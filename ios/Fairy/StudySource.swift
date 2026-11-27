import PDFKit
import SwiftUI

// A source: as its PDF, at the page asked for, when it is one on the Mac; otherwise as the words the notebook kept,
// a page at a time, lines with the cited ones lit, or a recording's transcript at the moment cited.
struct SourceScreen: View {
    let slug: String
    let source: String
    let at: Double?
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var words: SourceWords?
    @State private var problem: String?
    @State private var showing = Showing.page
    @State private var page = 1
    enum Showing: String, CaseIterable { case page = "Page", words = "Words" }

    var body: some View {
        VStack(spacing: 10) {
            if let words {
                if words.pdf {
                    Picker("Show", selection: $showing) { ForEach(Showing.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented).padding(.horizontal, 16)
                }
                if words.pdf && showing == .page {
                    CachedPDF(slug: slug, query: ["slug": slug, "source": source], key: source, page: Int(at ?? 1))
                } else {
                    wordsView(words)
                }
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(20).frame(maxHeight: .infinity, alignment: .top) }
            else { ProgressView().tint(Color.dim).frame(maxHeight: .infinity) }
        }
        .onWallpaper(0.75)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) {
            TopBar(title: words?.title ?? source, back: "Back") { dismiss() } trailing: {
                // Beside a paper, the clippings you pinned on the Mac.
                if words?.pdf == true && showing == .page { ShelfButton(slug: slug) }
            }
        }
        .task { page = max(1, Int(at ?? 1)); await load() }
    }

    private func load() async {
        var query = ["slug": slug, "id": source]
        if let at { query["page"] = String(Int(at)); query["line"] = String(Int(at)) }
        if let words, words.units == "pages" { query["page"] = String(page) }
        do { words = try await link.study("notebook-source", query); problem = nil }
        catch { problem = error.localizedDescription }
    }

    @ViewBuilder private func wordsView(_ words: SourceWords) -> some View {
        switch words.units {
        case "pages":
            VStack(spacing: 8) {
                ScrollView {
                    Text(words.text?.isEmpty == false ? words.text! : "This page has few words of its own: a picture or a title.")
                        .font(.body).foregroundStyle(Color.soft).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                }
                HStack {
                    Button { page = max(1, page - 1); Task { await load() } } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.disabled(page <= 1)
                    Spacer()
                    Text("Page \(words.page ?? page) of \(words.total)").font(.footnote).foregroundStyle(Color.dim).monospacedDigit()
                    Spacer()
                    Button { page = min(words.total, page + 1); Task { await load() } } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.disabled(page >= words.total)
                }
                .foregroundStyle(Color.ink).buttonStyle(.plain)
                .padding(.horizontal, 16).background(Color.tool, in: Capsule()).padding(.horizontal, 16).padding(.bottom, 8)
            }
        case "seconds":
            let cues = words.cues ?? []
            let current = at.flatMap { moment in cues.firstIndex { $0.end > moment } }
            ScrollViewReader { scroller in
                List(Array(cues.enumerated()), id: \.offset) { index, cue in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(Citation.clock(cue.start)).font(.caption.monospacedDigit()).foregroundStyle(Color.muted).frame(width: 44, alignment: .leading)
                        Text(cue.text).font(.subheadline).foregroundStyle(Color.soft)
                    }
                    .listRowBackground(lit(index, from: current, to: at.flatMap { _ in current.map { $0 + 3 } }) ? Color.working.opacity(0.16) : Color.clear)
                    .id(index)
                }
                .listStyle(.plain).scrollContentBackground(.hidden)
                .task { if let current { try? await Task.sleep(for: .milliseconds(150)); scroller.scrollTo(current, anchor: .center) } }
            }
        case "lines":
            let from = words.from ?? 1, target = at.map { Int($0) }
            ScrollViewReader { scroller in
                List(Array((words.lines ?? []).enumerated()), id: \.offset) { index, line in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(from + index)").font(.caption2.monospacedDigit()).foregroundStyle(Color.muted).frame(width: 34, alignment: .trailing)
                        Text(line.isEmpty ? " " : line).font(.system(size: 14, design: .monospaced)).foregroundStyle(Color.soft)
                    }
                    .listRowBackground(target == from + index ? Color.working.opacity(0.18) : Color.clear)
                    .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 2, trailing: 12))
                    .id(from + index)
                }
                .listStyle(.plain).scrollContentBackground(.hidden)
                .task { if let target { try? await Task.sleep(for: .milliseconds(150)); scroller.scrollTo(target, anchor: .center) } }
            }
            if let to = words.to, to < words.total { Text("Lines \(from)–\(to) of \(words.total)").font(.caption).foregroundStyle(Color.muted).padding(.bottom, 6) }
        default:
            Text("This source’s words haven’t been read on the Mac yet.").font(.subheadline).foregroundStyle(Color.dim).padding(20).frame(maxHeight: .infinity, alignment: .top)
        }
    }
    private func lit(_ index: Int, from: Int?, to: Int?) -> Bool { guard let from else { return false }; return index >= from && index <= (to ?? from) }
}

