import SwiftUI
import UIKit

struct CompletionArtwork: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let event: SaveFeedback?
    var word = 0
    var speaking = false
    @State private var started = Date.now
    @State private var playing = false
    @State private var characterMotion: Bool

    init(event: SaveFeedback?, word: Int = 0, speaking: Bool = false) {
        self.event = event; self.word = word; self.speaking = speaking
        _characterMotion = State(initialValue: event?.isRecent() == true)
    }

    var body: some View {
        ZStack {
            Circle().fill(Brand.sage.opacity(0.08)).frame(width: 180, height: 180)
            if !reduceMotion {
                TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !playing)) { timeline in
                    Canvas { context, size in
                        let elapsed: Double = timeline.date.timeIntervalSince(started)
                        let progress: Double = min(1.0, max(0.0, elapsed / 1.15))
                        guard playing, progress < 1 else { return }
                        let center = CGPoint(x: size.width / 2, y: size.height / 2)
                        let colors: [Color] = [Brand.sage, Brand.butter, Brand.peach, Brand.lavender]
                        for index in 0..<24 {
                            let angle: Double = Double(index) * Double.pi * 2.0 / 24.0
                            let travel: Double = 78.0 + Double(index % 4) * 5.0
                            let distance: Double = 24.0 + travel * progress
                            let x: CGFloat = center.x + CGFloat(cos(angle) * distance)
                            let vertical: Double = sin(angle) * distance
                            let gravity: Double = 16.0 * progress * progress
                            let y: CGFloat = center.y + CGFloat(vertical) + CGFloat(gravity)
                            let height: CGFloat = index.isMultiple(of: 3) ? 6 : 3
                            let rect = CGRect(x: x - 3, y: y - 2, width: 6, height: height)
                            context.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(colors[index % colors.count].opacity((1 - progress) * 0.85)))
                        }
                    }
                }.accessibilityHidden(true).allowsHitTesting(false)
            }
            PipCharacter(moment: .celebrate, event: 1, word: word, speaking: speaking, motionEnabled: characterMotion)
                .frame(width: 190, height: 190)
            Image(systemName: "checkmark.seal.fill").font(.system(size: 34))
                .foregroundStyle(Brand.sage).padding(7).background(Brand.surface, in: .circle)
                .offset(x: 74, y: 60).accessibilityHidden(true)
        }
        .clipped()
        .task {
            guard event?.isRecent() == true, !reduceMotion, scenePhase == .active else { characterMotion = false; return }
            started = .now; playing = true
            try? await Task.sleep(for: .milliseconds(1200))
            playing = false
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { playing = false; characterMotion = false } }
    }
}

struct BudgetCompletionView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let data: Overview
    let event: SaveFeedback?
    var planned = false
    var titleID = "budget-created"
    var word = 0
    var speaking = false
    var sound = true
    @AccessibilityFocusState private var titleFocused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                CompletionArtwork(event: event, word: word, speaking: speaking)
                    .frame(width: typeSize.isAccessibilitySize ? 210 : 260, height: typeSize.isAccessibilitySize ? 200 : 240)
                Text(planned ? "Your money has a plan." : "Your budget is ready.")
                    .font(.system(.largeTitle, design: .rounded, weight: .semibold)).multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader).accessibilityFocused($titleFocused).accessibilityIdentifier(titleID)
                Text(planned ? "Your accounts, categories and plan are saved." : "Your accounts and categories are saved. You can start planning your money.")
                    .font(.body).foregroundStyle(Brand.secondary).multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 18) {
                    Text(data.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                    MoneyStat(title: "In cash accounts", value: data.money(data.cash), symbol: "wallet.bifold")
                    MoneyStat(title: "Available to plan", value: data.money(data.ready), symbol: "tray.full")
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Brand.surface, in: .rect(cornerRadius: 24))
            }.padding(24).frame(maxWidth: 620).frame(maxWidth: .infinity)
        }
        .task {
            CompletionPlayer.shared.play(event, sound: sound)
            if UIAccessibility.isVoiceOverRunning { titleFocused = true }
        }
    }
}

struct CompletionPreview: View {
    @Environment(\.dismiss) private var dismiss
    @State private var event: SaveFeedback
    init(event: SaveFeedback) { _event = State(initialValue: event) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    CompletionArtwork(event: event).frame(width: 260, height: 240).id(event.id)
                    Text("Completion feedback").font(.title2.bold())
                    Text("A preview of the animation, sound and haptic used when a budget is created. Sounds follow Silent Mode and your App sounds choice.")
                        .font(.body).foregroundStyle(Brand.secondary).multilineTextAlignment(.center)
                    Button("Play again", systemImage: "arrow.clockwise") { event = SaveFeedback(id: UUID().uuidString, kind: .budgetCreated) }
                        .primaryAction()
                    Text("This preview does not change your budget.").font(.caption).foregroundStyle(Brand.secondary)
                }.padding(24).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.background(Brand.canvas).navigationTitle("Feedback preview").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .task(id: event.id) { CompletionPlayer.shared.play(event) }
        }
    }
}

struct SaveConfirmationMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    var body: some View {
        Image(systemName: "checkmark.circle.fill")
            .symbolEffect(.bounce, value: appeared).symbolEffectsRemoved(reduceMotion)
            .accessibilityHidden(true)
            .task { appeared = true }
    }
}
