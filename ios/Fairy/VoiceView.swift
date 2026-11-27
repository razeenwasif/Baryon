@preconcurrency import AVFoundation
import Speech
import SwiftUI
import UIKit

// For reading over a cable with `devicectl device process launch --console`. Never includes what was said.
func voiceLog(_ words: @autoclosure () -> String) {
    #if DEBUG
    fputs("[voice] \(words())\n", stderr)
    #endif
}

// Apple's recogniser often hears the name as something else, as the Mac's src/voice-gate.js also knows. You're
// talking to Fairy here, so "Siri" is always the name. The real words it could be stay alone unless they're used to
// call out to it, so "the ferry timetable" and "very good" are left as they are.
func restoringName(_ heard: String) -> String {
    var words = heard
    let fix: (String, String) -> Void = { pattern, with in
        if let found = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
            words = found.stringByReplacingMatches(in: words, range: NSRange(words.startIndex..., in: words), withTemplate: with)
        }
    }
    fix(#"\b(?:siri|fairey|faerie|faery|fairie)\b"#, "Fairy")
    fix(#"\b(hey|hi|hello|okay|ok|thanks|thank you)([,]?\s+)(?:a\s+)?(?:ferry|fairly|fiery|fury|furry|very|verry|barry|harry|mary)\b"#, "$1$2Fairy")
    fix(#"^\s*(?:a\s+)?(?:ferry|fairly|very|verry)\s*[.!?]?\s*$"#, "Fairy")
    fix(#"^\s*(?:ferry|fairly|verry)([,]\s+)"#, "Fairy$1")
    return words
}

// Listens through the microphone and recognises speech on this iPhone, so what you say only leaves it as the words
// you send. Its callbacks arrive on audio threads, and starting audio can block for seconds, so nothing in here belongs
// to the main actor, and everything that touches the engine takes turns on its own queue.
final class SpeechListener: @unchecked Sendable {
    private let queue = DispatchQueue(label: "dev.razeen.fairy.listener", qos: .userInitiated)
    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    static func allowed() async -> Bool {
        let speech = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { done.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
    // Only on-device recognition counts, so what you say never goes to a server to be understood.
    func canRecognise() -> Bool {
        guard let found = SFSpeechRecognizer(locale: .current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")), found.supportsOnDeviceRecognition else { return false }
        recognizer = found
        return true
    }
    static func prepareAudio(forListening listening: Bool) async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    if listening { try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP]) }
                    else { try session.setCategory(.playback) }
                    try session.setActive(true)
                    done.resume()
                } catch { done.resume(throwing: error) }
            }
        }
    }
    static func releaseAudio() {
        DispatchQueue.global(qos: .utility).async { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    struct Handlers: Sendable {
        let heard: @Sendable (String, Bool) -> Void
        let level: @Sendable (Float) -> Void
        let ended: @Sendable () -> Void
        let failed: @Sendable (Int, String) -> Void
    }

    func start(_ handlers: Handlers) async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            queue.async {
                do { try self.begin(handlers); done.resume() }
                catch { done.resume(throwing: error) }
            }
        }
    }
    private func begin(_ handlers: Handlers) throws {
        end()
        guard let recognizer else { throw VoiceError.noMicrophone }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.addsPunctuation = true
        // Tells it to expect the name, as it isn't a word it would otherwise think of.
        request.contextualStrings = ["Fairy", "Hey Fairy"]
        self.request = request
        let input = engine.inputNode, format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw VoiceError.noMicrophone }
        let route = AVAudioSession.sharedInstance().currentRoute
        voiceLog("start rate=\(format.sampleRate) channels=\(format.channelCount) locale=\(recognizer.locale.identifier) onDevice=\(recognizer.supportsOnDeviceRecognition) available=\(recognizer.isAvailable) input=\(route.inputs.map(\.portType.rawValue)) output=\(route.outputs.map(\.portType.rawValue))")
        var buffers = 0
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
            buffers += 1
            guard buffers % 4 == 0, let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            let count = Int(buffer.frameLength)
            var total: Float = 0
            for index in 0..<count { total += samples[index] * samples[index] }
            let level = (total / Float(count)).squareRoot()
            if buffers % 80 == 0 { voiceLog("audio buffers=\(buffers) level=\(level)") }
            handlers.level(level)
        }
        engine.prepare()
        try engine.start()
        voiceLog("engine running=\(engine.isRunning)")
        task = recognizer.recognitionTask(with: request) { result, error in
            if let result {
                voiceLog("result words=\(result.bestTranscription.segments.count) final=\(result.isFinal)")
                handlers.heard(restoringName(result.bestTranscription.formattedString), result.isFinal)
            }
            if let error = error as NSError? {
                voiceLog("error domain=\(error.domain) code=\(error.code) \(error.localizedDescription)")
                // No speech, and being stopped, both end the task without anything being wrong.
                let harmless = error.code == 1110 || error.code == 301 || error.code == 216
                if !harmless, result == nil { handlers.failed(error.code, error.localizedDescription); return }
            }
            if error != nil || result?.isFinal == true { handlers.ended() }
        }
        voiceLog("task state=\(task?.state.rawValue ?? -1)")
    }
    func stop() { queue.async { self.end() } }
    private func end() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }
}

