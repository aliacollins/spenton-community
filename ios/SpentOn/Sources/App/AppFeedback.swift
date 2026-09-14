import SwiftUI

/// Optional SpentOn feedback; native controls retain their system behavior.
struct AppFeedback<Trigger: Equatable>: ViewModifier {
    @AppStorage("spenton-haptics-enabled") private var enabled = true
    let feedback: SensoryFeedback
    let trigger: Trigger
    func body(content: Content) -> some View {
        content.sensoryFeedback(feedback, trigger: trigger, condition: { _, _ in enabled })
    }
}
