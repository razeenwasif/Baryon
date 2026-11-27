import Darwin
import Foundation
import Observation
import OSLog
import UIKit

enum LinkError: LocalizedError {
    case badCode, refused(String), removed
    var errorDescription: String? {
        switch self {
        case .badCode: "That isn’t a Fairy pairing code. Make a new one in Settings on your Mac."
        case .refused(let words): words
        case .removed: "This iPhone isn’t paired any more."
        }
    }
}

// The app's one connection to the Mac. Everything goes through a session that trusts only the certificate from pairing.
@MainActor
@Observable
final class LinkClient {
    enum Reach: Equatable { case connecting, connected, tailscaleOff, outOfReach, mismatch }

    private(set) var pairing = Keychain.loadPairing()
    private(set) var reach = Reach.connecting
    private(set) var overview: Overview?
    private(set) var chat: SessionDetail?
    private(set) var heardAt: Date?
    private(set) var chats = ChatStore.loadList()
    private(set) var queue = ChatStore.loadQueue()
    private(set) var pages: [PageItem] = []
    // A Study notebook's tutor chat being followed on the stream, and what the Mac says of it (StudyViews.swift).
    private(set) var tutor: TutorLive?
    private var followingTutor: TutorFollow?
    private(set) var modelCatalog: ModelCatalog?
    var chatSelections: [String: ModelCatalog.Selection] = [:]
    var notice: String?

    private var following: String?
    var followingChat: String? { following }
    var macName: String { pairing?.host.split(separator: ".").first.map(String.init) ?? "Your Mac" }
    private var flushing = false
    private var stream: Task<Void, Never>?
    private let log = Logger(subsystem: "dev.razeen.fairy", category: "link")
    let lookout = Lookout()
    private var lingering = UIBackgroundTaskIdentifier.invalid
    private var onScreen: Bool { UIApplication.shared.applicationState == .active }

    // Looks for a VPN interface holding one of Tailscale's addresses, from 100.64.0.0/10. The network's main route
    // can't say, as Tailscale only carries traffic for its own addresses and leaves the rest on Wi-Fi or mobile data.
    nonisolated static func tailscaleIsUp() -> Bool {
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0 else { return true }
        defer { freeifaddrs(first) }
        var each = first
        while let entry = each {
            defer { each = entry.pointee.ifa_next }
            guard String(cString: entry.pointee.ifa_name).hasPrefix("utun"), let address = entry.pointee.ifa_addr, address.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let value = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if value >> 22 == (100 << 2 | 1) { return true }
        }
        return false
    }

