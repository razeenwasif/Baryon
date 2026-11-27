import SwiftUI
import WebKit

// Pictures of pages for Make's tiles. Each page is opened once, one at a time, in a hidden web view locked down as
// opening it is (LockedPage), drawn at a phone's width, and its top kept as a picture: in memory, and on disk until the
// page has a new version. Dashboards that read from the Mac don't open on the phone, so they keep their icon.
@MainActor
@Observable
final class PagePreviews {
    static let shared = PagePreviews()
    private(set) var pictures: [String: UIImage] = [:]
    private var queue: [(link: LinkClient, page: PageItem)] = []
    private var working = false
    private var failed: Set<String> = []
    private let folder: URL = {
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "page-previews", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    static func key(_ page: PageItem) -> String? {
        guard page.opens, let version = page.versions.last else { return nil }
        return "\(page.id)-\(version.seq)"
    }

    func picture(for page: PageItem) -> UIImage? { Self.key(page).flatMap { pictures[$0] } }

    // Asks for a page's picture: from disk if made before, else made when its turn comes.
    func want(_ page: PageItem, link: LinkClient) {
        guard let key = Self.key(page), pictures[key] == nil, !failed.contains(key), !queue.contains(where: { $0.page.id == page.id }) else { return }
        let file = folder.appending(path: "\(key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key).jpg")
        if let saved = UIImage(contentsOfFile: file.path) { pictures[key] = saved; return }
        queue.append((link, page))
        next()
    }

    private func next() {
        guard !working, !queue.isEmpty else { return }
        working = true
        let (link, page) = queue.removeFirst()
        Task {
            let picture = await make(page, link: link)
            if let key = Self.key(page) {
                if let picture {
                    pictures[key] = picture
                    let file = folder.appending(path: "\(key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key).jpg")
                    try? picture.jpegData(compressionQuality: 0.8)?.write(to: file)
                } else { failed.insert(key) }
            }
            working = false
            next()
        }
    }

    // Opens the page out of sight behind the app, waits for it to settle, and takes its top 390 by 520 points.
    private func make(_ page: PageItem, link: LinkClient) async -> UIImage? {
        guard let version = page.versions.last, let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return nil }
        let shot = Snapshot(link: link, page: page.id, seq: version.seq, file: version.concepts.first?.file ?? version.file)
        return await withCheckedContinuation { finish in shot.start(in: window) { finish.resume(returning: $0) } }
    }
}

// One page being pictured.
@MainActor
private final class Snapshot {
    private let size = CGSize(width: 390, height: 520)
    private let guardian: LockedPage.Guard
    private let file: String
    private var view: WKWebView?
    private var finish: ((UIImage?) -> Void)?

    init(link: LinkClient, page: String, seq: Int, file: String) {
        self.file = file
        // Weak, so the guard doesn't keep this alive after it's done; the 15-second check below holds it while it works.
        weak var me: Snapshot?
        guardian = LockedPage.Guard(link: link, page: page, seq: seq, report: { _ in }, fail: { _ in me?.end(nil) }, done: { me?.settled() })
        me = self
    }

    func start(in window: UIWindow, finish: @escaping (UIImage?) -> Void) {
        self.finish = finish
        let web = LockedPage.lockedWebView(guard: guardian)
        web.frame = CGRect(origin: .zero, size: size)
        web.isUserInteractionEnabled = false
        web.alpha = 0.01
        // Under everything in the window, so it's drawn without being seen.
        window.insertSubview(web, at: 0)
        view = web
        guardian.open(file: file, in: web)
        // A page that never finishes keeps its icon.
        Task { try? await Task.sleep(for: .seconds(15)); self.end(nil) }
    }

    // A moment for fonts, pictures and the page's own drawing, then its top.
    private func settled() {
        Task {
            try? await Task.sleep(for: .milliseconds(900))
            guard let view, finish != nil else { return }
            let setup = WKSnapshotConfiguration()
            setup.rect = CGRect(origin: .zero, size: size)
            setup.snapshotWidth = NSNumber(value: Double(size.width))
            view.takeSnapshot(with: setup) { picture, _ in self.end(picture) }
        }
    }

    private func end(_ picture: UIImage?) {
        guard let finish else { return }
        self.finish = nil
        guardian.close()
        view?.stopLoading()
        view?.removeFromSuperview()
        view = nil
        finish(picture)
    }
}
