import AlarmKit
import AppIntents
import Foundation
import Observation

// A timer Fairy set, as AlarmKit keeps it. Its label shows on the Lock Screen, in the Dynamic Island and when it rings.
struct FairyTimer: AlarmMetadata {
    var label: String
}

// What the app should do as it opens: start listening (the Action button, Control Center, "Talk to Fairy"), or show a
// chat Siri handed over. Both the app and the widgets can see it, as a Control's intent runs in the app.
@MainActor
@Observable
final class LaunchRequest {
    static let shared = LaunchRequest()
    var listen = false
    var chat: String?
    var answer = false
}

// Opens Fairy listening, so you can say what you'd like her to do. The Action button, a Control Center or Lock Screen
// control, and "Hey Siri, talk to Fairy" all run this.
struct TalkToFairyIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk to Fairy"
    static let description = IntentDescription("Opens Fairy listening, so you can ask her to set a timer, go through your email, add something to your calendar, or anything else.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchRequest.shared.listen = true
        return .result()
    }
}
