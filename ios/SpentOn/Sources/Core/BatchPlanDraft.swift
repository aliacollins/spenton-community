import Foundation

struct BatchPlanDraft {
    let budget: JSONValue
    let overview: Overview
    let amounts: [String: Int64]
    let total: Int64

    @MainActor init(engine: BudgetEngine, budget: JSONValue, fields: [String: String], date: String? = nil) throws {
        var next = budget
        var amounts: [String: Int64] = [:]
        var total: Int64 = 0
        for id in fields.keys.sorted() {
            let text = (fields[id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let amount: Int64 = try engine.run("parseAmount", command: ["amount": text])
            guard amount >= 0 else { throw BudgetEngine.failure("Enter zero or more for each category.") }
            if amount == 0 { continue }
            let sum = total.addingReportingOverflow(amount)
            guard !sum.overflow else { throw BudgetEngine.failure("This plan is too large.") }
            next = try engine.run("change", budget: next,
                                  command: ["kind": "allocation", "categoryId": id, "amount": text], date: date)
            amounts[id] = amount
            total = sum.partialValue
        }
        self.budget = next
        overview = try engine.run("overview", budget: next, date: date)
        self.amounts = amounts
        self.total = total
    }
}
