import Foundation

struct CategoryDirectory {
    let categories: [BudgetCategory]
    private let byID: [String: BudgetCategory]

    init(_ categories: [BudgetCategory]) {
        self.categories = categories
        byID = Dictionary(categories.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    func context(for category: BudgetCategory) -> String {
        if let parentID = category.parentId, let parent = byID[parentID] {
            return "\(category.group) · \(parent.name)"
        }
        return category.group
    }

    func matching(_ query: String) -> [BudgetCategory] {
        let terms = normalized(query).split(whereSeparator: \.isWhitespace)
        return categories.filter { category in
            let label = normalized(category.name + " " + context(for: category))
            return terms.allSatisfy { label.contains($0) }
        }.sorted {
            let left = context(for: $0) + " " + $0.name
            let right = context(for: $1) + " " + $1.name
            if left == right { return $0.id < $1.id }
            return left.localizedStandardCompare(right) == .orderedAscending
        }
    }

    func recent(in transactions: [Transaction], limit: Int = 4) -> [BudgetCategory] {
        var seen = Set<String>()
        return Array(transactions.compactMap { transaction -> BudgetCategory? in
            guard transaction.kind == "expense", let id = transaction.categoryId,
                  let category = byID[id], seen.insert(id).inserted else { return nil }
            return category
        }.prefix(max(0, limit)))
    }

    private func normalized(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    }
}
