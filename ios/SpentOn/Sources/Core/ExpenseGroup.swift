import Foundation

struct ExpenseGroupsList: Decodable, Sendable {
    let available: Bool
    let version: Int
    let groups: [ExpenseGroupSummary]
    let changes: [SharedLifecycleChange]
}
struct ExpenseGroupSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String; let name: String; let kind: String; let currency: String
    let state: String; let revision: Int; let membership: String; let memberCount: Int
    let invitationId: String?
}
struct ExpenseGroupMember: Decodable, Identifiable, Sendable {
    let id: String; let name: String; let state: String; let isYou: Bool
    let email: String?
    var personKey: String? = nil
}
struct ExpenseGroupBalance: Decodable, Identifiable, Sendable {
    let memberId: String; let name: String
    let paid: Int64; let share: Int64; let owed: Int64; let owing: Int64; let pending: Int64
    var id: String { memberId }
}
struct ExpenseGroupBill: Decodable, Identifiable, Sendable {
    let id: String; let kind: String; let merchant: String; let date: String
    let total: Int64; let refunded: Int64; let payerId: String?
    let revision: Int; let hasReceipt: Bool; let archived: Bool
    let shares: [ExpenseGroupShare]
}
struct ExpenseGroupShare: Decodable, Identifiable, Sendable {
    let id: String; let memberId: String?; let amount: Int64
    let refunded: Int64; let confirmed: Int64; let pending: Int64; let offset: Int64
    let state: String
}
struct ExpenseGroupPair: Decodable, Identifiable, Sendable {
    let memberId: String; let name: String
    let owesYou: Int64; let youOwe: Int64; let net: Int64; let offsettable: Int64
    let canOffset: Bool; let lines: [ExpenseGroupLine]
    var id: String { memberId }
}
struct ExpenseGroupLine: Decodable, Identifiable, Sendable {
    let shareId: String; let expenseId: String; let merchant: String
    let direction: String; let amount: Int64
    var id: String { shareId }
}
struct ExpenseGroupDetail: Decodable, Identifiable, Sendable {
    let id: String; let name: String; let kind: String; let currency: String
    let state: String; let revision: Int; let memberId: String; let budgetId: String?
    let canManage: Bool; let total: Int64
    let members: [ExpenseGroupMember]; let balances: [ExpenseGroupBalance]
    let bills: [ExpenseGroupBill]; let changes: [SharedLifecycleChange]
    let settlements: [ExpenseGroupPair]
    let billVersion: Int?
    let combinedBills: [GroupBillRecord]?
    let series: [GroupBillSeries]?
}
struct ExpenseGroupInvitation: Decodable, Sendable {
    let url: String; let name: String; let groupName: String; let expiresAt: String
}
struct SharedChangeTotals: Decodable, Sendable {
    let cash: Int64; let ready: Int64; let spent: Int64
    let receivable: Int64; let owed: Int64; let reserved: Int64
}
struct SharedCategoryChange: Decodable, Identifiable, Sendable { let id: String; let name: String; let beforeLeft: Int64; let afterLeft: Int64; let beforeSpent: Int64; let afterSpent: Int64 }
struct SharedChangePreview: Decodable, Sendable {
    let budgetId: String; let budgetName: String; let revision: Int; let currency: String
    let before: SharedChangeTotals; let after: SharedChangeTotals
    let categories: [SharedCategoryChange]?
}
struct SharedChangeParticipant: Decodable, Sendable {
    let name: String; let isYou: Bool; let approved: Bool
}
struct SharedOffsetLine: Decodable, Sendable { let amount: Int64; let first: String; let second: String; let incomingBill: String?; let outgoingBill: String? }
struct SharedRefundPart: Decodable, Sendable { let name: String; let amount: Int64; let unpaid: Int64; let extra: Int64 }
struct SharedBillRevision: Decodable, Sendable { let total: Int64; let merchant: String; let date: String }
struct SharedLifecycleChange: Decodable, Identifiable, Sendable {
    let id: String; let groupId: String?; let kind: String; let state: String
    let currency: String?; let counterparty: String?
    let reason: String; let createdAt: String; let merchant: String?; let amount: Int64?
    let participants: [SharedChangeParticipant]
    let canApprove: Bool; let canCancel: Bool; let canReverse: Bool
    let preview: SharedChangePreview?; let problem: String?
    let before: SharedBillRevision?; let after: SharedBillRevision?
    let lines: [SharedOffsetLine]?; let refunds: [SharedRefundPart]?
    var title: String {
        ["offset": "Offset between two people", "correct": "Bill correction", "refund": "Shared refund",
         "reverse_payment": "Repayment reversal", "reverse_offset": "Offset reversal"][kind] ?? "Shared change"
    }
}
struct ExpenseGroupResponse: Decodable, Sendable {
    let group: ExpenseGroupDetail?
    let change: SharedLifecycleChange?
    let invitation: ExpenseGroupInvitation?
    let snapshot: Snapshot?
    let bill: GroupBillRecord?
    let series: GroupBillSeries?
}