enum VoiceError: LocalizedError {
    case noMicrophone
    var errorDescription: String? { "This iPhone’s microphone isn’t available." }
}

// Where a spoken conversation's words go and its reply comes from: Fairy's own chats (FairyVoice), or a Study notebook's
// tutor (TutorVoice in StudyVoice.swift). The listening, clips, glow and bar are the same for both.
@MainActor
protocol VoiceBackend: AnyObject {
    // Whether "set a timer for five minutes" is done here on the iPhone.
    var timers: Bool { get }
    func follow(_ conversation: String?)
    func send(_ words: String, to conversation: String?, voice: Bool) async throws -> String
    func stop(_ conversation: String) async
    func clip(_ conversation: String, _ index: Int) async -> Data?
    // The reply to what was just said, once the Mac has it; nil until then.
    func reply(for conversation: String?, sent: String) -> VoiceReply?
}
struct VoiceReply {
    var working: Bool
    var text: String
    var failure: String?
    // nil while the Mac hasn't said whether it's reading the reply aloud.
    var parts: Int?
    var done: Bool
}

// Fairy's own chats, as the in-chat voice has always worked.
@MainActor
final class FairyVoice: VoiceBackend {
    private let link: LinkClient
    init(link: LinkClient) { self.link = link }
    var timers: Bool { true }
    func follow(_ conversation: String?) { if let conversation { link.follow(conversation) } }
    func send(_ words: String, to conversation: String?, voice: Bool) async throws -> String { try await link.send(words, to: conversation, voice: voice) }
    func stop(_ conversation: String) async { try? await link.stop(conversation) }
    func clip(_ conversation: String, _ index: Int) async -> Data? { await link.voicePart(conversation, index) }
    func reply(for conversation: String?, sent: String) -> VoiceReply? {
        guard let detail = link.chat, detail.id == conversation else { return nil }
        // Until the Mac has this message, what it's showing is the last turn.
        guard detail.messages.contains(where: { $0.role == "user" && $0.text == sent }) || detail.state == "working" else { return nil }
        var text = ""
        if let writing = detail.live?.text, !writing.isEmpty { text = writing }
        else if detail.state != "working", let last = detail.messages.last, last.role == "assistant" { text = last.text }
        return VoiceReply(working: detail.state == "working", text: text, failure: detail.failure, parts: detail.voice?.parts, done: detail.voice?.done ?? false)
    }
}

