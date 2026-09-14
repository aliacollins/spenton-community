import Foundation

struct SharedInbox: Decodable, Sendable {
    var groupVersion: Int? = nil
    var atomicPurchases: Bool? = nil
    var categorySplits: Bool? = nil
    let verificationRequired: Bool; var expenses: [SharedExpense]
    var balances: [PersonBalance]? = nil; var hasMore: Bool? = nil; var nextOffset: Int? = nil
    var groupBills: [GroupBillRecord]? = nil
}
struct PersonBalance: Decodable, Identifiable, Hashable, Sendable {
    let email: String; let currency: String
    let owedToYou: Int64; let youOwe: Int64; let pendingToYou: Int64; let pendingFromYou: Int64
    let requestedToYou: Int64; let requestedFromYou: Int64
    var id: String { (personKey ?? email) + currency }
    var name: String? = nil
    var personKey: String? = nil
    var key: String { personKey ?? email }
    var displayName: String { if let name, !name.isEmpty { return name }; return email.components(separatedBy: "@").first ?? email }
}
enum SharedMoney {
    static func format(_ amount: Int64, _ currency: String) -> String {
        let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = currency
        f.locale = Locale(identifier: currency == "INR" ? "en_IN" : "en_US")
        f.minimumFractionDigits = amount % 100 == 0 ? 0 : 2; f.maximumFractionDigits = 2
        return f.string(from: NSDecimalNumber(value: amount).dividing(by: 100)) ?? currency
    }
}
struct SharedExpense: Decodable, Identifiable, Sendable {
    let id: String; let owned: Bool; let merchant: String; let total: Int64; let currency: String; let date: String; let payer: String
    let entryId: String?; let budgetId: String?; let shares: [ExpenseShare]
    var hasReceipt: Bool? = nil
    var groupId: String? = nil
    var groupName: String? = nil
    var categoryId: String? = nil
    var categorySplits: [Transaction.Split]? = nil
    var combinedBillId: String? = nil
    var groupBudgetId: String? = nil
    var kind: String? = nil
    var refunded: Int64? = nil
    var expenseRevision: Int? = nil
    var ledgerVersion: Int? = nil
    var unified: Bool { (ledgerVersion ?? 1) >= 2 }
}
struct ExpenseShare: Decodable, Identifiable, Sendable {
    let id: String; let email: String; let amount: Int64; let state: String; let budgetId: String?; let confirmed: Int64; let pending: Int64; let settlements: [ShareSettlement]
    var name: String? = nil
    var personKey: String? = nil
    var categoryId: String? = nil
    var reviewPending: Bool? = nil
    var pendingChangeId: String? = nil
    var offset: Int64? = nil
    var refunded: Int64? = nil
    var originalAmount: Int64? = nil
    var displayName: String { name?.isEmpty == false ? name! : email }
    var remaining: Int64 { max(0, amount - confirmed - pending - (offset ?? 0)) }
}
struct ShareSettlement: Decodable, Identifiable, Sendable { let id: String; let amount: Int64; let state: String; let date: String; var recordedByPayer: Bool? = nil; var recordedInYourBudget: Bool? = nil }
struct SharedResponse: Decodable, Sendable { let expense: SharedExpense; let snapshot: Snapshot?; var invitation: ShareInvitation? = nil }
struct PendingSharedRequest: Codable, Sendable {
    let userID: String; let path: String; let body: JSONValue
    var exportText: String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? "" }
}

struct ShareInvitation: Decodable, Sendable { let shareId: String; let url: String; let expiresAt: String }
