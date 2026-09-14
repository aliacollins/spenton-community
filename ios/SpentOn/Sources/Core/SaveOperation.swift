import Foundation

/// The disk record for an already-submitted save contains identity only.
/// The editable budget, form fields, receipt image and request body stay in memory.
struct SaveOperation: Codable, Equatable, Identifiable, Sendable {
    let server: String
    let userID: String
    let scope: String
    let operationID: String
    let budgetID: String?
    let protocolVersion: Int
    var id: String { scope + ":" + operationID }

    init(server: String, userID: String, scope: String, operationID: String, budgetID: String? = nil, protocolVersion: Int = 1) {
        self.server = server; self.userID = userID; self.scope = scope
        self.operationID = operationID; self.budgetID = budgetID; self.protocolVersion = protocolVersion
    }
    func belongs(server: String, userID: String) -> Bool { self.server == server && self.userID == userID }
    var body: JSONValue {
        var fields: [String: JSONValue] = ["scope": .string(scope), "operationId": .string(operationID), "protocolVersion": .number(Int64(protocolVersion))]
        if let budgetID { fields["budgetId"] = .string(budgetID) }
        return .object(fields)
    }
}

struct SaveOutcome: Decodable, Sendable {
    let version: Int
    let state: String
    let budgetId: String?
    let revision: Int?
    var isValid: Bool { version == 1 && ["saved", "not_saved", "unknown"].contains(state) }
}

struct ServerInfo: Decodable, Sendable {
    struct Capabilities: Decodable, Sendable {
        let operationStatus: Int
        let cloudSubscriptionRequired: Bool
        let sharing: String
    }
    let service: String
    let version: Int
    let instanceId: String
    let deployment: String
    let appVersion: String
    let capabilities: Capabilities
    var isCompatible: Bool {
        service == "spenton" && version == 1 && UUID(uuidString: instanceId) != nil &&
        ["cloud", "self-hosted"].contains(deployment) && capabilities.operationStatus == 1
    }
}