// One spoken conversation: listen, send what was said, play the reply, and listen again.
@MainActor
@Observable
final class VoiceTalk: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    enum Mode: Equatable { case starting, listening, thinking, speaking, paused, blocked(String) }

    private(set) var mode = Mode.starting
    private(set) var heard = ""
    private(set) var reply = ""
    private(set) var problem: String?
    private(set) var chat: String?
    private(set) var quiet = false
    private(set) var level: Float = 0
    private(set) var hint: String?

    private let link: LinkClient
    private let backend: VoiceBackend
    private let listener = SpeechListener()
    private var canListen = false
    private var starting = false
    private var hintTimer: Task<Void, Never>?
    private var loudest: Float = 0
    private var silence: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var sent: String?
    private var nextPart = 0
    private var fetching = false
    private var player: AVAudioPlayer?
    private let fallback = AVSpeechSynthesizer()

    init(link: LinkClient, chat: String?, backend: VoiceBackend? = nil) {
        self.link = link
        self.backend = backend ?? FairyVoice(link: link)
        self.chat = chat
        super.init()
        fallback.delegate = self
    }

    var eyeMood: EyeMood {
        switch mode {
        case .listening: .listening
        case .thinking, .starting: .thinking
        case .speaking: .speaking
        case .paused, .blocked: .idle
        }
    }
    var status: String {
        switch mode {
        case .starting: "Getting ready"
        case .listening: "Listening"
        case .thinking: "Thinking"
        case .speaking: "Speaking. Tap to interrupt"
        case .paused: "Microphone off. Tap to talk"
        case .blocked: "Type instead"
        }
    }

    func begin() async {
        UIApplication.shared.isIdleTimerDisabled = true
        backend.follow(chat)
        // While this screen is open the Mac leaves "Hey Fairy" to the phone, so one request isn't answered twice.
        heartbeat?.cancel()
        heartbeat = Task { [link] in
            while !Task.isCancelled {
                await link.setListening(true)
                try? await Task.sleep(for: .seconds(8))
            }
        }
        #if targetEnvironment(simulator)
        // The Simulator's microphone isn't dependable and can stop the app outright. Typing still tests everything after it.
        try? await SpeechListener.prepareAudio(forListening: false)
        mode = .blocked("The Simulator can’t listen, so type here. It works on a real iPhone.")
        #else
        guard await SpeechListener.allowed() else { return await blocked("Baryon needs the microphone and speech recognition. You can turn them on in Settings, under Baryon.") }
        guard listener.canRecognise() else { return await blocked("This iPhone can’t recognise your language on the device yet. Turn on Dictation in Settings, under General, then Keyboard, and it should download.") }
        do { try await SpeechListener.prepareAudio(forListening: true) }
        catch { return mode = .blocked(error.localizedDescription) }
        canListen = true
        listen()
        #endif
    }
    // You can still type and hear replies without the microphone.
    private func blocked(_ words: String) async {
        try? await SpeechListener.prepareAudio(forListening: false)
        mode = .blocked(words)
    }

    func end() {
        heartbeat?.cancel()
        heartbeat = nil
        Task { [link] in await link.setListening(false) }
        silence?.cancel()
        hintTimer?.cancel()
        listener.stop()
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        SpeechListener.releaseAudio()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func listen() {
        guard canListen, !starting else { return }
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        heard = ""
        reply = ""
        sent = nil
        starting = true
        mode = .starting
        hint = nil
        loudest = 0
        let handlers = SpeechListener.Handlers(
            heard: { [weak self] words, final in Task { @MainActor in self?.hear(words, final: final) } },
            level: { [weak self] level in Task { @MainActor in self?.meter(level) } },
            ended: { [weak self] in Task { @MainActor in self?.recognitionEnded() } },
            failed: { [weak self] code, message in Task { @MainActor in self?.recognitionFailed(code, message) } })
        Task {
            defer { starting = false }
            do {
                try await listener.start(handlers)
                if mode == .starting { mode = .listening; watchForNothing() } else { listener.stop() }
            } catch { mode = .blocked(error.localizedDescription) }
        }
    }

    private func meter(_ value: Float) {
        guard mode == .listening else { return }
        level = value
        loudest = max(loudest, value)
    }

    // Says so if nothing's coming through, rather than sitting on "Listening" looking fine.
    private func watchForNothing() {
        hintTimer?.cancel()
        hintTimer = Task {
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, mode == .listening, heard.isEmpty else { return }
            hint = loudest < 0.002 ? "The microphone isn’t picking anything up." : "I can hear sound, but no words yet."
            voiceLog("nothing heard after 6s loudest=\(loudest)")
        }
    }

    // Starting again can't fix these, so it stops and says what to do. You can still type, and tap the eye to retry.
    private func recognitionFailed(_ code: Int, _ message: String) {
        hintTimer?.cancel()
        silence?.cancel()
        listener.stop()
        level = 0
        mode = .blocked(code == 201
            ? "Talking needs Dictation or Siri turned on. Turn on Dictation in Settings, under General, then Keyboard, then come back and tap the eye. If you want it to stay on this iPhone, check its language shows as on-device there."
            : "\(message) (\(code)). Tap the eye to try again.")
    }

    // Recognition ends by itself after silence or a time limit, so it starts again unless it was meant to stop.
    private func recognitionEnded() {
        guard mode == .listening else { return }
        if !heard.trimmingCharacters(in: .whitespaces).isEmpty { return send(heard) }
        voiceLog("recognition ended with nothing, starting again")
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            if mode == .listening, !starting { mode = .starting; restart() }
        }
    }
    private func restart() { mode = .paused; listen() }

    private func hear(_ words: String, final: Bool) {
        guard mode == .listening else { return }
        heard = words
        if !words.isEmpty { hint = nil; hintTimer?.cancel() }
        // A pause means you've finished.
        silence?.cancel()
        silence = Task {
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled, mode == .listening, !heard.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            send(heard)
        }
    }

    func send(_ words: String) {
        silence?.cancel()
        hintTimer?.cancel()
        hint = nil
        level = 0
        listener.stop()
        heard = words
        sent = words
        reply = ""
        problem = nil
        nextPart = 0
        mode = .thinking
        // A timer is set here, on the iPhone, and said here too.
        if backend.timers, let timer = TimerWords.parse(words) {
            Task {
                do { reply = try await Timers.start(timer); sent = nil; if quiet { next() } else { speakHere(reply) } }
                catch { problem = error.localizedDescription; if canListen { listen() } else { mode = .blocked("") } }
            }
            return
        }
        Task {
            do {
                chat = try await backend.send(words, to: chat, voice: !quiet)
                backend.follow(chat)
            } catch {
                problem = error.localizedDescription
                if canListen { listen() } else { mode = .blocked("") }
            }
        }
    }

    // Called with each update from the Mac. It plays clips as they appear, and finishes when the Mac has no more.
    func update(_ detail: SessionDetail?) { refresh() }
    func refresh() {
        guard let sent, mode == .thinking || mode == .speaking, let state = backend.reply(for: chat, sent: sent) else { return }
        if !state.text.isEmpty { reply = state.text }
        if let failure = state.failure {
            problem = failure
            return next()
        }
        if !quiet, let parts = state.parts, parts > nextPart, !fetching, player?.isPlaying != true { fetchClip() }
        guard !state.working, !fetching, player?.isPlaying != true, !fallback.isSpeaking else { return }
        if quiet { return next() }
        guard state.done, let parts = state.parts, nextPart >= parts else { return }
        // The Mac has no voice to offer, so the iPhone reads it instead.
        if parts == 0, !reply.isEmpty { return speakHere(reply) }
        next()
    }

    private func next() {
        sent = nil
        if canListen { listen() } else { mode = .blocked("") }
    }

    private func fetchClip() {
        guard let chat else { return }
        let index = nextPart
        fetching = true
        Task {
            defer { fetching = false }
            guard let data = await backend.clip(chat, index) else { return }
            nextPart = index + 1
            do {
                let clip = try AVAudioPlayer(data: data)
                clip.delegate = self
                clip.prepareToPlay()
                player = clip
                mode = .speaking
                clip.play()
            } catch { problem = error.localizedDescription }
        }
    }

    private func speakHere(_ text: String) {
        mode = .speaking
        fallback.speak(AVSpeechUtterance(string: Self.plain(text)))
    }

    // What the iPhone's own voice says of a reply: no Markdown marks, citations, code or TeX dollars.
    static func plain(_ text: String) -> String {
        var said = text.replacingOccurrences(of: #"(?s)(`{3,}|~{3,}).*?\1"#, with: " ", options: .regularExpression)
        said = said.replacingOccurrences(of: #"\[\[[^\]\n]*\]\]"#, with: "", options: .regularExpression)
        for mark in ["**", "`", "$$", "$", "#"] { said = said.replacingOccurrences(of: mark, with: "") }
        return said
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.refresh() }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.next() }
    }

    // Tapping the eye: while it's listening that sends what you've said, and otherwise it cuts in.
    func tap() {
        switch mode {
        case .listening: if !heard.isEmpty { send(heard) }
        case .thinking, .speaking:
            if let chat { Task { [backend] in await backend.stop(chat) } }
            sent = nil
            player?.stop()
            fallback.stopSpeaking(at: .immediate)
            if canListen { listen() } else { mode = .blocked("") }
        case .paused: listen()
        case .blocked: if canListen { problem = nil; listen() }
        default: break
        }
    }
    func toggleMicrophone() {
        if mode == .paused { listen() }
        else if mode == .listening { silence?.cancel(); listener.stop(); heard = ""; mode = .paused }
    }
    func toggleQuiet() {
        quiet.toggle()
        if quiet { player?.stop(); fallback.stopSpeaking(at: .immediate); refresh() }
    }
    func pauseForTyping() { if mode == .listening { silence?.cancel(); listener.stop(); heard = ""; mode = .paused } }
}

