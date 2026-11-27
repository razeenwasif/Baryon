import SwiftUI
import WebKit

private let pageScheme = "fairy-artifact"

extension PageItem {
    var kindName: String {
        switch kind {
        case "doc": "Document"
        case "slides": "Slides"
        case "dashboard": "Dashboard"
        case "canvas": "Canvas"
        case "whiteboard": "Whiteboard"
        case "sheet": "Sheet"
        case "a2ui": "Interactive UI"
        default: "Page"
        }
    }
    var subtitle: String { "\(kindName) · version \(versions.last?.seq ?? 1)" }
    // The same marks the Mac's Pages buttons use.
    var symbol: String {
        switch kind {
        case "doc", "document": "doc.text"
        case "slides": "rectangle.on.rectangle.angled"
        case "dashboard": "chart.bar.xaxis"
        case "canvas", "design": "paintpalette"
        case "whiteboard": "scribble.variable"
        case "sheet": "tablecells"
        case "a2ui": "rectangle.3.group"
        default: "doc.richtext"
        }
    }
    // A colour of its own for each kind, so a list of them reads at a glance.
    var tint: Color {
        switch kind {
        case "slides": Color(hex: 0xF2B66D)
        case "dashboard": Color(hex: 0x7FD3C4)
        case "canvas", "design": Color(hex: 0xE59BD6)
        case "whiteboard": Color(hex: 0xB9A6FF)
        case "sheet": Color(hex: 0x8FE0A6)
        case "a2ui": Color(hex: 0x7BA4FF)
        default: Color(hex: 0xA9C4FF)
        }
    }
}

