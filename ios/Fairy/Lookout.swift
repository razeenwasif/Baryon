import ActivityKit
import BackgroundTasks
import OSLog
import UIKit
import UserNotifications
import WidgetKit

// Everything that tells you about the Mac when you aren't looking at the app: alerts, the badge, widgets and the Live
// Activity. These change when the app itself gets to look; with pushes on, the Mac also alerts the phone directly.
@MainActor
final class Lookout: NSObject, UNUserNotificationCenterDelegate {
    static let checkTask = "dev.razeen.fairy.check"
    static let lastCheck = "lastCheck", lastCheckReached = "lastCheckReached"
    private static let seenAsks = "seenAsks", wasBusy = "wasBusy"

    var openWork: () -> Void = {}
    // Answers a question from its notification's buttons (set by the app to the link's answer).
    var answer: (String, Bool) async throws -> Void = { _, _ in }
    // Ticks off a promise from its reminder's Done button (set by the app to the link's promiseDone).
    var promiseDone: (String) async throws -> Void = { _ in }
    static let askCategory = "ask", refuseCategory = "ask-refuse", promiseCategory = "promise"
    static let allowAction = "allow", denyAction = "deny", doneAction = "done"
    private let center = UNUserNotificationCenter.current()
    private let saved = UserDefaults.standard
    private let log = Logger(subsystem: "dev.razeen.fairy", category: "lookout")
    private var activitySent = Date.distantPast
    private var glance = Glance.load()

