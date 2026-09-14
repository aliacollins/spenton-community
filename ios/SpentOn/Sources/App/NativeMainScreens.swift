import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var planning = false
    @State private var reviewing = false
    @State private var bill: UpcomingBill?
    @State private var shared: [SharedExpense] = []
    var body: some View {
        if let data = store.overview {
            AppPage(title: "Your money", subtitle: Date.now.formatted(.dateTime.month(.wide).year()) + (store.sample ? " · Fictional preview" : "")) {
                AppHero(label: "Available to plan", value: data.money(data.ready), warning: data.ready < 0,
                        note: data.cash < 0 ? "You have spent more than you have. Review your recorded cash balances first." :
                            data.ready < 0 ? "Review the shortfall before setting aside more money." : "Choose which categories to set this money aside for.")
                FinanceAction(title: data.ready < 0 ? "Review shortfall" : "Plan your money", prominent: true) {
                    if data.ready < 0 { reviewing = true } else { planning = true }
                }.padding(.top, 20)
                if data.ready < 0 {
                    FinanceAction(title: "Plan your money", symbol: "tray.and.arrow.down") { planning = true }.padding(.top, 12)
                }
                let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 20)) : AnyLayout(HStackLayout(alignment: .top, spacing: 20))
                layout {
                    MoneyStat(title: "In cash accounts", value: data.money(data.cash))
                    MoneyStat(title: "Spent this month", value: data.money(data.spent))
                }.padding(.vertical, 24)
                Divider()
                let shortages = data.categories.filter { $0.available < 0 }
                let repayments = shared.filter { $0.owned && $0.budgetId == store.snapshot?.id && $0.shares.contains { $0.pending > 0 } }
                if !shortages.isEmpty || !repayments.isEmpty {
                    AppSection(title: "To review")
                    FinanceRows {
                        ForEach(shortages) { category in
                            NavigationLink {
                                CategoryDetail(categoryID: category.id).toolbar(.visible, for: .navigationBar)
                            } label: {
                                AppRow(title: category.name, subtitle: "Overspent", value: data.money(-category.available),
                                       symbol: categorySymbol(category.icon), color: categoryTint(category.color ?? "sage"), negative: true)
                            }.buttonStyle(.plain)
                            FinanceDivider()
                        }
                        ForEach(repayments) { expense in
                            NavigationLink {
                                SharedExpenseDetailView(expense: expense).toolbar(.visible, for: .navigationBar)
                            } label: {
                                AppRow(title: expense.merchant, subtitle: "Repayment to confirm",
                                       value: SharedMoney.format(expense.shares.reduce(0) { $0 + $1.pending }, expense.currency),
                                       symbol: "arrow.down.left.circle", color: Brand.blue)
                            }.buttonStyle(.plain)
                        }
                    }
                }
                let dueCards = data.accounts.filter {
                    guard let card = $0.card, card.statementRemaining > 0, let due = $0.statement?.due else { return false }
                    return due <= groupDateKey(Calendar.current.date(byAdding: .day, value: 14, to: Date.now) ?? Date.now)
                }
                let bills = (data.upcomingBills ?? []).filter { $0.amount > 0 && $0.kind != "income" && $0.date <= groupDateKey(Calendar.current.date(byAdding:.day,value:14,to:Date.now) ?? Date.now) }
                if !dueCards.isEmpty || !bills.isEmpty {
                    AppSection(title: "Coming up")
                    FinanceRows {
                        ForEach(dueCards) { account in
                            NavigationLink {
                                AccountDetail(accountID: account.id).toolbar(.visible, for: .navigationBar)
                            } label: {
                                AppRow(title: account.name, subtitle: "Statement due \(readableDate(account.statement?.due ?? ""))",
                                       value: data.money(account.card?.statementRemaining ?? 0), symbol: "creditcard", color: Brand.blue)
                            }.buttonStyle(.plain)
                            FinanceDivider()
                        }
                        ForEach(bills.prefix(3)) { upcoming in
                            Button { bill = upcoming } label: {
                                AppRow(title: upcoming.payee, subtitle: "Due \(readableDate(upcoming.date))",
                                       value: data.money(upcoming.amount), symbol: "calendar", color: Brand.sand)
                            }.buttonStyle(.plain)
                            if upcoming.id != bills.prefix(3).last?.id { FinanceDivider() }
                        }
                    }
                }
                let goals = data.categories.filter { $0.target > 0 }
                if !goals.isEmpty {
                    AppSection(title: "Savings goals")
                    FinanceRows {
                        ForEach(goals.prefix(3)) { category in
                            NavigationLink {
                                CategoryDetail(categoryID: category.id).toolbar(.visible, for: .navigationBar)
                            } label: {
                                VStack(spacing: 0) {
                                    AppRow(title: category.name,
                                           subtitle: "\(data.money(max(0, category.available))) of \(data.money(category.target))",
                                           symbol: categorySymbol(category.icon), color: categoryTint(category.color ?? "sage"))
                                    ProgressView(value: Double(max(0, min(category.available, category.target))), total: Double(max(1, category.target)))
                                        .tint(Brand.sage).padding(.horizontal, 20).padding(.bottom, 16)
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                }
                AppSection(title: "Recent activity")
                if data.transactions.isEmpty {
                    Text("Your recorded transactions will appear here.").font(.subheadline).foregroundStyle(Brand.secondary)
                } else {
                    FinanceRows {
                        ForEach(Array(data.transactions.prefix(4))) { transaction in
                            NavigationLink {
                                TransactionDetailView(id: transaction.id).toolbar(.visible, for: .navigationBar)
                            } label: { NativeTransactionRow(transaction: transaction, data: data) }.buttonStyle(.plain)
                            if transaction.id != data.transactions.prefix(4).last?.id { FinanceDivider() }
                        }
                    }
                }
                NotificationInvitation().padding(.top, 24)
                if let message = store.message { Notice(message: message).padding(.top, 16) }
            }
            .refreshable { await store.refresh() }
            .sheet(isPresented: $planning) { PlanForm() }
            .sheet(isPresented: $reviewing) { BudgetReviewView() }
            .sheet(item: $bill) { UpcomingBillPayment(bill: $0) }
            .task(id: store.savedCount) {
                if let inbox = try? await store.sharedInbox() { shared = inbox.expenses }
            }
        }
    }
}

struct CategoriesView: View {
    @Environment(AppStore.self) private var store
    @State private var creating = false
    @State private var planning = false
    @State private var review = false
    @State private var search = ""
    var body: some View {
        if let data = store.overview {
            AppPage(title: "Categories", subtitle: Date.now.formatted(.dateTime.month(.wide).year()),
                    addLabel: "Add categories", add: { creating = true }) {
                HStack {
                    Text("Available to plan").appFont(13).foregroundStyle(Brand.secondary)
                    Spacer()
                    Text(data.money(data.ready)).appFont(14, weight: .medium).monospacedDigit()
                        .foregroundStyle(data.ready < 0 ? Brand.danger : Brand.ink)
                }
                HStack(spacing: 12) {
                    FinanceAction(title: "Plan your money", symbol: "tray.and.arrow.down") { planning = true }
                    Button("Move money", systemImage: "arrow.left.arrow.right") { review = true }
                        .buttonStyle(.glass).controlSize(.large)
                }.padding(.vertical, 20)
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                    TextField("Find a category", text: $search).font(.subheadline)
                }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                let matches = CategoryDirectory(data.categories).matching(search)
                ForEach(Array(Set(matches.map(\.group))).sorted(), id: \.self) { group in
                    AppSection(title: group)
                    FinanceRows {
                        let categories = matches.filter { $0.group == group }
                        ForEach(categories) { category in
                            NavigationLink {
                                CategoryDetail(categoryID: category.id).toolbar(.visible, for: .navigationBar)
                            } label: {
                                AppRow(title: category.name, subtitle: category.available < 0 ? "Overspent" : "Left this month",
                                       value: data.money(abs(category.available)), symbol: categorySymbol(category.icon),
                                       color: categoryTint(category.color ?? "sage"), negative: category.available < 0)
                            }.buttonStyle(.plain)
                            if category.id != categories.last?.id { FinanceDivider() }
                        }
                    }
                }
                if matches.isEmpty { ContentUnavailableView.search(text: search).padding(.top, 24) }
            }
            .sheet(isPresented: $creating) { if let base = store.snapshot?.budget { BatchCategoryCreation(base: base) } }
            .sheet(isPresented: $planning) { PlanForm() }
            .sheet(isPresented: $review) { BudgetReviewView() }
        }
    }
}

