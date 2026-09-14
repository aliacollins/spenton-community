import AVFoundation
import Observation
import UIKit

@MainActor @Observable final class PipNarrator: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var meterTask: Task<Void, Never>?
    private var ownsAudioSession = false
    var speaking = false
    var word = 0
    var error: String?

    func play(_ clip: String) {
        stop()
        error = nil
        guard !UIAccessibility.isVoiceOverRunning, UIApplication.shared.applicationState == .active else { return }
        guard let url = Bundle.main.url(forResource: clip, withExtension: "mp3") else {
            error = "Pip’s voice is unavailable for this step. The instructions are still shown below."
            return
        }
        do {
            CompletionPlayer.shared.stopSound()
            let session = AVAudioSession.sharedInstance()
            // Narration follows an explicit voice choice and is separate from quiet action sounds.
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            ownsAudioSession = true
            let audio = try AVAudioPlayer(contentsOf: url)
            audio.delegate = self
            audio.isMeteringEnabled = true
            player = audio
            guard audio.play() else { throw CocoaError(.fileReadCorruptFile) }
            speaking = true
            meterTask = Task { @MainActor [weak self, weak audio] in
                while !Task.isCancelled {
                    guard let self, let audio, self.player === audio, audio.isPlaying else { return }
                    audio.updateMeters()
                    // Animate the existing mouth from the recording's voice activity.
                    if audio.averagePower(forChannel: 0) > -42 { self.word += 1 }
                    try? await Task.sleep(for: .milliseconds(160))
                }
            }
        } catch {
            stop()
            self.error = "Pip’s voice couldn’t play. You can turn it on again or follow the instructions below."
        }
    }

    func stop() {
        meterTask?.cancel(); meterTask = nil
        player?.delegate = nil
        player?.stop(); player = nil
        speaking = false
        error = nil
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard self?.player.map(ObjectIdentifier.init) == identity else { return }
            self?.stop()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard self?.player.map(ObjectIdentifier.init) == identity else { return }
            self?.stop()
            self?.error = "Pip’s voice couldn’t play. The instructions are still shown below."
        }
    }
}
