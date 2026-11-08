import AVFoundation
import Foundation

@MainActor
final class ReaderEdgeAudio {
    private var player: AVAudioPlayer?
    private let speech = AVSpeechSynthesizer()
    private var soundKey = ""
    private var speechKey = ""
    private var sessionActive = false
    private var lastError: String?

    func sync(session: ReaderEdgeSession?, settings: ReaderEdgeSettings?, endingLabel: String?) -> String? {
        guard let session, let settings, session.status != .paused else {
            stop()
            return nil
        }
        let audible = (settings.sound && session.isAdvancing) || settings.speech
        guard audible else { stop(); return nil }

        let nextSoundKey = "\(session.status.rawValue):\(session.phase.rawValue):\(session.bpm):\(settings.sound):\(settings.heartbeat)"
        if soundKey != nextSoundKey {
            soundKey = nextSoundKey
            lastError = nil
            player?.stop()
            player = nil
            if settings.sound && session.isAdvancing {
                let beat = session.status == .running && session.phase != .stop && session.bpm > 0
                let heartbeat = settings.heartbeat && session.phase == .stop
                if beat || heartbeat {
                    do {
                        try activate()
                        let period = beat ? 60 / Double(session.bpm) : 1.1
                        let frequency: Double = beat ? (session.phase == .go ? 880 : 580) : 85
                        let audio = try AVAudioPlayer(data: Self.wave(period: period, frequency: frequency, heartbeat: !beat))
                        audio.numberOfLoops = -1
                        audio.volume = beat ? 0.28 : 0.12
                        audio.prepareToPlay()
                        guard audio.play() else { throw ReaderEdgeRuntime.RuntimeError.unavailable }
                        player = audio
                    } catch {
                        lastError = "节拍声暂时不可用，指令仍会继续。可关闭后重新开启节拍声。"
                    }
                }
            }
        }

        if !settings.speech {
            speech.stopSpeaking(at: .immediate)
            speechKey = ""
        } else {
            let nextSpeechKey = "\(session.id):\(session.status.rawValue):\(session.phase.rawValue):\(session.edges):\(session.ending ?? "")"
            if speechKey != nextSpeechKey {
                speechKey = nextSpeechKey
                speech.stopSpeaking(at: .immediate)
                do {
                    try activate()
                    // Announce state changes only; never read the full command or a countdown.
                    let text = session.status == .finished ? "本次结束。\(endingLabel ?? "")" : session.phaseTitle
                    let utterance = AVSpeechUtterance(string: text)
                    utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
                    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
                    speech.speak(utterance)
                } catch {
                    lastError = "语音暂时不可用，仍可查看屏幕上的指令。"
                }
            }
        }
        return lastError
    }

    func stop() {
        player?.stop()
        player = nil
        speech.stopSpeaking(at: .immediate)
        soundKey = ""
        speechKey = ""
        lastError = nil
        if sessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
        }
    }

    private func activate() throws {
        guard !sessionActive else { return }
        // Respect the silent switch and other apps' audio. No background audio entitlement.
        try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try AVAudioSession.sharedInstance().setActive(true)
        speech.usesApplicationAudioSession = true
        sessionActive = true
    }

    private static func wave(period: Double, frequency: Double, heartbeat: Bool) -> Data {
        let rate: UInt32 = 22_050
        let count = Int(Double(rate) * period)
        let byteCount = UInt32(count * 2)
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: "RIFF".utf8)
        append(byteCount + 36)
        data.append(contentsOf: "WAVEfmt ".utf8)
        append(UInt32(16))
        append(UInt16(1)) // PCM
        append(UInt16(1)) // mono
        append(rate)
        append(rate * 2)
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: "data".utf8)
        append(byteCount)
        for sample in 0..<count {
            let time = Double(sample) / Double(rate)
            let pulseTime = heartbeat && time >= 0.16 ? time - 0.16 : time
            let duration = heartbeat ? 0.12 : 0.055
            let envelope = pulseTime < duration ? sin(.pi * pulseTime / duration) * exp(-pulseTime * 30) : 0
            let value = sin(2 * .pi * frequency * pulseTime) * envelope
            append(Int16(value * Double(Int16.max)))
        }
        return data
    }
}