struct AccountsView: View {
    @Environment(AppStore.self) private var store
    @State private var creating = false
    @State private var transfer = false
    var body: some View {
        if let data = store.overview {
            AppPage(title: "Accounts", subtitle: "Recorded balances", addLabel: "Add account", add: { creating = true }) {
                AppHero(label: "Net worth", value: data.money(data.netWorth), warning: data.netWorth < 0,
                        note: "Includes investments, card debt and recorded amounts between people.")
                accountSection("Cash accounts", accounts: data.accounts.filter(\.isCash), data: data)
                accountSection("Credit cards", accounts: data.accounts.filter { $0.type == "credit" }, data: data)
                accountSection("Investments", accounts: data.accounts.filter { $0.type == "investment" }, data: data)
                FinanceAction(title: "Record transfer", symbol: "arrow.left.arrow.right") { transfer = true }.padding(.top, 24)
            }
            .sheet(isPresented: $creating) { if let base = store.snapshot?.budget { RecordCreationSheet(kind: .account, base: base) } }
            .sheet(isPresented: $transfer) { TransactionForm(initialKind: "transfer") }
        }
    }
    @ViewBuilder private func accountSection(_ title: String, accounts: [BudgetAccount], data: Overview) -> some View {
        if !accounts.isEmpty {
            AppSection(title: title)
            FinanceRows {
                ForEach(accounts) { account in
                    NavigationLink {
                        AccountDetail(accountID: account.id).toolbar(.visible, for: .navigationBar)
                    } label: {
                        AppRow(title: account.name,
                               subtitle: account.type == "credit" ? "Card debt" : account.type == "investment" ? "Excluded from budget cash" : "Recorded balance",
                               value: data.money(account.type == "credit" ? account.card?.owed ?? 0 : account.balance),
                               symbol: accountSymbol(account.type), color: account.type == "credit" ? Brand.blue : account.type == "investment" ? Brand.sand : Brand.sage,
                               negative: account.type != "credit" && account.balance < 0)
                    }.buttonStyle(.plain)
                    if account.id != accounts.last?.id { FinanceDivider() }
                }
            }
        }
    }
}

