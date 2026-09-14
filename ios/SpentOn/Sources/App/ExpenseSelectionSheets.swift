import SwiftUI

struct ExpenseCategoryPicker: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    let base: JSONValue
    let scopeID: String
    let onUse: (String, [ExpenseCategoryAmount], String, [StructureDraft]) -> Void
    @State private var selected: Set<String>
    @State private var amounts: [String:String]
    @State private var total: String
    @State private var equal: Bool
    @State private var query = ""
    @State private var additions: [StructureDraft] = []
    @State private var creating = false
    @State private var discarded = false
    @State private var initialized = false
    @State private var editorID = UUID()
    init(base: JSONValue, scopeID: String, category: String, splits: [ExpenseCategoryAmount], total: String,
         onUse: @escaping (String, [ExpenseCategoryAmount], String, [StructureDraft]) -> Void) {
        self.base = base; self.scopeID = scopeID; self.onUse = onUse
        _selected = State(initialValue: Set(splits.isEmpty ? (category.isEmpty ? [] : [category]) : splits.map(\.categoryId)))
        _amounts = State(initialValue: Dictionary(uniqueKeysWithValues: splits.map { ($0.categoryId,$0.amount) }))
        _total = State(initialValue: total); _equal = State(initialValue: splits.isEmpty)
    }
    private var working: JSONValue? { try? store.adding(additions, to: base) }
    private var data: Overview? { working.flatMap { try? store.requireEngine().run("overview", budget: $0) } }
    private var ids: [String] { data?.categories.filter { selected.contains($0.id) }.map(\.id) ?? [] }
    private var value: Int64 { (try? store.requireEngine().run("parseAmount", command: ["amount":total], as: Int64.self)) ?? 0 }
    private var lines: [ExpenseCategoryAmount] {
        guard !ids.isEmpty else { return [] }
        let count = Int64(ids.count)
        return ids.enumerated().map { index,id in
            ExpenseCategoryAmount(categoryId: id, amount: equal ? decimal(value/count + (Int64(index) < value%count ? 1 : 0)) : amounts[id] ?? "")
        }
    }
    private var ready: Bool {
        guard !ids.isEmpty else { return false }
        if ids.count == 1 { return true }
        var remaining = value
        guard remaining > 0 else { return false }
        for line in lines {
            guard let amount: Int64 = try? store.requireEngine().run("parseAmount", command: ["amount":line.amount]), amount > 0, amount <= remaining else { return false }
            remaining -= amount
        }
        return remaining == 0
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(ids.count > 1 ? "\(ids.count) categories" : "Choose one or more categories.").font(.subheadline).foregroundStyle(Brand.secondary)
                    searchField
                    if ids.count > 1, let data {
                        FinancePanel {
                            HStack {
                                Text("Purchase total").font(.subheadline)
                                Spacer()
                                Text(currencyMark(data.currency)).foregroundStyle(Brand.secondary)
                                TextField("Total", text: $total).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 130).accessibilityLabel("Purchase total")
                            }
                        }
                        Picker("Category amounts", selection: Binding(get: { equal }, set: { next in
                            if equal && !next { amounts = Dictionary(uniqueKeysWithValues: lines.map { ($0.categoryId,$0.amount) }) }
                            equal = next
                        })) { Text("Equally").tag(true); Text("Exact amounts").tag(false) }.pickerStyle(.segmented)
                    }
                    if let data {
                        FinanceRows {
                            let categories = CategoryDirectory(data.categories).matching(query)
                            ForEach(categories) { category in
                                categoryRow(category, currency: data.currency)
                                if category.id != categories.last?.id { FinanceDivider() }
                            }
                        }
                    }
                    if ids.count > 1 && !ready {
                        Label("The category amounts must add up to the purchase total.", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(Brand.danger)
                    }
                    Button("Add categories", systemImage: "plus") { creating = true }.font(.subheadline).frame(minHeight: 44)
                }.padding(24)
            }.background(Brand.canvas).navigationTitle("Categories").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { discarded = true; dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            guard ready, let first = ids.first else { return }
                            onUse(first, ids.count > 1 ? lines : [], total, additions)
                            discarded = true; dismiss()
                        } label: { Text("Done").foregroundStyle(ready ? Color.white : Brand.secondary) }
                            .buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready)
                    }
                }
                .sheet(isPresented: $creating) {
                    if let working { BatchCategoryCreation(base: working, context: .transaction, onUse: {
                        additions.append(contentsOf: $0); selected.formUnion($0.map(\.id))
                    }) }
                }
                .onAppear { store.beginEditing(editorID); initialized = true }
                .onDisappear { store.endEditing(editorID) }

        }
    }
    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
            TextField("Find a category", text: $query).font(.subheadline)
        }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
    }
    private func toggle(_ id: String) { if selected.contains(id) { selected.remove(id) } else { selected.insert(id) } }
    private func decimal(_ value: Int64) -> String { NSDecimalNumber(value: value).dividing(by: 100).stringValue }
    private func amountField(_ category: BudgetCategory, currency: String) -> some View {
        HStack(spacing: 6) {
            Text(currencyMark(currency)).foregroundStyle(Brand.secondary)
            TextField("Amount", text: Binding(get: { lines.first { $0.categoryId == category.id }?.amount ?? "" }, set: { next in
                if equal { amounts = Dictionary(uniqueKeysWithValues: lines.map { ($0.categoryId,$0.amount) }); equal = false }
                amounts[category.id] = next
            })).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityLabel(category.name + " amount")
        }.padding(10).background(Brand.canvas, in: .rect(cornerRadius: 12))
    }
    private func categoryRow(_ category: BudgetCategory, currency: String) -> some View {
        let chosen = selected.contains(category.id)
        let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            Button { toggle(category.id) } label: {
                HStack(spacing: 12) {
                    CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 28)
                    Text(category.name).foregroundStyle(Brand.ink).frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: chosen ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen ? Brand.sage : Brand.secondary)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel(category.name).accessibilityValue(chosen ? "Selected" : "Not selected").accessibilityIdentifier("category-option-" + category.id)
            if chosen && ids.count > 1 { amountField(category, currency: currency).frame(width: textSize.isAccessibilitySize ? 170 : 110) }
        }.font(.subheadline).padding(20).frame(minHeight: 64)
    }
}

