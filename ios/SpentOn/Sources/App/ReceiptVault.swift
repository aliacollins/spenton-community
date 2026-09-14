import Foundation
import CryptoKit

/// New scans stay in memory until their receipt ID belongs to a server-confirmed
/// record. Confirmed local copies retain the existing 30-day lifetime.
@MainActor enum ReceiptVault {
    static var server = "https://spenton.dev"
    private static var temporary: [String: ReceiptAttachment] = [:]
    private static func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func key(user: String, id: String) -> String { hash(server + "\0" + user) + ":" + id }
    private static func root() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    }
    private static func directory(user: String) throws -> URL {
        var directory = try root().appendingPathComponent("SavedBills/" + hash(server + "\0" + user))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            if let date = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, date < Date.now.addingTimeInterval(-30 * 86400) { try? FileManager.default.removeItem(at: file) }
        }
        return directory
    }
    static func save(_ bill: ReceiptAttachment, id: String, user: String) throws {
        guard UUID(uuidString: id) != nil else { throw BudgetEngine.failure("The scanned bill could not be identified.") }
        guard temporary.count < 20 || temporary[key(user: user, id: id)] != nil else {
            throw BudgetEngine.failure("Close the current purchase before scanning another bill.")
        }
        temporary[key(user: user, id: id)] = bill
    }
    static func read(id: String?, user: String?) -> ReceiptAttachment? {
        guard let id, UUID(uuidString: id) != nil, let user else { return nil }
        if let value = temporary[key(user: user, id: id)] { return value }
        guard let directory = try? directory(user: user), let data = try? Data(contentsOf: directory.appendingPathComponent(id + ".json")) else { return nil }
        return try? JSONDecoder().decode(ReceiptAttachment.self, from: data)
    }
    private static func references(_ value: JSONValue) -> Set<String> {
        switch value {
        case .object(let fields):
            var result = fields.values.reduce(into: Set<String>()) { $0.formUnion(references($1)) }
            if case .string(let id) = fields["receiptId"], UUID(uuidString: id) != nil { result.insert(id) }
            return result
        case .array(let values): return values.reduce(into: Set<String>()) { $0.formUnion(references($1)) }
        default: return []
        }
    }
    static func commit(_ budget: JSONValue, user: String) throws {
        for id in references(budget) {
            guard let bill = temporary[key(user: user, id: id)] else { continue }
            let file = try directory(user: user).appendingPathComponent(id + ".json")
            try JSONEncoder().encode(bill).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            temporary.removeValue(forKey: key(user: user, id: id))
        }
    }
    static func clearTemporary() { temporary.removeAll() }
    static func hasLegacy(user: String) -> Bool {
        guard server == "https://spenton.dev", let root = try? root() else { return false }
        return FileManager.default.fileExists(atPath: root.appendingPathComponent("BillDrafts/" + hash(user)).path)
    }
    /// Run only after all of this account's budgets have been fetched. Never
    /// delete an old bill copy merely because a server read failed.
    static func migrateLegacy(user: String, budgets: [JSONValue]) throws {
        guard hasLegacy(user: user) else { return }
        let old = try root().appendingPathComponent("BillDrafts/" + hash(user))
        let used = budgets.reduce(into: Set<String>()) { $0.formUnion(references($1)) }
        for file in try FileManager.default.contentsOfDirectory(at: old, includingPropertiesForKeys: [.contentModificationDateKey]) where file.pathExtension == "json" {
            let originalDate = try file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            if used.contains(file.deletingPathExtension().lastPathComponent), let originalDate, originalDate >= Date.now.addingTimeInterval(-30 * 86400) {
                let target = try directory(user: user).appendingPathComponent(file.lastPathComponent)
                if !FileManager.default.fileExists(atPath: target.path) {
                    try Data(contentsOf: file).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: target.path)
                }
            }
            try FileManager.default.removeItem(at: file)
        }
        try FileManager.default.removeItem(at: old)
    }
}