struct NativeTransactionRow: View {
    let transaction: Transaction
    let data: Overview
    var body: some View {
        AppRow(title: transaction.payee, subtitle: readableDate(transaction.date) + " · " + detail,
               value: (transaction.kind == "income" || transaction.kind == "refund" ? "+" : "") + data.money(transaction.amount),
               symbol: symbol, color: transaction.kind == "transfer" || transaction.kind == "payment" ? Brand.blue : Brand.sage)
    }
    private var detail: String {
        if let shared = transaction.sharedAmount, shared > 0 { return "Your share " + data.money(transaction.amount - shared) }
        return ["expense": transaction.categoryName, "income":"Income", "payment":"Card payment", "transfer":"Transfer", "refund":"Refund"][transaction.kind] ?? transaction.kind.replacingOccurrences(of: "_", with: " ").capitalized
    }
    private var symbol: String {
        switch transaction.kind {
        case "income": "arrow.down.left"
        case "refund": "arrow.uturn.backward"
        case "payment": "creditcard"
        case "transfer": "arrow.left.arrow.right"
        default: data.categories.first { $0.id == transaction.categoryId }.map { categorySymbol($0.icon) } ?? "receipt"
        }
    }
}

struct ActivityView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var upcoming = false
    @State private var bill: UpcomingBill?
    var body: some View {
        if let data = store.overview {
            AppPage(title: "Activity", subtitle: "Purchases, payments and money received") {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                    TextField("Search transactions", text: $search).font(.subheadline)
                }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                Picker("Activity", selection: $upcoming) {
                    Text("Recorded").tag(false); Text("Scheduled").tag(true)
                }.pickerStyle(.segmented).padding(.top, 20)
                AppSection(title: upcoming ? "Scheduled transactions" : Date.now.formatted(.dateTime.month(.wide).year()))
                if upcoming {
                    let bills = (data.upcomingBills ?? []).filter { search.isEmpty || $0.payee.localizedCaseInsensitiveContains(search) }
                    FinanceRows {
                        ForEach(bills) { item in
                            Button { bill = item } label: {
                                AppRow(title: item.payee, subtitle: "\(item.kind == "income" ? "Expected" : "Scheduled") · \(readableDate(item.date))",
                                       value: data.money(item.amount), symbol: item.kind == "income" ? "arrow.down.left" : "calendar", color: Brand.blue)
                            }.buttonStyle(.plain)
                            if item.id != bills.last?.id { FinanceDivider() }
                        }
                    }
                    if bills.isEmpty { ContentUnavailableView("No upcoming bills", systemImage: "calendar", description: Text("Unpaid bills appear here until you record payment.")) }
                } else {
                    let transactions = data.transactions.filter { search.isEmpty || ($0.payee + $0.accountName + $0.categoryName).localizedCaseInsensitiveContains(search) }
                    FinanceRows {
                        ForEach(transactions) { entry in
                            NavigationLink {
                                TransactionDetailView(id: entry.id).toolbar(.visible, for: .navigationBar)
                            } label: { NativeTransactionRow(transaction: entry, data: data) }.buttonStyle(.plain)
                            if entry.id != transactions.last?.id { FinanceDivider() }
                        }
                    }
                    if transactions.isEmpty { ContentUnavailableView("No transactions here", systemImage: "receipt", description: Text("Add a transaction or try another search.")) }
                }
            }.refreshable { await store.refresh() }
                .sheet(item: $bill) { UpcomingBillPayment(bill: $0) }
        }
    }
}

struct SharedExpenseDetailView: View {
    @Environment(AppStore.self) private var store
    let expense: SharedExpense
    @State private var refreshed: SharedExpense?
    var body: some View {
        ScrollView {
            SharedExpenseCard(expense: refreshed ?? expense, changed: {
                Task { refreshed = try? await store.sharedExpense(expense.id) }
            }).padding(24).frame(maxWidth: 700).frame(maxWidth: .infinity)
        }.background(Brand.canvas).navigationTitle((refreshed ?? expense).merchant).navigationBarTitleDisplayMode(.inline)
    }
}
