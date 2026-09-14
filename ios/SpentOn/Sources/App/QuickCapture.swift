import SwiftUI

enum BudgetTab: String { case home, categories, activity, accounts, people }
@MainActor @Observable final class NavigationContext {
    var tab: BudgetTab = .home
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--sample") && ProcessInfo.processInfo.arguments.contains("--people") { tab = .people }
        #endif
    }
    var categoryID = ""
    var accountID = ""
    var people = ExpensePeopleDraft()
    var requiredBudgetID = ""
}

struct QuickCapture: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    @Environment(\.dismiss) private var dismiss
    let openDetails: (QuickEntry) -> Void
    let create: (RecordKind) -> Void
    let plan: () -> Void
    let scan: () -> Void
    @State private var query = ""
    @State private var categoryID = ""
    @State private var accountID = ""
    @State private var additions: [StructureDraft] = []
    @State private var panel: Panel?
    private enum Panel: String, Identifiable { case category, account; var id: String { rawValue } }
    @State private var error: String?
    @State private var editorID = UUID()
    @State private var initialized = false
    @State private var discarded = false
    @State private var initialCategory = ""
    @State private var initialAccount = ""
    @FocusState private var focused: Bool

    private var data: Overview? { additions.isEmpty ? store.overview : (try? store.structureOverview(additions)) }
    private var workingBudget: JSONValue? { store.snapshot.flatMap { try? store.adding(additions, to: $0.budget) } }
    private var dirty: Bool { !query.isEmpty || !additions.isEmpty || categoryID != initialCategory || accountID != initialAccount }

    private var entry: QuickEntry {
        guard let data else { return QuickEntry() }
        var value = QuickEntry.parse(query, data: data, categoryID: categoryID, accountID: accountID)
        value.additions = additions
        if !data.accounts.contains(where: { $0.id == value.accountID && $0.type != "investment" }) { value.accountID = data.accounts.first { $0.type != "investment" }?.id ?? "" }
        return value
    }
    private var command: [String: String] { ["kind": "expense", "amount": entry.amount, "payee": entry.payee, "categoryId": entry.categoryID, "accountId": entry.accountID] }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                        TextField("12.45 groceries", text: $query).font(.body).autocorrectionDisabled().textInputAutocapitalization(.sentences).focused($focused).submitLabel(.done).onSubmit { focused = false }
                            .accessibilityLabel("Quick entry")
                        if !query.isEmpty { Button("Clear", systemImage: "xmark.circle.fill") { query = "" }.labelStyle(.iconOnly).foregroundStyle(Brand.secondary).frame(width: 44, height: 44).contentShape(Rectangle()) }
                    }.padding(.leading, 16).padding(.trailing, query.isEmpty ? 16 : 4).frame(minHeight: 56).glassEffect(.regular, in: .capsule)
                    if let data {
                        if !entry.amount.isEmpty || !additions.isEmpty { review(data) }
                        else {
                            Text(navigation.tab == .categories ? "Plan, create, or record a purchase." : navigation.tab == .accounts ? "Add an account or record a transaction." : "Type an amount and a payee or category.").font(.subheadline).foregroundStyle(Brand.secondary)
                            if !dirty && navigation.tab == .categories {
                                action("Plan your money", symbol: "tray.and.arrow.down", run: plan)
                                action("Add category", symbol: "square.grid.2x2", run: { create(.category) })
                            } else if !dirty && navigation.tab == .accounts { action("Add account", symbol: "wallet.bifold", run: { create(.account) }) }
                            if !dirty { action("Scan a bill", symbol: "doc.text.viewfinder", run: scan) }
                            action("Enter details", symbol: "plus.circle", run: { handoff(entry) })
                            if query.isEmpty {
                                Text("Recently used").font(.caption.weight(.medium)).foregroundStyle(Brand.secondary)
                                ForEach(CategoryDirectory(data.categories).recent(in: data.transactions, limit: 3)) { category in
                                    Button { var seed = entry; seed.categoryID = category.id; seed.userEntered = true; handoff(seed) } label: {
                                        HStack(spacing: 12) { CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 30); Text(category.name).font(.subheadline); Spacer(); Text(data.money(category.available)).font(.caption).foregroundStyle(Brand.secondary) }.frame(minHeight: 44).contentShape(Rectangle())
                                    }.buttonStyle(ContentRowStyle())
                                }
                            } else {
                                ForEach(Array(CategoryDirectory(data.categories).matching(query).prefix(6))) { category in
                                    action("Use \(category.name)", symbol: categorySymbol(category.icon), run: { var seed = entry; seed.categoryID = category.id; seed.userEntered = true; handoff(seed) })
                                }
                            }
                        }
                    }
                    if let problem = entry.problem { Text(problem).font(.subheadline).foregroundStyle(Brand.danger) }
                    if let error { Text(error).font(.subheadline).foregroundStyle(Brand.danger) }
                }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively).background(Brand.canvas).disabled(store.busy)
                .navigationTitle("Quick add").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { discarded = true; dismiss() }.labelStyle(.iconOnly).disabled(store.busy).accessibilityIdentifier("quick-cancel") } }
                .interactiveDismissDisabled(dirty || store.busy)
                .sheet(item: $panel) { panel in
                    if let data {
                        switch panel {
                        case .category: CategoryPickerSheet(data: data, selection: $categoryID, creationBase: workingBudget, onCreate: { additions.append($0) })
                        case .account: AccountPickerSheet(title: "Account", data: data, accounts: data.accounts.filter { $0.type != "investment" }, selection: $accountID, creationBase: workingBudget, allowedAccountTypes: ["checking", "savings", "credit"], onCreate: { additions.append($0) })
                        }
                    }
                }
                .task {
                    store.beginEditing(editorID)
                    guard !initialized else { return }
                    categoryID = navigation.categoryID; accountID = navigation.accountID
                    initialCategory = categoryID; initialAccount = accountID; initialized = true
                }
                .onDisappear { store.endEditing(editorID) }
                .editorSaveState()

        }
    }
    private func handoff(_ entry: QuickEntry) { discarded = true; openDetails(entry) }
    private var previewProblem: String? {
        guard !entry.amount.isEmpty, !entry.categoryID.isEmpty, !entry.accountID.isEmpty else { return nil }
        do { _ = try store.preview(command, additions: additions); return nil } catch { return error.localizedDescription }
    }
    private func action(_ label: String, symbol: String, run: @escaping () -> Void) -> some View {
        Button(action: run) { HStack(spacing: 12) { Image(systemName: symbol).foregroundStyle(Brand.sage).frame(width: 28); Text(label).font(.subheadline.weight(.medium)); Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Brand.secondary) }.frame(minHeight: 44).contentShape(Rectangle()) }.buttonStyle(ContentRowStyle())
    }
    private func review(_ data: Overview) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(entry.amount.isEmpty ? "0.00" : entry.amount).font(.title2.weight(.semibold)).monospacedDigit()
                Text(data.currency).font(.subheadline).foregroundStyle(Brand.secondary)
                Spacer()
            }
            if !entry.payee.isEmpty { Text(entry.payee).font(.subheadline) }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { categoryChip(data); accountChip(data) }.fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 8) { categoryChip(data); accountChip(data) }
            }
            if !additions.isEmpty { Text("Any new category or account will be saved with this transaction.").font(.caption).foregroundStyle(Brand.secondary) }
            if entry.matchedHistory { Text("Suggested from your previous purchases. Check before saving.").font(.caption).foregroundStyle(Brand.secondary) }
            if let preview = try? store.preview(command, additions: additions), let category = preview.categories.first(where: { $0.id == entry.categoryID }) {
                Text(category.available < 0 ? "This category will be overspent by \(preview.money(-category.available))." : "\(preview.money(category.available)) will be left in this category.").font(.caption).foregroundStyle(category.available < 0 ? Brand.danger : Brand.sage)
            }
            if let problem = previewProblem { Text(problem).font(.caption).foregroundStyle(Brand.danger) }
            ViewThatFits(in: .horizontal) {
                HStack { detailsButton; Spacer(); saveButton }
                VStack(alignment: .leading, spacing: 8) { saveButton; detailsButton }
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Brand.surface, in: .rect(cornerRadius: 22))
    }
    private func categoryChip(_ data: Overview) -> some View {
        Button { focused = false; panel = .category } label: {
            Label(data.categories.first { $0.id == entry.categoryID }?.name ?? "Choose category", systemImage: data.categories.first { $0.id == entry.categoryID }.map { categorySymbol($0.icon) } ?? "square.grid.2x2")
                .font(.subheadline).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 12).padding(.vertical, 10).frame(minHeight: 44)
                .background(Brand.sage.opacity(0.08), in: .rect(cornerRadius: 16))
        }.buttonStyle(ContentRowStyle()).foregroundStyle(Brand.sage).accessibilityIdentifier("quick-category")
    }
    private func accountChip(_ data: Overview) -> some View {
        Button { focused = false; panel = .account } label: {
            Label(data.accounts.first { $0.id == entry.accountID }?.name ?? "Choose account", systemImage: accountSymbol(data.accounts.first { $0.id == entry.accountID }?.type ?? "checking"))
                .font(.subheadline).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 12).padding(.vertical, 10).frame(minHeight: 44)
                .background(Brand.sage.opacity(0.08), in: .rect(cornerRadius: 16))
        }.buttonStyle(ContentRowStyle()).foregroundStyle(Brand.sage).accessibilityIdentifier("quick-account")
    }
    private var detailsButton: some View {
        Button("Details", systemImage: "slider.horizontal.3") { handoff(entry) }.font(.subheadline).frame(minHeight: 44).accessibilityLabel("Review all details")
    }
    private var saveButton: some View {
        Button("Save transaction", systemImage: "checkmark") {
            focused = false
            Task { if await store.change(command, additions: additions) { dismiss() } else { error = store.message } }
        }.font(.subheadline.weight(.semibold)).primaryAction()
            .disabled(entry.amount.isEmpty || entry.categoryID.isEmpty || entry.accountID.isEmpty || previewProblem != nil || store.busy || store.pending != nil)
    }
}
