import AVFoundation
import UIKit

/// Only confirmed saves or an explicit preview call this player.
@MainActor final class CompletionPlayer: NSObject, AVAudioPlayerDelegate {
    static let shared = CompletionPlayer()
    private var played: [String] = []
    private var player: AVAudioPlayer?
    private var ownsAudioSession = false
    private var inactiveObserver: NSObjectProtocol?

    override init() {
        super.init()
        inactiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stopSound() }
        }
    }
    func play(_ feedback: SaveFeedback?, sound: Bool = true) {
        guard let feedback, !played.contains(feedback.id) else { return }
        played.append(feedback.id)
        if played.count > 32 { played.removeFirst() }
        guard feedback.isRecent(), UIApplication.shared.applicationState == .active else { return }
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "spenton-haptics-enabled") as? Bool ?? true {
            if feedback.kind.usesSuccessFeedback { UINotificationFeedbackGenerator().notificationOccurred(.success) }
            else { UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.55) }
        }
        guard feedback.kind.usesSuccessFeedback, sound, !UIAccessibility.isVoiceOverRunning,
              defaults.object(forKey: "spenton-sounds-enabled") as? Bool ?? true else { return }
        let name = feedback.kind == .budgetCreated ? "budget-ready" : "item-added"
        guard let url = Bundle.main.url(forResource: name, withExtension: "wav") else { return }
        do {
            stopSound()
            let session = AVAudioSession.sharedInstance()
            // Ambient audio follows Silent Mode and mixes with existing audio.
            try session.setCategory(.ambient, mode: .default)
            try session.setActive(true)
            ownsAudioSession = true
            let sound = try AVAudioPlayer(contentsOf: url)
            sound.delegate = self; sound.volume = 0.65
            player = sound
            if !sound.play() { stopSound() }
        } catch { stopSound() } // Optional feedback must never turn a saved action into an error.
    }
    func stopSound() {
        player?.stop(); player = nil
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard self?.player.map(ObjectIdentifier.init) == identity else { return }
            self?.stopSound()
        }
    }
}
