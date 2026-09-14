import Foundation

enum SaveFeedbackKind: String, Codable, Sendable {
    case saved, budgetCreated, accountCreated, categoryCreated, expenseShared, repaymentRecorded
    var usesSuccessFeedback: Bool { self != .saved }
}

struct SaveFeedback: Identifiable, Equatable, Sendable {
    let id: String
    let kind: SaveFeedbackKind
    var confirmedAt = Date.now

    func isRecent(at now: Date = .now) -> Bool {
        let age = now.timeIntervalSince(confirmedAt)
        return age >= 0 && age < 3
    }
}