// Reads a typed chat's reply out loud, for "Speak replies out loud" in Settings. It plays the Mac's clips as they
// arrive, and uses the iPhone's own voice if the Mac has none.
@MainActor
final class ReplySpeaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    private var sent: String?
    private var nextPart = 0
    private var fetching = false
    private var player: AVAudioPlayer?
    private let fallback = AVSpeechSynthesizer()
    private var link: LinkClient?

    override init() {
        super.init()
        fallback.delegate = self
    }

    func expect(_ words: String) {
        player?.stop()
        fallback.stopSpeaking(at: .immediate)
        sent = words
        nextPart = 0
        Task { try? await SpeechListener.prepareAudio(forListening: false) }
    }

    func stop() {
        let wasSpeaking = sent != nil || player != nil || fallback.isSpeaking
        sent = nil
        player?.stop()
        player = nil
        fallback.stopSpeaking(at: .immediate)
        if wasSpeaking { SpeechListener.releaseAudio() }
    }

    func update(_ detail: SessionDetail?, link: LinkClient) {
        self.link = link
        guard let detail, let sent else { return }
        // Until the Mac has this message, what it's showing is the last turn.
        guard detail.messages.contains(where: { $0.role == "user" && $0.text == sent }) || detail.state == "working" else { return }
        if detail.failure != nil { return stop() }
        guard player?.isPlaying != true, !fallback.isSpeaking, !fetching else { return }
        if let voice = detail.voice, voice.parts > nextPart { return fetchClip(detail.id, link) }
        guard detail.state != "working", let voice = detail.voice, voice.done else { return }
        if voice.parts == 0, let last = detail.messages.last, last.role == "assistant" {
            self.sent = nil
            let plain = last.text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
            return fallback.speak(AVSpeechUtterance(string: plain))
        }
        stop()
    }

    private func fetchClip(_ chat: String, _ link: LinkClient) {
        let index = nextPart
        fetching = true
        Task {
            defer { fetching = false }
            guard let data = await link.voicePart(chat, index), sent != nil else { return }
            nextPart = index + 1
            guard let clip = try? AVAudioPlayer(data: data) else { return }
            clip.delegate = self
            clip.prepareToPlay()
            player = clip
            clip.play()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            guard let link = self.link else { return }
            self.update(link.chat, link: link)
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in SpeechListener.releaseAudio() }
    }
}
