import SwiftUI

// The Study tab: your notebooks on the Mac, each opening to its chats with the tutor, its sources and what's been made
// of them. Reading never opens a notebook in the Mac's window; making things, adding sources and settings stay there.
struct StudyTab: View {
    @Environment(LinkClient.self) private var link
    @State private var path: [StudyRoute] = []
    @State private var notebooks: [NotebookRow] = []
    @State private var problem: String?
    @State private var loading = true

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Study").font(.system(size: 32, weight: .light)).foregroundStyle(Color.ink)
                        Text(notebooks.isEmpty ? "Your notebooks on \(link.macName)" : "\(notebooks.count) notebook\(notebooks.count == 1 ? "" : "s") on \(link.macName)").font(.subheadline).foregroundStyle(Color.muted)
                    }
                    if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(.top, 14) }
                    if loading && notebooks.isEmpty { ProgressView().tint(Color.dim).frame(maxWidth: .infinity).padding(.top, 40) }
                    else if notebooks.isEmpty && problem == nil {
                        Text("No notebooks yet. Make one in Study on your Mac.").font(.subheadline).foregroundStyle(Color.dim).padding(.top, 24)
                    }
                    VStack(spacing: 12) {
                        ForEach(notebooks) { book in
                            NavigationLink(value: StudyRoute.notebook(book.slug, book.title)) { NotebookCard(book: book) }.buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 18)
                }
                .padding(.horizontal, 16)
                .padding(.top, 30)
                .padding(.bottom, 32)
            }
            .scrollEdgeEffectHidden(true, for: .all)
            .mask { EdgeFade(reach: 4) }
            .onWallpaper(0.45)
            .safeAreaInset(edge: .bottom, spacing: 0) { TabPill() }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
            .navigationDestination(for: StudyRoute.self) { route in StudyDestination(route: route, path: $path) }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do { notebooks = (try await link.study("notebooks") as NotebookList).notebooks; problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct StudyDestination: View {
    let route: StudyRoute
    @Binding var path: [StudyRoute]
    var body: some View {
        switch route {
        case .notebook(let slug, let title): NotebookScreen(slug: slug, title: title, path: $path)
        case .chat(let slug, let chat): TutorChatScreen(slug: slug, chat: chat, path: $path)
        case .source(let slug, let id, let at): SourceScreen(slug: slug, source: id, at: at)
        case .note(let slug, let id): RenderedScreen(slug: slug, kind: .note(id), path: $path)
        case .made(let slug, let id, _): RenderedScreen(slug: slug, kind: .made(id), path: $path)
        case .file(let slug, let name): FileScreen(slug: slug, name: name, path: $path)
        case .pdfFile(let slug, let name): PDFFileScreen(slug: slug, name: name)
        case .review(let slug, let deck): ReviewScreen(slug: slug, deck: deck, path: $path)
        case .quiz(let slug, let id): QuizScreen(slug: slug, quiz: id, path: $path)
        case .audio(let slug, let id, let title): AudioScreen(slug: slug, id: id, title: title)
        }
    }
}

private struct NotebookCard: View {
    let book: NotebookRow
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(book.title).font(.headline).foregroundStyle(Color.ink).lineLimit(2)
                Spacer(minLength: 8)
                if let days = book.daysToExam, days >= 0 {
                    Text(days == 0 ? "Exam today" : days == 1 ? "Exam tomorrow" : "Exam in \(days) days")
                        .font(.caption.weight(.semibold)).foregroundStyle(Color.asking)
                        .padding(.horizontal, 9).padding(.vertical, 4).background(Color.asking.opacity(0.14), in: Capsule())
                }
            }
            Text([book.course, "\(book.sources) source\(book.sources == 1 ? "" : "s")", book.chats > 0 ? "\(book.chats) chat\(book.chats == 1 ? "" : "s")" : "", book.notes > 0 ? "\(book.notes) note\(book.notes == 1 ? "" : "s")" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.footnote).foregroundStyle(Color.muted)
            if book.cardsDue > 0 {
                Text("\(book.cardsDue) card\(book.cardsDue == 1 ? "" : "s") due").font(.caption.weight(.medium)).foregroundStyle(Color.working)
                    .padding(.horizontal, 9).padding(.vertical, 4).background(Color.working.opacity(0.16), in: Capsule())
            }
            if book.heldBy != nil {
                Text("Open in Proton on the Mac: you can read it, but the tutor can’t answer in it until Proton closes it.").font(.caption).foregroundStyle(Color.asking)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.hairline, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 20))
    }
}

