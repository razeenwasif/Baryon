import AlarmKit
import AppIntents
import Foundation
import SwiftUI

// The app's one connection and tab state, made once. Siri can run "Ask Fairy" before any screen exists, and it must use
// the same link the screens do.
@MainActor
final class AppParts {
    static let shared = AppParts()
    let link: LinkClient
    let tabs: TabState
    private init() {
        let link = LinkClient(), tabs = TabState()
        link.lookout.openWork = { tabs.current = .tasks }
        link.lookout.answer = { id, allow in try await link.answer(id: id, allow: allow) }
        link.lookout.promiseDone = { id in try await link.promiseDone(id) }
        self.link = link
        self.tabs = tabs
        #if DEBUG
        if Demo.on { link.loadDemo() }
        #endif
    }
}

// Timers and alarms live on the iPhone, through AlarmKit, so they ring like the Clock app's, locked or not, without the Mac.
enum Timers {
    enum Problem: LocalizedError {
        case notAllowed
        var errorDescription: String? { "Baryon isn’t allowed to set timers. In Settings, open Apps, then Baryon, and turn on Alarms." }
    }

    @MainActor
    static func start(_ request: TimerWords.Request) async throws -> String {
        let manager = AlarmManager.shared
        switch manager.authorizationState {
        case .authorized: break
        case .denied: throw Problem.notAllowed
        default: guard try await manager.requestAuthorization() == .authorized else { throw Problem.notAllowed }
        }
        let name = request.label ?? (request.clock == nil ? "Timer" : "Alarm")
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) { alert = AlarmPresentation.Alert(title: "\(name)") }
        else { alert = AlarmPresentation.Alert(title: "\(name)", stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill")) }
        // An alarm for a time of day rings the next time that time comes round, and has no countdown to show.
        if let clock = request.clock {
            let attributes = AlarmAttributes<FairyTimer>(presentation: AlarmPresentation(alert: alert), metadata: FairyTimer(label: name), tintColor: .accent)
            let schedule = Alarm.Schedule.relative(.init(time: .init(hour: clock.hour, minute: clock.minute), repeats: .never))
            _ = try await manager.schedule(id: UUID(), configuration: .alarm(schedule: schedule, attributes: attributes))
            let rings = Date.now.addingTimeInterval(TimeInterval(request.seconds))
            let at = rings.formatted(date: .omitted, time: .shortened)
            let when = Calendar.current.isDateInToday(rings) ? at : "\(at) tomorrow"
            return request.label.map { "\($0) alarm set for \(when)." } ?? "Alarm set for \(when)."
        }
        let presentation = AlarmPresentation(alert: alert, countdown: AlarmPresentation.Countdown(title: "\(name)"))
        let attributes = AlarmAttributes<FairyTimer>(presentation: presentation, metadata: FairyTimer(label: name), tintColor: .accent)
        let id = UUID()
        _ = try await manager.schedule(id: id, configuration: .timer(duration: TimeInterval(request.seconds), attributes: attributes))
        // The notch island counts it down (see NotchIsland.swift).
        IslandTimers.add(id: id, name: name, seconds: request.seconds)
        let length = TimerWords.spoken(request.seconds)
        return request.label.map { "\($0) timer set for \(length)." } ?? "Timer set for \(length)."
    }
}

// What Siri says aloud: the reply without its Markdown, and only its start when it's long.
enum Spoken {
    static func short(_ text: String, limit: Int = 700) -> String {
        var plain = text.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^\s*(?:#+|[-*•]|\d+\.)\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[*_`>#]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard plain.count > limit else { return plain }
        let cut = plain.prefix(limit)
        plain = cut.range(of: ". ", options: .backwards).map { String(cut[..<$0.lowerBound]) + "." } ?? String(cut) + "…"
        return plain + " The rest is in Fairy."
    }
}

struct AskProblem: LocalizedError, CustomLocalizedStringResourceConvertible {
    let words: String
    var errorDescription: String? { words }
    var localizedStringResource: LocalizedStringResource { "\(words)" }
}

// "Hey Siri, ask Fairy." Siri asks what to do, and Fairy does it: a timer here on the iPhone, anything else on the Mac,
// where Gmail and Calendar requests are answered as they are in a chat there. A short answer is said by Siri. One that
// needs Face ID (adding an event) or takes longer opens Fairy to carry on.
struct AskFairyIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Fairy"
    static let description = IntentDescription("Ask Fairy to set a timer, go through your recent email, add something to your calendar, or anything else.")
    static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]
    // Your email can be read out, so the iPhone must be unlocked.
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Request", requestValueDialog: "What should I do?")
    var request: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let words = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { throw AskProblem(words: "I didn’t catch that.") }
        if let timer = TimerWords.parse(words) {
            // iOS asks once whether Fairy may set timers, and only with Fairy open.
            if AlarmManager.shared.authorizationState == .notDetermined { try await continueInForeground("Fairy needs your OK once to set timers.", alwaysConfirm: false) }
            return .result(dialog: "\(try await Timers.start(timer))")
        }

        let link = AppParts.shared.link
        guard link.pairing != nil else { throw AskProblem(words: "Baryon isn’t paired with your Mac yet. Open Baryon to pair it.") }
        // Quick requests go into Home's thread, so they sit with your briefs and check-ins, and follow-ups keep context.
        let chat: String
        do { chat = try await link.send(words, to: try? await link.ensureThread(), voice: false) }
        catch { throw AskProblem(words: (error as? LinkError)?.errorDescription ?? "I can’t reach your Mac right now.") }

        // Siri waits a little while. Most answers come well within it.
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            try await Task.sleep(for: .milliseconds(700))
            guard let detail = try? await link.chatDetail(chat) else { continue }
            if detail.state == "waiting" {
                LaunchRequest.shared.answer = true
                try await continueInForeground("Fairy needs Face ID to add this to your calendar.", alwaysConfirm: false)
                return .result(dialog: "Check it in Fairy, then confirm.")
            }
            guard detail.state != "working" else { continue }
            if let failure = detail.failure { return .result(dialog: "\(failure)") }
            if let reply = detail.messages.last, reply.role == "assistant" { return .result(dialog: "\(Spoken.short(reply.text))") }
        }
        LaunchRequest.shared.chat = chat
        try await continueInForeground("Fairy’s still working on it. I’ll open Baryon so you can follow along.", alwaysConfirm: false)
        return .result(dialog: "It’s in Fairy.")
    }
}

// The phrases Siri knows without any setup, and the actions the Action button and Shortcuts offer.
struct FairyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskFairyIntent(), phrases: ["Ask \(.applicationName)", "Tell \(.applicationName)", "Hey \(.applicationName)"], shortTitle: "Ask Fairy", systemImageName: "sparkle")
        AppShortcut(intent: TalkToFairyIntent(), phrases: ["Talk to \(.applicationName)", "Open \(.applicationName) and listen"], shortTitle: "Talk to Fairy", systemImageName: "waveform")
    }
}
