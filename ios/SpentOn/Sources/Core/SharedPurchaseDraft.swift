import Foundation

struct SharedPurchaseDraft {
    let budget: JSONValue
    let overview: Overview
    let transaction: Transaction
    let payload: JSONValue

    init(original: JSONValue, budget: JSONValue, overview: Overview) throws {
        guard case .object(let before) = original, case .object(let after) = budget,
              case .array(let oldEntries) = before["entries"], case .array(let entries) = after["entries"],
              entries.count > oldEntries.count, let entry = entries.last,
              case .object(let entryFields) = entry, case .string(let id) = entryFields["id"],
              let transaction = overview.transactions.first(where: { $0.id == id }) else {
            throw BudgetEngine.failure("Review the purchase before choosing people.")
        }
        func additions(_ key: String) -> [JSONValue] {
            guard case .array(let old) = before[key], case .array(let new) = after[key] else { return [] }
            return Array(new.dropFirst(old.count))
        }
        self.budget = budget; self.overview = overview; self.transaction = transaction
        var fields: [String:JSONValue] = ["entry": entry, "accounts": .array(additions("accounts")),
                                         "categories": .array(additions("categories")),
                                         "allocations": .array(Array(entries.dropFirst(oldEntries.count).dropLast()))]
        if case .array(let previous) = before["schedules"], case .array(let current) = after["schedules"] {
            let removed = previous.filter { old in
                guard case .object(let row) = old else { return false }
                return !current.contains { candidate in if case .object(let next) = candidate { return next["id"] == row["id"] && candidate == old }; return false }
            }
            if removed.count == 1 {
                fields["schedule"] = removed[0]
                if case .object(let row) = removed[0], let next = current.first(where: { candidate in if case .object(let item) = candidate { return item["id"] == row["id"] };return false }) {
                    fields["nextSchedule"] = next
                }
            }
        }
        payload = .object(fields)
    }
}
