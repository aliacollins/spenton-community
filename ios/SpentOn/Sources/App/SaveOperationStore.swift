import Foundation
import CryptoKit

struct SaveOperationStore {
    private func folder() throws -> URL {
        var directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("SaveOperations", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }
    private func file(server: String, userID: String) throws -> URL {
        let key = SHA256.hash(data: Data((server + "\0" + userID).utf8)).map { String(format: "%02x", $0) }.joined()
        return try folder().appendingPathComponent(key + ".json")
    }
    func read(server: String, userID: String) throws -> [SaveOperation] {
        let url = try file(server: server, userID: userID)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let values = try JSONDecoder().decode([SaveOperation].self, from: Data(contentsOf: url))
        guard values.count <= 100, values.allSatisfy({ $0.belongs(server: server, userID: userID) }) else {
            throw BudgetEngine.failure("An unfinished save belongs to another connection. Check the original server.")
        }
        return values
    }
    func save(_ operation: SaveOperation) throws {
        var values = try read(server: operation.server, userID: operation.userID)
        if values.contains(operation) { return }
        guard !values.contains(where: { $0.id == operation.id }), values.count < 100 else {
            throw BudgetEngine.failure("Check the unfinished saves before making another change.")
        }
        values.append(operation)
        try JSONEncoder().encode(values).write(to: file(server: operation.server, userID: operation.userID), options: [.atomic, .completeFileProtection])
    }
    func remove(_ operation: SaveOperation) throws {
        let url = try file(server: operation.server, userID: operation.userID)
        let values = try read(server: operation.server, userID: operation.userID).filter { $0.id != operation.id }
        if values.isEmpty {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        } else { try JSONEncoder().encode(values).write(to: url, options: [.atomic, .completeFileProtection]) }
    }
    /// Old production clients used Cloud only. Copy operation identity durably
    /// before removing the old payload; a crash can safely repeat this migration.
    func removeLegacyDrafts() throws {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = root.appendingPathComponent("PendingChanges", isDirectory: true)
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "json" {
            let data = try Data(contentsOf: file)
            if let pending = try? JSONDecoder().decode(PendingMutation.self, from: data) {
                try save(SaveOperation(server: "https://spenton.dev", userID: pending.userID,
                    scope: pending.budgetID == nil ? "budget-create" : "budget-update", operationID: pending.mutationID,
                    budgetID: pending.budgetID, protocolVersion: 0))
            } else if let shared = try? JSONDecoder().decode(PendingSharedRequest.self, from: data),
                      case .object(let fields) = shared.body, case .string(let id) = fields["operationId"] {
                try save(SaveOperation(server: "https://spenton.dev", userID: shared.userID, scope: "shared", operationID: id, protocolVersion: 0))
            }
            try FileManager.default.removeItem(at: file)
        }
    }
}
