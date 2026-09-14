import Foundation

enum ReceiptAIChoice: String {
    case notAsked, allowed, declined
    static func read(userID: String, defaults: UserDefaults = .standard) -> Self {
        if let value = defaults.string(forKey: "receipt-ai-image-consent-v2." + userID), let choice = Self(rawValue: value) { return choice }
        // A previous refusal remains a refusal. Text-only approval never
        // authorizes sending images to either provider.
        return defaults.string(forKey: "receipt-ai-consent-v1." + userID) == Self.declined.rawValue ? .declined : .notAsked
    }
    func save(userID: String, defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: "receipt-ai-image-consent-v2." + userID)
    }
}
