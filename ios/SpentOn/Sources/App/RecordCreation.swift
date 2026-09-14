import SwiftUI

enum RecordKind: String, Identifiable { case category, account; var id: String { rawValue } }
enum CreationContext {
    case budget, transaction, plan, setup
    var explanation: String {
        switch self {
        case .budget: "This will be saved to your SpentOn budget."
        case .transaction: "This will be saved together with your transaction."
        case .plan: "This will be saved when you set money aside."
        case .setup: "This will be saved when you create your budget."
        }
    }
}

struct RecordCreationSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let kind: RecordKind
    let base: JSONValue
    var context: CreationContext = .budget
    var allowedAccountTypes = ["checking", "savings", "credit", "investment"]
    var initialParent = ""
    var initialGroup = ""
    var onUse: ((StructureDraft) -> Void)?
    @State private var recordID = UUID().uuidString.lowercased()
    @State private var editorID = UUID()
    @State private var name = ""
    @State private var group = ""
    @State private var parentID = ""
    @State private var icon = "basket"
    @State private var color = "sage"
    @State private var accountType = "checking"
    @State private var amount = ""
    @State private var position = "owed"
    @State private var reserveCash = false
    @State private var reserveAmount = ""
    @State private var choosingParent = false
    @State private var showAppearance = false
    @State private var error: String?
    @State private var original: [String: String]?
    @State private var discarded = false
    @State private var restoredAccountType: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: Bool

    private var command: [String: String] {
        ["id": recordID, "kind": kind.rawValue, "name": name, "group": group, "parentId": parentID, "icon": icon, "color": color,
         "type": accountType, "amount": amount, "position": position, "reserve": reserveCash && accountType == "credit" && position == "owed" ? reserveAmount : "0"]
    }
    private var title: String { kind == .category ? "Add category" : "Add account" }
    private var action: String { (context == .budget ? "Save " : "Use ") + kind.rawValue }
    private var data: Overview? { try? store.requireEngine().run("overview", budget: base) }
    private var dirty: Bool { reserveCash || (original.map { $0 != command } ?? false) }
    private var preview: Overview? {
        var sample = command
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { sample["name"] = "New " + kind.rawValue }
        guard let budget: JSONValue = try? store.requireEngine().run("structure", budget: base, command: sample) else { return nil }
        return try? store.requireEngine().run("overview", budget: budget)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if kind == .category { categoryFields } else { accountFields }
                    }.padding(24).frame(maxWidth: 600).frame(maxWidth: .infinity)
                }.scrollDismissesKeyboard(.interactively).disabled(store.busy)
                VStack(alignment: .leading, spacing: 12) {
                    if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(Brand.danger).accessibilityAddTraits(.updatesFrequently) }
                    Text(context.explanation).foregroundStyle(Brand.secondary)
                    Button(action: save) {
                        HStack { Spacer(); if store.busy { ProgressView().tint(.white) } else { Image(systemName: "checkmark").accessibilityHidden(true) }; Text(store.busy ? "Saving…" : action).font(.headline); Spacer() }.padding(.vertical, 4)
                    }.primaryAction()
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy)
                        .accessibilityIdentifier("save-\(kind.rawValue)")
                }.font(.caption).padding(20).frame(maxWidth: 648).frame(maxWidth: .infinity)
            }.background(Brand.canvas)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark") { focused = false; discarded = true; dismiss() }
                            .labelStyle(.iconOnly).disabled(store.busy).accessibilityIdentifier("cancel-creation")
                    }
                    ToolbarItem(placement: .topBarTrailing) { if focused { Button("Hide keyboard", systemImage: "keyboard.chevron.compact.down") { focused = false }.labelStyle(.iconOnly) } }
                }
                .interactiveDismissDisabled(dirty || store.busy)
                .sheet(isPresented: $choosingParent) {
                    if let data { CategoryParentSheet(data: data, selection: $parentID) }
                }
                .onChange(of: accountType) { _, new in if restoredAccountType == new { restoredAccountType = nil; return }; position = accountType == "credit" ? "owed" : "positive"; reserveCash = false; error = nil }
                .onChange(of: parentID) { _, _ in if let parent = data?.categories.first(where: { $0.id == parentID }) { group = parent.group } }
                .onChange(of: command) { _, _ in error = nil }
                .task {
                    store.beginEditing(editorID)
                    guard original == nil else { return }
                    parentID = initialParent
                    group = initialGroup.isEmpty ? data?.groups?.sorted().first ?? "Everyday essentials" : initialGroup
                    accountType = allowedAccountTypes.first ?? "checking"
                    position = accountType == "credit" ? "owed" : "positive"
                    original = command
                }
                .onDisappear { store.endEditing(editorID) }
                .editorSaveState()
                .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: reserveCash)
                .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: showAppearance)

        }
    }

    private var categoryFields: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 16) {
                CategoryGlyph(icon: icon, color: color)
                VStack(alignment: .leading, spacing: 5) {
                    Text(name.isEmpty ? "A category for what matters." : name).font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Text("Keep spending and savings easy to find.").font(.subheadline).foregroundStyle(Brand.secondary)
                }
            }
            field("Category name", placeholder: "For example, Weekend trips", text: $name, identifier: "category-name")
            VStack(alignment: .leading, spacing: 10) {
                Text("Organize under").font(.subheadline.weight(.semibold))
                Button { focused = false; choosingParent = true } label: {
                    HStack { Text(data?.categories.first { $0.id == parentID }?.name ?? "Main category"); Spacer(); Image(systemName: "chevron.down") }.padding(16)
                        .background(Brand.sage.opacity(0.08), in: .rect(cornerRadius: 18))
                }.buttonStyle(ContentRowStyle()).foregroundStyle(Brand.sage).accessibilityIdentifier("category-parent")
            }
            if parentID.isEmpty {
                field("Group", placeholder: "For example, Looking ahead", text: $group, identifier: "category-group")
                if let groups = data?.groups, !groups.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) { ForEach(groups.sorted(), id: \.self) { value in Button(value) { group = value; focused = false }.buttonStyle(.bordered).tint(Brand.sage).controlSize(.large) } }
                    }.scrollIndicators(.hidden)
                }
            } else { Text("This subcategory belongs to \(group).").font(.subheadline).foregroundStyle(Brand.secondary) }
            Button { focused = false; showAppearance.toggle() } label: {
                Label(showAppearance ? "Hide appearance" : "Choose icon and color", systemImage: "paintpalette").font(.subheadline.weight(.medium)).frame(minHeight: 44)
            }
            if showAppearance {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 52))], spacing: 12) {
                    ForEach(["basket", "home", "food", "coffee", "car", "plane", "heart", "paw", "baby", "study", "gift", "umbrella", "wallet", "music", "shirt", "laptop", "health", "phone", "bike", "zap", "repeat", "sparkles"], id: \.self) { value in
                        Button { icon = value } label: { CategoryGlyph(icon: value, color: color).padding(4).overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(icon == value ? Brand.sage : .clear, lineWidth: 2) } }
                            .accessibilityLabel("\(value.capitalized) icon").accessibilityAddTraits(icon == value ? [.isSelected] : [])
                    }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 52))], spacing: 12) {
                    ForEach(["sage", "sand", "blue", "butter", "lavender", "peach", "rose"], id: \.self) { value in
                        Button { color = value } label: {
                            Circle().fill(categoryTint(value)).frame(width: 36, height: 36).overlay { if color == value { Image(systemName: "checkmark").font(.headline).foregroundStyle(.white).shadow(radius: 1) } }.frame(width: 52, height: 52)
                        }.accessibilityLabel("\(value.capitalized) color").accessibilityAddTraits(color == value ? [.isSelected] : [])
                    }
                }
            }
            Text("You can set money aside after adding the category.").font(.subheadline).foregroundStyle(Brand.secondary)
        }
    }

    private var accountFields: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Bring your money together.").font(.title2.weight(.semibold))
                Text("Start with the balance shown by your bank today. This account is tracked manually.").font(.subheadline).foregroundStyle(Brand.secondary)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: dynamicTypeSize.isAccessibilitySize ? 1 : 2), spacing: 10) {
                ForEach(allowedAccountTypes, id: \.self) { type in
                    Button { accountType = type; focused = false } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack { Image(systemName: accountSymbol(type)); Spacer(); if accountType == type { Image(systemName: "checkmark.circle.fill") } }
                            Text(accountTitle(type)).font(.subheadline.weight(.semibold))
                        }.frame(maxWidth: .infinity, minHeight: 64, alignment: .leading).padding(16)
                            .background(Brand.sage.opacity(accountType == type ? 0.13 : 0.05), in: .rect(cornerRadius: 20))
                            .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(accountType == type ? Brand.sage : .clear, lineWidth: 1) }
                    }.buttonStyle(ContentRowStyle()).foregroundStyle(Brand.sage).accessibilityIdentifier("account-type-\(type)").accessibilityAddTraits(accountType == type ? [.isSelected] : [])
                }
            }
            field("Account name", placeholder: "For example, Everyday account", text: $name, identifier: "account-name")
            VStack(alignment: .leading, spacing: 10) {
                Text(accountType == "credit" ? (position == "credit" ? "Credit balance" : "Amount you owe") : accountType == "investment" ? "Current value" : "Current balance").font(.subheadline.weight(.semibold))
                HStack(alignment: .firstTextBaseline) {
                    Text(data?.currency ?? "").foregroundStyle(Brand.sage)
                    TextField("0.00", text: $amount).keyboardType(.decimalPad).font(.largeTitle.weight(.semibold)).monospacedDigit().focused($focused).accessibilityIdentifier("account-amount")
                }.padding(16).background(Brand.sage.opacity(0.06), in: .rect(cornerRadius: 20))
                Text("Balance as of \(Date.now.formatted(date: .abbreviated, time: .omitted)). Zero is okay.").font(.caption).foregroundStyle(Brand.secondary)
            }
            if accountType == "credit" {
                Picker("Card balance", selection: $position) { Text("I owe money").tag("owed"); Text("I have a credit").tag("credit") }.pickerStyle(.segmented)
                if position == "owed" {
                    Toggle(isOn: $reserveCash) { Label("Set aside cash for this debt", systemImage: "tray.and.arrow.down") }.tint(Brand.sage)
                        .onChange(of: reserveCash) { _, enabled in
                            if enabled && reserveAmount.isEmpty, let data, let debt: Int64 = try? store.requireEngine().run("parseAmount", command: ["amount": amount]) {
                                reserveAmount = NSDecimalNumber(value: max(0, min(debt, data.ready))).dividing(by: 100).stringValue
                            }
                        }
                    if reserveCash { field("Cash to set aside", placeholder: "0.00", text: $reserveAmount, identifier: "account-reserve", numeric: true) }
                    Text("Setting cash aside reduces Available to plan. It does not pay the card.").font(.caption).foregroundStyle(Brand.secondary)
                }
            } else if accountType != "investment" {
                Toggle(isOn: Binding(get: { position == "overdrawn" }, set: { position = $0 ? "overdrawn" : "positive" })) {
                    Label("This account is overdrawn", systemImage: "exclamationmark.circle")
                }.tint(Brand.sage)
            }
            if accountType == "investment" { Text("Investment value counts toward net worth. It is not available to plan or spend.").font(.subheadline).foregroundStyle(Brand.secondary) }
            if let preview {
                VStack(alignment: .leading, spacing: 14) {
                    Text("After saving").font(.subheadline.weight(.semibold))
                    MoneyStat(title: "Available to plan", value: preview.money(preview.ready))
                    if accountType == "credit", let card = preview.accounts.first(where: { $0.id == recordID })?.card { MoneyStat(title: "Card debt still needing cash", value: preview.money(card.unbacked)) }
                    if accountType == "investment" { MoneyStat(title: "Net worth", value: preview.money(preview.netWorth)) }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Brand.sage.opacity(0.07), in: .rect(cornerRadius: 24))
            }
        }
    }
    private func field(_ label: String, placeholder: String, text: Binding<String>, identifier: String, numeric: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label).font(.subheadline.weight(.semibold))
            TextField(placeholder, text: text).focused($focused).keyboardType(numeric ? .decimalPad : .default).submitLabel(.done).onSubmit { focused = false }
                .padding(16).background(Brand.surface, in: .rect(cornerRadius: 18)).accessibilityLabel(label).accessibilityIdentifier(identifier)
        }
    }
    private func save() {
        focused = false; error = nil
        do { let _: JSONValue = try store.requireEngine().run("structure", budget: base, command: command) }
        catch { self.error = error.localizedDescription; return }
        let draft = StructureDraft(command: command)
        if let onUse { discarded = true; onUse(draft); dismiss() }
        else { Task { if await store.createRecord(draft) { dismiss() } else { error = store.message } } }
    }
}

