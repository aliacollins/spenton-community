import Foundation

/// Uses the existing, pre-generated ElevenLabs recordings. No user text is sent for speech.
enum PipVoiceCatalog {
    static let completion = "v6-step-17"

    static func clip(for step: PipSetupDraft.Step, currency: String, replay: Bool) -> String {
        if step == .welcome { return "v5-hello" }
        // These old takes describe a different ending or a preview-only save.
        // The existing neutral prompt is safe for review and replay endings.
        if step == .review || (replay && (step == .digital || step == .afterPurchase)) {
            return "v6-step-19"
        }
        let number: Int
        switch step {
        case .welcome: return "v5-hello"
        case .currency: number = 1
        case .everyday: number = 2
        case .surprises: number = 3
        case .digital: number = 5
        case .purchase: number = 6
        case .afterPurchase: number = 7
        case .name: number = 8
        case .account: number = 9
        case .balance: number = 10
        case .categories: number = 11
        case .plan: number = 12
        case .review: return "v6-step-19"
        }
        if [2, 3, 5, 6, 7, 12].contains(number) {
            let spoken = ["CAD", "AUD"].contains(currency) ? "USD" : currency
            if ["USD", "INR", "EUR", "GBP"].contains(spoken) {
                return "v7-\(spoken.lowercased())-\(number)"
            }
        }
        return "v6-step-\(number)"
    }
}
