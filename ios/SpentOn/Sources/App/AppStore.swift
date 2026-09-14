import SwiftUI
import AuthenticationServices

@MainActor @Observable final class AppStore {
    var user: CloudUser?
    var budgets: [BudgetSummary] = []
    var snapshot: Snapshot?
    var overview: Overview?
    var pending: PendingMutation?
    var pendingShared: PendingSharedRequest?
    var lastSharedResponse: SharedResponse?
    var lastGroupResponse: ExpenseGroupResponse?
    var lastPersonResponse: PersonResponse?
    var groupsAvailable = false
    var busy = false
    var editing = false
    var requiresSignIn = false
    var message: String?
    var syncStatus = "Connecting"
    var sample = false
    var conflict = false
    var restoring = true
    var presentingOnboarding = false
    var savedCount = 0
    var lastSave: SaveFeedback?
    var savedMessage = "Your change was saved."
    private var notificationSyncAgain = false
    var notificationActivityRequested = false
    var sharingAvailable: Bool?
    var atomicPurchasesAvailable = false
    var categorySharingAvailable = false
    var sharingVerificationRequired = false
    var exportPresented = false
    private var editors = Set<UUID>()
    private(set) var engine: BudgetEngine?
    private let socialSignIn = NativeSignIn()
    private var api: APIClient
    private(set) var connectionID = UUID()
    private var restoringSession = false
    var serverURL: URL { api.origin }
    var isCloudConnection: Bool { api.origin == ServerConnection.cloud }
    var accountScope: String { guard let user else { return "" }; return isCloudConnection ? user.id : serverOrigin + "|" + user.id }
    private let operationStore = SaveOperationStore()
    private(set) var saveOperations: [SaveOperation] = []
    private(set) var saveStatusNeedsReview = false
    private(set) var lastNotSavedOperationID: String?
    private(set) var serverInfo: ServerInfo?
    var hasPendingSave: Bool { !saveOperations.isEmpty || pending != nil || pendingShared != nil }
    private var serverOrigin: String { api.origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
    private var syncTask: Task<Void, Never>?
    private var sessionVault: SessionVault { SessionVault(service: "dev.spenton.ios.session:" + serverOrigin) }
    private func savedSession() throws -> Data? {
        if let data = try sessionVault.read() { return data }
        guard isCloudConnection else { return nil }
        let previous = SessionVault(service: "dev.spenton.ios.spenton.dev443")
        guard let data = try previous.read() else { return nil }
        try sessionVault.save(data); try previous.remove()
        return data
    }

    func sharedInbox(person: String = "", offset: Int = 0, group: String = "") async throws -> SharedInbox {
        if sample { sharingAvailable = true; atomicPurchasesAvailable = true; categorySharingAvailable = true; return SharedPreview.inbox(person: person) }
        var components = URLComponents(); components.queryItems = [URLQueryItem(name: "person", value: person), URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "group", value: group)]
        do {
            let inbox: SharedInbox = try await api.request("/shared-expenses?" + (components.percentEncodedQuery ?? ""))
            sharingAvailable = true; atomicPurchasesAvailable = inbox.atomicPurchases == true; categorySharingAvailable = inbox.categorySplits == true
            sharingVerificationRequired = inbox.verificationRequired; groupsAvailable = inbox.groupVersion == 1; return inbox
        } catch let error as APIError where error.status == 404 {
            sharingAvailable = false
            throw APIError(status: 503, code: "SHARING_UNAVAILABLE", message: "Sharing is not available on this version of SpentOn yet. You can continue recording purchases in your budget.")
        }
    }
    func expenseGroups() async throws -> ExpenseGroupsList {
        let result: ExpenseGroupsList = try await api.request("/expense-groups")
        groupsAvailable = result.version == 1; return result
    }
    func peopleDirectory() async throws -> PeopleDirectory {
        if sample {
            let balances = SharedPreview.inbox().balances ?? []
            var seen = Set<String>()
            return PeopleDirectory(version: 1, people: balances.filter { seen.insert($0.key).inserted }.map {
                PrivatePerson(id: $0.key, name: $0.displayName, email: $0.email)
            })
        }
        do { return try await api.request("/people") }
        catch let error as APIError where error.status == 404 {
            let balances = try await sharedInbox().balances ?? []
            var seen = Set<String>()
            return PeopleDirectory(version: 0, people: balances.filter { seen.insert($0.key).inserted }.map {
                PrivatePerson(id: $0.key, name: $0.displayName, email: $0.email)
            })
        }
    }
    func expenseGroup(_ id: String) async throws -> ExpenseGroupDetail { try await api.request("/expense-groups/" + id) }
    func sharedReview(_ id: String) async throws -> SharedLifecycleChange { try await api.request("/shared-changes/" + id) }
    func groupBill(_ id:String,account:String?=nil,category:String?=nil) async throws -> GroupBillRecord {
        if let account,let category { return try await api.request("/group-bills/"+id+"/preview",method:"POST",body:.object(["accountId":.string(account),"categoryId":.string(category)])) }
        return try await api.request("/group-bills/"+id)
    }
    func sharedChange(_ path: String, body: [String: JSONValue]) async -> Bool {
        guard let user, !sample, !hasPendingSave, !busy else { return false }
        guard path == "/people" || sharingAvailable != false else { message = "Sharing is not available on this version of SpentOn yet."; return false }
        lastSharedResponse = nil; lastGroupResponse = nil; lastPersonResponse = nil
        var body = body; body["operationId"] = .string(UUID().uuidString.lowercased()); body["ledgerVersion"] = .number(groupsAvailable ? 3 : 2); if groupsAvailable { body["groupVersion"] = .number(1) }
        let draft = PendingSharedRequest(userID: user.id, path: path, body: .object(body))
        do {
            guard case .string(let id) = body["operationId"] else { return false }
            try rememberOperation(scope: "shared", id: id)
            pendingShared = draft; conflict = false; await retryShared()
            return lastSave?.id == id
        }
        catch { handle(error); return false }
    }
    func retryShared() async {
        guard let draft = pendingShared, draft.userID == user?.id, !busy, !conflict else { return }
        busy = true; message = nil; defer { busy = false }
        do {
            guard draft.path.range(of: #"^/(people|shared-expenses|expense-shares/[0-9a-f-]{36}/(respond|repay|invite|receive)|share-settlements/[0-9a-f-]{36}(/record)?|expense-groups(/[0-9a-f-]{36})?|expense-group-members/[0-9a-f-]{36}/invite|group-invitations/join|shared-changes(/[0-9a-f-]{36})?|group-bills(/[0-9a-f-]{36}/(confirm|accept))?|group-bill-series(/[0-9a-f-]{36})?)$"#, options: .regularExpression) != nil else { throw BudgetEngine.failure("This shared-expense draft could not be verified. Export or discard it.") }
            let isGroupRequest = draft.path.hasPrefix("/expense-group") || draft.path.hasPrefix("/group-invitations/") || draft.path.hasPrefix("/shared-changes") || draft.path.hasPrefix("/group-bill")
            let savedSnapshot: Snapshot?
            if draft.path == "/people" {
                let response: PersonResponse = try await api.request(draft.path, method: "POST", body: draft.body)
                lastPersonResponse = response; lastSharedResponse = nil; lastGroupResponse = nil; savedSnapshot = nil
            } else if isGroupRequest {
                let response: ExpenseGroupResponse = try await api.request(draft.path, method: "POST", body: draft.body)
                let validResponse = draft.path.hasPrefix("/group-bill-series") ? response.series != nil : draft.path.hasPrefix("/group-bills") ? response.bill != nil : draft.path.hasPrefix("/shared-changes") ? response.change != nil : draft.path.hasSuffix("/invite") ? response.invitation != nil : response.group != nil
                guard validResponse else { throw BudgetEngine.failure("The group response could not be verified. Your request is kept.") }
                lastGroupResponse = response; lastSharedResponse = nil; savedSnapshot = response.snapshot
            } else {
                let response: SharedResponse = try await api.request(draft.path, method: "POST", body: draft.body)
                lastSharedResponse = response; lastGroupResponse = nil; savedSnapshot = response.snapshot
            }
            if let value = savedSnapshot {
                guard snapshot?.id == value.id else { throw BudgetEngine.failure("Open the budget associated with this change. Your request is kept.") }
                let checked = try validated(value, expectedID: value.id)
                if checked.revision >= (snapshot?.revision ?? 0) { snapshot = checked; try display(checked.budget) }
            }
            if case .object(let fields) = draft.body, case .string(let id) = fields["operationId"] { try forgetOperation(scope: "shared", id: id) }
            pendingShared = nil; conflict = false
            var kind: SaveFeedbackKind = .saved
            savedMessage = "Your shared-expense change was saved."
            if draft.path == "/people" { savedMessage = "Person added." }
            else if draft.path == "/shared-expenses" { kind = .expenseShared; savedMessage = "Split saved." }
            else if draft.path.hasSuffix("/respond"), case .object(let fields) = draft.body, fields["action"] == .string("accept") {
                kind = .expenseShared; savedMessage = "Share accepted."
            }
            else if draft.path.hasSuffix("/repay") || draft.path.hasSuffix("/record") {
                kind = .repaymentRecorded; savedMessage = "Repayment recorded."
            } else if draft.path.hasSuffix("/receive") {
                kind = .repaymentRecorded; savedMessage = "Money received was recorded."
            } else if case .object(let fields) = draft.body, fields["action"] == .string("confirm") {
                kind = .repaymentRecorded; savedMessage = "Repayment confirmed."
            } else if case .object(let fields) = draft.body, fields["action"] == .string("dispute") {
                savedMessage = "Payment marked as not received."
            }
            if isGroupRequest {
                if let bill=lastGroupResponse?.bill { savedMessage = bill.state=="recorded" ? "Bill recorded." : bill.state=="cancelled" ? "Bill cancelled." : "Bill is ready for payer review." }
                else if lastGroupResponse?.series != nil { savedMessage = "Recurring bill saved." }
                else if draft.path == "/shared-changes" { savedMessage = "Review requested. Budgets have not changed." }
                else if let change = lastGroupResponse?.change { savedMessage = change.state == "applied" ? "Shared change applied." : change.state == "cancelled" ? "Review cancelled." : "Your approval is recorded." }
                else if draft.path == "/expense-groups" { savedMessage = "Group created." }
                else if draft.path == "/group-invitations/join" { savedMessage = "You joined the group." }
                else if lastGroupResponse?.invitation != nil { savedMessage = "Invitation ready." }
                else { savedMessage = "Group updated." }
            }
            if case .object(let fields) = draft.body, case .string(let operationID) = fields["operationId"] {
                lastSave = SaveFeedback(id: operationID, kind: kind)
            } else { lastSave = SaveFeedback(id: UUID().uuidString, kind: kind) }
            savedCount += 1
            if let user, let snapshot { keepSavedReceipt(snapshot.budget, userID: user.id) }
            syncStatus = "Saved to your account"; startSync()
        } catch { handle(error) }
    }
    func discardShared() async {
        await checkSaveStatus()
    }

    var receiptAIChoice: ReceiptAIChoice { guard user != nil else { return .notAsked }; return ReceiptAIChoice.read(userID: accountScope) }
    func setReceiptAIChoice(_ choice: ReceiptAIChoice) { if user != nil { choice.save(userID: accountScope) } }
    func scanCapabilities() async throws -> ScanCapabilities { try await api.request("/receipt-scans/capabilities") }
    func scanReceipt(id: String, text: String, pages: [String], retryOf: String?) async throws -> ReceiptScan {
        guard !sample, let snapshot else { throw BudgetEngine.failure("Sign in to your own budget to use AI scanning.") }
        guard receiptAIChoice == .allowed else { throw BudgetEngine.failure("AI scanning is off. You can enable it in Account → Bill scanning.") }
        let request = ReceiptScanRequest(id: id, budgetID: snapshot.id, text: text, pages: pages, retryOf: retryOf)
        return try await api.request("/receipt-scans", method: "POST", body: request.body)
    }
    func existingScan(_ id: String) async throws -> ReceiptScan { try await api.request("/receipt-scans/" + id) }
    func scanBecameVisible(_ id: String, elapsed: Int64) async {
        _ = try? await api.data("/receipt-scans/" + id + "/visible", method: "POST", body: .object(["elapsedMs": .number(elapsed)]))
    }

    init() {
        let selectedOrigin = UserDefaults.standard.string(forKey: "spenton.server.origin").flatMap { try? ServerConnection.origin($0) } ?? ServerConnection.cloud
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--local-api") {
            let testPort = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--local-api-port=") }.flatMap { Int($0.dropFirst("--local-api-port=".count)) } ?? 5418
            api = APIClient(origin: URL(string: "http://127.0.0.1:\((1024...65535).contains(testPort) ? testPort : 5418)")!)
        } else { api = APIClient(origin: selectedOrigin) }
        #else
        api = APIClient(origin: selectedOrigin)
        #endif
        ReceiptVault.server = serverOrigin
        do { try operationStore.removeLegacyDrafts(); engine = try BudgetEngine() } catch { message = error.localizedDescription }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fresh-session") { try? sessionVault.remove(); api.clearSession() }
        if ProcessInfo.processInfo.arguments.contains("--sample") {
            do {
                var budget: JSONValue = try requireEngine().run("sample")
                if ProcessInfo.processInfo.arguments.contains("--many-categories") { budget = PreviewBudget.manyCategories(budget) }
                sample = true
                restoring = false
                user = CloudUser(id: "fictional-preview", email: "Fictional preview")
                snapshot = Snapshot(id: "fictional-preview", revision: 1, updatedAt: "", budget: budget)
                try display(budget)
                syncStatus = "Fictional preview"
            } catch { message = error.localizedDescription }
        }
        #endif
    }
    func requireEngine() throws -> BudgetEngine {
        guard let engine else { throw BudgetEngine.failure("The budget engine could not start. Reopen the app.") }
        return engine
    }
    func sharedReceipt(_ id: String) async throws -> ReceiptAttachment { try await api.request("/shared-expenses/" + id + "/receipt") }
    func sharedExpense(_ id: String) async throws -> SharedExpense { try await api.request("/shared-expenses/" + id) }
    func syncNotifications() async {
        let notifications = NotificationManager.shared
        guard !sample, let user, !requiresSignIn else { return }
        if notifications.working { notificationSyncAgain = true; return }
        let connection = connectionID, client = api
        notifications.attach(userID: accountScope)
        notifications.working = true; notifications.error = nil
        defer { notifications.working = false; if notificationSyncAgain { notificationSyncAgain = false; Task { await syncNotifications() } } }
        do {
            await notifications.refreshAuthorization()
            struct Capabilities: Decodable, Sendable { let sharedUpdates: Bool }
            let capabilities: Capabilities = try await client.request("/notifications/capabilities")
            guard connectionID == connection, self.user?.id == user.id, !requiresSignIn else { return }
            notifications.sharedAvailable = capabilities.sharedUpdates
            if notifications.allowed && notifications.preferences.sharedUpdates && capabilities.sharedUpdates {
                UIApplication.shared.registerForRemoteNotifications()
                if let token = notifications.token {
                    #if DEBUG
                    let environment = "sandbox"
                    #else
                    let environment = "production"
                    #endif
                    try await client.data("/notifications/devices", method: "POST", body: .object(["installationID": .string(notifications.installationID), "enabled": .bool(true), "token": .string(token), "environment": .string(environment)]))
                }
            } else {
                try await client.data("/notifications/devices", method: "POST", body: .object(["installationID": .string(notifications.installationID), "enabled": .bool(false)]))
            }
            var bills: [(String, [UpcomingBill])] = []
            for id in notifications.preferences.billBudgets.sorted() {
                do {
                    let saved = try validated(await client.request("/budgets/" + id), expectedID: id)
                    let view: Overview = try requireEngine().run("overview", budget: saved.budget)
                    bills.append((id, view.upcomingBills ?? []))
                } catch let error as APIError where error.status == 404 { bills.append((id, [])) }
            }
            guard connectionID == connection, self.user?.id == user.id, !requiresSignIn else { return }
            await notifications.schedule(budgets: bills)
        } catch {
            guard connectionID == connection, self.user?.id == user.id else { return }
            if let apiError = error as? APIError, apiError.status == 401 { notifications.clear(); handle(error) }
            else { notifications.error = "Notification settings could not sync. Your previous reminders are kept. Try again when connected." }
        }
    }
    func display(_ budget: JSONValue) throws {
        var data: Overview = try requireEngine().run("overview", budget: budget)
        data.upcomingBills = data.upcomingBills?.map { bill in
            var value = bill
            value.sharePlan = snapshot?.plannedShares?.first { $0.scheduleId == bill.id }?.plan
            return value
        }
        overview = data
    }
    func validated(_ value: Snapshot, expectedID: String? = nil) throws -> Snapshot {
        guard value.revision >= 1, UUID(uuidString: value.id) != nil, expectedID == nil || value.id == expectedID else { throw BudgetEngine.failure("The saved budget could not be verified. Check the server before entering the change again.") }
        let budget: JSONValue = try requireEngine().run("validate", budget: value.budget)
        if case .object(let fields) = budget, fields["demo"] != .bool(false) { throw BudgetEngine.failure("A fictional budget cannot replace your saved budget.") }
        return Snapshot(id: value.id, revision: value.revision, updatedAt: value.updatedAt, budget: budget, plannedShares: value.plannedShares)
    }
    func signIn(email: String, password: String) async {
        guard !busy else { return }
        busy = true; message = nil
        defer { busy = false }
        do {
            struct Login: Decodable, Sendable { let user: CloudUser }
            let result: Login = try await api.request("/auth/login", method: "POST", body: .object(["email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)), "password": .string(password)]))
            try await acceptSignIn(result.user)
        } catch { handle(error) }
    }
    private func acceptSignIn(_ signedIn: CloudUser) async throws {
        if let user, user.id != signedIn.id {
            _ = try? await api.data("/auth/logout", method: "POST")
            api.clearSession()
            throw BudgetEngine.failure("Sign in to \(user.email) to check the unfinished save.")
        }
        try sessionVault.save(api.sessionData())
        user = signedIn; requiresSignIn = false
        saveOperations = try operationStore.read(server: serverOrigin, userID: signedIn.id)
        try await loadWorkspace()
        if !saveOperations.isEmpty { try await resolveSaveOperations() }
        if snapshot == nil && budgets.count == 1 { try await loadBudget(budgets[0].id) }
        startSync()
    }
    func providers() async throws -> [SignInProvider] {
        let connection = connectionID, client = api
        struct Providers: Decodable, Sendable { let providers: [SignInProvider]; let nativeAuthentication: Bool? }
        let result: Providers
        do { result = try await client.request("/auth/providers") }
        catch { if connectionID != connection { throw CancellationError() }; throw error }
        guard connectionID == connection else { throw CancellationError() }
        return result.nativeAuthentication == true ? result.providers.filter(\.available) : []
    }
    func register(email: String, password: String) async -> Bool {
        guard !busy else { return false }
        busy = true; message = nil
        defer { busy = false }
        do {
            struct Registration: Decodable, Sendable { let user: CloudUser?; let verificationRequired: Bool? }
            let result: Registration = try await api.request("/auth/register", method: "POST", body: .object(["email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)), "password": .string(password)]))
            if result.verificationRequired == true { return true }
            guard let user = result.user else { throw BudgetEngine.failure("Your account could not be opened. Try signing in.") }
            try await acceptSignIn(user)
        } catch { handle(error) }
        return false
    }
    func signIn(provider: String) async {
        guard !busy else { return }
        busy = true; message = nil
        defer { busy = false }
        do { try await acceptSignIn(socialSignIn.authenticate(provider: provider, api: api)) }
        catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { }
        catch { handle(error) }
    }
    func accountEmail(_ email: String, verification: Bool) async -> Bool {
        guard !busy else { return false }
        busy = true; message = nil
        defer { busy = false }
        do {
            try await api.data(verification ? "/auth/send-verification" : "/auth/request-reset", method: "POST", body: .object(["email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines))]))
            return true
        } catch { handle(error); return false }
    }
    func restoreSignIn() async {
        guard !sample, user == nil else { restoring = false; return }
        guard !restoringSession else { return }
        restoringSession = true; restoring = true
        defer { restoring = false; restoringSession = false }
        do {
            guard let data = try savedSession() else { return }
            try api.restoreSession(data)
            struct Login: Decodable, Sendable { let user: CloudUser }
            let result: Login = try await api.request("/auth/me")
            user = result.user
            saveOperations = try operationStore.read(server: serverOrigin, userID: result.user.id)
            try await loadWorkspace()
            if !saveOperations.isEmpty { try await resolveSaveOperations() }
            if snapshot == nil && budgets.count == 1 { try await loadBudget(budgets[0].id) }
            startSync()
        } catch {
            if let error = error as? APIError, error.status == 401 { try? sessionVault.remove(); api.clearSession() }
            handle(error)
        }
    }
    func loadWorkspace() async throws {
        let connection = connectionID, client = api
        let info: ServerInfo? = try? await client.request("/server")
        struct List: Decodable, Sendable { let budgets: [BudgetSummary] }
        let result: List
        do { result = try await client.request("/budgets") }
        catch { if connectionID != connection { throw CancellationError() }; throw error }
        guard connectionID == connection else { throw CancellationError() }
        serverInfo = info
        budgets = result.budgets
        if let user, ReceiptVault.hasLegacy(user: user.id) {
            var documents: [JSONValue] = []
            for budget in budgets { documents.append(try validated(await api.request("/budgets/" + budget.id), expectedID: budget.id).budget) }
            try ReceiptVault.migrateLegacy(user: user.id, budgets: documents)
        }
    }
    func loadBudget(_ id: String) async throws {
        let connection = connectionID
        let value = try validated(await api.request("/budgets/" + id), expectedID: id)
        guard connectionID == connection else { throw CancellationError() }
        snapshot = value; try display(value.budget); syncStatus = "Saved to your account"
    }
    func open(_ id: String) async {
        guard pending == nil, pendingShared == nil, !busy else { return }
        busy = true; defer { busy = false }
        do { try await loadBudget(id); startSync() } catch { handle(error) }
    }
    func beginEditing(_ id: UUID) { editors.insert(id); editing = true }
    func endEditing(_ id: UUID) { editors.remove(id); editing = !editors.isEmpty; if !editing { Task { await refresh() } } }
    func adding(_ additions: [StructureDraft], to budget: JSONValue) throws -> JSONValue {
        try additions.reduce(budget) { try requireEngine().run("structure", budget: $0, command: $1.command) }
    }
    func structureOverview(_ additions: [StructureDraft]) throws -> Overview {
        guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
        return try requireEngine().run("overview", budget: adding(additions, to: snapshot.budget))
    }
    func createRecord(_ draft: StructureDraft) async -> Bool {
        guard pending == nil, pendingShared == nil, !busy else { return false }
        do {
            guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
            savedMessage = draft.command["kind"] == "account" ? "Account saved." : "Category saved."
            return await save(try adding([draft], to: snapshot.budget), feedbackKind: draft.command["kind"] == "account" ? .accountCreated : .categoryCreated)
        } catch { handle(error); return false }
    }
    func createRecords(_ drafts: [StructureDraft]) async -> Bool {
        guard !drafts.isEmpty, pending == nil, pendingShared == nil, !busy else { return false }
        do {
            guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
            let budget = try adding(drafts, to: snapshot.budget)
            savedMessage = "\(drafts.count) categor\(drafts.count == 1 ? "y" : "ies") added."
            return await save(budget, feedbackKind: .categoryCreated)
        } catch { handle(error); return false }
    }
    func createBudget(_ command: [String: String], additions: [StructureDraft] = []) async -> Bool {
        guard pending == nil, pendingShared == nil, !busy else { return false }
        do {
            let budget: JSONValue = try requireEngine().run("create", command: command)
            savedMessage = "Budget created."
            return await save(try adding(additions, to: budget), creating: true)
        } catch { handle(error); return false }
    }
    func discardOnboarding() throws {
        guard !busy else { throw BudgetEngine.failure("Wait for the current request to finish.") }
        dropPendingPayload()
    }
    func finishOnboarding(_ draft: PipSetupDraft) async -> Bool {
        guard let user, user.id == draft.userID, !busy, pendingShared == nil else { return false }
        do {
            if let pending {
                guard pending.mutationID == draft.mutationID else { throw BudgetEngine.failure("Resolve the other pending save first.") }
                await retry()
                return lastSave?.id == draft.mutationID
            }
            guard draft.reviewed else { throw BudgetEngine.failure("Confirm that you have reviewed the amounts.") }
            let budget: JSONValue = try requireEngine().run("createOnboarding", command: draft.command(complete: true))
            if sample { return await save(budget, creating: true) }
            let operation = PendingMutation(userID: user.id, budgetID: nil, mutationID: draft.mutationID, expectedRevision: nil, budget: budget)
            try rememberOperation(scope: "budget-create", id: operation.mutationID)
            pending = operation
            // Keep the setup visible until the server acknowledges this exact creation.
            await retry()
            return lastSave?.id == operation.mutationID
        } catch { handle(error); return false }
    }
    func preview(_ command: [String: String], additions: [StructureDraft] = []) throws -> Overview {
        guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
        let budget: JSONValue = try requireEngine().run("change", budget: adding(additions, to: snapshot.budget), command: command)
        return try requireEngine().run("overview", budget: budget)
    }
    func prepareSharedPurchase(_ command: [String: String], additions: [StructureDraft]) throws -> SharedPurchaseDraft {
        guard let snapshot, command["kind"] == "expense", command["upcoming"] != "true" else { throw BudgetEngine.failure("Only a purchase paid by you can be split.") }
        let budget: JSONValue = try requireEngine().run("change", budget: adding(additions, to: snapshot.budget), command: command)
        return try SharedPurchaseDraft(original: snapshot.budget, budget: budget, overview: requireEngine().run("overview", budget: budget))
    }
    func change(_ command: [String: String], additions: [StructureDraft] = []) async -> Bool {
        guard pending == nil, pendingShared == nil, !busy else { return false }
        do {
            guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
            let budget: JSONValue = try requireEngine().run("change", budget: adding(additions, to: snapshot.budget), command: command)
            var plans = snapshot.plannedShares ?? []
            if let schedule = command["scheduleId"], !schedule.isEmpty { plans.removeAll { $0.scheduleId == schedule } }
            if let raw = command["sharePlan"], !raw.isEmpty {
                guard let plan = DraftFields.decode(ExpensePeopleDraft.self,raw), !plan.people.isEmpty else {
                    throw BudgetEngine.failure("Review the people sharing this upcoming bill.")
                }
                let total: Int64 = try requireEngine().run("parseAmount", command: ["amount":command["amount"] ?? ""])
                _ = try plan.shares(total: total, engine: requireEngine())
                let oldIDs: Set<String> = {
                    guard case .object(let original) = snapshot.budget, case .array(let rows) = original["schedules"] else { return [] }
                    return Set(rows.compactMap { if case .object(let row) = $0,case .string(let id) = row["id"] { return id };return nil })
                }()
                guard case .object(let fields) = budget, case .array(let scheduled) = fields["schedules"],
                      let final = scheduled.first(where: { if case .object(let row) = $0,case .string(let id) = row["id"] { return !oldIDs.contains(id) };return false }),
                      case .object(let last) = final, case .string(let id) = last["id"] else {
                    throw BudgetEngine.failure("The upcoming split could not be prepared.")
                }
                plans.append(PlannedShare(scheduleId:id,plan:plan))
            }
            savedMessage = [
                "expense": command["upcoming"] == "true" ? "Upcoming bill added." : "Purchase saved.",
                "income": "Income recorded.", "payment": "Card payment recorded.",
                "transfer": "Transfer recorded.", "allocation": "Category amounts updated.",
                "clearing": command["cleared"] == "true" ? "Transaction marked cleared." : "Transaction marked uncleared.",
                "recordBill": "Bill payment recorded.", "reconcile": "Account reconciled.",
                "goal": "Goal saved. No money was set aside.", "statement": "Statement updated.",
                "editEntry": "Transaction details saved.", "refund": "Refund recorded.",
                "postSchedule": "Scheduled transaction recorded.", "skipSchedule": "Occurrence skipped."
            ][command["kind"] ?? ""] ?? "Your change was saved."
            return await save(budget, plannedShares: plans)
        } catch { handle(error); return false }
    }
    func previewPlan(_ fields: [String: String], additions: [StructureDraft] = []) throws -> BatchPlanDraft {
        guard let snapshot else { throw BudgetEngine.failure("Open a budget first.") }
        return try BatchPlanDraft(engine: requireEngine(), budget: adding(additions, to: snapshot.budget), fields: fields)
    }
    func savePlan(_ fields: [String: String], additions: [StructureDraft] = []) async -> Bool {
        guard pending == nil, pendingShared == nil, !busy else { return false }
        do {
            let plan = try previewPlan(fields, additions: additions)
            guard !plan.amounts.isEmpty else { throw BudgetEngine.failure("Enter an amount beside at least one category.") }
            savedMessage = "Money set aside for \(plan.amounts.count) categor\(plan.amounts.count == 1 ? "y" : "ies")."
            return await save(plan.budget)
        } catch { handle(error); return false }
    }
    private func save(_ budget: JSONValue, creating: Bool = false, feedbackKind: SaveFeedbackKind = .saved, plannedShares: [PlannedShare]? = nil) async -> Bool {
        guard let user, !hasPendingSave, !busy else { return false }
        let plans = (plannedShares ?? (creating ? [] : snapshot?.plannedShares ?? [])).sorted { $0.scheduleId < $1.scheduleId }
        if sample {
            snapshot = Snapshot(id: "fictional-preview", revision: (snapshot?.revision ?? 0) + 1, updatedAt: "", budget: budget, plannedShares: plans)
            try? display(budget); message = "Updated the fictional preview."; return true
        }
        let operation = PendingMutation(userID: user.id, budgetID: creating ? nil : snapshot?.id, mutationID: UUID().uuidString.lowercased(), expectedRevision: creating ? nil : snapshot?.revision, budget: budget, feedbackKind: creating ? .budgetCreated : feedbackKind, plannedShares: plans)
        do {
            try rememberOperation(scope: creating ? "budget-create" : "budget-update", id: operation.mutationID, budgetID: operation.budgetID)
            pending = operation
            await retry()
            return lastSave?.id == operation.mutationID
        } catch { handle(error); return false }
    }
    func retry() async {
        guard let pending, pending.userID == user?.id, !busy, !conflict else { return }
        busy = true; message = nil; syncStatus = "Saving"
        defer { busy = false }
        do {
            let path = pending.budgetID.map { "/budgets/" + $0 } ?? "/budgets"
            let result = try validated(await api.request(path, method: pending.budgetID == nil ? "POST" : "PUT", body: pending.body), expectedID: pending.budgetID)
            try forgetOperation(scope: pending.budgetID == nil ? "budget-create" : "budget-update", id: pending.mutationID)
            snapshot = result; self.pending = nil; conflict = false
            try display(result.budget)
            syncStatus = "Saved to your account"; message = "Your change was saved."
            lastSave = pending.confirmedFeedback
            switch lastSave?.kind {
            case .budgetCreated: savedMessage = "Budget created."
            case .accountCreated: savedMessage = "Account saved."
            case .categoryCreated: savedMessage = "Category saved."
            default: break
            }
            savedCount += 1
            keepSavedReceipt(result.budget, userID: pending.userID)
            startSync()
        } catch { syncStatus = "Save not confirmed"; handle(error) }
    }
    func discardAndReload() async {
        await checkSaveStatus()
    }
    func refresh() async {
        guard !sample, !busy, pending == nil, pendingShared == nil, !editing, let snapshot else { return }
        let connection = connectionID
        do {
            let result = try validated(await api.request("/budgets/" + snapshot.id), expectedID: snapshot.id)
            guard connectionID == connection, !busy, pending == nil, pendingShared == nil, !editing, self.snapshot?.id == result.id, result.revision >= (self.snapshot?.revision ?? 0) else { return }
            let changed = self.snapshot?.revision != result.revision
            self.snapshot = result; try display(result.budget); syncStatus = "Saved to your account"
            if changed { Task { await syncNotifications() } }
        } catch { if connectionID == connection { handle(error) } }
    }
    func startSync() {
        syncTask?.cancel()
        guard !sample, let snapshot, user != nil else { return }
        let budgetID = snapshot.id
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.snapshot?.id == budgetID else { return }
                do {
                    struct Change: Decodable, Sendable { let revision: Int; let changed: Bool }
                    let change: Change = try await self.api.request("/budgets/\(budgetID)/changes?after=\(self.snapshot?.revision ?? 1)")
                    guard !Task.isCancelled else { return }
                    if change.changed {
                        if self.pending != nil || self.pendingShared != nil || self.editing { self.syncStatus = "An update is waiting" }
                        else { await self.refresh() }
                    }
                    try await Task.sleep(for: .seconds(change.changed ? 1 : 0.2))
                } catch {
                    if Task.isCancelled { return }
                    if let error = error as? APIError, error.status == 401 { self.handle(error); return }
                    self.syncStatus = "Checking for updates"
                    await self.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }
    func pauseSync() { syncTask?.cancel(); syncTask = nil }
    func signOut() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            if !sample { _ = try? await api.data("/auth/logout", method: "POST") }
            try sessionVault.remove(); api.clearSession()
            NotificationManager.shared.clear()
            ReceiptVault.clearTemporary()
            // Keep submitted-operation identifiers under their original account
            // on disk. Signing out never moves or retries them on another server.
            dropPendingPayload(); saveOperations = []; saveStatusNeedsReview = false; lastNotSavedOperationID = nil; requiresSignIn = false; message = nil
            connectionID = UUID()
            pauseSync(); user = nil; snapshot = nil; overview = nil; budgets = []; sample = false; lastSave = nil; lastGroupResponse = nil; lastSharedResponse = nil; lastPersonResponse = nil; groupsAvailable = false; sharingAvailable = nil; atomicPurchasesAvailable = false; categorySharingAvailable = false; sharingVerificationRequired = false
        } catch { handle(error) }
    }
    func handle(_ error: Error) {
        if error is CancellationError { return }
        if let error = error as? APIError {
            if error.status == 401 { NotificationManager.shared.clear(); requiresSignIn = user != nil; pauseSync() }
            if ["REVISION_CONFLICT", "MUTATION_REUSED", "SHARE_OPERATION_REUSED", "GROUP_CHANGED", "GROUP_BILL_CHANGED", "GROUP_SERIES_CHANGED", "GROUP_SERIES_OCCURRENCE", "CHANGE_STALE", "SHARED_HISTORY_CHANGED"].contains(error.code) { conflict = true }
        }
        message = error is URLError ? "The server could not confirm this request. Check your connection, then check save status before entering it again." : error.localizedDescription
    }

    private func rememberOperation(scope: String, id: String, budgetID: String? = nil) throws {
        guard let user, serverInfo?.isCompatible == true else {
            throw BudgetEngine.failure("Update this SpentOn server before saving with this app. Your saved budgets are available to view.")
        }
        guard saveOperations.isEmpty else { throw BudgetEngine.failure("Check the unfinished save before making another change.") }
        let operation = SaveOperation(server: serverOrigin, userID: user.id, scope: scope, operationID: id, budgetID: budgetID)
        try operationStore.save(operation)
        saveOperations.append(operation)
    }
    private func forgetOperation(scope: String, id: String) throws {
        guard let operation = saveOperations.first(where: { $0.scope == scope && $0.operationID == id }) else { return }
        try operationStore.remove(operation)
        saveOperations.removeAll { $0.id == operation.id }
    }
    func dropPendingPayload() { pending = nil; pendingShared = nil; conflict = false }
    private func keepSavedReceipt(_ budget: JSONValue, userID: String) {
        do { try ReceiptVault.commit(budget, user: userID) }
        catch { message = "Your change was saved, but its bill copy could not be kept on this iPhone." }
    }
    func checkSaveStatus() async {
        guard !busy, user != nil else { return }
        busy = true; defer { busy = false }
        do { try await resolveSaveOperations() } catch { handle(error) }
    }
    private func resolveSaveOperations() async throws {
        guard let user, serverInfo?.isCompatible == true else {
            throw BudgetEngine.failure("Update this server to check the earlier save. Do not enter the same change again yet.")
        }
        saveStatusNeedsReview = false
        var confirmed = false
        for operation in saveOperations {
            guard operation.belongs(server: serverOrigin, userID: user.id) else { throw BudgetEngine.failure("Reconnect to the original server to check this save.") }
            let outcome: SaveOutcome = try await api.request("/operations/resolve", method: "POST", body: operation.body)
            guard outcome.isValid else { throw BudgetEngine.failure("The server did not return a valid save result. Try checking again.") }
            if outcome.state == "unknown" {
                saveStatusNeedsReview = true
                message = "This earlier save cannot be confirmed from its old receipt. Review your saved records before entering it again."
                dropPendingPayload()
                continue
            }
            let needsConflictReview = conflict && (pending != nil || pendingShared != nil)
            try forgetOperation(scope: operation.scope, id: operation.operationID)
            if !needsConflictReview { dropPendingPayload() }
            var refreshFailed = false
            if let id = outcome.budgetId {
                do {
                    try await loadBudget(id)
                    if let snapshot { keepSavedReceipt(snapshot.budget, userID: user.id) }
                } catch { refreshFailed = true }
            }
            if needsConflictReview {
                message = "The saved records changed. Close this edit and review the latest version before trying again."
                syncStatus = "Review changed records"
            } else if outcome.state == "saved" {
                confirmed = true
                lastSave = SaveFeedback(id: operation.operationID, kind: operation.scope == "budget-create" ? .budgetCreated : .saved)
                savedMessage = "Your earlier save was confirmed."
                savedCount += 1
                message = refreshFailed ? "The save was confirmed. Your latest records could not refresh. Reopen the budget when connected." : savedMessage
            } else {
                lastNotSavedOperationID = operation.operationID
                message = "The change was not saved. You can enter it again."; syncStatus = "Saved records loaded"
            }
        }
        do {
            try await loadWorkspace()
            if let id = snapshot?.id { try await loadBudget(id) }
        } catch {
            if confirmed { message = "The save was confirmed. Your latest records could not refresh. Reopen the budget when connected." }
            else { throw error }
        }
        startSync()
    }
    func acknowledgeSaveReview() {
        guard saveStatusNeedsReview, !busy else { return }
        do {
            for operation in saveOperations where operation.protocolVersion == 0 { try forgetOperation(scope: operation.scope, id: operation.operationID) }
            saveStatusNeedsReview = false
            message = "Earlier save review closed. Your saved records have not changed."
        } catch { handle(error) }
    }
    func selectServer(_ address: String) async throws {
        guard user == nil, !busy, !hasPendingSave else {
            throw BudgetEngine.failure("Finish checking any pending save and sign out before changing servers.")
        }
        let origin = try ServerConnection.origin(address)
        busy = true; defer { busy = false }
        let candidate = APIClient(origin: origin)
        let info: ServerInfo
        do { info = try await candidate.request("/server") }
        catch { throw BudgetEngine.failure("This SpentOn server could not be reached securely. Check its HTTPS address and connection.") }
        guard info.isCompatible else { throw BudgetEngine.failure("This server needs a compatible SpentOn update before the app can connect.") }
        guard info.deployment == (origin == ServerConnection.cloud ? "cloud" : "self-hosted") else {
            throw BudgetEngine.failure("This address is not configured for independent hosting. Choose SpentOn Cloud or check the server configuration.")
        }
        pauseSync()
        api.clearSession()
        NotificationManager.shared.clear()
        ReceiptVault.clearTemporary()
        api = candidate; ReceiptVault.server = serverOrigin; serverInfo = info
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fresh-session") { try? sessionVault.remove() }
        #endif
        UserDefaults.standard.set(origin.absoluteString, forKey: "spenton.server.origin")
        snapshot = nil; overview = nil; budgets = []; message = nil; requiresSignIn = false
        pending = nil; pendingShared = nil; saveOperations = []; saveStatusNeedsReview = false; lastNotSavedOperationID = nil
        lastSave = nil; lastSharedResponse = nil; lastGroupResponse = nil; lastPersonResponse = nil
        groupsAvailable = false; sharingAvailable = nil; atomicPurchasesAvailable = false; categorySharingAvailable = false
        sharingVerificationRequired = false; editors.removeAll(); editing = false
        restoring = false; connectionID = UUID()
    }
}