    override init() {
        super.init()
        center.delegate = self
        // A question's notification answers it in place. Don't allow goes straight from the notification; Allow opens
        // Fairy for Face ID, as saying yes in the app does. Both need the phone unlocked.
        let allow = UNNotificationAction(identifier: Self.allowAction, title: "Allow", options: [.foreground, .authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "faceid"))
        let deny = UNNotificationAction(identifier: Self.denyAction, title: "Don’t allow", options: [.destructive, .authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "xmark"))
        // A reminder of something you said you'd do is ticked off in place, without opening Fairy.
        let done = UNNotificationAction(identifier: Self.doneAction, title: "Done", options: [.authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.askCategory, actions: [allow, deny], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.refuseCategory, actions: [deny], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.promiseCategory, actions: [done], intentIdentifiers: []),
        ])
    }

    func askToAlert() async { _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge]) }
    func alertsAllowed() async -> Bool { await center.notificationSettings().authorizationStatus == .authorized }

    // On the screen the app shows all this itself, so an alert only goes out when you're somewhere else.
    func saw(_ overview: Overview, onScreen: Bool, stamp: Bool = false) {
        alert(overview, onScreen: onScreen)
        show(overview, stamp: stamp)
        showActivity(overview, onScreen: onScreen)
    }

    private func alert(_ overview: Overview, onScreen: Bool) {
        let asks = overview.approvals.map(\.id), known = saved.stringArray(forKey: Self.seenAsks) ?? []
        let busyBefore = saved.stringArray(forKey: Self.wasBusy) ?? []
        if !onScreen {
            for ask in overview.approvals where !known.contains(ask.id) {
                post(id: "ask-\(ask.id)", title: "Needs your OK", words: [ask.chat, ask.title].compactMap(\.self).joined(separator: ": "),
                     category: ask.phoneMayAllow ? Self.askCategory : Self.refuseCategory, info: ["kind": "ask", "id": ask.id])
            }
            // It might have finished, stopped or failed, and only the session knows which.
            // With pushes on, the Mac says itself when work finishes, so this would say it twice.
            for chat in overview.chats where !saved.bool(forKey: "pushRegistered") && busyBefore.contains(chat.id) && chat.state == "idle" { post(id: "done-\(chat.id)-\(Date.now.timeIntervalSince1970)", title: chat.title, words: "Stopped working. Open Fairy to see how it went.") }
        }
        center.removeDeliveredNotifications(withIdentifiers: known.filter { !asks.contains($0) }.map { "ask-\($0)" })
        center.setBadgeCount(asks.count)
        saved.set(asks, forKey: Self.seenAsks)
        saved.set(overview.chats.filter { $0.state != "idle" }.map(\.id), forKey: Self.wasBusy)
    }

    private func post(id: String, title: String, words: String, category: String? = nil, info: [String: String] = [:]) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = words
        content.sound = .default
        if let category { content.categoryIdentifier = category }
        if !info.isEmpty { content.userInfo = info }
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    private func show(_ overview: Overview, stamp: Bool) {
        let rows = overview.chats.filter { $0.state != "idle" }.sorted { ($0.state == "waiting" ? 0 : 1) < ($1.state == "waiting" ? 0 : 1) }
        var next = Glance(waiting: overview.approvals.count, working: overview.chats.count { $0.state == "working" },
                          rows: rows.prefix(2).map { .init(id: $0.id, title: $0.title, waiting: $0.state == "waiting") }, at: .now)
        // Each redraw uses up some of what iOS allows the widgets, so an unchanged Mac waits for a reason to stamp the time.
        if !stamp, let glance { next.at = glance.at; if next == glance { return } }
        next.at = .now
        next.save()
        glance = next
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func showActivity(_ overview: Overview, onScreen: Bool) {
        let busy = overview.chats.filter { $0.state != "idle" }, running = Activity<WorkActivity>.activities
        guard let top = busy.first(where: { $0.state == "waiting" }) ?? busy.first else { endActivities(running); return }
        let state = WorkActivity.ContentState(title: top.title, waiting: top.state == "waiting", others: busy.count - 1, at: .now)
        let content = ActivityContent(state: state, staleDate: .now + 600)
        if let current = running.first {
            endActivities(Array(running.dropFirst()))
            var same = current.content.state
            same.at = state.at
            // Still fresh and nothing's changed. The stale date keeps moving while the app can keep looking.
            if same == state && Date.now.timeIntervalSince(activitySent) < 300 { return }
            activitySent = .now
            let id = current.id
            Task { await Self.update(id, content) }
        } else if onScreen, ActivityAuthorizationInfo().areActivitiesEnabled {
            // iOS only lets an app start one while it's on the screen.
            do { _ = try Activity.request(attributes: WorkActivity(), content: content); activitySent = .now }
            catch { log.error("Couldn’t start a Live Activity: \(String(describing: error), privacy: .public)") }
        }
    }
    private func endActivities(_ activities: [Activity<WorkActivity>]) {
        let ids = activities.map(\.id)
        Task { await Self.end(ids) }
    }
    // Found again here, because an Activity can't be handed across to the work that updates it.
    private nonisolated static func update(_ id: String, _ content: ActivityContent<WorkActivity.ContentState>) async {
        await Activity<WorkActivity>.activities.first { $0.id == id }?.update(content)
    }
    private nonisolated static func end(_ ids: [String]) async {
        for activity in Activity<WorkActivity>.activities where ids.contains(activity.id) { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    func scheduleCheck() {
        let request = BGAppRefreshTaskRequest(identifier: Self.checkTask)
        request.earliestBeginDate = .now + 15 * 60
        do { try BGTaskScheduler.shared.submit(request) }
        catch { log.error("Couldn’t ask for a background check: \(String(describing: error), privacy: .public)") }
    }
    func checked(reached: Bool) {
        saved.set(Date.now.timeIntervalSince1970, forKey: Self.lastCheck)
        saved.set(reached, forKey: Self.lastCheckReached)
    }

    func forget() {
        BGTaskScheduler.shared.cancelAllTaskRequests()
        center.removeAllDeliveredNotifications()
        center.setBadgeCount(0)
        for key in [Self.seenAsks, Self.wasBusy, Self.lastCheck, Self.lastCheckReached] { saved.removeObject(forKey: key) }
        endActivities(Activity<WorkActivity>.activities)
        Glance.forget()
        glance = nil
        WidgetCenter.shared.reloadAllTimelines()
    }

    // A question opens Tasks, or is answered by its buttons; a check-in, a brief or finished work opens its chat.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let kind = info["kind"] as? String, chat = info["chat"] as? String, id = info["id"] as? String, promise = info["promise"] as? String
        switch response.actionIdentifier {
        case Self.doneAction:
            if let promise { await tickOff(promise) }
        case Self.allowAction, Self.denyAction:
            if let id { await settle(id, allow: response.actionIdentifier == Self.allowAction) }
        default:
            await MainActor.run {
                if kind == "chat", let chat, !chat.isEmpty { LaunchRequest.shared.chat = chat } else { openWork() }
            }
        }
    }
    // Sends the answer. Allow arrives with Fairy open, so Face ID can show; Don't allow is sent without opening her.
    // If it can't be sent (already answered, the Mac out of reach), a notification says so.
    private func settle(_ id: String, allow: Bool) async {
        if allow {
            // Face ID can only show once Fairy is in front, which takes a moment after the tap.
            await MainActor.run { openWork() }
            for _ in 0..<30 where await MainActor.run(body: { UIApplication.shared.applicationState != .active }) {
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        do { try await answer(id, allow) }
        catch KeychainError.cancelled { return }
        catch {
            let why = error is URLError ? "Your Mac couldn’t be reached." : error.localizedDescription
            post(id: "answer-\(id)", title: "Your answer wasn’t sent", words: "\(why) Open Fairy to answer it.")
        }
    }
    // Sends Done for a promise. If it can't be sent, a notification says so, and it can be ticked off in Your week.
    private func tickOff(_ id: String) async {
        do { try await promiseDone(id) }
        catch {
            let why = error is URLError ? "Your Mac couldn’t be reached." : error.localizedDescription
            post(id: "promise-\(id)", title: "It wasn’t ticked off", words: "\(why) You can tick it off in Your week.")
        }
    }
    // With the app open, a check-in or brief from the Mac still shows; questions are already on the screen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        (notification.request.content.userInfo["kind"] as? String) == "chat" ? [.banner, .sound, .list] : []
    }
}