    private var pinnedSession: (pin: String, session: URLSession)?
    private func session(for pairing: Pairing) -> URLSession {
        if let pinnedSession, pinnedSession.pin == pairing.pin { return pinnedSession.session }
        pinnedSession?.session.invalidateAndCancel()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: CertificatePin(fingerprint: pairing.pin), delegateQueue: nil)
        pinnedSession = (pairing.pin, session)
        return session
    }
    private func request(_ pairing: Pairing, path: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://\(pairing.host):\(pairing.port)\(path)")!)
        request.setValue("Bearer \(pairing.readKey)", forHTTPHeaderField: "Authorization")
        return request
    }

    // The code from the Mac: fairy://pair?host=…&port=…&code=…&pin=…
    func pair(with link: URL) async throws {
        let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        // Only Tailscale names can get through iOS's rules, so nothing else can be a real code.
        guard link.scheme == "fairy", link.host == "pair", let host = value("host"), host.hasSuffix(".ts.net"), let port = value("port").flatMap(Int.init), let code = value("code"), let pin = value("pin"), pin.count == 64 else { throw LinkError.badCode }
        let draft = Pairing(host: host, port: port, pin: pin, readKey: "")
        var ask = request(draft, path: "/v1/pair")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "name": "iPhone"])
        let reply: PairingReply = try await send(ask, using: draft)
        try Keychain.saveApproveKey(reply.approveKey)
        let done = Pairing(host: host, port: port, pin: pin, readKey: reply.readKey)
        try Keychain.savePairing(done)
        pairing = done
        notice = nil
        start()
    }

    func forget(tellingMac: Bool) async {
        if tellingMac, let pairing {
            var ask = request(pairing, path: "/v1/leave")
            ask.httpMethod = "POST"
            ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
            ask.httpBody = Data("{}".utf8)
            _ = try? await session(for: pairing).data(for: ask)
        }
        stop()
        lookout.forget()
        Keychain.forget()
        ChatStore.forget()
        pairing = nil
        overview = nil
        chat = nil
        chats = []
        queue = []
        pages = []
    }

    func start() {
        #if DEBUG
        if Demo.on { return }
        #endif
        stop()
        guard let pairing else { return }
        reach = .connecting
        stream = Task { await listen(pairing) }
    }
    func stop() { stream?.cancel(); stream = nil }

    // iOS gives a closed app about 30 seconds. The stream stays open for them, so something new can still raise an alert.
    func wentAway() {
        if let overview { lookout.saw(overview, onScreen: false, stamp: true) }
        lookout.scheduleCheck()
        guard lingering == .invalid else { return }
        lingering = UIApplication.shared.beginBackgroundTask(withName: "Keep listening") { [weak self] in self?.stopLingering(); self?.stop() }
    }
    func cameBack() {
        stopLingering()
        // iOS can start the app in the background before you've first unlocked the phone, when none of this can be read.
        if pairing == nil { pairing = Keychain.loadPairing() }
        if chats.isEmpty { chats = ChatStore.loadList() }
        if queue.isEmpty { queue = ChatStore.loadQueue() }
        start()
    }
    private func stopLingering() {
        guard lingering != .invalid else { return }
        UIApplication.shared.endBackgroundTask(lingering)
        lingering = .invalid
    }

    // One look when iOS allows it, which could be hours from now. Sends nothing, and queued messages wait for the app.
    func check() async {
        lookout.scheduleCheck()
        guard let pairing else { return }
        let seen: Overview? = try? await send(request(pairing, path: "/v1/overview"), using: pairing)
        lookout.checked(reached: seen != nil)
        if let seen { lookout.saw(seen, onScreen: false, stamp: true) }
    }

    // Asks for one chat's detail on the same stream. Passing nil goes back to the overview alone.
    func follow(_ id: String?) {
        #if DEBUG
        if Demo.on { following = id; chat = id.flatMap(Demo.chat); return }
        #endif
        guard following != id else { return }
        following = id
        chat = nil
        if pairing != nil { start() }
    }

    // Follows a Study notebook's tutor chat on the same stream (nil chat: a new one, not yet asked in). nil stops.
    func followTutor(_ follow: TutorFollow?) {
        guard followingTutor != follow else { return }
        followingTutor = follow
        if tutor.map({ $0.slug != follow?.slug || $0.chat != follow?.chat }) ?? false { tutor = nil }
        if pairing != nil { start() }
    }

    // Study notebooks: a read, a request, and bytes, each only to the Mac's /v1/notebook… routes.
    func study<Reply: Decodable>(_ route: String, _ query: [String: String] = [:]) async throws -> Reply {
        #if DEBUG
        if Demo.on, let data = Demo.study(route, query) { try? await Task.sleep(for: .milliseconds(300)); return try JSONDecoder().decode(Reply.self, from: data) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath(route, query)), using: pairing) }
        catch let error as DecodingError { throw error }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func studyPost<Reply: Decodable>(_ route: String, _ body: [String: Any]) async throws -> Reply {
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: Self.studyPath(route, [:]))
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: body)
        do { return try await send(ask, using: pairing) }
        catch let error as DecodingError { throw error }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    // A file, downloaded to a temporary place, with the Mac's date for it (to keep a copy by).
    func studyDownload(_ route: String, _ query: [String: String]) async throws -> (URL, String) {
        #if DEBUG
        if Demo.on, route == "notebook-pdf" { return (Demo.studyPDF(), "demo") }
        #endif
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: Self.studyPath(route, query))
        ask.timeoutInterval = 60
        let (file, response) = try await session(for: pairing).download(for: ask)
        let reply = response as? HTTPURLResponse
        guard let reply, reply.statusCode == 200 else {
            let data = (try? Data(contentsOf: file)) ?? Data()
            throw LinkError.refused((try? JSONDecoder().decode(Failure.self, from: data).error) ?? Self.oldMac)
        }
        return (file, reply.value(forHTTPHeaderField: "X-Fairy-Modified") ?? "")
    }
    func studyVoicePart(slug: String, chat: String, index: Int) async -> Data? {
        guard let pairing else { return nil }
        guard let (data, response) = try? await session(for: pairing).data(for: request(pairing, path: Self.studyPath("notebook-voice", ["slug": slug, "chat": chat, "part": String(index)]))), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
    }
    private static func studyPath(_ route: String, _ query: [String: String]) -> String {
        var parts = URLComponents()
        parts.path = "/v1/\(route)"
        if !query.isEmpty { parts.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        // A + in a query would be read as a space.
        return parts.string?.replacingOccurrences(of: "+", with: "%2B") ?? "/v1/\(route)"
    }

    private func listen(_ pairing: Pairing) async {
        var wait: UInt64 = 1, failures = 0
        while !Task.isCancelled {
            do {
                var parts = URLComponents()
                parts.queryItems = [following.map { URLQueryItem(name: "chat", value: $0) }, followingTutor.map { URLQueryItem(name: "notebook", value: $0.slug) }, followingTutor?.chat.map { URLQueryItem(name: "tutor", value: $0) }].compactMap { $0 }
                let query = parts.queryItems?.isEmpty == false ? "?\(parts.percentEncodedQuery ?? "")" : ""
                var ask = request(pairing, path: "/v1/events\(query)")
                // This limit is on silence, not on the whole stream. The Mac sends something at least every 15 seconds,
                // so this long with nothing means the connection is dead, and it's time to try a new one.
                ask.timeoutInterval = 40
                let (bytes, response) = try await session(for: pairing).bytes(for: ask)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 401 {
                    notice = LinkError.removed.errorDescription
                    await forget(tellingMac: false)
                    return
                }
                guard status == 200 else { throw URLError(.badServerResponse) }
                for try await line in bytes.lines where line.hasPrefix("data: ") {
                    let frame = try JSONDecoder().decode(LinkFrame.self, from: Data(line.dropFirst(6).utf8))
                    overview = frame.overview
                    chat = frame.chat
                    if let followed = followingTutor, let live = frame.tutor, live.slug == followed.slug, live.chat == followed.chat { tutor = live } else if followingTutor == nil { tutor = nil }
                    lookout.saw(frame.overview, onScreen: onScreen)
                    // A reply in progress isn't worth keeping. The finished one will be along.
                    if let saved = frame.chat, saved.state != "working" { ChatStore.saveChat(saved) }
                    heardAt = .now
                    if reach != .connected { Task { await refreshModels() } }
                    reach = .connected
                    wait = 1
                    failures = 0
                    // The queue's file can't be written once the phone locks, so a send now could go twice later.
                    if onScreen { await sendQueue() }
                }
                throw URLError(.networkConnectionLost)
            } catch {
                if Task.isCancelled { return }
                log.error("The stream stopped: \(String(describing: error), privacy: .public)")
                // One failure is often just the network changing, so it doesn't take you off the screen you're on.
                failures += 1
                if error is DecodingError { reach = .mismatch }
                else if failures >= 2 || overview == nil { reach = Self.tailscaleIsUp() ? .outOfReach : .tailscaleOff }
                try? await Task.sleep(nanoseconds: wait * 1_000_000_000)
                wait = min(wait * 2, 15)
            }
        }
    }

    // Saying no needs nothing more. Saying yes takes Face ID, because the Mac asks for the key behind it.
    func answer(_ approval: Approval, allow: Bool) async throws {
        try await answer(id: approval.id, allow: allow, reason: approval.isPlan ? "Approve this plan" : approval.isCalendarEvent ? "Add this event to your calendar" : "Allow this step")
    }
    // The same, from a notification's buttons, which only know the question's id.
    func answer(id: String, allow: Bool, reason: String = "Allow this step") async throws {
        guard let pairing else { throw LinkError.removed }
        var body: [String: String] = ["id": id, "decision": allow ? "allow" : "deny"]
        if allow { body["approveKey"] = try await Keychain.approveKey(reason: reason) }
        var ask = request(pairing, path: "/v1/answer")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: body)
        let _: Empty = try await send(ask, using: pairing)
    }

    // Deletes a chat on the Mac (to its Trash) and takes it off the list here straight away.
    func deleteChat(_ id: String) async throws {
        #if DEBUG
        if Demo.on { chats.removeAll { $0.id == id }; return }
        #endif
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/chat-delete")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["id": id])
        let _: Empty = try await send(ask, using: pairing)
        chats.removeAll { $0.id == id }
        ChatStore.saveList(chats)
        await refreshChats()
    }

    func refreshChats() async {
        #if DEBUG
        if Demo.on { return }
        #endif
        guard let pairing else { return }
        do {
            let list: ChatList = try await send(request(pairing, path: "/v1/chats"), using: pairing)
            chats = list.chats
            ChatStore.saveList(list.chats)
        } catch { log.error("Couldn’t list chats: \(String(describing: error), privacy: .public)") }
    }

    // Plain conversation only. The Mac takes the chat and the words, plus optional per-message provider/model/effort choice.
    func send(_ text: String, to chat: String?, voice: Bool = false, attachments: [AttachmentRef] = [], selection: ModelCatalog.Selection? = nil) async throws -> String {
        #if DEBUG
        if Demo.on { let id = Demo.begin(text, in: chat, attachments: attachments.map { Attached(name: $0.name, size: $0.size) }); try? await Task.sleep(for: .milliseconds(1200)); self.chat = Demo.chat(id); return id }
        #endif
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/send")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["text": text, "voice": voice]
        if let chat { body["chat"] = chat }
        if !attachments.isEmpty { body["attachments"] = attachments.map(\.id) }
        if let selection {
            if !selection.provider.isEmpty { body["provider"] = selection.provider }
            if !selection.model.isEmpty { body["model"] = selection.model }
            if !selection.effort.isEmpty { body["effort"] = selection.effort }
        }
        ask.httpBody = try JSONSerialization.data(withJSONObject: body)
        let reply: SentReply = try await send(ask, using: pairing)
        Task { await refreshChats() }
        return reply.chat
    }

    func refreshModels() async {
        #if DEBUG
        if Demo.on { modelCatalog = Demo.models; return }
        #endif
        guard let pairing else { return }
        if let loaded: ModelCatalog = try? await send(request(pairing, path: "/v1/models"), using: pairing) {
            modelCatalog = loaded
        }
    }

    func usage(force: Bool = false) async throws -> TokenUsageReport {
        #if DEBUG
        if Demo.on { return Demo.usageReport }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: force ? "/v1/usage?force=1" : "/v1/usage"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }

    func runBrief(kind: String = "brief") async throws -> BriefRunResult {
        #if DEBUG
        if Demo.on { return BriefRunResult(said: true, unchanged: false, pushed: 1, thread: "c0") }
        #endif
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/brief-run")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.timeoutInterval = 120
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["kind": kind])
        return try await send(ask, using: pairing)
    }

    // MARK: - Goals
    func goals() async throws -> GoalList {
        #if DEBUG
        if Demo.on { return Demo.goals }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/goals"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func goalDetail(_ id: String) async throws -> GoalDetail {
        #if DEBUG
        if Demo.on { return Demo.goalDetail(id) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath("goal", ["id": id])), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func goalAction(id: String, action: String, reason: String? = nil) async throws {
        #if DEBUG
        if Demo.on { return }
        #endif
        guard let pairing else { throw LinkError.removed }
        var payload: [String: Any] = ["id": id, "action": action]
        if let reason, !reason.isEmpty { payload["reason"] = reason }
        if action == "continue" { payload["approveKey"] = try await Keychain.approveKey(reason: "Start \(id)’s next step on your Mac") }
        var ask = request(pairing, path: "/v1/goal-action")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let _: Empty = try await send(ask, using: pairing)
    }

    // MARK: - Research
    func researchHome() async throws -> ResearchHome {
        #if DEBUG
        if Demo.on { return Demo.researchHome }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/research"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func researchDetail(_ slug: String) async throws -> ResearchDetail {
        #if DEBUG
        if Demo.on { return Demo.researchDetail(slug) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath("research-detail", ["slug": slug])), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }

    // MARK: - Neutrino
    func neutrinoInbox() async throws -> NeutrinoInbox {
        #if DEBUG
        if Demo.on { return Demo.neutrinoInbox }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/neutrino"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func neutrinoPR(repo: String, number: Int) async throws -> NeutrinoPRDetail {
        #if DEBUG
        if Demo.on { return Demo.neutrinoPR(repo: repo, number: number) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath("neutrino-pr", ["repo": repo, "number": String(number)])), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func neutrinoAction(action: String, repo: String, number: Int? = nil, job: Int? = nil, run: Int? = nil, strategy: String = "merge", text: String? = nil, approve: Bool = true) async throws {
        #if DEBUG
        if Demo.on { return }
        #endif
        guard let pairing else { throw LinkError.removed }
        var body: [String: Any] = ["action": action, "repo": repo, "strategy": strategy, "approve": approve]
        if let number { body["number"] = number }
        if let job { body["job"] = job }
        if let run { body["run"] = run }
        if let text, !text.isEmpty { body["text"] = text }
        if action == "merge" || action == "approve-job" {
            body["approveKey"] = try await Keychain.approveKey(reason: action == "merge" ? "Merge \(repo)#\(number ?? 0)" : "Approve deploy on \(repo)")
        }
        var ask = request(pairing, path: "/v1/neutrino-action")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: body)
        let _: Empty = try await send(ask, using: pairing)
    }

    // MARK: - Analytics & Boards
    func analyticsOverview() async throws -> AnalyticsOverview {
        #if DEBUG
        if Demo.on { return Demo.analyticsOverview }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/analytics"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func analyticsRun(_ id: String) async throws -> AnalyticsRunDetail {
        #if DEBUG
        if Demo.on { return Demo.analyticsRun(id) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath("analytics-run", ["id": id])), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func boardsList() async throws -> BoardList {
        #if DEBUG
        if Demo.on { return Demo.boardsList }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/boards"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func boardDetail(_ id: String) async throws -> BoardDetail {
        #if DEBUG
        if Demo.on { return Demo.boardDetail(id) }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: Self.studyPath("board", ["id": id])), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }

    // Your week for the dashboard in Make: the Mac's calendar and inbox count. force skips the Mac's five-minute cache.
    func week(force: Bool = false) async throws -> WeekData {
        #if DEBUG
        if Demo.on { try? await Task.sleep(for: .milliseconds(900)); return Demo.week }
        #endif
        guard let pairing else { throw LinkError.removed }
        return try await send(request(pairing, path: force ? "/v1/week?force=1" : "/v1/week"), using: pairing)
    }

    // A file or folder from this phone, sent to the Mac ahead of the message it goes with; Fairy then reads it there. A
    // folder is zipped by iOS first, as the Files app does to share one, and the Mac unpacks it.
    func attach(_ url: URL) async throws -> AttachmentRef {
        let reading = url.startAccessingSecurityScopedResource()
        defer { if reading { url.stopAccessingSecurityScopedResource() } }
        let folder = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        let data = folder ? try Self.zipped(url) : try Data(contentsOf: url)
        return try await attach(data: data, name: url.lastPathComponent, folder: folder)
    }
    func attach(data: Data, name: String, folder: Bool = false) async throws -> AttachmentRef {
        let limit = folder ? 50 : 20
        guard data.count <= limit * 1024 * 1024 else { throw LinkError.refused("\(name) is over \(limit) MB\(folder ? " zipped" : ""), which is as big as \(folder ? "an attached folder" : "an attached file") can be.") }
        #if DEBUG
        if Demo.on { try? await Task.sleep(for: .milliseconds(700)); return AttachmentRef(id: UUID().uuidString.lowercased(), name: name, size: data.count, folder: folder) }
        #endif
        guard let pairing else { throw LinkError.removed }
        var path = URLComponents()
        path.path = "/v1/attach"
        path.queryItems = [URLQueryItem(name: "name", value: name)] + (folder ? [URLQueryItem(name: "folder", value: "1")] : [])
        var ask = request(pairing, path: path.string ?? "/v1/attach")
        ask.httpMethod = "POST"
        ask.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        ask.timeoutInterval = 180
        ask.httpBody = data
        return try await send(ask, using: pairing)
    }
    private static func zipped(_ folder: URL) throws -> Data {
        var made: Result<Data, Error> = .failure(LinkError.refused("That folder couldn’t be read."))
        var problem: NSError?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: .forUploading, error: &problem) { zip in made = Result { try Data(contentsOf: zip) } }
        if let problem { throw problem }
        return try made.get()
    }

    // Gives the Mac this phone's push token and its key for sealing pushes, over this pinned link only.
    private(set) var pushRegistered = UserDefaults.standard.bool(forKey: "pushRegistered")
    func registerPush(token: String) async {
        guard let pairing else { return }
        do {
            let key = try PushSecret.loadOrMake()
            var ask = request(pairing, path: "/v1/push")
            ask.httpMethod = "POST"
            ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
            ask.httpBody = try JSONSerialization.data(withJSONObject: ["token": token, "environment": PushEnvironment.current, "key": PushSecret.base64(key)])
            let _: Empty = try await send(ask, using: pairing)
            pushRegistered = true
            UserDefaults.standard.set(true, forKey: "pushRegistered")
        } catch { log.error("Couldn’t register for pushes: \(String(describing: error), privacy: .public)") }
    }

    // Tells the Mac the phone is listening for you, so its own wake word stays quiet. Nothing is lost if it fails: the Mac
    // only goes on listening as it would have anyway.
    func setListening(_ on: Bool) async {
        guard let pairing else { return }
        var ask = request(pairing, path: "/v1/listening")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try? JSONSerialization.data(withJSONObject: ["on": on])
        let _: Empty? = try? await send(ask, using: pairing)
    }

    // Home's thread: briefs, check-ins and quick requests. The Mac makes it the first time it's asked for.
    func ensureThread() async throws -> String {
        #if DEBUG
        if Demo.on { return "c0" }
        #endif
        if let known = overview?.thread { remember(thread: known); return known }
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/thread")
        ask.httpMethod = "POST"
        struct Thread: Decodable { var id: String }
        let thread: Thread = try await send(ask, using: pairing)
        remember(thread: thread.id)
        return thread.id
    }
    private func remember(thread id: String) { UserDefaults.standard.set(id, forKey: "homeThread") }

    // Only you mark a task done; this is where you do it from the phone.
    func markDone(_ id: String, done: Bool = true) async throws {
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/task-done")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "done": done])
        let _: Empty = try await send(ask, using: pairing)
    }

    // Ticks off something you told Fairy you'd do (Your week).
    func promiseDone(_ id: String, done: Bool = true) async throws {
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/promise-done")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "done": done])
        let _: Empty = try await send(ask, using: pairing)
    }

    // Starts a task on the Mac, in a folder you've worked in, after Face ID. Every step it takes still asks.
    func startWork(in folder: WorkFolder, prompt: String) async throws -> String {
        guard let pairing else { throw LinkError.removed }
        let key = try await Keychain.approveKey(reason: "Start this task on your Mac")
        var ask = request(pairing, path: "/v1/work")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["folder": folder.path, "prompt": prompt, "approveKey": key])
        let started: SentReply = try await send(ask, using: pairing)
        return started.chat
    }

    // One chat as it stands, for Siri, which waits on an answer without the stream.
    func chatDetail(_ id: String) async throws -> SessionDetail {
        guard let pairing else { throw LinkError.removed }
        return try await send(request(pairing, path: "/v1/chat?id=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"), using: pairing)
    }

    func stop(_ chat: String) async throws {
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/stop")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ask.httpBody = try JSONSerialization.data(withJSONObject: ["chat": chat])
        let _: Empty = try await send(ask, using: pairing)
    }

    func sendA2UIData(chat: String, messageAt: String?, surfaceId: String, path: String, value: A2UIValue) async {
        guard let pairing, !chat.isEmpty else { return }
        var ask = request(pairing, path: "/v1/a2ui-data")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["chat": chat, "surfaceId": surfaceId, "path": path, "value": value.toJSONObject()]
        if let messageAt, !messageAt.isEmpty { body["messageAt"] = messageAt }
        ask.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let _: Empty? = try? await send(ask, using: pairing)
    }

    func sendA2UIAction(chat: String?, surfaceId: String, title: String?, actionName: String, sourceComponentId: String, context: [String: A2UIValue]) async throws -> String {
        guard let pairing else { throw LinkError.removed }
        var ask = request(pairing, path: "/v1/a2ui-action")
        ask.httpMethod = "POST"
        ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "surfaceId": surfaceId,
            "actionName": actionName,
            "sourceComponentId": sourceComponentId,
            "context": context.mapValues { $0.toJSONObject() },
        ]
        if let chat, !chat.isEmpty { body["chat"] = chat }
        if let title, !title.isEmpty { body["title"] = title }
        ask.httpBody = try JSONSerialization.data(withJSONObject: body)
        let reply: SentReply = try await send(ask, using: pairing)
        Task { await refreshChats() }
        return reply.chat
    }

    // One clip of a spoken reply, or nothing if it isn't ready.
    func voicePart(_ chat: String, _ index: Int) async -> Data? {
        guard let pairing, let name = chat.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        guard let (data, response) = try? await session(for: pairing).data(for: request(pairing, path: "/v1/voice?chat=\(name)&part=\(index)")), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
    }

    // Pages and memory are read from the Mac each time and not kept here. Returns what went wrong, if anything did.
    @discardableResult func refreshPages() async -> String? {
        #if DEBUG
        if Demo.on { return nil }
        #endif
        guard let pairing else { return nil }
        do {
            let list: PageList = try await send(request(pairing, path: "/v1/pages"), using: pairing)
            pages = list.pages
            return nil
        } catch { return pages.isEmpty ? Self.words(for: error) : nil }
    }
    func memory() async throws -> MemoryBook {
        #if DEBUG
        if Demo.on { return Demo.memory }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/memory"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func about() async -> AboutMac? {
        #if DEBUG
        if Demo.on { return Demo.about }
        #endif
        guard let pairing else { return nil }
        return try? await send(request(pairing, path: "/v1/about"), using: pairing)
    }
    // The experiment tracker, read only (RunsView.swift): the projects with runs, and one project's runs.
    func runsProjects() async throws -> RunsProjects {
        #if DEBUG
        if Demo.on { return Demo.runsProjects }
        #endif
        guard let pairing else { throw LinkError.removed }
        do { return try await send(request(pairing, path: "/v1/runs"), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    func runsList(_ folder: String) async throws -> RunsPage {
        #if DEBUG
        if Demo.on { return Demo.runsPage(folder) }
        #endif
        guard let pairing else { throw LinkError.removed }
        var parts = URLComponents()
        parts.path = "/v1/runs-list"
        parts.queryItems = [URLQueryItem(name: "folder", value: folder)]
        let path = parts.string?.replacingOccurrences(of: "+", with: "%2B") ?? "/v1/runs-list"
        do { return try await send(request(pairing, path: path), using: pairing) }
        catch { throw LinkError.refused(Self.words(for: error)) }
    }
    // One file of one version. Only the page's web view asks for these, and it only asks within its own folder.
    func pageFile(page: String, seq: Int, path: String, range: String?) async throws -> (Data, HTTPURLResponse) {
        guard let pairing else { throw LinkError.removed }
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "id", value: page), URLQueryItem(name: "seq", value: String(seq)), URLQueryItem(name: "path", value: path)]
        var ask = request(pairing, path: "/v1/page-file?\(parts.percentEncodedQuery ?? "")")
        if let range { ask.setValue(range, forHTTPHeaderField: "Range") }
        do {
            let (data, response) = try await session(for: pairing).data(for: ask)
            guard let reply = response as? HTTPURLResponse, let address = ask.url else { throw URLError(.badServerResponse) }
            guard (200..<300).contains(reply.statusCode) else { throw LinkError.refused((try? JSONDecoder().decode(Failure.self, from: data).error) ?? Self.oldMac) }
            // The web view sees the page's own address, its type and its policy, and none of the link's details.
            var headers = ["Content-Type", "Content-Security-Policy", "Content-Range", "Accept-Ranges", "Content-Length", "X-Fairy-Needs-Internet"].reduce(into: [String: String]()) { kept, name in
                if let value = reply.value(forHTTPHeaderField: name) { kept[name] = value }
            }
            headers["Cache-Control"] = "no-store"
            return (data, HTTPURLResponse(url: address, statusCode: reply.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) ?? reply)
        } catch { throw LinkError.refused(Self.words(for: error)) }
    }
    private static let oldMac = "Baryon on your Mac needs updating to show this."
    // A Mac on an older Fairy doesn't have these routes yet, and shouldn't read as if something's broken.
    private static func words(for error: Error) -> String {
        if case LinkError.refused(let words) = error { return words == "Not found." ? oldMac : words }
        return "Can’t reach your Mac right now."
    }

    func queueMessage(_ text: String, to chat: String?) {
        queue.append(QueuedMessage(chat: chat, text: text))
        ChatStore.saveQueue(queue)
    }

    // Sends what was left for later, oldest first. The Mac takes one reply at a time, so anything it can't take yet
    // stays queued for the next update. A message it refuses outright is dropped, with a note saying so.
    private func sendQueue() async {
        guard !flushing, let next = queue.first else { return }
        flushing = true
        defer { flushing = false }
        do {
            _ = try await send(next.text, to: next.chat)
            queue.removeAll { $0.id == next.id }
            ChatStore.saveQueue(queue)
        } catch LinkError.refused(let words) where !words.contains("still replying") && !words.contains("busy") {
            queue.removeAll { $0.id == next.id }
            ChatStore.saveQueue(queue)
            notice = "A message you left couldn’t be sent: \(words)"
        } catch { log.error("A queued message is still waiting: \(String(describing: error), privacy: .public)") }
    }

    private struct Empty: Decodable {}
    private struct Failure: Decodable { var error: String }
    private func send<Reply: Decodable>(_ ask: URLRequest, using pairing: Pairing) async throws -> Reply {
        let (data, response) = try await session(for: pairing).data(for: ask)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw LinkError.refused((try? JSONDecoder().decode(Failure.self, from: data).error) ?? "The Mac said no (\(status)).") }
        return try JSONDecoder().decode(Reply.self, from: data)
    }
}

#if DEBUG
// Debug builds launched with -FairyDemo show made-up chats, work and pages, with no Mac, so every screen can be seen and
// photographed in the Simulator. Never in a release build.
extension LinkClient {
    func loadDemo() {
        pairing = Pairing(host: "home-mac.tail0000.ts.net", port: 47616, pin: "", readKey: "")
        reach = .connected
        overview = Demo.overview
        chats = Demo.chats
        pages = Demo.pages
        modelCatalog = Demo.models
        heardAt = .now
    }
}
#endif
