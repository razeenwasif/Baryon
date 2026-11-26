import Foundation
import AVFoundation
import Speech

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

struct TranscriptionError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@available(macOS 26.0, *)
func perform(_ request: [String: Any]) async throws {
    guard SpeechTranscriber.isAvailable else {
        throw TranscriptionError(message: "Apple local transcription is unavailable on this Mac. It requires supported Apple Silicon hardware and macOS 26 or later.")
    }
    let requested = Locale(identifier: request["locale"] as? String ?? "en-AU")
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw TranscriptionError(message: "Apple local transcription does not support this language. Choose another local recognition language in Settings.")
    }
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    let status = await AssetInventory.status(forModules: [transcriber])
    let command = request["command"] as? String ?? "check"
    if command == "check" {
        emit(["result": ["locale": locale.identifier, "installed": status == .installed]])
        return
    }
    guard command == "prepare" || command == "transcribe" else {
        throw TranscriptionError(message: "Invalid local transcription command.")
    }
    if status != .installed {
        emit(["progress": "Downloading Apple speech model for \(locale.identifier)… This is only needed for initial setup."])
        do {
            if let download = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await download.downloadAndInstall()
            }
        } catch {
            throw TranscriptionError(message: "Could not install Apple's speech model. Connect to the internet and retry. \(error.localizedDescription)")
        }
    }
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
        throw TranscriptionError(message: "Apple's speech model is not ready. Retry local speech setup in Settings.")
    }
    if command == "prepare" {
        emit(["result": ["locale": locale.identifier, "installed": true]])
        return
    }
    guard let path = request["path"] as? String else {
        throw TranscriptionError(message: "Missing local recording.")
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    guard file.length > 0, Double(file.length) / file.processingFormat.sampleRate <= 65 else {
        throw TranscriptionError(message: "Local recordings must contain at most 65 seconds of audio.")
    }
    emit(["progress": "Transcribing on your Mac…"])
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    // Bias recognition toward the companion's name so "Fairy" isn't heard as "ferry".
    let vocabulary = (request["vocabulary"] as? [String] ?? []).filter { !$0.isEmpty && $0.count <= 40 }.prefix(20)
    if !vocabulary.isEmpty {
        let context = AnalysisContext()
        context.contextualStrings[.general] = Array(vocabulary)
        try await analyzer.setContext(context)
    }
    let resultTask = Task { () throws -> String in
        var text = ""
        for try await result in transcriber.results { text += String(result.text.characters) }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    do {
        _ = try await analyzer.analyzeSequence(from: file)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        emit(["result": ["text": try await resultTask.value, "locale": locale.identifier]])
    } catch {
        await analyzer.cancelAndFinishNow()
        resultTask.cancel()
        throw error
    }
}

@main struct LocalTranscription {
    static func main() async {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard data.count < 8192, let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw TranscriptionError(message: "Invalid local transcription request.")
            }
            if #available(macOS 26.0, *) { try await perform(request) }
            else { throw TranscriptionError(message: "Apple local transcription needs macOS 26 or later.") }
        } catch {
            emit(["error": error.localizedDescription])
            exit(1)
        }
    }
}
