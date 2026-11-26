import SwiftUI
import UIKit
import WebKit

// A tutor's answer, a note or anything made, as the Mac drew it (Markdown and KaTeX, desktop/notebook/phone-html.mjs):
// shown in a web view that runs none of the page's script, loads nothing from anywhere, and follows no link but a
// citation (opened here), an animation (played in its own sandbox) or a plain web address (opened in Safari).
struct RichHTML: UIViewRepresentable {
    let html: String
    var citations: [Citation] = []
    var animations: [TutorAnimation] = []
    var onCite: (Citation) -> Void = { _ in }
    var onAnimation: (TutorAnimation) -> Void = { _ in }
    // Sized to its words inside a list; or a page of its own that scrolls.
    @Binding var height: CGFloat
    var scrolls = false
    var size: CGFloat = 16

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let setup = WKWebViewConfiguration()
        setup.websiteDataStore = .nonPersistent()
        // The Mac's HTML has no script of its own to run; what measures its height is the app's, not the page's.
        setup.defaultWebpagePreferences.allowsContentJavaScript = false
        setup.preferences.javaScriptCanOpenWindowsAutomatically = false
        setup.dataDetectorTypes = []
        setup.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: setup)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = scrolls
        view.scrollView.contentInsetAdjustmentBehavior = scrolls ? .automatic : .never
        view.allowsLinkPreview = false
        view.navigationDelegate = context.coordinator
        context.coordinator.view = view
        context.coordinator.show(html)
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.show(html)
    }

    static func page(_ body: String, size: CGFloat) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
        <style>\(katex)</style><style>\(style(size))</style></head><body><main id="words">\(body)</main></body></html>
        """
    }
    static func style(_ size: CGFloat) -> String {
        """
        :root{color-scheme:dark}
        html,body{margin:0;padding:0;background:transparent;overflow-x:hidden}
        body{color:#E8E9EE;font-family:-apple-system,system-ui,sans-serif;font-size:\(Int(size))px;line-height:1.5;-webkit-text-size-adjust:100%;overflow-wrap:break-word}
        main>:first-child{margin-top:0} main>:last-child{margin-bottom:0}
        p{margin:0 0 .7em} ul,ol{margin:0 0 .7em;padding-left:1.4em} li{margin:.15em 0}
        h1{font-size:1.4em;font-weight:600;margin:.8em 0 .4em} h2{font-size:1.2em;font-weight:600;margin:.9em 0 .4em} h3,h4{font-size:1.05em;font-weight:600;margin:.8em 0 .3em}
        a{color:#A9C4FF}
        a.cite{display:inline-block;min-width:1.25em;padding:0 .35em;margin:0 .12em;border-radius:.65em;background:#A9C4FF;color:#0B1030;font-size:.72em;font-weight:700;line-height:1.55;text-align:center;text-decoration:none;vertical-align:.18em}
        .cite.missing{font-size:.75em;color:#FFB4BD}
        a.anim{display:flex;gap:.6em;align-items:center;padding:.85em 1em;margin:.6em 0;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E8E9EE;text-decoration:none;font-weight:500}
        a.anim .play{color:#A9C4FF}
        .making{color:#A2A4AD;font-style:italic;margin:.5em 0}
        pre{overflow-x:auto;background:rgba(0,0,0,.4);padding:.7em .8em;border-radius:10px;font-size:.84em;line-height:1.4}
        code{font-family:ui-monospace,Menlo,monospace;font-size:.9em} p code,li code{background:rgba(255,255,255,.08);padding:.05em .3em;border-radius:5px}
        table{border-collapse:collapse;display:block;overflow-x:auto;margin:.5em 0;font-size:.92em} td,th{border:1px solid rgba(255,255,255,.16);padding:.35em .55em;vertical-align:top}
        blockquote{margin:.6em 0;padding-left:.8em;border-left:2px solid rgba(255,255,255,.22);color:#B9BBC4}
        hr{border:0;border-top:1px solid rgba(255,255,255,.12);margin:1em 0}
        .math{overflow-x:auto;overflow-y:hidden;padding:.15em 0} .katex-display{margin:.35em 0;overflow-x:auto;overflow-y:hidden} .katex{font-size:1.08em}
        .image{color:#A2A4AD;font-style:italic}
        """
    }
    // KaTeX's stylesheet with its fonts inside (scripts/ios-katex.mjs), read once.
    static let katex: String = {
        guard let url = Bundle.main.url(forResource: "katex-inline", withExtension: "css"), let css = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return css
    }()

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: RichHTML
        weak var view: WKWebView?
        private var shown: String?
        private var loaded = false
        init(_ parent: RichHTML) { self.parent = parent }

        // The first time, the page; after that only its words change, so a streaming answer doesn't flash.
        func show(_ html: String) {
            guard html != shown, let view else { return }
            shown = html
            if !loaded { view.loadHTMLString(RichHTML.page(html, size: parent.size), baseURL: nil); return }
            guard let data = try? JSONEncoder().encode([html]), let list = String(data: data, encoding: .utf8) else { return }
            view.evaluateJavaScript("document.getElementById('words').innerHTML = \(list)[0]; document.documentElement.scrollHeight") { [weak self] value, _ in
                if let height = value as? Double { self?.report(height) }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            if let html = shown, html != parent.html { shown = nil; show(parent.html) }
            measure()
            // Fonts can land after the first measure.
            Task { try? await Task.sleep(for: .milliseconds(250)); measure() }
        }
        private func measure() {
            view?.evaluateJavaScript("document.documentElement.scrollHeight") { [weak self] value, _ in if let height = value as? Double { self?.report(height) } }
        }
        private func report(_ height: Double) {
            let value = CGFloat(ceil(height))
            if abs(parent.height - value) > 1 { parent.height = value }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            if url.scheme == "about" || (url.scheme == nil && action.navigationType == .other) { return .allow }
            if action.navigationType == .other && !loaded { return .allow }
            switch url.scheme {
            case "fairy-cite":
                if let n = Int(url.absoluteString.dropFirst("fairy-cite:".count)), let cite = parent.citations.first(where: { $0.n == n }) { parent.onCite(cite) }
            case "fairy-anim":
                if let n = Int(url.absoluteString.dropFirst("fairy-anim:".count)), n >= 1, n <= parent.animations.count { parent.onAnimation(parent.animations[n - 1]) }
            case "https":
                await UIApplication.shared.open(url)
            default: break
            }
            return .cancel
        }
    }
}

// A web view sized to what it shows, for answers in a list.
struct SizedHTML: View {
    let html: String
    var citations: [Citation] = []
    var animations: [TutorAnimation] = []
    var onCite: (Citation) -> Void = { _ in }
    var onAnimation: (TutorAnimation) -> Void = { _ in }
    var size: CGFloat = 16
    @State private var height: CGFloat = 24

    var body: some View {
        RichHTML(html: html, citations: citations, animations: animations, onCite: onCite, onAnimation: onAnimation, height: $height, size: size)
            .frame(height: height)
            .frame(maxWidth: .infinity)
    }
}

// One of the tutor's animations, in a sandbox of its own: its script runs, and nothing it does can reach anything.
struct AnimationPlayer: View {
    let animation: TutorAnimation
    @Environment(\.dismiss) private var dismiss
    @State private var round = 0

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text(animation.title).font(.headline).foregroundStyle(Color.ink).lineLimit(2)
                Spacer()
                Button("Done") { dismiss() }.foregroundStyle(Color.ink)
            }
            SandboxedAnimation(code: animation.code).id(round)
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 16))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            Button { round += 1 } label: { Label("Replay", systemImage: "arrow.counterclockwise") }
                .buttonStyle(PillButton())
            Spacer()
        }
        .padding(20)
        .presentationBackground { Wallpaper(still: true) }
    }
}

private struct SandboxedAnimation: UIViewRepresentable {
    let code: String
    func makeCoordinator() -> Blocker { Blocker() }
    func makeUIView(context: Context) -> WKWebView {
        let setup = WKWebViewConfiguration()
        setup.websiteDataStore = .nonPersistent()
        setup.defaultWebpagePreferences.allowsContentJavaScript = true
        setup.preferences.javaScriptCanOpenWindowsAutomatically = false
        setup.dataDetectorTypes = []
        setup.mediaTypesRequiringUserActionForPlayback = .all
        setup.userContentController.addUserScript(WKUserScript(source: Self.nothingToReachFor, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let view = WKWebView(frame: .zero, configuration: setup)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.allowsLinkPreview = false
        view.navigationDelegate = context.coordinator
        let page = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
        <style>html,body{margin:0;background:transparent;color:#e6e9f4;font-family:-apple-system,system-ui;overflow:hidden} svg,canvas{display:block;width:100%;height:auto;max-height:100vh}</style>
        </head><body>\(code)</body></html>
        """
        // Nothing runs until the block on the internet is in place.
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "fairy-study-no-internet", encodedContentRuleList: Self.noInternet) { rules, _ in
            guard let rules else { return }
            view.configuration.userContentController.add(rules)
            view.loadHTMLString(page, baseURL: nil)
        }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Blocker: NSObject, WKNavigationDelegate {
        private var started = false
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            if !started, action.navigationType == .other { started = true; return .allow }
            return action.targetFrame?.isMainFrame == false && action.request.url?.scheme == "about" ? .allow : .cancel
        }
    }

    private static let noInternet = #"""
    [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^ftp://"},"action":{"type":"block"}}]
    """#
    private static let nothingToReachFor = """
    for (const [place, names] of [
      [window, ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebSocket', 'XMLHttpRequest', 'fetch', 'EventSource', 'WebTransport', 'SpeechRecognition', 'webkitSpeechRecognition', 'Notification', 'ServiceWorker', 'open']],
      [Navigator.prototype, ['mediaDevices', 'getUserMedia', 'geolocation', 'share', 'clipboard', 'credentials', 'serviceWorker', 'sendBeacon']],
    ]) {
      for (const name of names) {
        try { Object.defineProperty(place, name, { value: undefined, configurable: false, writable: false }); } catch {}
      }
    }
    """
}
