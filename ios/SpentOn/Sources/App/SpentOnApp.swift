import SwiftUI
import UniformTypeIdentifiers

@main struct SpentOnApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var notifications = NotificationManager.shared
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environment(store)
                .onChange(of: notifications.token) { Task { await store.syncNotifications() } }
                .onChange(of: store.snapshot?.id) { Task { await store.syncNotifications() } }
                .onChange(of: store.savedCount) { Task { await store.syncNotifications() } }
                .onChange(of: store.restoring) { if !store.restoring { Task { await store.syncNotifications() } } }
                .onChange(of: store.user?.id) { Task { await store.syncNotifications() } }
                .tint(Brand.sage).foregroundStyle(Brand.ink).toggleStyle(AppToggleStyle())
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.startSync(); Task { await store.refresh(); await store.syncNotifications() } }
                    else { store.pauseSync() }
                }
        }
    }
}

enum Brand {
    // Asset colors provide light, dark, and increased-contrast appearances.
    // Action is the filled-button background; sage is foreground emphasis.
    static let action = Color("BrandAction")
    static let sage = Color("BrandSage")
    static let ink = Color("BrandInk")
    static let secondary = Color("BrandSecondary")
    static let canvas = Color("BrandCanvas")
    static let surface = Color("BrandSurface")
    static let danger = Color("BrandDanger")
    static let sand = Color("BrandSand")
    static let blue = Color("BrandBlue")
    static let butter = Color("BrandButter")
    static let lavender = Color("BrandLavender")
    static let peach = Color("BrandPeach")
    static let rose = Color("BrandRose")
}

struct BrandedList<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        List { Group { content }.listRowBackground(Brand.surface) }
            .scrollContentBackground(.hidden).background(Brand.canvas)
    }
}

struct BrandedForm<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        Form { Group { content }.listRowBackground(Brand.surface) }
            .scrollContentBackground(.hidden).background(Brand.canvas).scrollDismissesKeyboard(.interactively)
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmation: String?
    @State private var settings = false
    #if DEBUG
    @State private var pipPreview = ProcessInfo.processInfo.arguments.contains("--sample") && ProcessInfo.processInfo.arguments.contains("--pip-lesson")
    #else
    @State private var pipPreview = false
    #endif
    @State private var activeNudge: NudgeRoute?
    @State private var notifications = NotificationManager.shared
    var body: some View {
        @Bindable var store = store
        appContent
        .overlay {
            if scenePhase != .active {
                ZStack { Brand.canvas; VStack(spacing: 12) { Image("Pip").resizable().scaledToFit().frame(width: 100, height: 100); Text("SpentOn").font(.title2.weight(.semibold)) } }.ignoresSafeArea()
            }
        }
        .sheet(item: $activeNudge, onDismiss: { presentNudge() }) { NotificationDetailView(route: $0) }
        .onChange(of: notifications.pendingRoute) { presentNudge() }
        .onChange(of: store.editing) { presentNudge() }
        .onChange(of: store.busy) { presentNudge() }
        .onChange(of: !store.hasPendingSave) { presentNudge() }
        .onChange(of: store.restoring) { presentNudge() }
        .onChange(of: store.user?.id) {
            if activeNudge?.account != store.user.map({ _ in NotificationManager.accountKey(store.accountScope) }) { activeNudge = nil }
            presentNudge()
        }
        .onChange(of: store.requiresSignIn) {
            if store.requiresSignIn, let activeNudge { notifications.pendingRoute = activeNudge; self.activeNudge = nil }
            else { presentNudge() }
        }
        .sheet(isPresented: $store.requiresSignIn) { WelcomeView(restoring: true).interactiveDismissDisabled() }
        .sheet(isPresented: $settings) { SettingsView() }
        .sheet(isPresented: $pipPreview) { PipOnboardingView(replay: true) }
        .safeAreaInset(edge: .top, spacing: 0) {
            if store.hasPendingSave && !store.editing { SaveStatusBanner() }
        }
        .fileExporter(isPresented: $store.exportPresented, document: BudgetDocument(budget: store.snapshot?.budget), contentType: .json, defaultFilename: "SpentOn-budget") { result in
            if case .failure(let error) = result { store.message = error.localizedDescription }
        }
    }
    private var appContent: some View {
        ZStack {
            if store.restoring { ProgressView("Opening your budget").frame(maxWidth: .infinity, maxHeight: .infinity).background(Brand.canvas) }
            else if store.user == nil { WelcomeView().transition(.opacity) }
            else if store.overview != nil && !store.presentingOnboarding { BudgetTabs().id(store.connectionID).transition(.opacity) }
            else { WorkspaceView().id(store.connectionID).transition(.opacity) }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.user?.id)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.overview != nil && !store.presentingOnboarding)
        .task { await store.restoreSignIn() }
        .onChange(of: store.savedCount) {
            if store.lastSave?.kind == .budgetCreated && store.presentingOnboarding {
                confirmation = nil
                return
            }
            confirmation = store.savedMessage
            CompletionPlayer.shared.play(store.lastSave)
            if scenePhase == .active { AccessibilityNotification.Announcement(store.savedMessage).post() }
        }
        .onChange(of: store.hasPendingSave) { _, pending in
            if pending { confirmation = nil }
        }
        .task(id: store.savedCount) {
            guard confirmation != nil else { return }
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            confirmation = nil
        }
        .overlay(alignment: .top) {
            if let confirmation {
                HStack {
                    Label { Text(confirmation) } icon: { SaveConfirmationMark().id(store.savedCount) }.font(.subheadline)
                    Spacer(minLength: 8)
                    Button("Dismiss confirmation", systemImage: "xmark") { self.confirmation = nil }.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                }.foregroundStyle(Brand.sage).padding(.horizontal, 16).padding(.vertical, 6)
                    .background(Brand.surface, in: .rect(cornerRadius: 16))
                    .shadow(color: Brand.ink.opacity(0.10), radius: 8, y: 3)
                    .padding(.horizontal, 16).padding(.top, 56)
            }
        }
    }
    private func presentNudge() {
        // Defer opening during another task, but keep an already-open review
        // alive while its own confirmation editor is active or saving.
        guard activeNudge == nil, let user = store.user, !store.restoring, !store.requiresSignIn,
              !store.editing, !store.busy, store.pending == nil, store.pendingShared == nil, !settings,
              let route = notifications.pendingRoute, route.account == NotificationManager.accountKey(store.accountScope) else { return }
        activeNudge = route; notifications.pendingRoute = nil
    }

}

