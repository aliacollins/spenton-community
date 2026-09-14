import Foundation

struct ScanCapabilities: Decodable, Sendable {
    let available: Bool
    let model: String
    var images: Bool?
    var imageConsentVersion: Int?
    var canReadImages: Bool { available && images == true && imageConsentVersion == 2 }
}

struct ReceiptScanRequest {
    let id: String
    let budgetID: String
    let text: String
    let pages: [String]
    let retryOf: String?
    var body: JSONValue {
        var body: [String: JSONValue] = ["id": .string(id), "budgetId": .string(budgetID), "text": .string(text), "consent": .bool(true)]
        if !pages.isEmpty {
            body["pages"] = .array(pages.map(JSONValue.string))
            body["imageConsentVersion"] = .number(2)
        }
        if let retryOf { body["retryOf"] = .string(retryOf) }
        return .object(body)
    }
}
struct ScannedReceipt: Codable, Sendable {
    var merchant: String?; var date: String?; var currency: String?; var total: String?
    var totalLabel: String?; var payment: String; var dueDate: String?; var uncertain: [String]
}
struct ReceiptScan: Decodable, Sendable {
    let id: String; let state: String; let result: ScannedReceipt?; let errorCode: String?; let costKnown: Bool
}
enum ReceiptText {
    static let maximumBytes = 1200
    static func excerpt(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard text.utf8.count > maximumBytes else { return text }
        // Keep merchant context and the document's end. Total-like lines get
        // priority, but the user always sees and can edit the actual excerpt.
        let terms = ["total", "payable", "amount due", "balance due", "subtotal", "tax", "paid", "tender", "change", "currency", "invoice", "date", "due", "gesamt", "betrag", "totaal", "importe"]
        var priority = Array(lines.indices.prefix(4))
        for index in lines.indices.reversed() where terms.contains(where: { lines[index].localizedCaseInsensitiveContains($0) }) {
            priority += [index, max(0, index - 1), min(lines.count - 1, index + 1)]
        }
        priority += Array(lines.indices.reversed())
        var selected = Set<Int>(), used = 0
        for index in priority where !selected.contains(index) {
            let size = lines[index].utf8.count + 1
            if used + size <= maximumBytes { selected.insert(index); used += size }
        }
        return selected.sorted().map { lines[$0] }.joined(separator: "\n")
    }
    static func validDate(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
        return f.date(from: value).map { f.string(from: $0) == value } ?? false
    }
    static func possibleDuplicate(in budget: JSONValue, amount: Int64, date: String, merchant: String) -> Bool {
        guard case .object(let document) = budget, case .array(let entries) = document["entries"] else { return false }
        return entries.contains { value in
            guard case .object(let e) = value, e["kind"] == .string("expense"), e["amount"] == .number(amount) else { return false }
            if e["date"] == .string(date) { return true }
            guard !merchant.isEmpty, case .string(let payee) = e["payee"], payee.compare(merchant, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame,
                  case .string(let recorded) = e["date"], validDate(recorded), validDate(date) else { return false }
            let f = ISO8601DateFormatter()
            guard let a = f.date(from: recorded + "T12:00:00Z"), let b = f.date(from: date + "T12:00:00Z") else { return false }
            return abs(a.timeIntervalSince(b)) <= 3 * 86_400
        }
    }
}
