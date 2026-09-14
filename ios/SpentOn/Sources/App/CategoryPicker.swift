import SwiftUI

struct CategoryPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let data: Overview
    @Binding var selection: String
    @State private var search = ""
    @State private var creating = false
    private let creationBase: JSONValue?
    private let creationContext: CreationContext
    private let onCreate: ((StructureDraft) -> Void)?
    private let directory: CategoryDirectory

    init(data: Overview, selection: Binding<String>, creationBase: JSONValue? = nil, creationContext: CreationContext = .transaction, onCreate: ((StructureDraft) -> Void)? = nil) {
        self.data = data
        _selection = selection
        directory = CategoryDirectory(data.categories)
        self.creationBase = creationBase; self.creationContext = creationContext; self.onCreate = onCreate
    }

    var body: some View {
        NavigationStack {
            let matches = directory.matching(search)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        let recent = directory.recent(in: data.transactions)
                        if !recent.isEmpty { categorySection("Recently used", categories: recent) }
                    }
                    if matches.isEmpty {
                        ContentUnavailableView {
                            Label(data.categories.isEmpty ? "No categories yet" : "No matching categories", systemImage: "magnifyingglass")
                        } description: {
                            Text(data.categories.isEmpty ? "Add a category to record your first purchase." : "Try a category, group, or parent category name.")
                        } actions: {
                            if !search.isEmpty { Button("Clear search") { search = "" } }
                        }
                    } else {
                        ForEach(Array(Set(matches.map(\.group))).sorted(), id: \.self) { group in
                            categorySection(group, categories: matches.filter { $0.group == group })
                        }
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }
            .background(Brand.canvas)
            .navigationTitle("Choose category").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search categories or groups")
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.accessibilityIdentifier("category-picker-cancel") }
                ToolbarItem(placement: .primaryAction) { if creationBase != nil { Button("Add category", systemImage: "plus") { creating = true }.labelStyle(.iconOnly).accessibilityIdentifier("picker-add-category") } }
            }
            .safeAreaInset(edge: .bottom) { if creationBase != nil { Button("Add category", systemImage: "plus.circle") { creating = true }.font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44).padding(8).background(Brand.canvas).accessibilityIdentifier("picker-create-category") } }
            .sheet(isPresented: $creating) {
                if let creationBase { RecordCreationSheet(kind: .category, base: creationBase, context: creationContext, onUse: { draft in onCreate?(draft); selection = draft.id; dismiss() }) }
            }
        }
    }

    private func categorySection(_ title: String, categories: [BudgetCategory]) -> some View {
        Section {
            ForEach(categories) { category in
                Button {
                    selection = category.id
                    dismiss()
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 34)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(category.name).font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                            Text(directory.context(for: category)).font(.caption).foregroundStyle(Brand.secondary)
                            Text("\(data.money(category.available)) left").font(.caption).monospacedDigit().foregroundStyle(category.available < 0 ? Brand.danger : Brand.sage)
                        }
                        Spacer(minLength: 0)
                        if selection == category.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.sage).accessibilityHidden(true) }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(selection == category.id ? Brand.sage.opacity(0.10) : Brand.surface, in: .rect(cornerRadius: 14))
                    .contentShape(.rect(cornerRadius: 22))
                }
                .buttonStyle(ContentRowStyle())
                .accessibilityLabel(category.name)
                .accessibilityValue("\(directory.context(for: category)), \(data.money(category.available)) left")
                .accessibilityAddTraits(selection == category.id ? [.isSelected] : [])
                .accessibilityIdentifier("category-option-\(category.id)")
            }
        } header: {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(Brand.secondary).padding(.top, 12).accessibilityAddTraits(.isHeader)
        }
    }
}

struct CategoryGlyph: View {
    let icon: String
    var color = "sage"
    var size: CGFloat = 36
    var body: some View {
        Image(systemName: categorySymbol(icon)).font(.system(size: size * 0.46)).foregroundStyle(categoryTint(color))
            .frame(width: size, height: size).background(categoryTint(color).opacity(0.10), in: .rect(cornerRadius: size * 0.3)).accessibilityHidden(true)
    }
}

struct AccountPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let data: Overview
    let accounts: [BudgetAccount]
    @Binding var selection: String
    @State private var search = ""
    var creationBase: JSONValue? = nil
    var allowedAccountTypes = ["checking", "savings", "credit", "investment"]
    var onCreate: ((StructureDraft) -> Void)? = nil
    @State private var creating = false
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    let matches = accounts.filter { search.isEmpty || $0.name.localizedStandardContains(search) }
                    if matches.isEmpty {
                        ContentUnavailableView(accounts.isEmpty ? "No eligible accounts" : "No matching accounts", systemImage: "wallet.bifold", description: Text(accounts.isEmpty ? "Add an account to continue this transaction." : "Try another account name."))
                    }
                    ForEach(matches) { account in
                        Button { selection = account.id; dismiss() } label: {
                            HStack(spacing: 14) {
                                Image(systemName: account.type == "credit" ? "creditcard" : "building.columns").font(.title2).foregroundStyle(Brand.sage).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(account.name).font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink)
                                    Text(data.money(account.balance)).font(.subheadline).monospacedDigit().foregroundStyle(Brand.secondary)
                                }
                                Spacer(minLength: 0)
                                if selection == account.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.sage) }
                            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Brand.surface, in: .rect(cornerRadius: 16))
                        }.buttonStyle(ContentRowStyle()).accessibilityIdentifier("account-option-\(account.id)")
                            .accessibilityAddTraits(selection == account.id ? [.isSelected] : [])
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(Brand.canvas)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search accounts")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .safeAreaInset(edge: .bottom) { if creationBase != nil { Button("Add account", systemImage: "plus.circle") { creating = true }.font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44).padding(8).background(Brand.canvas).accessibilityIdentifier("picker-create-account") } }
                .sheet(isPresented: $creating) {
                    if let creationBase { RecordCreationSheet(kind: .account, base: creationBase, context: .transaction, allowedAccountTypes: allowedAccountTypes, onUse: { draft in onCreate?(draft); selection = draft.id; dismiss() }) }
                }
        }
    }
}
