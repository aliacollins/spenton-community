import Foundation

struct EditorDraft: Codable, Equatable {
    let userID: String
    let budgetID: String
    let key: String
    let revision: Int
    let fields: [String: String]

    func belongs(to user: String, budget: String, editor: String) -> Bool {
        userID == user && budgetID == budget && key == editor
    }
}

enum DraftFields {
    static func encode<T: Encodable>(_ value: T) -> String {
        (try? String(data: JSONEncoder().encode(value), encoding: .utf8)) ?? ""
    }
    static func decode<T: Decodable>(_ type: T.Type, _ value: String?) -> T? {
        value.flatMap { try? JSONDecoder().decode(type, from: Data($0.utf8)) }
    }
}
