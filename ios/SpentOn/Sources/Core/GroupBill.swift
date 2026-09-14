import Foundation

enum SharedSplitMethod:String,CaseIterable,Codable,Sendable {
    case equal,amount,percent,shares
    var title:String { switch self { case .equal:"Equally";case .amount:"By amount";case .percent:"By percentage";case .shares:"By shares" } }
    var shortTitle:String { switch self { case .equal:"Equal";case .amount:"Amounts";case .percent:"Percentages";case .shares:"Shares" } }
    var symbol:String { switch self { case .equal:"equal";case .amount:"number";case .percent:"percent";case .shares:"person.2" } }
}
struct GroupBillCostInput:Codable,Sendable { let memberId:String;let value:String }
struct GroupBillPaymentInput:Codable,Sendable { let memberId:String;let amount:Int64 }
struct GroupBillDefinition:Codable,Sendable {
    let total:Int64;let method:String;let people:[GroupBillCostInput];let payers:[GroupBillPaymentInput]
    var body:[String:JSONValue] { ["total":.number(total),"method":.string(method),"people":.array(people.map{.object(["memberId":.string($0.memberId),"value":.string($0.value)])}),"payers":.array(payers.map{.object(["memberId":.string($0.memberId),"amount":.number($0.amount)])})] }
}
struct GroupBillSchedule:Codable,Sendable { let start:String;let interval:String;let every:Int;let until:String? }
struct GroupBillSeries:Codable,Identifiable,Sendable {
    let id:String;let groupId:String;let merchant:String;let state:String;let revision:Int
    let definition:GroupBillDefinition;let schedule:GroupBillSchedule;let nextDate:String?;let due:Bool;let canManage:Bool
}
struct GroupComputedPlan:Decodable,Sendable {
    struct Person:Decodable,Sendable { let memberId:String;let value:String;let amount:Int64 }
    struct Payer:Decodable,Sendable { let memberId:String;let amount:Int64 }
    let total:Int64;let method:String;let people:[Person];let payers:[Payer]
}
struct GroupBillClientPreview:Decodable,Sendable { let paid:Int64;let personalSpending:Int64;let receivable:Int64;let categoryLeft:Int64;let ready:Int64;let cash:Int64 }
struct GroupBillBudgetPreview:Decodable,Sendable {
    let budgetId:String;let budgetName:String;let revision:Int;let currency:String;let accountId:String;let categoryId:String
    let before:SharedChangeTotals;let after:SharedChangeTotals
}
struct GroupBillRecord:Decodable,Identifiable,Sendable {
    struct Person:Decodable,Identifiable,Sendable { let memberId:String;let name:String;let amount:Int64;let isYou:Bool;var id:String{memberId} }
    struct Payer:Decodable,Identifiable,Sendable { let memberId:String;let name:String;let amount:Int64;let isYou:Bool;let approved:Bool;let expenseId:String?;let canOpen:Bool;var id:String{memberId} }
    let id:String;let groupId:String;let budgetId:String;let merchant:String;let date:String;let currency:String;let state:String;let revision:Int;let method:String;let total:Int64;let originalTotal:Int64
    let scheduledDate:String?;let refunded:Int64
    let people:[Person];let payers:[Payer];let canConfirm:Bool;let canCancel:Bool;let canAccept:Bool
    let own:GroupBillBudgetPreview?;let problem:String?;let seriesId:String?
    var groupName:String?=nil
}
