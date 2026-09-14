import SwiftUI
import UserNotifications
import CryptoKit

@MainActor @Observable final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()
    var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var authorizationChecked = false
    var preferences = NudgePreferences()
    var sharedAvailable = false
    var pendingRoute: NudgeRoute?
    var error: String?
    var working = false
    var token: String?
    private(set) var account: String?
    private(set) var invitationAnswered = false
    private(set) var preferencesConfigured = false
    private let center = UNUserNotificationCenter.current()
    private var generation = 0
    private var defaults: UserDefaults { .standard }
    var installationID: String {
        if let value = defaults.string(forKey: "notification-installation") { return value }
        let value = UUID().uuidString; defaults.set(value, forKey: "notification-installation"); return value
    }
    var allowed: Bool { authorization == .authorized || authorization == .provisional || authorization == .ephemeral }
    static func accountKey(_ userID: String) -> String { SHA256.hash(data: Data(userID.utf8)).map { String(format: "%02x", $0) }.joined() }
    override init() { super.init(); center.delegate = self }
    func attach(userID: String) {
        let key = Self.accountKey(userID)
        guard account != key else { return }
        generation += 1; account = key
        let saved = defaults.data(forKey: "nudges-" + key)
        preferences = saved.flatMap { try? JSONDecoder().decode(NudgePreferences.self, from: $0) } ?? NudgePreferences()
        preferencesConfigured = saved != nil
        invitationAnswered = defaults.bool(forKey: "nudges-invitation-" + key)
    }
    func savePreferences() {
        generation += 1
        guard let account, let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: "nudges-" + account)
        preferencesConfigured = true
        if !preferences.sharedUpdates { UIApplication.shared.unregisterForRemoteNotifications() }
        // Turning reminders off applies locally even if the service is offline.
        let enabled = preferences.billBudgets, version = generation
        Task {
            let requests = await center.pendingNotificationRequests()
            guard generation == version else { return }
            center.removePendingNotificationRequests(withIdentifiers: requests.filter {
                $0.identifier.hasPrefix("bill:") && !enabled.contains($0.content.userInfo["budgetID"] as? String ?? "")
            }.map(\.identifier))
        }
    }
    func canOfferInvitation(userID: String) -> Bool {
        account == Self.accountKey(userID) && authorizationChecked && authorization != .denied
            && !invitationAnswered && !preferencesConfigured
    }
    func answerInvitation(userID: String) {
        guard account == Self.accountKey(userID) else { return }
        invitationAnswered = true
        defaults.set(true, forKey: "nudges-invitation-" + Self.accountKey(userID))
    }
    func refreshAuthorization() async {
        authorization = await center.notificationSettings().authorizationStatus
        authorizationChecked = true
    }
    func requestPermission() async -> Bool {
        await refreshAuthorization()
        guard authorization == .notDetermined else { return allowed }
        do { _ = try await center.requestAuthorization(options: [.alert, .sound]); await refreshAuthorization(); return allowed }
        catch { self.error = "Notifications could not be enabled. Try again in Settings."; return false }
    }
    func clear() {
        generation += 1; account = nil; preferences = NudgePreferences(); sharedAvailable = false; pendingRoute = nil
        invitationAnswered = false; preferencesConfigured = false
        center.removeAllPendingNotificationRequests(); center.removeAllDeliveredNotifications()
        UIApplication.shared.unregisterForRemoteNotifications()
    }
    func schedule(budgets: [(String, [UpcomingBill])]) async {
        let currentGeneration = generation
        guard let account else { return }
        await refreshAuthorization()
        guard generation == currentGeneration else { return }
        let existing = await center.pendingNotificationRequests()
        guard generation == currentGeneration else { return }
        var wanted: Set<String> = []
        if allowed {
            let calendar = Calendar.current
            let candidates = budgets.filter { preferences.billBudgets.contains($0.0) }.flatMap { budget in
                budget.1.compactMap { bill -> (String, UpcomingBill, Date)? in
                    guard let date = NudgePolicy.reminderDate(due: bill.date, preferences: preferences, now: .now, calendar: calendar) else { return nil }
                    return (budget.0, bill, date)
                }
            }.sorted { $0.2 < $1.2 }.prefix(48)
            for (budgetID, bill, date) in candidates {
                guard generation == currentGeneration else { return }
                let id = "bill:" + Self.accountKey(account + budgetID + bill.id + bill.date)
                wanted.insert(id)
                let content = UNMutableNotificationContent()
                content.title = preferences.dayBefore ? "Bill due tomorrow" : "Bill due today"
                content.body = "An upcoming bill is ready to review. Record payment only after you have paid."
                content.sound = .default; content.threadIdentifier = "upcoming-bills"; content.interruptionLevel = .active
                content.userInfo = ["account": account, "route": "bill", "budgetID": budgetID, "billID": bill.id]
                let trigger = UNCalendarNotificationTrigger(dateMatching: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date), repeats: false)
                do { try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) }
                catch { self.error = "Some bill reminders could not be scheduled. Open Notifications to try again." }
            }
        }
        guard generation == currentGeneration else { center.removePendingNotificationRequests(withIdentifiers: Array(wanted)); return }
        center.removePendingNotificationRequests(withIdentifiers: existing.map(\.identifier).filter { $0.hasPrefix("bill:") && !wanted.contains($0) })
        // Clear old previews after refreshing; notification taps always fetch the
        // current owned record, including cancellation or payment on the web.
        center.removeAllDeliveredNotifications()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // The open app already shows current activity. Respect Focus and avoid
        // a second banner over a task the person is working on.
        return []
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        let info = response.notification.request.content.userInfo
        guard let account = info["account"] as? String, let kind = info["route"] as? String,
              let route = NudgeRoute(account: account, kind: kind, expenseID: info["expenseID"] as? String, budgetID: info["budgetID"] as? String, billID: info["billID"] as? String) else { return }
        await MainActor.run { self.pendingRoute = route }
    }
}

final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationManager.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined()
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationManager.shared.error = "Shared-expense alerts could not connect. Reopen Notifications to try again. Bill reminders are still available."
    }
}
