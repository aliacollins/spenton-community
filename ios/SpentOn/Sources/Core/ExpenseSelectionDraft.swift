import Foundation

struct ExpenseCategoryAmount: Codable, Equatable, Identifiable, Sendable {
    var categoryId: String
    var amount: String
    var id: String { categoryId }
}

struct ExpensePersonDraft: Codable, Equatable, Identifiable, Sendable {
    var id = UUID().uuidString.lowercased()
    var name: String
    var email = ""
    var memberId: String?
    var amount = ""
}

struct ExpensePeopleDraft: Codable, Equatable, Sendable {
    var people: [ExpensePersonDraft] = []
    var method = SharedSplitMethod.equal
    var groupId = ""
    var groupName = ""
    var groupRevision: Int?
    var includeReceipt = false

    @MainActor func shares(total: Int64, engine: BudgetEngine) throws -> [Int64] {
        guard people.count <= 20, Set(people.map(\.id)).count == people.count else {
            throw BudgetEngine.failure("Choose each person once, with up to 20 people.")
        }
        let emails=people.map{$0.email.lowercased()}.filter{!$0.isEmpty}
        guard Set(emails).count == emails.count else { throw BudgetEngine.failure("Choose each person once.") }
        guard people.allSatisfy({ person in
            let name=person.name.trimmingCharacters(in:.whitespacesAndNewlines)
            return !name.isEmpty && name.count<=100 && name.range(of:#"[<>\u0000-\u001f\u007f]"#,options:.regularExpression)==nil &&
                (person.email.isEmpty || (person.email.count<=254 && person.email.range(of:#"^\S+@[^\s@]+\.[^\s@]+$"#,options:.regularExpression) != nil))
        }) else { throw BudgetEngine.failure("Enter a name and optional valid email for each person.") }
        if people.isEmpty { return [] }
        guard total > 0 else { throw BudgetEngine.failure("Enter the purchase total first.") }
        if method == .equal {
            let count = Int64(people.count + 1)
            guard total >= count else { throw BudgetEngine.failure("The total is too small to give everyone a share.") }
            let base = total / count, remainder = total % count
            return people.indices.map { base + (Int64($0 + 1) < remainder ? 1 : 0) }
        }
        guard method == .amount else { throw BudgetEngine.failure("Choose equal or exact amounts.") }
        var remaining = total
        return try people.map { person in
            let value: Int64 = try engine.run("parseAmount", command: ["amount":person.amount])
            guard value > 0, value <= remaining else { throw BudgetEngine.failure("Each share must be positive and fit within the total.") }
            remaining -= value
            return value
        }
    }

    @MainActor func request(total: Int64, engine: BudgetEngine) throws -> [JSONValue] {
        let values = try shares(total: total, engine: engine)
        return zip(people, values).map { person, value in
            var fields: [String:JSONValue] = ["name":.string(person.name),"email":.string(person.email),"personKey":.string(person.id),"amount":.number(value)]
            if !groupId.isEmpty, let member = person.memberId { fields["memberId"] = .string(member) }
            return .object(fields)
        }
    }
}

struct PrivatePerson: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let email: String
}
struct PeopleDirectory: Decodable, Sendable { let version: Int; let people: [PrivatePerson] }
struct PersonResponse: Decodable, Sendable { let person: PrivatePerson }
struct PlannedShare: Codable, Equatable, Sendable {
    let scheduleId: String
    var plan: ExpensePeopleDraft
}