// A PDF the tutor wrote, such as a compiled cheatsheet.
struct PDFFileScreen: View {
    let slug: String
    let name: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        CachedPDF(slug: slug, query: ["slug": slug, "file": name], key: "file-\(name)", page: 1)
            .onWallpaper(0.75)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: name, back: "Back") { dismiss() } trailing: { ShelfButton(slug: slug) } }
    }
}

// A PDF from the Mac, kept on the phone after the first time so it opens at once, and fetched afresh on request.
struct CachedPDF: View {
    let slug: String
    let query: [String: String]
    let key: String
    let page: Int
    @Environment(LinkClient.self) private var link
    @State private var document: PDFDocument?
    @State private var problem: String?
    @State private var fetching = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let document { PDFKitView(document: document, page: page) }
            else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(20).frame(maxHeight: .infinity, alignment: .top) }
            else { VStack(spacing: 10) { ProgressView().tint(Color.dim); Text("Fetching the PDF from your Mac").font(.footnote).foregroundStyle(Color.dim) }.frame(maxWidth: .infinity, maxHeight: .infinity) }
            if document != nil {
                Button { Task { await fetch() } } label: {
                    Image(systemName: fetching ? "hourglass" : "arrow.clockwise").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.ink)
                        .frame(width: 44, height: 44).background(Color.tool, in: Circle())
                }
                .buttonStyle(.plain).disabled(fetching).padding(16)
                .accessibilityLabel("Fetch it again from the Mac")
            }
        }
        .task {
            if let kept = PDFShelf.kept(slug: slug, key: key), let document = PDFDocument(url: kept) { self.document = document }
            else { await fetch() }
        }
    }
    private func fetch() async {
        fetching = true
        defer { fetching = false }
        do {
            let (file, _) = try await link.studyDownload("notebook-pdf", query)
            let kept = try PDFShelf.keep(file, slug: slug, key: key)
            guard let fresh = PDFDocument(url: kept) else { throw LinkError.refused("That PDF couldn’t be opened.") }
            document = fresh
            problem = nil
        } catch { if document == nil { problem = error.localizedDescription } }
    }
}

// Where PDFs from the Mac are kept: Caches, so iOS may clear them, and never backed up.
enum PDFShelf {
    private static var folder: URL { URL.cachesDirectory.appending(path: "study-pdfs", directoryHint: .isDirectory) }
    private static func place(slug: String, key: String) -> URL {
        let safe = { (text: String) in text.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" }.reduce("") { $0 + String($1) } }
        return folder.appending(path: safe(slug), directoryHint: .isDirectory).appending(path: "\(safe(key)).pdf")
    }
    static func kept(slug: String, key: String) -> URL? { let url = place(slug: slug, key: key); return FileManager.default.fileExists(atPath: url.path()) ? url : nil }
    static func keep(_ file: URL, slug: String, key: String) throws -> URL {
        let url = place(slug: slug, key: key)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: url)
        try FileManager.default.moveItem(at: file, to: url)
        return url
    }
}

struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument
    let page: Int
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        view.pageShadowsEnabled = true
        view.document = document
        go(view)
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document; go(view) }
    }
    private func go(_ view: PDFView) {
        guard let target = document.page(at: max(0, min(document.pageCount - 1, page - 1))) else { return }
        DispatchQueue.main.async { view.go(to: target) }
    }
}
