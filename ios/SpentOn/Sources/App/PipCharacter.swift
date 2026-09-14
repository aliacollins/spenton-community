import SwiftUI

enum PipVectorLayer: Equatable, Sendable {
    case shadow, body, leftLeg, rightLeg, sprout, leftArm, rightArm
    case eyes, happyEyes, closedEyes, brows, smile, worriedMouth, mouth, heart
}
enum PipVectorFill: Sendable { case none, solid(Color), fabric }
struct PipVectorPart: Sendable {
    let layer: PipVectorLayer
    let followsBody: Bool
    let path: Path
    let fill: PipVectorFill
    let stroke: Color?
    let width: CGFloat
    let opacity: Double
    let dash: [CGFloat]
}

enum PipMoment: String { case welcome, thinking, celebrate, ready }
private struct PipPose {
    var lift = 0.0
    var lean = 0.0
    var wave = 0.0
    var foot = 0.0
    var blink = 1.0
    var gaze = 0.0
    var squash = 0.0
    var joy = 0.0
}
private struct PipMouth { var open = 0.0 }

struct PipCharacter: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var moment: PipMoment = .welcome
    var event = 0
    var word = 0
    var speaking = false
    var motionEnabled = true
    @State private var greeting = 0
    @AppStorage("pip-motion-paused") private var paused = false
    @AppStorage("spenton-haptics-enabled") private var hapticsEnabled = true
    @AppStorage("spenton-sounds-enabled") private var soundsEnabled = true
    private var still: Bool { !motionEnabled || reduceMotion || paused || scenePhase != .active }
    var body: some View {
        Button { greeting += 1 } label: {
            Group {
                if still { PipFigure(pose: PipPose(), mouth: 0) }
                else { animatedFigure }
            }.aspectRatio(1, contentMode: .fit).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Say hello to Pip")
        .accessibilityHint("Pip responds with a short greeting movement.")
        .accessibilityIdentifier("pip-character")
        .contextMenu {
            if reduceMotion { Label("Reduce Motion is on", systemImage: "accessibility") }
            else { Button(paused ? "Resume Pip’s movement" : "Pause Pip’s movement", systemImage: paused ? "play" : "pause") { paused.toggle() } }
            Toggle("App haptics", isOn: $hapticsEnabled)
            Toggle("App sounds", isOn: $soundsEnabled)
        }
        .task { greeting += 1 }
        .onChange(of: soundsEnabled) { _, enabled in if !enabled { CompletionPlayer.shared.stopSound() } }
    }
    private var animatedFigure: some View {
        KeyframeAnimator(initialValue: PipPose(), trigger: moment.rawValue + String(event) + "-" + String(greeting)) { pose in
            KeyframeAnimator(initialValue: PipMouth(), trigger: word) { mouth in
                PipFigure(pose: pose, mouth: speaking ? mouth.open : 0)
            } keyframes: { _ in
                KeyframeTrack(\.open) {
                    LinearKeyframe(0.9, duration: 0.07)
                    CubicKeyframe(0.2, duration: 0.1)
                    CubicKeyframe(0.65, duration: 0.08)
                    CubicKeyframe(0, duration: 0.12)
                }
            }
        } keyframes: { _ in
            KeyframeTrack(\.wave) {
                CubicKeyframe(moment == .welcome ? -110 : -18, duration: 0.28)
                CubicKeyframe(moment == .welcome ? -145 : -28, duration: 0.23)
                CubicKeyframe(moment == .welcome ? -108 : -12, duration: 0.23)
                CubicKeyframe(moment == .welcome ? -140 : -22, duration: 0.23)
                SpringKeyframe(0, duration: 0.45)
            }
            KeyframeTrack(\.lean) {
                CubicKeyframe(moment == .thinking ? -6 : -3, duration: 0.35)
                CubicKeyframe(moment == .thinking ? -3 : 2, duration: 0.45)
                SpringKeyframe(0, duration: 0.55)
            }
            KeyframeTrack(\.lift) {
                CubicKeyframe(0, duration: 0.22)
                SpringKeyframe(moment == .celebrate ? -9 : -2, duration: 0.35)
                SpringKeyframe(0, duration: 0.55)
            }
            KeyframeTrack(\.squash) {
                CubicKeyframe(1, duration: 0.22)
                SpringKeyframe(-0.5, duration: 0.35)
                SpringKeyframe(0, duration: 0.55)
            }
            KeyframeTrack(\.foot) {
                CubicKeyframe(moment == .celebrate ? 15 : 5, duration: 0.32)
                CubicKeyframe(moment == .celebrate ? -12 : -4, duration: 0.32)
                SpringKeyframe(0, duration: 0.48)
            }
            KeyframeTrack(\.blink) {
                LinearKeyframe(1, duration: 0.68)
                LinearKeyframe(0.08, duration: 0.08)
                LinearKeyframe(1, duration: 0.13)
            }
            KeyframeTrack(\.gaze) {
                CubicKeyframe(moment == .thinking ? 2 : -1, duration: 0.4)
                CubicKeyframe(0, duration: 0.7)
            }
            KeyframeTrack(\.joy) {
                CubicKeyframe(moment == .celebrate || moment == .ready ? 1 : 0, duration: 0.25)
                LinearKeyframe(moment == .celebrate || moment == .ready ? 1 : 0, duration: 0.6)
                CubicKeyframe(0, duration: 0.35)
            }
        }
    }
}

