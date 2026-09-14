import Foundation

struct PipStarter: Decodable {
    let name: String
    let group: String
    let icon: String
    let color: String
    let selected: Bool
}

struct PipSetupCategory: Codable, Equatable, Identifiable {
    var id = UUID().uuidString.lowercased()
    var name: String
    var group: String
    var icon: String
    var color: String
    var parentId: String?
    var selected: Bool
    var amount = ""
}

struct PipSetupDraft: Codable, Equatable {
    enum Step: Int, Codable, CaseIterable {
        case welcome, currency, everyday, surprises, digital, purchase, afterPurchase, name, account, balance, categories, plan, review
        var isLesson: Bool { rawValue >= Step.everyday.rawValue && rawValue <= Step.afterPurchase.rawValue }
        var heading: String {
            switch self {
            case .welcome: "Oh, hello! I’m Pip."
            case .currency: "Which currency feels familiar?"
            case .everyday: "Give everyday needs a purpose."
            case .surprises: "Leave room for surprises."
            case .digital: "Your envelopes, now digital."
            case .purchase: "Try a grocery purchase."
            case .afterPurchase: "Check Left before you spend."
            case .name: "What shall we call your budget?"
            case .account: "Where is your money today?"
            case .balance: "Start with what you have."
            case .categories: "Choose what matters to you."
            case .plan: "Give your money a purpose."
            case .review: "Does this look right?"
            }
        }
    }
    let userID: String
    var mutationID = UUID().uuidString.lowercased()
    var accountID = UUID().uuidString.lowercased()
    var step = Step.welcome
    var currency: String
    var name = ""
    var accountName = ""
    var accountType = "checking"
    var balance = ""
    var categories: [PipSetupCategory]
    var skippedLesson = false
    var reviewed = false

    init(userID: String, currency: String, starters: [PipStarter]) {
        self.userID = userID
        self.currency = Self.currencies.contains(currency) ? currency : "USD"
        categories = starters.map { PipSetupCategory(name: $0.name, group: $0.group, icon: $0.icon, color: $0.color, selected: $0.selected) }
    }
    static let currencies = ["USD", "INR", "EUR", "GBP", "CAD", "AUD"]
    var selected: [PipSetupCategory] { categories.filter(\.selected) }
    func command(complete: Bool = false, placeholders: Bool = false) throws -> [String: String] {
        struct Plan: Encodable {
            let name: String; let currency: String; let accountName: String; let accountID: String
            let accountType: String; let balance: String; let categories: [PipSetupCategory]
        }
        let plan = Plan(name: placeholders && name.isEmpty ? "My budget" : name, currency: currency,
                        accountName: placeholders && accountName.isEmpty ? "Everyday account" : accountName,
                        accountID: accountID, accountType: accountType, balance: balance, categories: selected)
        return ["plan": String(decoding: try JSONEncoder().encode(plan), as: UTF8.self), "complete": String(complete)]
    }
    func money(_ cents: Int64) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: currency == "INR" ? "en_IN" : "en_US")
        formatter.currencyCode = currency
        return formatter.string(from: NSDecimalNumber(value: cents).dividing(by: 100)) ?? "\(currency) \(Decimal(cents) / 100)"
    }
    mutating func selectCategory(_ id: String) {
        guard let index = categories.firstIndex(where: { $0.id == id }) else { return }
        let selected = !categories[index].selected
        categories[index].selected = selected
        if selected, let parent = categories[index].parentId, let parentIndex = categories.firstIndex(where: { $0.id == parent }) { categories[parentIndex].selected = true }
        if !selected { for child in categories.indices where categories[child].parentId == id { categories[child].selected = false } }
        reviewed = false
    }
}