struct BudgetTabs: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var navigation = NavigationContext()
    private enum Route: String, Identifiable { case quick, scan, transaction, category, account, plan, share; var id: String { rawValue } }
    #if DEBUG
    @State private var route: Route? = ProcessInfo.processInfo.arguments.contains("--sample") ? (ProcessInfo.processInfo.arguments.contains("--scan") ? .scan : ProcessInfo.processInfo.arguments.contains("--compose") ? .transaction : nil) : nil
    #else
    @State private var route: Route?
    #endif
    @State private var seed = QuickEntry()
    @State private var transactionKind = "expense"
    @State private var transactionDestination = ""
    @State private var capturePeople = ExpensePeopleDraft()
    @State private var settings = false
    @State private var choosingTransaction = false
    var body: some View {
        @Bindable var navigation = navigation
        TabView(selection: $navigation.tab) {
            Tab("Home", systemImage: "house", value: .home) { NavigationStack { HomeView() } }
            Tab("Categories", systemImage: "square.grid.2x2", value: .categories) { NavigationStack { CategoriesView() } }
            Tab("Activity", systemImage: "list.bullet.rectangle", value: .activity) { NavigationStack { ActivityView() } }
            Tab("Accounts", systemImage: "wallet.bifold", value: .accounts) { NavigationStack { AccountsView() } }
            Tab("People", systemImage: "person.2", value: .people) { SharedExpensesView(embedded: true) }
        }
        .tabViewBottomAccessory {
            HStack(spacing: 0) {
                Button { choosingTransaction = true } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                        Text(dynamicTypeSize.isAccessibilitySize ? "Add" : "Add transaction").appFont(15, weight: .medium)
                        Spacer(minLength: 0)
                    }.padding(.leading, 20).padding(.trailing, 12).frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Add transaction").accessibilityIdentifier("quick-add")
                Rectangle().fill(Brand.secondary.opacity(0.16)).frame(width: 0.5, height: 24).accessibilityHidden(true)
                Button { capturePeople = navigation.people; route = .scan } label: {
                    Label("Scan", systemImage: "doc.text.viewfinder").appFont(15, weight: .medium)
                        .padding(.horizontal, 16).frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Scan a bill").accessibilityIdentifier("constant-scan")
            }.foregroundStyle(Brand.ink).disabled(store.hasPendingSave || store.busy || (!navigation.requiredBudgetID.isEmpty && navigation.requiredBudgetID != store.snapshot?.id))
        }
        .tabBarMinimizeBehavior(.never)
        .environment(navigation)
        .confirmationDialog("Add transaction", isPresented: $choosingTransaction, titleVisibility: .visible) {
            Button("Money spent (purchase)") { openTransaction("expense") }.accessibilityIdentifier("record-purchase")
            Button("Money received (income)") { openTransaction("income") }
            Button("Transfer between accounts") { openTransaction("transfer") }
            Button("Record card payment") { openTransaction("payment") }
            Button("Quick entry") { capturePeople = navigation.people; route = .quick }
            Button("Cancel", role: .cancel) {}
        }
        .onChange(of: store.notificationActivityRequested) { _, requested in
            if requested { navigation.tab = .activity; store.notificationActivityRequested = false }
        }
        .sheet(isPresented: Binding(get: { route != nil }, set: { if !$0 { route = nil; seed = QuickEntry() } }), onDismiss: { seed = QuickEntry(); ReceiptVault.clearTemporary() }) {
            Group {
                switch route {
                case .quick: QuickCapture(openDetails: { seed = $0; seed.people = capturePeople; transactionKind = "expense"; transactionDestination = ""; self.route = .transaction }, create: { self.route = $0 == .category ? .category : .account }, plan: { self.route = .plan }, scan: { self.route = .scan })
                case .scan: ReceiptScanView(openDetails: { seed = $0; seed.people = capturePeople; transactionKind = "expense"; transactionDestination = ""; self.route = .transaction })
                case .transaction: TransactionForm(seed: seed, initialKind: transactionKind, destination: transactionDestination)
                case .category: if let base = store.snapshot?.budget { BatchCategoryCreation(base: base) }
                case .account: if let base = store.snapshot?.budget { RecordCreationSheet(kind: .account, base: base) }
                case .plan: PlanForm(initialCategory: navigation.categoryID)
                case .share: SharedPurchaseForm()
                case nil: EmptyView()
                }
            }.id(route).transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                .animation(reduceMotion ? nil : .smooth(duration: 0.28), value: route)
                .environment(navigation).presentationDetents(route == .quick && !dynamicTypeSize.isAccessibilitySize ? [.medium, .large] : [.large]).presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $settings) { SettingsView() }
    }
    private func openTransaction(_ kind: String) {
        transactionKind = kind
        transactionDestination = kind == "payment" && store.overview?.accounts.first(where: { $0.id == navigation.accountID })?.type == "credit" ? navigation.accountID : ""
        seed = QuickEntry(categoryID: kind == "expense" ? navigation.categoryID : "",
                          accountID: transactionDestination.isEmpty ? navigation.accountID : "")
        if kind == "expense" { seed.people = navigation.people }
        route = .transaction
    }

}