// The card for a page in a chat, or a row in the list of them.
struct PageCard: View {
    let page: PageItem
    var body: some View {
        NavigationLink { PageView(page: page) } label: {
            HStack(spacing: 12) {
                Image(systemName: page.symbol)
                    .font(.system(size: 24, weight: .light))
                    .foregroundStyle(page.tint)
                    .frame(width: 56, height: 56)
                    .background(LinearGradient(colors: [page.tint.opacity(0.26), page.tint.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(page.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(2).multilineTextAlignment(.leading)
                    Text(page.subtitle).font(.footnote).foregroundStyle(Color.muted)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.dim).accessibilityHidden(true)
            }
            .padding(10)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct PagesView: View {
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var problem: String?

    private var found: [PageItem] {
        let term = search.trimmingCharacters(in: .whitespaces)
        return term.isEmpty ? link.pages : link.pages.filter { $0.title.localizedCaseInsensitiveContains(term) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.muted).accessibilityHidden(true)
                    TextField("Search pages", text: $search).foregroundStyle(Color.ink).autocorrectionDisabled()
                }
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(Color.raised, in: Capsule())
                .padding(.bottom, 6)
                ForEach(found) { PageCard(page: $0) }
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                else if found.isEmpty {
                    Text(search.isEmpty ? "Pages Fairy makes will show up here." : "No pages match that.").font(.subheadline).foregroundStyle(Color.dim).frame(maxWidth: .infinity).padding(.top, 24)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.45)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: "Pages", back: "Back", glass: false) { dismiss() } }
        .task { problem = await link.refreshPages() }
        .refreshable { problem = await link.refreshPages() }
    }
}

// A6. The page runs in a web view with no way back into the app and no way out to the internet.
struct PageView: View {
    let page: PageItem
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var seq: Int?
    @State private var concept: String?
    @State private var problem: String?
    @State private var needsInternet = false
    @State private var attempt = 0
    @State private var loading = true
    @State private var a2uiSurface: A2UISurface?

    private var version: PageItem.Version? { page.versions.first { $0.seq == seq } ?? page.versions.last }
    private var file: String? {
        guard let version else { return nil }
        return concept.flatMap { name in version.concepts.first { $0.name == name }?.file } ?? version.concepts.first?.file ?? version.file
    }

    var body: some View {
        VStack(spacing: 8) {
            if !page.opens {
                closed("This dashboard opens on your Mac", "It reads from your Mac, and a phone can’t give it that.")
            } else if let problem {
                closed(problem, nil, retry: true)
            } else if page.kind == "a2ui", let version {
                Group {
                    if let a2uiSurface {
                        ScrollView {
                            A2UISurfaceView(surface: a2uiSurface, onAction: { _, actionName, sourceComponentId, context in
                                do {
                                    _ = try await link.sendA2UIAction(
                                        chat: page.session,
                                        surfaceId: a2uiSurface.surfaceId,
                                        title: a2uiSurface.title ?? page.title,
                                        actionName: actionName,
                                        sourceComponentId: sourceComponentId,
                                        context: context
                                    )
                                } catch {
                                    problem = error.localizedDescription
                                }
                            })
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                        }
                        .scrollEdgeEffectHidden(true, for: .all)
                    } else {
                        ZStack {
                            Color(hex: 0x1C1D20)
                            EyeView(mood: .thinking, size: 96).accessibilityLabel("Opening the page")
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                        .padding(.horizontal, 12)
                    }
                }
                .task(id: "\(page.id)/\(version.seq)/\(attempt)") {
                    loading = true
                    a2uiSurface = nil
                    problem = nil
                    do {
                        let (data, _) = try await link.pageFile(page: page.id, seq: version.seq, path: "surface.json", range: nil)
                        a2uiSurface = try JSONDecoder().decode(A2UISurface.self, from: data)
                        loading = false
                    } catch {
                        problem = error.localizedDescription
                        loading = false
                    }
                }
            } else if let version, let file {
                LockedPage(link: link, page: page.id, seq: version.seq, file: file, needsInternet: $needsInternet, problem: $problem, loading: $loading)
                    .id("\(version.seq)/\(file)/\(attempt)")
                    .overlay {
                        if loading {
                            ZStack {
                                Color(hex: 0x1C1D20)
                                EyeView(mood: .thinking, size: 96).accessibilityLabel("Opening the page")
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 22))
                    .padding(.horizontal, 12)
            }
            VStack(spacing: 8) {
                if needsInternet {
                    Text("This page uses a script from the internet, which is blocked here. Open it on your Mac to see all of it.").font(.footnote).foregroundStyle(Color.asking).multilineTextAlignment(.center)
                }
                if page.opens && problem == nil {
                    Text(page.kind == "a2ui" ? "Rendered natively as an interactive UI with no remote scripts." : "Runs on its own, with no access to Fairy, other pages or your files.")
                        .font(.caption).foregroundStyle(Color.muted).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 20)
            if let concepts = version?.concepts, concepts.count > 1 {
                switcher(concepts.map(\.name), selected: concept ?? concepts[0].name, label: "Concepts") { concept = $0 }
            }
            if page.versions.count > 1 {
                switcher(page.versions.map { "Version \($0.seq)" }, selected: "Version \(version?.seq ?? 0)", label: "Versions") { name in
                    seq = page.versions.first { "Version \($0.seq)" == name }?.seq
                    concept = nil
                }
            }
        }
        .padding(.bottom, 8)
        .onWallpaper(0.3)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: page.title, back: "Back", glass: false) { dismiss() } }
        .onChange(of: seq) { reset() }
        .onChange(of: concept) { reset() }
    }

    private func reset() {
        needsInternet = false
        problem = nil
        loading = true
        a2uiSurface = nil
    }

    private func closed(_ title: String, _ detail: String?, retry: Bool = false) -> some View {
        VStack(spacing: 10) {
            Spacer()
            EyeView(mood: retry ? .sleeping : .idle, size: 120)
            Text(title).font(.body).foregroundStyle(Color.ink).multilineTextAlignment(.center)
            if let detail { Text(detail).font(.subheadline).foregroundStyle(Color.dim).multilineTextAlignment(.center) }
            if retry { Button("Try again") { reset(); attempt += 1 }.buttonStyle(PillButton()).frame(maxWidth: 180) }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
    }

    private func switcher(_ names: [String], selected: String, label: String, choose: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(names, id: \.self) { name in
                    Button(name) { choose(name) }
                        .font(.subheadline)
                        .foregroundStyle(Color.ink)
                        .padding(.horizontal, 16)
                        .frame(height: 38)
                        .background(name == selected ? Color.white.opacity(0.14) : .clear, in: Capsule())
                        .accessibilityAddTraits(name == selected ? .isSelected : [])
                }
            }
            .padding(3)
            .background(Color.tool, in: Capsule())
            .padding(.horizontal, 12)
        }
        .accessibilityLabel(label)
    }
}

// Every part of this stays closed unless a page needs it to draw itself. There are no message handlers, so nothing a
// page runs can call the app, and it never sees the phone's key: this file fetches for it, and only from its own folder.
struct LockedPage: UIViewRepresentable {
    let link: LinkClient
    let page: String
    let seq: Int
    let file: String
    @Binding var needsInternet: Bool
    @Binding var problem: String?
    @Binding var loading: Bool

    func makeCoordinator() -> Guard { Guard(link: link, page: page, seq: seq, report: { needs in needsInternet = needs }, fail: { words in problem = words }, done: { loading = false }) }

    func makeUIView(context: Context) -> WKWebView {
        let view = Self.lockedWebView(guard: context.coordinator)
        context.coordinator.open(file: file, in: view)
        return view
    }
    // A web view a page can show itself in and do nothing else (see the rules below). Also used for Make's previews.
    static func lockedWebView(guard coordinator: Guard) -> WKWebView {
        let setup = WKWebViewConfiguration()
        setup.websiteDataStore = .nonPersistent()
        setup.setURLSchemeHandler(coordinator, forURLScheme: pageScheme)
        setup.defaultWebpagePreferences.allowsContentJavaScript = true
        setup.preferences.javaScriptCanOpenWindowsAutomatically = false
        setup.allowsAirPlayForMediaPlayback = false
        setup.allowsPictureInPictureMediaPlayback = false
        setup.mediaTypesRequiringUserActionForPlayback = .all
        setup.dataDetectorTypes = []
        setup.userContentController.addUserScript(WKUserScript(source: Self.nothingToReachFor, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let view = WKWebView(frame: .zero, configuration: setup)
        // White, as in any browser, so a page that sets no background of its own can still be read.
        view.backgroundColor = .white
        view.scrollView.backgroundColor = .white
        view.allowsLinkPreview = false
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Guard) {
        coordinator.close()
        view.stopLoading()
    }

    // Gone before a page's first line runs. Peer connections would get past the page's policy and the rules below, and
    // just asking for the camera, the microphone or your location makes iOS put up a question in Fairy's name.
    private static let nothingToReachFor = """
    for (const [place, names] of [
      [window, ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription', 'WebTransport', 'SpeechRecognition', 'webkitSpeechRecognition', 'ApplePaySession', 'PaymentRequest', 'Notification', 'DeviceMotionEvent', 'DeviceOrientationEvent', 'ServiceWorker', 'ServiceWorkerContainer']],
      [Navigator.prototype, ['mediaDevices', 'getUserMedia', 'webkitGetUserMedia', 'geolocation', 'share', 'canShare', 'clipboard', 'credentials', 'serviceWorker', 'sendBeacon']],
    ]) {
      for (const name of names) {
        try { Object.defineProperty(place, name, { value: undefined, configurable: false, writable: false }); } catch {}
      }
    }
    """

    // Blocked in WebKit itself as well as by the page's policy, so a mistake in one leaves the other standing.
    private static let noInternet = #"""
    [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^ftp://"},"action":{"type":"block"}}]
    """#

    @MainActor
    final class Guard: NSObject, WKURLSchemeHandler, WKNavigationDelegate, WKUIDelegate {
        private let link: LinkClient
        private let page: String
        private let seq: Int
        private let report: (Bool) -> Void
        private let fail: (String) -> Void
        private let done: () -> Void
        private var entry: String?
        private var running: [ObjectIdentifier: Task<Void, Never>] = [:]

        init(link: LinkClient, page: String, seq: Int, report: @escaping (Bool) -> Void, fail: @escaping (String) -> Void, done: @escaping () -> Void) {
            (self.link, self.page, self.seq, self.report, self.fail, self.done) = (link, page, seq, report, fail, done)
        }

        private var folder: String {
            let safe = page.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? page
            return "\(pageScheme)://page/\(safe)/\(seq)/"
        }

        // Nothing loads until the block on the internet is in place. If it can't be, the page doesn't open.
        func open(file: String, in view: WKWebView) {
            let name = file.split(separator: "/").map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
            guard let url = URL(string: folder + name) else { return fail("That page’s address isn’t one this app can open.") }
            entry = url.absoluteString
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "fairy-no-internet", encodedContentRuleList: LockedPage.noInternet) { [weak self, weak view] rules, _ in
                guard let self, let view else { return }
                guard let rules else { return self.fail("This iPhone couldn’t lock this page down, so it hasn’t opened it.") }
                view.configuration.userContentController.add(rules)
                view.load(URLRequest(url: url))
            }
        }

        func close() {
            for task in running.values { task.cancel() }
            running = [:]
        }

        func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
            let id = ObjectIdentifier(task)
            let address = task.request.url
            let range = task.request.value(forHTTPHeaderField: "Range")
            // Only this page's own version. Anything else gets nothing, even if a page gets past its policy.
            let path = address?.path(percentEncoded: false).split(separator: "/").dropFirst(2).joined(separator: "/") ?? ""
            guard task.request.httpMethod ?? "GET" == "GET", let address, address.absoluteString.hasPrefix(folder), !path.isEmpty else {
                task.didFailWithError(URLError(.noPermissionsToReadFile))
                return
            }
            let isEntry = address.absoluteString == entry
            running[id] = Task { [weak self] in
                guard let self else { return }
                do {
                    let (data, response) = try await self.link.pageFile(page: self.page, seq: self.seq, path: path, range: range)
                    guard self.running[id] != nil else { return }
                    if isEntry { self.report(response.value(forHTTPHeaderField: "X-Fairy-Needs-Internet") != nil) }
                    task.didReceive(response)
                    task.didReceive(data)
                    task.didFinish()
                } catch {
                    guard self.running[id] != nil else { return }
                    if isEntry { self.fail(error.localizedDescription) }
                    task.didFailWithError(error)
                }
                self.running[id] = nil
            }
        }
        // WebKit says the task is over, and using it after this would stop the app.
        func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
            running.removeValue(forKey: ObjectIdentifier(task))?.cancel()
        }

        // A page can move around inside its own folder, and go nowhere else.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            action.request.url?.absoluteString.hasPrefix(folder) == true ? .allow : .cancel
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done() }
        // No new windows.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
        // The app can use the camera and microphone. A page can't borrow them.
        func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision { .deny }
        func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo) async -> WKPermissionDecision { .deny }
    }
}
