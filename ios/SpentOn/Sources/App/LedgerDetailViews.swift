import SwiftUI

enum LedgerEditorRoute: Identifiable {
    case reconcile(String), goal(String), statement(String), details(String), refund(String)
    var id: String {
        switch self {
        case .reconcile(let id): "reconcile:" + id
        case .goal(let id): "goal:" + id
        case .statement(let id): "statement:" + id
        case .details(let id): "details:" + id
        case .refund(let id): "refund:" + id
        }
    }
    var title: String {
        switch self {
        case .reconcile: "Reconcile"
        case .goal: "Savings goal"
        case .statement: "Statement details"
        case .details: "Transaction details"
        case .refund: "Record refund"
        }
    }
}

struct ReconcilePreview: Decodable { let cleared: Int64; let target: Int64; let difference: Int64 }

struct LedgerDetailEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let route: LedgerEditorRoute
    @State private var amount = ""
    @State private var note = ""
    @State private var name = ""
    @State private var date = Date.now
    @State private var due = Date.now
    @State private var categoryID = ""
    @State private var targetType = "balance"
    @State private var cap = ""
    @State private var minimum = ""
    @State private var negative = false
    @State private var reviewed = false
    @State private var deadline = false
    @State private var initialized = false
    @State private var discarded = false
    @State private var editorID = UUID()
    @State private var original: [String:String]?
    @State private var error: String?
    @FocusState private var typing: Bool
    private var data: Overview? { store.overview }
    private var entry: Transaction? {
        switch route {
        case .details(let id), .refund(let id): data?.transactions.first { $0.id == id }
        default: nil
        }
    }
    private var account: BudgetAccount? {
        switch route {
        case .reconcile(let id), .statement(let id): data?.accounts.first { $0.id == id }
        default: nil
        }
    }
    private var category: BudgetCategory? {
        if case .goal(let id) = route { return data?.categories.first { $0.id == id } }
        return nil
    }
    private var command: [String:String] {
        switch route {
        case .reconcile(let id):
            return ["kind":"reconcile","accountId":id,"amount":negative ? "-" + amount : amount,"date":groupDateKey(date),"note":note,"reviewed":String(reviewed)]
        case .goal(let id):
            return ["kind":"goal","categoryId":id,"amount":amount,"targetType":targetType,"targetCap":cap,"targetDate":deadline ? groupDateKey(due) : ""]
        case .statement(let id):
            return ["kind":"statement","accountId":id,"amount":amount,"minimum":minimum,"closed":groupDateKey(date),"due":groupDateKey(due)]
        case .details(let id):
            return ["kind":"editEntry","entryId":id,"payee":name,"note":note,"date":groupDateKey(date)]
        case .refund(let id):
            return ["kind":"refund","entryId":id,"categoryId":categoryID,"amount":amount,"date":groupDateKey(date),"note":note]
        }
    }
    private var reconciliation: ReconcilePreview? {
        guard case .reconcile = route, let budget = store.snapshot?.budget else { return nil }
        return try? store.requireEngine().run("reconcilePreview", budget: budget, command: command)
    }
    private var preview: Overview? { try? store.preview(command) }
    private var dirty: Bool { original.map { $0 != command } ?? false }
    private var ready: Bool {
        guard initialized, !store.busy, store.pending == nil, store.pendingShared == nil else { return false }
        if case .details = route { return preview != nil }
        return !amount.isEmpty && preview != nil
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let data {
                        fields(data)
                        if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger) }
                        if case .reconcile = route { }
                        else if let preview, dirty {
                            FinancePanel {
                                Text("After saving").font(.subheadline.weight(.medium))
                                LabeledContent("Available to plan", value: preview.money(preview.ready)).font(.subheadline)
                                if let accountID = entry?.accountId ?? account?.id, let next = preview.accounts.first(where: { $0.id == accountID }) {
                                    LabeledContent("Account balance", value: preview.money(next.balance)).font(.subheadline)
                                }
                            }
                        }
                    }
                }.padding(24).frame(maxWidth: 700).frame(maxWidth: .infinity)
            }.background(Brand.canvas).scrollDismissesKeyboard(.interactively)
                .navigationTitle(route.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { typing = false; discarded = true; dismiss() }.disabled(store.busy) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            typing = false
                            do { _ = try store.preview(command) } catch { self.error = error.localizedDescription; return }
                            Task { if await store.change(command) { discarded = true; dismiss() } }
                        } label: { Text(isReconcile ? "Confirm" : "Save").foregroundStyle(ready ? Color.white : Brand.secondary) }
                            .buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready)
                    }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { typing = false } }
                }
                .editorSaveState().interactiveDismissDisabled(dirty || store.busy)
                .task {
                    store.beginEditing(editorID)
                    guard !initialized else { return }
                    initialize(); original = command; initialized = true
                }
                .onDisappear { store.endEditing(editorID) }

        }
    }
    private var isReconcile: Bool { if case .reconcile = route { true } else { false } }
    @ViewBuilder private func fields(_ data: Overview) -> some View {
        switch route {
        case .reconcile:
            if let account {
                Label(account.name, systemImage: accountSymbol(account.type)).font(.headline)
                Text("Compare the cleared balance with your bank or statement.").font(.subheadline).foregroundStyle(Brand.secondary)
                amountField(account.type == "investment" ? "Statement value" : "Balance at your bank", currency: data.currency)
                FinancePanel {
                    Toggle(account.type == "credit" ? "This amount is owed" : "Overdrawn", isOn: $negative).font(.subheadline)
                    DatePicker("As of", selection: $date, in: ...Date.now, displayedComponents: .date).font(.subheadline)
                }
                if let check = reconciliation, !amount.isEmpty {
                    FinancePanel {
                        LabeledContent("Recorded cleared balance", value: data.money(check.cleared)).font(.subheadline)
                        LabeledContent("Balance you entered", value: data.money(check.target)).font(.subheadline)
                        if check.difference == 0 {
                            Label("Balances match. No adjustment is needed.", systemImage: "equal.circle").font(.subheadline)
                        } else {
                            LabeledContent("Adjustment", value: data.money(check.difference)).font(.subheadline)
                            Toggle("I reviewed missing and duplicate entries", isOn: $reviewed).font(.subheadline)
                            TextField("Reason for the adjustment", text: $note, axis: .vertical).lineLimit(1...4).focused($typing)
                        }
                    }
                }
            }
        case .goal:
            if let category {
                Label(category.name, systemImage: categorySymbol(category.icon)).font(.headline)
                Picker("Goal type", selection: $targetType) {
                    Text("Balance").tag("balance"); Text("Monthly").tag("monthly"); Text("Capped").tag("capped")
                }.pickerStyle(.segmented)
                amountField(targetType == "balance" ? "Goal amount" : "Monthly amount", currency: data.currency)
                FinancePanel {
                    if targetType == "capped" { moneyInput("Stop at balance", text: $cap, currency: data.currency) }
                    Toggle("Set a deadline", isOn: $deadline).font(.subheadline)
                    if deadline { DatePicker("Deadline", selection: $due, displayedComponents: .date).font(.subheadline) }
                }
                Text("A goal suggests how much to set aside. Saving it does not move money.").font(.caption).foregroundStyle(Brand.secondary)
            }
        case .statement:
            if let account {
                Label(account.name, systemImage: "creditcard").font(.headline)
                amountField("Statement total", currency: data.currency)
                FinancePanel {
                    moneyInput("Minimum payment", text: $minimum, currency: data.currency)
                    DatePicker("Statement closed", selection: $date, in: ...Date.now, displayedComponents: .date).font(.subheadline)
                    DatePicker("Due date", selection: $due, displayedComponents: .date).font(.subheadline)
                }
                Text("Enter the details on your statement. This does not change total card debt.").font(.caption).foregroundStyle(Brand.secondary)
            }
        case .details:
            FinancePanel {
                TextField("Description", text: $name).focused($typing)
                DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
                    .disabled(entry?.sharedExpenseId != nil).font(.subheadline)
                TextField("Note (optional)", text: $note, axis: .vertical).lineLimit(1...5).focused($typing)
            }
        case .refund:
            if let entry {
                Label(entry.payee, systemImage: "arrow.uturn.backward").font(.headline)
                amountField("Refund received", currency: data.currency)
                FinancePanel {
                    if let splits = entry.splits {
                        Picker("Category", selection: $categoryID) {
                            ForEach(splits, id: \.categoryId) { part in Text(data.categories.first { $0.id == part.categoryId }?.name ?? "Category").tag(part.categoryId) }
                        }.font(.subheadline)
                    }
                    DatePicker("Received on", selection: $date, in: ...Date.now, displayedComponents: .date).font(.subheadline)
                    TextField("Note (optional)", text: $note, axis: .vertical).lineLimit(1...4).focused($typing)
                }
                Text("The refund stays linked to the original purchase and reduces spending.").font(.caption).foregroundStyle(Brand.secondary)
            }
        }
    }
    private func amountField(_ title: String, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.subheadline).foregroundStyle(Brand.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(currencyMark(currency)).font(.title).foregroundStyle(Brand.secondary)
                TextField("0", text: $amount).font(.largeTitle.weight(.medium)).keyboardType(.decimalPad).focused($typing).accessibilityLabel(title)
            }
        }
    }
    private func moneyInput(_ title: String, text: Binding<String>, currency: String) -> some View {
        HStack {
            Text(title).font(.subheadline)
            Spacer()
            Text(currencyMark(currency)).foregroundStyle(Brand.secondary)
            TextField("0", text: text).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 120).focused($typing).accessibilityLabel(title)
        }
    }
    private func decimal(_ value: Int64) -> String {
        NSDecimalNumber(value: value).dividing(by: 100).stringValue
    }
    private func initialize() {
        switch route {
        case .reconcile:
            negative = (account?.balance ?? 0) < 0
        case .goal:
            amount = decimal(category?.target ?? 0); cap = decimal(category?.targetCap ?? 0)
            targetType = (category?.target ?? 0) > 0 ? category?.targetType ?? "balance" : "balance"
            if let targetDate = category?.targetDate { due = groupDate(targetDate); deadline = true }
        case .statement:
            amount = decimal(account?.statement?.amount ?? 0); minimum = decimal(account?.statement?.minimum ?? 0)
            if let closed = account?.statement?.closed { date = groupDate(closed) }
            if let day = account?.statement?.due { due = groupDate(day) }
        case .details:
            name = entry?.payee ?? ""; note = entry?.note ?? ""; date = groupDate(entry?.date ?? groupDateKey(Date.now))
        case .refund:
            categoryID = entry?.categoryId ?? entry?.splits?.first?.categoryId ?? ""
        }
    }
}

