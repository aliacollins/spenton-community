import Foundation

struct NudgePreferences: Codable, Equatable, Sendable {
    var sharedUpdates = false
    var billBudgets: Set<String> = []
    var hour = 9
    var minute = 0
    var dayBefore = true

    func enablingInvitation(budgetID: String, includeShared: Bool) -> Self {
        var updated = self
        updated.billBudgets.insert(budgetID)
        if includeShared { updated.sharedUpdates = true }
        return updated
    }
}

struct NudgeRoute: Identifiable, Equatable, Sendable {
    let account: String
    let kind: String
    let expenseID: String?
    let budgetID: String?
    let billID: String?
    var id: String { [account, kind, expenseID ?? "", budgetID ?? "", billID ?? ""].joined(separator: ":") }
    init?(account: String, kind: String, expenseID: String? = nil, budgetID: String? = nil, billID: String? = nil) {
        guard account.count == 64, account.allSatisfy({ $0.isHexDigit }),
              (kind == "shared" && expenseID.flatMap(UUID.init(uuidString:)) != nil) ||
              (kind == "bill" && budgetID.flatMap(UUID.init(uuidString:)) != nil && !(billID ?? "").isEmpty && (billID?.count ?? 0) <= 128) else { return nil }
        self.account = account; self.kind = kind; self.expenseID = expenseID; self.budgetID = budgetID; self.billID = billID
    }
}

enum NudgePolicy {
    // One reminder per due date. Never turn a missed reminder into a daily nag.
    static func reminderDate(due: String, preferences: NudgePreferences, now: Date, calendar: Calendar) -> Date? {
        let parts = due.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (0...23).contains(preferences.hour), (0...59).contains(preferences.minute),
              let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              calendar.component(.month, from: day) == parts[1], calendar.component(.day, from: day) == parts[2],
              let targetDay = calendar.date(byAdding: .day, value: preferences.dayBefore ? -1 : 0, to: day),
              let trigger = calendar.date(bySettingHour: preferences.hour, minute: preferences.minute, second: 0, of: targetDay), trigger > now,
              trigger.timeIntervalSince(now) <= 30 * 86400 else { return nil }
        return trigger
    }
}
