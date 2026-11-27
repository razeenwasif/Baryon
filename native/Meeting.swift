import Foundation
import AVFoundation
import CoreMedia
import ScreenCaptureKit
import Speech

// Live meeting transcription. System audio (other participants) and the
// microphone (the user) are transcribed separately on this Mac with Apple's
// SpeechTranscriber. Only finished text segments are written to stdout; audio is
// never stored. The helper exits when Fairy closes its stdin.

let output = FileHandle.standardOutput
let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock(); output.write(data + Data([10])); outputLock.unlock()
}

struct MeetingError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@available(macOS 26.0, *)
final class SourceTranscriber: @unchecked Sendable {
    let source: String
    let transcriber: SpeechTranscriber
    let analyzer: SpeechAnalyzer
    let format: AVAudioFormat
    let input: AsyncStream<AnalyzerInput>.Continuation
    private let stream: AsyncStream<AnalyzerInput>
    private var converter: AVAudioConverter?
    private var converterInput: AVAudioFormat?
    private let lock = NSLock()

    init(source: String, locale: Locale) async throws {
        self.source = source
        transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        analyzer = SpeechAnalyzer(modules: [transcriber])
        guard let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw MeetingError(message: "Apple speech recognition has no compatible audio format.")
        }
        format = best
        (stream, input) = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingNewest(400))
    }

    func start() async throws {
        let source = self.source
        Task {
            do {
                for try await result in transcriber.results where result.isFinal {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { emit(["segment": ["source": source, "text": text]]) }
                }
            } catch {
                emit(["error": "Meeting transcription stopped: \(error.localizedDescription)"])
                exit(1)
            }
        }
        try await analyzer.start(inputSequence: stream)
    }

    func append(_ sampleBuffer: CMSampleBuffer) {
        guard sampleBuffer.isValid, sampleBuffer.numSamples > 0,
              var description = sampleBuffer.formatDescription?.audioStreamBasicDescription,
              let inputFormat = AVAudioFormat(streamDescription: &description) else { return }
        lock.lock(); defer { lock.unlock() }
        do {
            try sampleBuffer.withAudioBufferList { list, _ in
                guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: list.unsafePointer) else { return }
                if converterInput != inputFormat {
                    converter = AVAudioConverter(from: inputFormat, to: format)
                    converterInput = inputFormat
                }
                guard let converter else { return }
                let capacity = AVAudioFrameCount(Double(pcm.frameLength) * format.sampleRate / inputFormat.sampleRate) + 64
                guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
                var supplied = false
                var conversionError: NSError?
                converter.convert(to: converted, error: &conversionError) { _, status in
                    if supplied { status.pointee = .noDataNow; return nil }
                    supplied = true; status.pointee = .haveData; return pcm
                }
                if conversionError == nil, converted.frameLength > 0 { input.yield(AnalyzerInput(buffer: converted)) }
            }
        } catch {}
    }

    func finish() async {
        input.finish()
        try? await analyzer.finalizeAndFinishThroughEndOfInput()
    }
}

@available(macOS 26.0, *)
final class MeetingCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let others: SourceTranscriber
    let me: SourceTranscriber?
    var stream: SCStream?

    init(others: SourceTranscriber, me: SourceTranscriber?) { self.others = others; self.me = me }

    func start(excludingProcess pid: Int32?) async throws {
        let content: SCShareableContent
        do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
        catch { throw MeetingError(message: "Fairy needs Screen & System Audio Recording permission to hear meeting audio. Enable it in System Settings → Privacy & Security, then reopen Fairy.") }
        guard let display = content.displays.first else { throw MeetingError(message: "No display is available for system audio capture.") }
        // Keep Fairy's own spoken replies out of the meeting transcript.
        let excluded = content.applications.filter { app in pid.map { app.processID == $0 } ?? false }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48000
        configuration.channelCount = 1
        configuration.captureMicrophone = me != nil
        // Audio only: request the smallest, slowest video stream ScreenCaptureKit allows.
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 1
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        let queue = DispatchQueue(label: "fairy.meeting.audio")
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        if me != nil { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "fairy.meeting.video"))
        try await stream.startCapture()
        self.stream = stream
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        switch type {
        case .audio: others.append(sampleBuffer)
        case .microphone: me?.append(sampleBuffer)
        default: break
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["error": "Meeting audio capture stopped: \(error.localizedDescription)"])
        exit(1)
    }

    func stop() async {
        try? await stream?.stopCapture()
        await others.finish()
        await me?.finish()
    }
}

@available(macOS 26.0, *)
func run(_ request: [String: Any]) async throws {
    guard SpeechTranscriber.isAvailable else {
        throw MeetingError(message: "Apple local transcription is unavailable on this Mac. It requires supported Apple Silicon hardware and macOS 26 or later.")
    }
    let requested = Locale(identifier: request["locale"] as? String ?? "en-AU")
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw MeetingError(message: "Apple local transcription does not support this language. Choose another local recognition language in Settings.")
    }
    let probe = SpeechTranscriber(locale: locale, preset: .transcription)
    if await AssetInventory.status(forModules: [probe]) != .installed {
        emit(["progress": "Downloading Apple speech model for \(locale.identifier)…"])
        if let download = try await AssetInventory.assetInstallationRequest(supporting: [probe]) { try await download.downloadAndInstall() }
    }
    let others = try await SourceTranscriber(source: "others", locale: locale)
    let me = (request["microphone"] as? Bool ?? true) ? try await SourceTranscriber(source: "me", locale: locale) : nil
    try await others.start()
    try await me?.start()
    let capture = MeetingCapture(others: others, me: me)
    try await capture.start(excludingProcess: (request["excludePid"] as? NSNumber)?.int32Value)
    emit(["ready": ["locale": locale.identifier, "microphone": me != nil]])
    // Stop when Fairy closes stdin (including when Fairy quits or crashes).
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        DispatchQueue.global().async { while !FileHandle.standardInput.availableData.isEmpty {}; done.resume() }
    }
    await capture.stop()
}

@main struct MeetingTranscription {
    static func main() async {
        do {
            guard let line = readLine(), line.utf8.count < 8192,
                  let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
                throw MeetingError(message: "Invalid meeting transcription request.")
            }
            if #available(macOS 26.0, *) { try await run(request) }
            else { throw MeetingError(message: "Meeting mode needs macOS 26 or later.") }
            exit(0)
        } catch {
            emit(["error": error.localizedDescription])
            exit(1)
        }
    }
}
