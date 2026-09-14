import Foundation

struct QuickEntry {
    var amount = ""
    var payee = ""
    var categoryID = ""
    var accountID = ""
    var matchedHistory = false
    var problem: String?
    var userEntered = false
    var additions: [StructureDraft] = []
    var date: String?
    var receiptID: String?
    var upcoming = false
    var scheduleID = ""
    var scheduleDate = ""
    var categorySplits: [ExpenseCategoryAmount] = []
    var people = ExpensePeopleDraft()
    var note = ""

    static func parse(_ text: String, data: Overview, categoryID: String = "", accountID: String = "") -> QuickEntry {
        var entry = QuickEntry(categoryID: categoryID, accountID: accountID, userEntered: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let expression = try? NSRegularExpression(pattern: #"^\s*([$€£₹]|USD\s*|INR\s*|EUR\s*|GBP\s*|CAD\s*|AUD\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s+(.+))?\s*$"#, options: .caseInsensitive)
        let input = text as NSString
        guard let match = expression?.firstMatch(in: text, range: NSRange(location: 0, length: input.length)) else {
            if text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: #"^(?:[$€£₹]|[A-Z]{3}\s*)?[0-9][0-9,]*\.[0-9]{3}"#, options: .regularExpression) != nil { entry.problem = "Use up to two decimal places for the amount." }
            return entry
        }
        if match.range(at: 1).location != NSNotFound {
            let prefix = input.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespaces).uppercased()
            let allowed: [String: [String]] = ["$": ["USD", "CAD", "AUD"], "€": ["EUR"], "£": ["GBP"], "₹": ["INR"]]
            if !(allowed[prefix] ?? [prefix]).contains(data.currency) { entry.problem = "Use \(data.currency) for this budget."; return entry }
        }
        entry.amount = input.substring(with: match.range(at: 2))
        if match.range(at: 3).location != NSNotFound { entry.payee = input.substring(with: match.range(at: 3)).trimmingCharacters(in: .whitespacesAndNewlines) }
        if entry.payee.lowercased().hasPrefix("at ") { entry.payee = String(entry.payee.dropFirst(3)) }
        let named = data.categories.filter { $0.name.compare(entry.payee, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
        if named.count == 1 && entry.categoryID.isEmpty { entry.categoryID = named[0].id; entry.payee = "" }
        if !entry.payee.isEmpty {
            let prior = data.transactions.filter { $0.kind == "expense" && $0.payee.compare(entry.payee, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
            let categories = Set(prior.compactMap(\.categoryId))
            if entry.categoryID.isEmpty, categories.count == 1, let id = categories.first, data.categories.contains(where: { $0.id == id }) { entry.categoryID = id; entry.matchedHistory = true }
            if entry.accountID.isEmpty, let id = prior.first?.accountId, data.accounts.contains(where: { $0.id == id && $0.type != "investment" }) { entry.accountID = id; entry.matchedHistory = true }
        }
        return entry
    }
}