func accountTitle(_ type: String) -> String { ["checking": "Bank or cash", "savings": "Savings", "credit": "Credit card", "investment": "Investment"][type] ?? "Account" }
func accountSymbol(_ type: String) -> String { ["checking": "building.columns", "savings": "banknote", "credit": "creditcard", "investment": "chart.line.uptrend.xyaxis"][type] ?? "wallet.bifold" }

func categoryTint(_ color: String) -> Color {
    switch color {
    case "sand": Brand.sand
    case "blue": Brand.blue
    case "butter": Brand.butter
    case "lavender": Brand.lavender
    case "peach": Brand.peach
    case "rose": Brand.rose
    default: Brand.sage
    }
}

private struct CategoryParentSheet: View {
    @Environment(\.dismiss) private var dismiss
    let data: Overview
    @Binding var selection: String
    @State private var search = ""
    var body: some View {
        NavigationStack {
            BrandedList {
                Button("Main category") { selection = ""; dismiss() }
                ForEach(CategoryDirectory(data.categories.filter { $0.parentId == nil }).matching(search)) { category in
                    Button { selection = category.id; dismiss() } label: { VStack(alignment: .leading, spacing: 4) { Text(category.name); Text(category.group).font(.caption).foregroundStyle(Brand.secondary) }.padding(.vertical, 6) }
                        .accessibilityIdentifier("parent-\(category.id)")
                }
            }.scrollContentBackground(.hidden).background(Brand.canvas).navigationTitle("Organize under").navigationBarTitleDisplayMode(.inline)
                .searchable(text: $search, prompt: "Search main categories")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