private struct PipFigure: View {
    let pose: PipPose
    let mouth: Double
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 150
            context.translateBy(x: size.width / 2, y: size.height / 2)
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -90, y: -99)
            for part in PipVectorArtwork.parts {
                if !visible(part.layer) { continue }
                var layer = context
                layer.opacity = part.opacity
                if part.layer != .shadow { layer.translateBy(x: 0, y: pose.lift) }
                if part.followsBody {
                    layer.translateBy(x: 90, y: 132)
                    layer.rotate(by: .degrees(pose.lean))
                    layer.scaleBy(x: 1 + pose.squash * 0.025, y: 1 - pose.squash * 0.035)
                    layer.translateBy(x: -90, y: -132)
                }
                switch part.layer {
                case .rightArm: rotate(&layer, around: CGPoint(x: 137, y: 99), degrees: pose.wave)
                case .leftArm: rotate(&layer, around: CGPoint(x: 43, y: 99), degrees: -pose.joy * 15)
                case .leftLeg: rotate(&layer, around: CGPoint(x: 72, y: 130), degrees: pose.foot)
                case .rightLeg: rotate(&layer, around: CGPoint(x: 108, y: 130), degrees: -pose.foot)
                case .sprout: rotate(&layer, around: CGPoint(x: 90, y: 61), degrees: pose.lean * -0.7)
                case .eyes:
                    layer.translateBy(x: 90 + pose.gaze, y: 96)
                    layer.scaleBy(x: 1, y: max(0.08, pose.blink))
                    layer.translateBy(x: -90, y: -96)
                case .happyEyes: layer.translateBy(x: pose.gaze, y: 0)
                case .mouth:
                    layer.translateBy(x: 90, y: 111)
                    layer.scaleBy(x: 0.75, y: max(0.1, mouth * 0.7))
                    layer.translateBy(x: -90, y: -111)
                default: break
                }
                switch part.fill {
                case .none: break
                case .solid(let color): layer.fill(part.path, with: .color(color))
                case .fabric:
                    layer.fill(part.path, with: .linearGradient(
                        Gradient(colors: [Color(.sRGB, red: 1, green: 233.0/255, blue: 209.0/255, opacity: 1), Color(.sRGB, red: 245.0/255, green: 201.0/255, blue: 169.0/255, opacity: 1)]),
                        startPoint: CGPoint(x: 90, y: 62), endPoint: CGPoint(x: 90, y: 137)))
                }
                if let stroke = part.stroke {
                    layer.stroke(part.path, with: .color(stroke), style: StrokeStyle(lineWidth: part.width, lineCap: .round, lineJoin: .round, dash: part.dash))
                }
            }
        }.accessibilityHidden(true)
    }
    private func visible(_ layer: PipVectorLayer) -> Bool {
        switch layer {
        case .eyes: pose.joy < 0.5
        case .happyEyes: pose.joy >= 0.5
        case .closedEyes, .brows, .worriedMouth, .heart: false
        case .smile: mouth < 0.15
        case .mouth: mouth >= 0.15
        default: true
        }
    }
    private func rotate(_ context: inout GraphicsContext, around point: CGPoint, degrees: Double) {
        context.translateBy(x: point.x, y: point.y)
        context.rotate(by: .degrees(degrees))
        context.translateBy(x: -point.x, y: -point.y)
    }
}
