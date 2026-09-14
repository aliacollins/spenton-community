import SwiftUI

private struct PipMoneyAnchors: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) { value.merge(nextValue(), uniquingKeysWith: { _, new in new }) }
}
private struct PipMoneyFlight: Identifiable {
    let id = UUID()
    let amount: Int64
    let from: String
    let to: String
}

struct PipMoneyLesson: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    let step: PipSetupDraft.Step
    let money: (Int64) -> String
    let advance: (PipSetupDraft.Step) -> Void
    @State private var flights: [PipMoneyFlight] = []
    private var digital: Bool { step.rawValue >= PipSetupDraft.Step.digital.rawValue }
    private var bought: Bool { step == .afterPurchase }
    private var available: Int64 { step == .everyday ? 100_000 : step == .surprises ? 30_000 : 0 }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(spacing: 12) {
                LabeledContent("Example cash") { Text(money(bought ? 90_000 : 100_000)).monospacedDigit().contentTransition(.numericText()) }
                Divider()
                HStack(alignment: .firstTextBaseline) {
                    Text("Available to plan").font(.subheadline).foregroundStyle(Brand.secondary)
                    Spacer(minLength: 12)
                    Text(money(available)).font(.title3.weight(.semibold)).monospacedDigit().contentTransition(.numericText())
                        .anchorPreference(key: PipMoneyAnchors.self, value: .bounds) { ["cash": $0] }
                }
            }.padding(18).background(Brand.surface, in: .rect(cornerRadius: 22))

            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 18)) : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
            layout {
                category(name: "Everyday needs", key: "everyday", symbol: "basket", planned: step == .everyday ? 0 : 70_000, spent: bought ? 10_000 : 0,
                         active: step == .everyday || step == .purchase) { advance(step == .purchase ? .afterPurchase : .surprises) }
                category(name: "Surprises", key: "surprises", symbol: "sparkles", planned: digital ? 30_000 : 0, spent: 0,
                         active: step == .surprises) { advance(.digital) }
            }
            if step == .purchase || bought {
                HStack(spacing: 12) {
                    Image(systemName: bought ? "checkmark.circle.fill" : "receipt").foregroundStyle(Brand.sage).contentTransition(.symbolEffect(.replace))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(bought ? "Example purchase recorded" : "Example purchase").font(.subheadline.weight(.medium))
                        Text("Groceries · " + money(10_000)).font(.subheadline).foregroundStyle(Brand.secondary)
                    }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Brand.sage.opacity(0.1), in: .rect(cornerRadius: 18))
                    .anchorPreference(key: PipMoneyAnchors.self, value: .bounds) { ["purchase": $0] }
            }
            Text(bought ? "Cash and Everyday needs both fell by \(money(10_000))." : available == 0 ? "Every unit has a purpose. Your cash has not moved." : "Your money stays in the account while you plan.")
                .font(.subheadline).foregroundStyle(Brand.secondary)
        }
        .overlayPreferenceValue(PipMoneyAnchors.self) { anchors in
            GeometryReader { geometry in
                ForEach(flights) { flight in
                    if let start = anchors[flight.from], let end = anchors[flight.to] {
                        PipFlyingAmount(text: money(flight.amount), start: center(geometry[start]), end: center(geometry[end]))
                            .task {
                                try? await Task.sleep(for: .milliseconds(800))
                                flights.removeAll { $0.id == flight.id }
                            }
                    }
                }
            }.allowsHitTesting(false).accessibilityHidden(true)
        }
        .onChange(of: step) { old, new in
            guard !reduceMotion, !typeSize.isAccessibilitySize else { flights = []; return }
            if old == .everyday && new == .surprises { flights.append(PipMoneyFlight(amount: 70_000, from: "cash", to: "everyday")) }
            else if old == .surprises && new == .digital { flights.append(PipMoneyFlight(amount: 30_000, from: "cash", to: "surprises")) }
            else if old == .purchase && new == .afterPurchase { flights.append(PipMoneyFlight(amount: 10_000, from: "everyday", to: "purchase")) }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: step)
        .modifier(AppFeedback(feedback: .selection, trigger: step))
    }
    @ViewBuilder private func category(name: String, key: String, symbol: String, planned: Int64, spent: Int64, active: Bool, action: @escaping () -> Void) -> some View {
        if active {
            Button(action: action) { card(name: name, symbol: symbol, planned: planned, spent: spent, active: true) }
                .buttonStyle(PipEnvelopePressStyle())
                .accessibilityIdentifier(step == .purchase ? "pip-example-" + name : "pip-envelope-" + name)
                .anchorPreference(key: PipMoneyAnchors.self, value: .bounds) { [key: $0] }
        } else {
            card(name: name, symbol: symbol, planned: planned, spent: spent, active: false)
                .accessibilityElement(children: .combine)
                .anchorPreference(key: PipMoneyAnchors.self, value: .bounds) { [key: $0] }
        }
    }
    private func card(name: String, symbol: String, planned: Int64, spent: Int64, active: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack {
                PipEnvelopeFold(open: planned > 0 ? 1 : 0).stroke(Brand.sage.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                Image(systemName: planned > 0 ? "checkmark.circle.fill" : symbol)
                    .font(.title2).foregroundStyle(Brand.sage).offset(y: planned > 0 ? -5 : 12)
                    .contentTransition(.symbolEffect(.replace))
            }.frame(height: digital ? 26 : 56)
                .opacity(digital ? 0 : 1)
                .overlay(alignment: .leading) { if digital { Image(systemName: symbol).font(.title2).foregroundStyle(Brand.sage) } }
            Text(name).font(.headline).fixedSize(horizontal: false, vertical: true)
            if digital {
                Text("Left").font(.caption).foregroundStyle(Brand.secondary)
                Text(money(planned - spent)).font(.title2.weight(.semibold)).monospacedDigit().contentTransition(.numericText())
                VStack(alignment: .leading, spacing: 4) {
                    Text("Set aside " + money(planned))
                    Text("Spent " + money(spent))
                }.font(.caption).foregroundStyle(Brand.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(planned > 0 ? money(planned) : "Not planned yet").font(.subheadline).monospacedDigit().contentTransition(.numericText())
                if active {
                    Label("Set aside " + money(keyAmount(name)), systemImage: "arrow.down")
                        .font(.subheadline.weight(.medium)).foregroundStyle(Brand.sage).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
        .background(Brand.surface, in: .rect(cornerRadius: digital ? 22 : 14))
        .overlay { RoundedRectangle(cornerRadius: digital ? 22 : 14).stroke(active ? Brand.sage.opacity(0.6) : Brand.sage.opacity(0.15), lineWidth: active ? 1.5 : 1) }
        .foregroundStyle(Brand.ink)
    }
    private func keyAmount(_ name: String) -> Int64 { name == "Everyday needs" ? 70_000 : 30_000 }
    private func center(_ rect: CGRect) -> CGPoint { CGPoint(x: rect.midX, y: rect.midY) }
}

private struct PipEnvelopeFold: Shape {
    var open: CGFloat
    var animatableData: CGFloat { get { open } set { open = newValue } }
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: 8))
        path.addQuadCurve(to: CGPoint(x: rect.width / 2, y: 50 - open * 45), control: CGPoint(x: rect.width / 4, y: 28 - open * 28))
        path.addQuadCurve(to: CGPoint(x: rect.width, y: 8), control: CGPoint(x: rect.width * 0.75, y: 28 - open * 28))
        return path
    }
}
private struct PipEnvelopePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .smooth(duration: 0.14), value: configuration.isPressed)
    }
}
private struct PipFlyingAmount: View {
    let text: String
    let start: CGPoint
    let end: CGPoint
    @State private var progress = 0.0
    var body: some View {
        Text(text).font(.subheadline.weight(.semibold)).monospacedDigit()
            .padding(.horizontal, 16).padding(.vertical, 9).foregroundStyle(Brand.ink)
            .background(Brand.surface, in: .rect(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(Brand.sage.opacity(0.35), lineWidth: 1) }
            .keyframeAnimator(initialValue: 0.0, trigger: progress) { content, value in
                content.scaleEffect(1 - value * 0.2)
                    .opacity(value > 0.8 ? (1 - value) * 5 : 1)
                    .rotationEffect(.degrees(sin(value * .pi) * -7))
                    .position(x: start.x + (end.x - start.x) * value, y: start.y + (end.y - start.y) * value - sin(value * .pi) * 32)
            } keyframes: { _ in CubicKeyframe(1, duration: 0.65) }
            .task { progress = 1 }
    }
}
