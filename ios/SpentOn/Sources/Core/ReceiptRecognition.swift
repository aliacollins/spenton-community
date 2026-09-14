import Foundation

enum ReceiptRecognition {
    // Conservative, offline extraction. Conflicting totals and ambiguous dates
    // stay editable and unresolved; tendered cash is never a purchase total.
    static func recognize(_ text: String, budgetCurrency: String) -> ScannedReceipt {
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var candidates: [(value: String, label: String, priority: Int)] = []
        for (index, line) in lines.enumerated() {
            let lower = line.lowercased()
            guard !matches(#"sub\s*total|tax|change|tender|cash|saving|discount|tip\s*(?:suggest|guide)|total\s*(?:items|quantity)"#, lower) else { continue }
            let priority = matches(#"grand\s*total|final\s*total|net\s*(?:total|payable)|total\s*payable|amount\s*payable"#, lower) ? 3 : matches(#"\btotal\b|gesamtbetrag|montant total|importe total"#, lower) ? 2 : matches(#"amount\s*due|balance\s*due"#, lower) ? 1 : 0
            guard priority > 0 else { continue }
            var value = money(in: line)
            if value == nil, index + 1 < lines.count, matches(#"^(?:[A-Z]{3}|[$€£₹])?\s*\d[\d., ]*(?:\s*[A-Z]{3})?$"#, lines[index + 1]) { value = money(in: lines[index + 1]) }
            if let value { candidates.append((value, line, priority)) }
        }
        let strongest = candidates.filter { $0.priority == candidates.map(\.priority).max() }
        let chosen = Set(strongest.map(\.value)).count == 1 ? strongest.first : nil
        var currencies = Set(["USD", "INR", "EUR", "GBP", "CAD", "AUD"].filter { matches("\\b" + $0 + "\\b", text.uppercased()) })
        for (symbol, code) in [("₹", "INR"), ("€", "EUR"), ("£", "GBP")] where text.contains(symbol) { currencies.insert(code) }
        let currency = currencies.count == 1 ? currencies.first : (currencies.isEmpty ? budgetCurrency : nil)
        var dates = Set<String>()
        if let expression = try? NSRegularExpression(pattern: #"\b\d{4}-\d{2}-\d{2}\b"#) {
            for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                if let range = Range(match.range, in: text), ReceiptText.validDate(String(text[range])) { dates.insert(String(text[range])) }
            }
        }
        var uncertain = ["merchant"]
        if chosen == nil { uncertain.append("total") }
        if currencies.count != 1 { uncertain.append("currency") }
        if dates.count != 1 { uncertain.append("date") }
        return ScannedReceipt(merchant: lines.first.map { String($0.prefix(160)) }, date: dates.count == 1 ? dates.first : nil, currency: currency, total: chosen?.value, totalLabel: chosen?.label, payment: "unknown", uncertain: uncertain)
    }
    private static func matches(_ pattern: String, _ value: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
    private static func money(in line: String) -> String? {
        guard let expression = try? NSRegularExpression(pattern: #"(?<![\d./-])\d+(?:[ ,.]\d{3})*(?:[.,]\d{1,2})?(?![\d./-])"#) else { return nil }
        let matches = expression.matches(in: line, range: NSRange(line.startIndex..., in: line))
        guard matches.count == 1, let range = Range(matches[0].range, in: line) else { return nil }
        var value = String(line[range]).replacingOccurrences(of: " ", with: "")
        if let last = value.lastIndex(where: { $0 == "," || $0 == "." }), value.distance(from: last, to: value.endIndex) <= 3 {
            value = value[..<last].filter(\.isNumber) + "." + value[value.index(after: last)...]
        } else { value = value.filter(\.isNumber) }
        guard let decimal = Decimal(string: value), decimal > 0, decimal <= 10_000_000_000 else { return nil }
        let parts = NSDecimalNumber(decimal: decimal).stringValue.components(separatedBy: ".")
        return parts[0] + "." + (parts.count > 1 ? parts[1].padding(toLength: 2, withPad: "0", startingAt: 0) : "00")
    }
}

struct ReceiptAttachment: Codable, Sendable {
    var text: String
    var pages: [String]
    var json: JSONValue { .object(["text": .string(text), "pages": .array(pages.map(JSONValue.string))]) }
}
