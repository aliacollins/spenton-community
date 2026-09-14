import Foundation

indirect enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Int64), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Int64.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}

struct CloudUser: Codable, Equatable, Sendable { let id: String; let email: String }
struct BudgetSummary: Codable, Identifiable, Sendable { let id: String; let name: String; let revision: Int; let updatedAt: String }
struct Snapshot: Codable, Sendable { let id: String; let revision: Int; let updatedAt: String; var budget: JSONValue; var plannedShares: [PlannedShare]? = nil }
struct Overview: Decodable {
    let name: String; let currency: String; let date: String
    let groups: [String]?
    var upcomingBills: [UpcomingBill]?
    let shared: SharedBudgetTotals?
    let ready: Int64; let spent: Int64; let cash: Int64; let netWorth: Int64
    let categories: [BudgetCategory]; let accounts: [BudgetAccount]; let transactions: [Transaction]
    func money(_ amount: Int64) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: currency == "INR" ? "en_IN" : "en_US")
        formatter.currencyCode = currency
        formatter.minimumFractionDigits = amount % 100 == 0 ? 0 : 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSDecimalNumber(value: amount).dividing(by: 100)) ?? "\(currency) \(Decimal(amount) / 100)"
    }
}
struct BudgetCategory: Decodable, Identifiable {
    let id: String; let name: String; let group: String; let icon: String
    let available: Int64; let assigned: Int64; let spent: Int64; let needed: Int64; let target: Int64
    let parentId: String?
    let color: String?
    var targetType: String? = nil
    var targetDate: String? = nil
    var targetCap: Int64? = nil
}

struct StructureDraft: Identifiable, Equatable, Codable, Sendable {
    var command: [String: String]
    var id: String { command["id"] ?? "" }
}
struct BudgetAccount: Decodable, Identifiable {
    let id: String; let name: String; let type: String; let balance: Int64
    let card: CardTotal?; let statement: Statement?
    var isCash: Bool { type == "checking" || type == "savings" }
}
struct Statement: Decodable { let due: String; var amount: Int64? = nil; var minimum: Int64? = nil; var closed: String? = nil }
struct CardTotal: Decodable { let reserve: Int64; let owed: Int64; let unbacked: Int64; let statementRemaining: Int64 }
struct Transaction: Decodable, Identifiable {
    struct Split: Decodable, Sendable { let categoryId: String; let amount: Int64 }
    let id: String; let date: String; let kind: String; let amount: Int64
    let payee: String; let note: String; let accountName: String; let categoryName: String; let destinationName: String
    let categoryId: String?; let accountId: String?
    let cleared: Bool; let clearedTo: Bool?; let toAccountId: String?
    var receiptId: String? = nil
    var sharedAmount: Int64? = nil
    var sharedExpenseId: String? = nil
    var sharedSettlementId: String? = nil
    var splits: [Split]? = nil
    var canSplit: Bool { kind == "expense" && sharedExpenseId == nil && sharedSettlementId == nil && (categoryId != nil || splits != nil) }
    var isUncleared: Bool { !cleared || (toAccountId != nil && !(clearedTo ?? cleared)) }
}
struct APIError: Error, LocalizedError, Sendable {
    let status: Int; let code: String; let message: String
    var errorDescription: String? { message }
}
struct PendingMutation: Codable, Sendable {
    let userID: String; let budgetID: String?; let mutationID: String
    let expectedRevision: Int?; let budget: JSONValue
    var feedbackKind: SaveFeedbackKind? = nil
    var plannedShares: [PlannedShare]? = nil
    var confirmedFeedback: SaveFeedback {
        let kind: SaveFeedbackKind = budgetID == nil ? .budgetCreated : feedbackKind == .budgetCreated ? .saved : feedbackKind ?? .saved
        return SaveFeedback(id: mutationID, kind: kind)
    }
    var body: JSONValue {
        var value: [String: JSONValue] = ["budget": budget, "mutationId": .string(mutationID), "reviewed": .bool(true), "serviceAction": .string("budget.saved")]
        if let plannedShares, let bytes = try? JSONEncoder().encode(plannedShares), let plans = try? JSONDecoder().decode(JSONValue.self,from:bytes) { value["plannedShares"] = plans }
        if let expectedRevision { value["expectedRevision"] = .number(Int64(expectedRevision)) }
        else { value["completeSetup"] = .bool(true) }
        return .object(value)
    }
}

struct UpcomingBill: Decodable, Identifiable {
    struct Template: Decodable { let accountId: String; let categoryId: String?; let receiptId: String?; let splits: [Transaction.Split]?; var toAccountId: String? = nil;var note: String? = nil }
    let id: String; let date: String; let amount: Int64; let payee: String; let accountName: String
    var sharePlan: ExpensePeopleDraft? = nil
    var template: Template? = nil
    var kind: String? = nil
    var frequency: String? = nil
}

struct SharedBudgetTotals: Decodable { let receivable: Int64; let owed: Int64; let reserved: Int64; let unfunded: Int64 }
struct SharedBudgetPreview: Decodable { let ready: Int64; let categoryLeft: Int64; let reserved: Int64; let unfunded: Int64; let cardReserve: Int64; let personalSpending: Int64 }