// One notebook: its chats with the tutor, its sources by category, and what's been made.
struct NotebookScreen: View {
    let slug: String
    let title: String
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var detail: NotebookDetail?
    @State private var part = Part.chats
    @State private var problem: String?
    enum Part: String, CaseIterable { case chats = "Chats", sources = "Sources", made = "Made" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let detail {
                    Text([detail.course, detail.exam.map { "exam \(Self.examDay($0))" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(Color.muted)
                    Picker("Part", selection: $part) { ForEach(Part.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                        .pickerStyle(.segmented)
                    switch part {
                    case .chats: chats(detail)
                    case .sources: sources(detail)
                    case .made: made(detail)
                    }
                } else if let problem {
                    Text(problem).font(.footnote).foregroundStyle(Color.removed)
                } else { ProgressView().tint(Color.dim).frame(maxWidth: .infinity).padding(.top, 40) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.55)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: detail?.title ?? title, back: "Study", glass: false) { dismiss() } }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { detail = try await link.study("notebook", ["slug": slug]); problem = nil }
        catch { problem = error.localizedDescription }
    }
    static func examDay(_ day: String) -> String {
        let reading = DateFormatter(); reading.dateFormat = "yyyy-MM-dd"
        guard let date = reading.date(from: day) else { return day }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    @ViewBuilder private func chats(_ detail: NotebookDetail) -> some View {
        NavigationLink(value: StudyRoute.chat(slug, nil)) {
            Label("Ask the tutor", systemImage: "plus").font(.body.weight(.semibold)).foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading).padding(.horizontal, 16)
                .background(Color.accent.opacity(0.35), in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        if detail.chats.isEmpty { Text("No chats yet. Ask about anything in your sources.").font(.subheadline).foregroundStyle(Color.dim) }
        ForEach(detail.chats) { chat in
            NavigationLink(value: StudyRoute.chat(slug, chat.id)) {
                row(chat.title, [chat.updated.map { Date(timeIntervalSince1970: $0).formatted(.relative(presentation: .named)) } ?? "", "\(chat.turns) question\(chat.turns == 1 ? "" : "s")"].filter { !$0.isEmpty }.joined(separator: " · "), icon: "bubble.left.and.text.bubble.right")
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private func sources(_ detail: NotebookDetail) -> some View {
        let grouped = Dictionary(grouping: detail.sources) { $0.category ?? "" }
        let order = detail.categories + (grouped[""] == nil ? [] : [""])
        if detail.sources.isEmpty { Text("No sources yet. Add them in Study on your Mac.").font(.subheadline).foregroundStyle(Color.dim) }
        ForEach(order, id: \.self) { name in
            if let list = grouped[name], !list.isEmpty {
                Text(name.isEmpty ? (detail.categories.isEmpty ? "Sources" : "Not in a category") : name).font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 6)
                ForEach(list) { source in
                    NavigationLink(value: StudyRoute.source(slug, source.id, nil)) {
                        row(source.title, [source.id, source.role, source.size, source.hasWords ? "" : "not read yet"].filter { !$0.isEmpty }.joined(separator: " · "), icon: Self.icon(source))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
    static func icon(_ source: NotebookSource) -> String {
        if source.pdf { return "doc.richtext" }
        switch source.units { case "seconds": return "waveform"; case "pages": return "doc.text"; default: return source.kind == "folder" ? "folder" : "text.alignleft" }
    }

    @ViewBuilder private func made(_ detail: NotebookDetail) -> some View {
        if detail.flashcards.decks.contains(where: { $0.cards > 0 }) {
            NavigationLink(value: StudyRoute.review(slug, nil)) {
                row("Review flashcards", detail.flashcards.due > 0 ? "\(detail.flashcards.due) due today" : "Nothing due today", icon: "rectangle.on.rectangle.angled")
            }.buttonStyle(.plain)
        }
        if !detail.notes.isEmpty {
            section("Notes")
            ForEach(detail.notes) { note in
                NavigationLink(value: StudyRoute.note(slug, note.id)) { row(note.title, "\(note.words) words", icon: "note.text") }.buttonStyle(.plain)
            }
        }
        if !detail.files.isEmpty {
            section("Files")
            ForEach(detail.files) { file in
                NavigationLink(value: file.name.lowercased().hasSuffix(".pdf") ? StudyRoute.pdfFile(slug, file.name) : StudyRoute.file(slug, file.name)) {
                    row(file.name, ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file), icon: file.name.lowercased().hasSuffix(".pdf") ? "doc.richtext" : "chevron.left.forwardslash.chevron.right")
                }.buttonStyle(.plain)
            }
        }
        if !detail.made.isEmpty {
            section("Studio")
            ForEach(detail.made) { item in
                NavigationLink(value: Self.route(slug, item)) { row(item.title.isEmpty ? item.kind : item.title, Self.madeLine(item), icon: Self.madeIcon(item)) }.buttonStyle(.plain)
                    .disabled(item.opens == "audio" && item.state != "ready")
            }
        }
        if detail.notes.isEmpty && detail.files.isEmpty && detail.made.isEmpty {
            Text("Nothing made yet. Notes and files the tutor writes, and what the Studio makes on your Mac, show here.").font(.subheadline).foregroundStyle(Color.dim)
        }
    }
    static func route(_ slug: String, _ item: MadeRow) -> StudyRoute {
        switch item.opens {
        case "deck": .review(slug, item.id)
        case "quiz": .quiz(slug, item.id)
        case "audio": .audio(slug, item.id, item.title)
        default: .made(slug, item.id, item.title)
        }
    }
    static func madeLine(_ item: MadeRow) -> String {
        let kind = item.kind.replacingOccurrences(of: #"([a-z])([A-Z])"#, with: "$1 $2", options: .regularExpression).capitalized
        let count = item.count.map { item.opens == "deck" ? "\($0) cards" : item.opens == "quiz" ? "\($0) questions" : "" } ?? ""
        let state = item.opens == "audio" && item.state != "ready" ? (item.state == "voicing" || item.state == "waiting" ? "being spoken on the Mac" : "not ready") : ""
        return [kind, count, state].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    static func madeIcon(_ item: MadeRow) -> String {
        switch item.opens {
        case "deck": "rectangle.on.rectangle.angled"
        case "quiz": "checklist"
        case "audio": "headphones"
        default: item.kind == "slides" ? "rectangle.stack" : item.kind == "mindMap" ? "point.3.connected.trianglepath.dotted" : item.kind == "table" ? "tablecells" : "doc.plaintext"
        }
    }

    private func section(_ name: String) -> some View { Text(name).font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 8) }
    private func row(_ title: String, _ line: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 17)).foregroundStyle(Color.working).frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(2).multilineTextAlignment(.leading)
                if !line.isEmpty { Text(line).font(.caption).foregroundStyle(Color.muted).lineLimit(1) }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Color.muted)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.hairline, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}

// A note, or anything the Studio made, drawn as the Mac drew it, its citations opening their sources.
struct RenderedScreen: View {
    enum Kind { case note(String), made(String) }
    let slug: String
    let kind: Kind
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var html: String?
    @State private var citations: [Citation] = []
    @State private var animations: [TutorAnimation] = []
    @State private var problem: String?
    @State private var height: CGFloat = 0
    @State private var cited: Citation?
    @State private var playing: TutorAnimation?

    var body: some View {
        Group {
            if let html {
                RichHTML(html: html, citations: citations, animations: animations, onCite: { cited = $0 }, onAnimation: { playing = $0 }, height: $height, scrolls: true)
                    .padding(.horizontal, 12)
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(20).frame(maxHeight: .infinity, alignment: .top) }
            else { ProgressView().tint(Color.dim).frame(maxHeight: .infinity) }
        }
        .onWallpaper(0.7)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: title, back: "Back") { dismiss() } }
        .sheet(item: $cited) { cite in CitationSheet(citation: cite) { cited = nil; path.append(.source(slug, cite.source, cite.from)) } }
        .sheet(item: Binding(get: { playing.map(Playing.init) }, set: { playing = $0?.animation })) { AnimationPlayer(animation: $0.animation) }
        .task { await load() }
    }
    private func load() async {
        do {
            switch kind {
            case .note(let id):
                let note: RenderedNote = try await link.study("notebook-note", ["slug": slug, "id": id])
                (title, html, citations, animations) = (note.title, note.html, note.citations, note.animations)
            case .made(let id):
                let made: RenderedMade = try await link.study("notebook-made", ["slug": slug, "id": id])
                (title, html, citations, animations) = (made.title, made.html, made.citations, made.animations)
            }
        } catch { problem = error.localizedDescription }
    }
}
struct Playing: Identifiable { let animation: TutorAnimation; var id: String { animation.title + String(animation.code.count) } }

// A file the tutor wrote: its text, and its PDF when the Mac has made one. Editing and compiling stay on the Mac.
struct FileScreen: View {
    let slug: String
    let name: String
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var file: NotebookFile?
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let file {
                    if let pdf = file.pdf {
                        Button { path.append(.pdfFile(slug, pdf)) } label: { Label("Open \(pdf)", systemImage: "doc.richtext") }.buttonStyle(PillButton(fill: Color.accent.opacity(0.5)))
                    } else if file.name.lowercased().hasSuffix(".tex") {
                        Text("Compile it in Study on your Mac to read it as a PDF here.").font(.footnote).foregroundStyle(Color.muted)
                    }
                    if let text = file.text {
                        Text(text).font(.system(size: 13, design: .monospaced)).foregroundStyle(Color.soft).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12).background(Color.well, in: RoundedRectangle(cornerRadius: 14))
                    } else {
                        Text(file.kind == "large" ? "This file is too long to show on the phone." : "This file isn’t text, so it can’t be shown here.").font(.subheadline).foregroundStyle(Color.dim)
                    }
                } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                else { ProgressView().tint(Color.dim).frame(maxWidth: .infinity).padding(.top, 40) }
            }
            .padding(16)
        }
        .onWallpaper(0.7)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: name, back: "Back") { dismiss() } }
        .task {
            do { file = try await link.study("notebook-file", ["slug": slug, "name": name]) }
            catch { problem = error.localizedDescription }
        }
    }
}

// Where a citation points: the words it quotes, at once, and a way to open the source there.
struct CitationSheet: View {
    let citation: Citation
    let open: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("\(citation.n)").font(.caption.weight(.bold)).foregroundStyle(Color(hex: 0x0B1030))
                    .padding(.horizontal, 8).padding(.vertical, 2).background(Color.working, in: Capsule())
                VStack(alignment: .leading, spacing: 2) {
                    Text(citation.title.isEmpty ? citation.source : citation.title).font(.headline).foregroundStyle(Color.ink).lineLimit(2)
                    Text([citation.source, citation.place].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(Color.muted)
                }
            }
            ScrollView {
                Text(citation.resolved ? citation.quote : "This citation doesn’t match the notebook’s sources as they are now.")
                    .font(.subheadline).foregroundStyle(citation.resolved ? Color.soft : Color.removed)
                    .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            }
            .padding(14)
            .background(Color.well, in: RoundedRectangle(cornerRadius: 16))
            Button(action: open) { Text(citation.place.isEmpty ? "Open the source" : "Open at \(citation.place)") }
                .buttonStyle(PillButton(fill: Color.working, ink: Color(hex: 0x0B1030)))
                .disabled(citation.title.isEmpty)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
        .presentationBackground { Wallpaper(still: true) }
    }
}