struct MoneyStat: View {
    let title: String; let value: String
    var symbol: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let symbol { Label(title, systemImage: symbol) }
                else { Text(title) }
            }.font(.subheadline).foregroundStyle(Brand.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        }
            .frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}
struct Notice: View {
    let message: String
    var body: some View { Text(message).font(.subheadline).foregroundStyle(Brand.secondary).accessibilityAddTraits(.updatesFrequently) }
}

func categorySymbol(_ icon: String) -> String {
    ["home": "house", "basket": "basket", "coffee": "cup.and.saucer", "umbrella": "umbrella", "car": "car", "zap": "bolt", "repeat": "repeat", "heart": "heart", "sparkles": "sparkles", "plane": "airplane", "laptop": "laptopcomputer", "wallet": "wallet.bifold", "paw": "pawprint", "baby": "figure.child", "study": "graduationcap", "health": "cross.case", "gift": "gift", "food": "fork.knife", "phone": "iphone", "bike": "bicycle", "music": "music.note", "shirt": "tshirt"][icon] ?? "square.grid.2x2"
}
func readableDate(_ date: String) -> String {
    let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.calendar = Calendar(identifier: .gregorian); parser.dateFormat = "yyyy-MM-dd"
    guard let value = parser.date(from: date) else { return date }
    return value.formatted(.dateTime.day().month(.abbreviated).year())
}
struct CategoryRow: View {
    let category: BudgetCategory; let data: Overview
    var body: some View {
        HStack(spacing: 14) {
            CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 32)
            VStack(alignment: .leading, spacing: 4) { Text(category.name).font(.subheadline.weight(.medium)); Text(CategoryDirectory(data.categories).context(for: category)).font(.caption).foregroundStyle(Brand.secondary) }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(data.money(category.available)).monospacedDigit().fontWeight(.medium).foregroundStyle(category.available < 0 ? Brand.danger : Brand.ink)
                Text(category.available < 0 ? "Overspent" : "Left").font(.caption).foregroundStyle(Brand.secondary)
            }
        }.padding(.vertical, 4).accessibilityElement(children: .combine)
    }
}
struct CategoryDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let categoryID: String
    @State private var plan = false
    @State private var movement = false
    @State private var purchase = false
    @State private var goal: LedgerEditorRoute?
    var body: some View {
        if let data = store.overview, let category = data.categories.first(where: { $0.id == categoryID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 24) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Left").font(.subheadline).foregroundStyle(Brand.secondary)
                                Text(data.money(category.available)).font(.title.weight(.semibold)).monospacedDigit().foregroundStyle(category.available < 0 ? Brand.danger : Brand.ink)
                                    .contentTransition(.numericText()).animation(reduceMotion ? nil : .smooth(duration: 0.25), value: category.available)
                            }
                            Spacer(minLength: 12)
                            CategoryGlyph(icon: category.icon, color: category.color ?? "sage").accessibilityHidden(true)
                        }
                        HStack(alignment: .top, spacing: 20) {
                            categoryStat("Set aside", value: data.money(category.assigned))
                            categoryStat("Spent", value: data.money(category.spent))
                        }
                        if category.needed > 0 { Text(data.money(category.needed) + " needed for your goal").font(.caption).foregroundStyle(Brand.secondary) }
                    }.padding(22).frame(maxWidth: .infinity, alignment: .leading).background(Brand.surface, in: .rect(cornerRadius: 24))
                    FinanceAction(title: category.available < 0 ? "Cover overspending" : "Set aside money", prominent: true) {
                        if category.available < 0 { movement = true } else { plan = true }
                    }.disabled(store.hasPendingSave || store.busy)
                    FinancePanel {
                        if category.target > 0 {
                            LabeledContent("Savings goal", value: data.money(category.target))
                            LabeledContent("Suggested this month", value: data.money(category.needed))
                            Button("Edit goal", systemImage: "target") { goal = .goal(categoryID) }.frame(minHeight: 44)
                        } else {
                            Button("Set a savings goal", systemImage: "target") { goal = .goal(categoryID) }.frame(minHeight: 44)
                        }
                    }.font(.subheadline)
                    VStack(alignment: .leading, spacing: 16) {
                        Text("This month’s purchases").font(.subheadline.weight(.semibold))
                        let entries = data.transactions.filter { $0.categoryId == categoryID || $0.splits?.contains(where: { $0.categoryId == categoryID }) == true }
                        if entries.isEmpty { Text("No purchases recorded here yet.").font(.subheadline).foregroundStyle(Brand.secondary).padding(.vertical, 8) }
                        FinanceRows {
                            ForEach(entries) { entry in
                                NavigationLink { TransactionDetailView(id: entry.id) } label: { NativeTransactionRow(transaction: entry, data: data) }.buttonStyle(.plain)
                                if entry.id != entries.last?.id { FinanceDivider() }
                            }
                        }
                    }.padding(.horizontal, 4)
                }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.navigationTitle(category.name).navigationBarTitleDisplayMode(.inline).background(Brand.canvas)
                .sheet(isPresented: $plan) { PlanForm(initialCategory: categoryID) }
                .sheet(isPresented: $movement) { MoveMoneyView(categoryID: categoryID, covering: category.available < 0) }
                .sheet(isPresented: $purchase) { TransactionForm(seed: QuickEntry(categoryID: categoryID)) }
                .sheet(item: $goal) { LedgerDetailEditor(route: $0) }
                .toolbar { ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Add purchase", systemImage: "plus") { purchase = true }
                        Button("Move category money", systemImage: "arrow.left.arrow.right") { movement = true }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Category actions")
                } }
                .onAppear { navigation.categoryID = categoryID }
                .onDisappear { if navigation.categoryID == categoryID { navigation.categoryID = "" } }
        }
    }
    private func categoryStat(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(title).font(.caption).foregroundStyle(Brand.secondary); Text(value).font(.subheadline.weight(.medium)).monospacedDigit() }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func categoryAction(_ title: String, symbol: String, accessibility: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            let layout = typeSize.isAccessibilitySize ? AnyLayout(HStackLayout(spacing: 14)) : AnyLayout(VStackLayout(spacing: 8))
            layout { Image(systemName: symbol).font(.body.weight(.medium)).frame(width: 24, height: 24); Text(title).font(.caption.weight(.medium)) }
                .frame(maxWidth: .infinity, minHeight: typeSize.isAccessibilitySize ? 56 : 64, alignment: typeSize.isAccessibilitySize ? .leading : .center).padding(.horizontal, 8).contentShape(.rect)
        }.buttonStyle(ContentRowStyle()).foregroundStyle(Brand.sage).accessibilityLabel(accessibility)
    }
}
struct TransactionRow: View {
    @Environment(AppStore.self) private var store
    let transaction: Transaction; let data: Overview
    var clear: ((String) -> Void)? = nil
    var split: (() -> Void)? = nil
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: transaction.kind == "payment" ? "creditcard" : transaction.kind == "transfer" ? "arrow.left.arrow.right" : transaction.kind == "income" ? "arrow.down.left" : "receipt")
                .foregroundStyle(Brand.sage).frame(width: 30, height: 32).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.payee.isEmpty ? "Transaction" : transaction.payee).font(.subheadline.weight(.medium))
                Text(transaction.categoryName.isEmpty ? (transaction.destinationName.isEmpty ? transaction.accountName : "\(transaction.accountName) → \(transaction.destinationName)") : "\(transaction.categoryName) · \(transaction.accountName)").font(.caption).foregroundStyle(Brand.secondary)
                Text(readableDate(transaction.date) + (transaction.accountId == nil ? " · No bank movement" : transaction.isUncleared ? " · Uncleared" : " · Cleared")).font(.caption).foregroundStyle(Brand.secondary)
                if let amount = transaction.sharedAmount { Text("Your spending " + data.money(transaction.amount - amount)).font(.caption).foregroundStyle(Brand.secondary) }
                if transaction.kind == "shared_offset" { Text("Offset. Spending unchanged.").font(.caption).foregroundStyle(Brand.secondary) }
                if ["shared_refund","shared_credit"].contains(transaction.kind) { Text("Shared refund").font(.caption).foregroundStyle(Brand.secondary) }
                if transaction.kind == "shared_claim" { Text("Refund owed to you").font(.caption).foregroundStyle(Brand.secondary) }
                if transaction.kind == "shared_return" { Text("Refund to return").font(.caption).foregroundStyle(Brand.secondary) }
                if transaction.kind == "shared_charge" { Text("Accepted share").font(.caption).foregroundStyle(Brand.secondary) }
                if transaction.kind == "shared_payment" || transaction.kind == "shared_receipt" { Text("Shared repayment. Spending unchanged.").font(.caption).foregroundStyle(Brand.secondary) }
                if let split { Button("Split", systemImage: "person.2") { split() }.font(.caption.weight(.medium)).frame(minHeight: 44).buttonStyle(.borderless).accessibilityLabel("Split " + transaction.payee) }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                Text((transaction.kind == "income" || transaction.kind == "refund" || transaction.kind == "shared_receipt" || transaction.kind == "shared_refund" || transaction.kind == "shared_credit" ? "+" : "") + data.money(transaction.amount)).monospacedDigit().font(.subheadline.weight(.medium))
                if let clear, transaction.accountId != nil {
                    if transaction.toAccountId != nil {
                        Menu {
                            Button((transaction.cleared ? "Mark uncleared: " : "Mark cleared: ") + transaction.accountName) { clear("source") }
                            Button(((transaction.clearedTo ?? transaction.cleared) ? "Mark uncleared: " : "Mark cleared: ") + transaction.destinationName) { clear("destination") }
                        } label: { clearingIcon }.accessibilityLabel("Clearing status for " + transaction.payee)
                    } else { Button { clear("source") } label: { clearingIcon }.buttonStyle(.borderless).accessibilityLabel((transaction.cleared ? "Mark uncleared: " : "Mark cleared: ") + transaction.payee).accessibilityIdentifier("clear-" + transaction.id) }
                }
            }
        }.padding(.vertical, 2).accessibilityElement(children: clear == nil ? .combine : .contain)
            .disabled(clear != nil && (store.busy || store.hasPendingSave))
    }
    private var clearingIcon: some View {
        Image(systemName: transaction.isUncleared ? "circle" : "checkmark.circle.fill").font(.title3).foregroundStyle(transaction.isUncleared ? Brand.secondary : Brand.sage).frame(width: 44, height: 44)
    }
}
struct AccountDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    let accountID: String
    @State private var payment = false
    @State private var transfer = false
    @State private var editor: LedgerEditorRoute?
    var body: some View {
        if let data = store.overview, let account = data.accounts.first(where: { $0.id == accountID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    FinancePanel {
                        AppHero(label: account.card == nil ? "Recorded balance" : "Card debt",
                                value: data.money(account.card?.owed ?? account.balance), warning: account.card == nil && account.balance < 0)
                        FinanceAction(title: "Reconcile account", symbol: "arrow.triangle.2.circlepath") { editor = .reconcile(accountID) }
                    }
                    if let card = account.card {
                        Text("Current statement").font(.headline)
                        FinancePanel {
                            if let statement = account.statement {
                                LabeledContent("Statement still to pay", value: data.money(card.statementRemaining))
                                LabeledContent("Due date", value: readableDate(statement.due))
                            } else { Text("Add the total and dates from your card statement.").font(.subheadline).foregroundStyle(Brand.secondary) }
                            Button("Edit statement", systemImage: "calendar") { editor = .statement(accountID) }.frame(minHeight: 44)
                            FinanceAction(title: "Record card payment", symbol: "creditcard", prominent: true) { payment = true }
                        }.font(.subheadline)
                        FinancePanel {
                            LabeledContent("Cash set aside", value: data.money(card.reserve))
                            LabeledContent("Debt without cash set aside", value: data.money(card.unbacked))
                            Text("This cash stays in your bank until you record a payment.").font(.caption).foregroundStyle(Brand.secondary)
                        }.font(.subheadline)
                    } else if account.type == "investment" {
                        Text("Investments are excluded from Available to plan.").font(.subheadline).foregroundStyle(Brand.secondary)
                    }
                    Text("This month’s activity").font(.headline)
                    FinanceRows {
                        let entries = data.transactions.filter { $0.accountId == accountID || $0.toAccountId == accountID }
                        ForEach(entries) { entry in
                            NavigationLink { TransactionDetailView(id: entry.id) } label: { NativeTransactionRow(transaction: entry, data: data) }.buttonStyle(.plain)
                            if entry.id != entries.last?.id { FinanceDivider() }
                        }
                        if entries.isEmpty { Text("No transactions recorded this month.").font(.subheadline).foregroundStyle(Brand.secondary).padding(20) }
                    }
                }.padding(24).frame(maxWidth: 700).frame(maxWidth: .infinity)
            }.background(Brand.canvas).navigationTitle(account.name).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) {
                    if account.type != "credit" { Button("Record transfer", systemImage: "arrow.left.arrow.right") { transfer = true }.labelStyle(.iconOnly) }
                } }
                .sheet(isPresented: $payment) { TransactionForm(initialKind: "payment", destination: accountID) }
                .sheet(isPresented: $transfer) { TransactionForm(seed: QuickEntry(accountID: accountID), initialKind: "transfer") }
                .sheet(item: $editor) { LedgerDetailEditor(route: $0) }
                .onAppear { navigation.accountID = accountID }
                .onDisappear { if navigation.accountID == accountID { navigation.accountID = "" } }
        }
    }
}

struct BudgetDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    var budget: JSONValue?
    init(budget: JSONValue?) { self.budget = budget }
    init(configuration: ReadConfiguration) throws { budget = try JSONDecoder().decode(JSONValue.self, from: configuration.file.regularFileContents ?? Data()) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return FileWrapper(regularFileWithContents: try encoder.encode(budget))
    }
}