struct ExpensePeoplePicker: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let currency: String
    let scopeID: String
    let receiptAvailable: Bool
    let onUse: (ExpensePeopleDraft, String) -> Void
    @State private var working: ExpensePeopleDraft
    @State private var totalText: String
    @State private var directory: [PrivatePerson] = []
    @State private var groups: [ExpenseGroupSummary] = []
    @State private var group: ExpenseGroupDetail?
    @State private var desiredGroupID: String
    @State private var groupRequest = UUID()
    @State private var selectingGroup = false
    @State private var query = ""
    @State private var error: String?
    @State private var loaded = false
    @State private var discarded = false
    @State private var editorID = UUID()
    private let needsAmount: Bool
    init(selection: ExpensePeopleDraft, total: String, currency: String, scopeID: String, receiptAvailable: Bool,
         onUse: @escaping (ExpensePeopleDraft, String) -> Void) {
        _working = State(initialValue: selection); _totalText = State(initialValue: total)
        _desiredGroupID = State(initialValue: selection.groupId)
        self.currency = currency; self.scopeID = scopeID; self.receiptAvailable = receiptAvailable; self.onUse = onUse
        needsAmount = total.isEmpty
    }
    private var total: Int64 { (try? store.requireEngine().run("parseAmount", command: ["amount":totalText], as: Int64.self)) ?? 0 }
    private var shares: [Int64]? { try? working.shares(total: total, engine: store.requireEngine()) }
    private var ready: Bool { !selectingGroup && (working.people.isEmpty ? working.groupId.isEmpty : shares != nil && (working.groupId.isEmpty || group?.id == working.groupId)) }
    private var rows: [PrivatePerson] {
        var result = directory
        for person in working.people where !result.contains(where: { $0.id == person.id }) { result.append(.init(id: person.id,name: person.name,email: person.email)) }
        return result.filter { query.isEmpty || ($0.name + $0.email).localizedCaseInsensitiveContains(query.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Choose everyone sharing this expense. You’re included.").font(.subheadline).foregroundStyle(Brand.secondary)
                    if needsAmount {
                        FinancePanel {
                            HStack { Text(currencyMark(currency)); TextField("Purchase total", text: $totalText).keyboardType(.decimalPad).accessibilityLabel("Purchase total") }.font(.title2)
                        }
                    }
                    if let shares {
                        FinancePanel {
                            LabeledContent("Purchase total", value: SharedMoney.format(total,currency))
                            LabeledContent("Your share", value: SharedMoney.format(total-shares.reduce(0,+),currency))
                        }.font(.subheadline)
                    }
                    HStack {
                        Text("People").font(.headline); Spacer()
                        Menu {
                            Button("No group") { desiredGroupID="";groupRequest=UUID();selectingGroup=false;working.groupId = ""; working.groupName = ""; working.groupRevision = nil; group = nil }
                            ForEach(groups) { group in Button(group.name) { desiredGroupID=group.id;Task { await chooseGroup(group.id, replace: true) } } }
                        } label: {
                            Label(working.groupName.isEmpty ? "Use a group" : working.groupName, systemImage: "person.3").font(.subheadline).frame(minHeight: 32)
                        }.buttonStyle(.glass).disabled(groups.isEmpty && working.groupId.isEmpty)
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                        TextField("Find or add a person", text: $query).font(.subheadline).disabled(selectingGroup)
                    }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                    if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                        !rows.contains(where: { $0.name.caseInsensitiveCompare(query.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame || $0.email.caseInsensitiveCompare(query.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame }) {
                        Button("Add “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”", systemImage: "person.badge.plus", action: addTyped)
                            .font(.subheadline).frame(minHeight: 44).disabled(working.people.count >= 20 || (group != nil && group?.canManage == false))
                    }
                    if selectingGroup { ProgressView("Loading group") }
                    FinanceRows {
                        ForEach(rows) { person in
                            let index = working.people.firstIndex { $0.id == person.id }
                            let member = group?.members.first { ($0.personKey ?? $0.id) == person.id }
                            Button {
                                if let index { working.people.remove(at: index) }
                                else if working.people.count < 20 {
                                    working.people.append(.init(id:person.id,name:person.name,email:person.email,memberId:member?.id))
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    PersonAvatar(email: person.id,name: person.name,size: 34)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(person.name).foregroundStyle(Brand.ink)
                                        if let index, let shares, working.method == .equal { Text(SharedMoney.format(shares[index],currency)).font(.caption).foregroundStyle(Brand.secondary) }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                    Image(systemName: index == nil ? "circle" : "checkmark.circle.fill").foregroundStyle(index == nil ? Brand.secondary : Brand.sage)
                                }.font(.subheadline).padding(20).frame(minHeight: 64).contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(index == nil && group != nil && group?.canManage == false && member == nil)
                            if person.id != rows.last?.id { FinanceDivider() }
                        }
                    }.disabled(selectingGroup)
                    if !working.people.isEmpty {
                        Picker("How to split", selection: Binding(get: { working.method }, set: { method in
                            if method == .amount, let values = shares { for index in working.people.indices { working.people[index].amount = NSDecimalNumber(value:values[index]).dividing(by:100).stringValue } }
                            working.method = method
                        })) { Text("Equally").tag(SharedSplitMethod.equal); Text("Exact amounts").tag(SharedSplitMethod.amount) }.pickerStyle(.segmented)
                        if working.method == .amount {
                            FinanceRows {
                                ForEach($working.people) { $person in
                                    HStack {
                                        Text(person.name).font(.subheadline); Spacer()
                                        Text(currencyMark(currency)).foregroundStyle(Brand.secondary)
                                        TextField("Share", text: $person.amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 130).accessibilityLabel(person.name + " share")
                                    }.padding(20)
                                }
                            }
                        }
                        if receiptAvailable {
                            FinancePanel {
                                Toggle("Include the bill", isOn: $working.includeReceipt)
                                if working.includeReceipt { Text("The bill will be visible to the people sharing this expense.").font(.caption).foregroundStyle(Brand.secondary) }
                            }
                        }
                        if let group, working.people.contains(where: { $0.memberId == nil }) {
                            Text("New people will also be added to \(group.name) when you save.").font(.caption).foregroundStyle(Brand.secondary)
                        }
                        Text("Only your share counts as your spending.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                    if store.sharingVerificationRequired { Text("Verify your email in account settings before saving shared expenses.").font(.subheadline).foregroundStyle(Brand.secondary) }
                    if !ready && total > 0 { Text("Check each share, or choose No group to keep the expense personal.").font(.caption).foregroundStyle(Brand.danger) }
                    if let error { Notice(message: error); Button("Try again") { Task { await load() } } }
                    if !loaded { ProgressView("Loading people") }
                }.padding(24)
            }.background(Brand.canvas).navigationTitle("People").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { discarded = true; dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button { onUse(working,totalText); discarded = true; dismiss() } label: { Text("Done").foregroundStyle(ready ? Color.white : Brand.secondary) }
                            .buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready)
                    }
                }
                .task { store.beginEditing(editorID); await load() }
                .onDisappear { store.endEditing(editorID) }

        }
    }
    private func load() async {
        do {
            _ = try await store.sharedInbox()
            directory = try await store.peopleDirectory().people
            if store.groupsAvailable {
                groups = try await store.expenseGroups().groups.filter { $0.membership == "active" && $0.state == "active" && $0.currency == currency }
            }
            error = nil
            if !working.groupId.isEmpty { desiredGroupID=working.groupId;await chooseGroup(working.groupId,replace:false) }
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
    private func chooseGroup(_ id: String, replace: Bool) async {
        guard !id.isEmpty,desiredGroupID==id else{return}
        let request=UUID();groupRequest=request;selectingGroup=true
        defer{if groupRequest==request{selectingGroup=false}}
        do {
            let selected = try await store.expenseGroup(id)
            guard groupRequest==request,desiredGroupID==id else{return}
            guard selected.budgetId == store.snapshot?.id else { error = "Open the budget linked to this group, or choose No group."; return }
            group = selected; working.groupId = selected.id; working.groupName = selected.name; working.groupRevision = selected.revision
            if replace {
                working.people = selected.members.filter { !$0.isYou && $0.state != "removed" }.map {
                    .init(id:$0.personKey ?? $0.id,name:$0.name,email:$0.email ?? "",memberId:$0.id)
                }
                working.method = .equal
            }
            error = nil
        } catch { if groupRequest==request{self.error = error.localizedDescription} }
    }
    private func addTyped() {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 100, working.people.count < 20 else { error = "Enter a name with up to 100 characters."; return }
        if value.contains("@") {
            guard value.range(of: #"^\S+@[^\s@]+\.[^\s@]+$"#,options:.regularExpression) != nil && value.lowercased() != store.user?.email.lowercased() else {
                error = "Enter another person’s name or valid email."; return
            }
            working.people.append(.init(name:value.components(separatedBy:"@").first ?? value,email:value.lowercased()))
        } else { working.people.append(.init(name:value)) }
        query = ""; error = nil
    }
}