struct TransactionDetailView: View {
    @Environment(AppStore.self) private var store
    let id: String
    @State private var editor: LedgerEditorRoute?
    @State private var split = false
    @State private var receipt = false
    @State private var shared: SharedExpense?
    @State private var error: String?
    var body: some View {
        if let data = store.overview, let entry = data.transactions.first(where: { $0.id == id }) {
            BrandedList {
                Section {
                    AppHero(label: entry.kind.replacingOccurrences(of: "_", with: " ").capitalized, value: data.money(entry.amount))
                        .padding(.vertical, 12)
                    LabeledContent("Account", value: entry.accountName)
                    if !entry.categoryName.isEmpty { LabeledContent("Category", value: entry.categoryName) }
                    LabeledContent("Date", value: readableDate(entry.date))
                    if !entry.note.isEmpty { Text(entry.note).font(.subheadline) }
                }
                if let parts = entry.splits {
                    Section("Category amounts") {
                        ForEach(parts, id: \.categoryId) { part in
                            LabeledContent(data.categories.first { $0.id == part.categoryId }?.name ?? "Category", value: data.money(part.amount))
                        }
                    }
                }
                Section("Clearing") {
                    Button(entry.cleared ? "Marked cleared" : "Mark cleared", systemImage: entry.cleared ? "checkmark.circle.fill" : "circle") { clear(entry, destination: false) }
                    if entry.toAccountId != nil {
                        Button((entry.clearedTo ?? entry.cleared) ? "Receiving account cleared" : "Mark receiving account cleared",
                               systemImage: (entry.clearedTo ?? entry.cleared) ? "checkmark.circle.fill" : "circle") { clear(entry, destination: true) }
                    }
                }.disabled(store.busy || store.hasPendingSave)
                Section {
                    Button("Edit details", systemImage: "pencil") { editor = .details(id) }
                    if entry.kind == "expense" && entry.sharedExpenseId == nil && entry.sharedSettlementId == nil {
                        Button("Record refund", systemImage: "arrow.uturn.backward") { editor = .refund(id) }
                    }
                    if entry.canSplit { Button("Share this purchase", systemImage: "person.2") { split = true } }
                    if entry.receiptId != nil { Button("View bill", systemImage: "receipt") { receipt = true } }
                }
                if let shared {
                    Section("Shared expense") { SharedExpenseCard(expense: shared, changed: { Task { self.shared = try? await store.sharedExpense(shared.id) } }) }
                }
                if let error { Section { Notice(message: error) } }
            }.navigationTitle(entry.payee).navigationBarTitleDisplayMode(.inline)
                .sheet(item: $editor) { LedgerDetailEditor(route: $0) }
                .sheet(isPresented: $split) { SharedPurchaseForm(initial: entry) }
                .sheet(isPresented: $receipt) {
                    if let user = store.user?.id, let id = entry.receiptId { LocalBillView(user: user, receiptID: id) }
                }
                .task(id: entry.sharedExpenseId) {
                    if let id = entry.sharedExpenseId { do { shared = try await store.sharedExpense(id) } catch { self.error = error.localizedDescription } }
                }
        } else { ContentUnavailableView("Transaction unavailable", systemImage: "receipt", description: Text("Return to Activity and refresh your budget.")) }
    }
    private func clear(_ entry: Transaction, destination: Bool) {
        let was = destination ? entry.clearedTo ?? entry.cleared : entry.cleared
        Task { _ = await store.change(["kind":"clearing","entryId":entry.id,"side":destination ? "destination" : "source","expectedCleared":String(was),"cleared":String(!was)]) }
    }
}

struct LocalBillView: View {
    @Environment(\.dismiss) private var dismiss
    let user: String
    let receiptID: String
    @State private var attachment: ReceiptAttachment?
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let attachment {
                        ForEach(Array(attachment.pages.enumerated()), id: \.offset) { index, page in
                            if let bytes = Data(base64Encoded: page), let image = UIImage(data: bytes) {
                                Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Bill page \(index + 1)")
                            }
                        }
                        if !attachment.text.isEmpty { Text(attachment.text).textSelection(.enabled) }
                    } else if let error { Text(error).foregroundStyle(Brand.secondary) }
                    else { ProgressView("Opening bill") }
                }.padding(24)
            }.background(Brand.canvas).navigationTitle("Bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .task {
                    attachment = ReceiptVault.read(id: receiptID, user: user)
                    if attachment == nil { error = "This bill is no longer stored on this iPhone." }
                }
        }
    }
}
