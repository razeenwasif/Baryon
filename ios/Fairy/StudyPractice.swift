import AVFoundation
import SwiftUI

// Flashcards due today, reviewed on the phone: each rating is written to the deck on the Mac, as a review there is.
struct ReviewScreen: View {
    let slug: String
    let deck: String?
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var review: Review?
    @State private var shown = false
    @State private var started = Date.now
    @State private var problem: String?
    @State private var rating = false
    @State private var done = 0
    @State private var cited: Citation?
    @State private var height: CGFloat = 0

    var body: some View {
        VStack(spacing: 16) {
            if let card = review?.card {
                Text("\(review?.due ?? 0) due · \(card.deckTitle)").font(.footnote).foregroundStyle(Color.muted).frame(maxWidth: .infinity, alignment: .leading)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !card.topic.isEmpty { Text(card.topic.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(Color.muted) }
                        SizedHTML(html: card.front, citations: card.citations, onCite: { cited = $0 }, size: 19)
                        if shown {
                            Rectangle().fill(Color.hairline).frame(height: 1)
                            SizedHTML(html: card.back, citations: card.citations, onCite: { cited = $0 })
                            if !card.citations.isEmpty {
                                ForEach(card.citations) { cite in
                                    Button { cited = cite } label: { Text("Where it’s taught: \(TutorChatScreen.short(cite.title.isEmpty ? cite.source : cite.title))\(cite.place.isEmpty ? "" : ", \(cite.place)")").font(.caption).foregroundStyle(Color.working) }.buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.card, in: RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.hairline, lineWidth: 1))
                .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { shown = true } }
                if shown {
                    HStack(spacing: 8) {
                        ForEach(1...4, id: \.self) { n in
                            Button { rate(n, card) } label: {
                                VStack(spacing: 3) {
                                    Text(["Again", "Hard", "Good", "Easy"][n - 1]).font(.subheadline.weight(.semibold))
                                    Text(Self.span(card.after.indices.contains(n - 1) ? card.after[n - 1] : 0)).font(.caption2).foregroundStyle(Color.muted)
                                }
                                .foregroundStyle([Color.removed, Color.asking, Color.working, Color.added][n - 1])
                                .frame(maxWidth: .infinity, minHeight: 58)
                                .background(Color.tool, in: RoundedRectangle(cornerRadius: 16))
                            }
                            .buttonStyle(.plain).disabled(rating)
                        }
                    }
                } else {
                    Button("Show the answer") { withAnimation(.easeOut(duration: 0.2)) { shown = true } }.buttonStyle(PillButton(fill: Color.accent.opacity(0.55)))
                }
            } else if let review {
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle").font(.system(size: 40, weight: .light)).foregroundStyle(Color.added)
                    Text(done > 0 ? "That’s all for now: \(done) reviewed." : "Nothing is due.").font(.headline).foregroundStyle(Color.ink)
                    if let waiting = review.waiting { Text("More come back \(Date(timeIntervalSince1970: waiting).formatted(.relative(presentation: .named))).").font(.subheadline).foregroundStyle(Color.dim) }
                }
                .frame(maxHeight: .infinity)
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).frame(maxHeight: .infinity, alignment: .top) }
            else { ProgressView().tint(Color.dim).frame(maxHeight: .infinity) }
            if let problem, review != nil { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
        }
        .padding(16)
        .onWallpaper(0.6)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: "Flashcards", back: "Notebook", glass: false) { dismiss() } }
        .sheet(item: $cited) { cite in CitationSheet(citation: cite) { cited = nil; path.append(.source(slug, cite.source, cite.from)) } }
        .task { await load() }
    }

    private func load() async {
        var query = ["slug": slug]
        if let deck { query["deck"] = deck }
        do { review = try await link.study("notebook-review", query); problem = nil; shown = false; started = .now }
        catch { problem = error.localizedDescription }
    }
    private func rate(_ n: Int, _ card: ReviewCard) {
        rating = true
        Task {
            defer { rating = false }
            var body: [String: Any] = ["slug": slug, "deck": card.deck, "card": card.id, "rating": n, "took": Int(Date.now.timeIntervalSince(started) * 1000)]
            if let deck { body["next"] = deck }
            do { review = try await link.studyPost("notebook-rate", body); done += 1; shown = false; started = .now; problem = nil }
            catch { problem = error.localizedDescription }
        }
    }
    static func span(_ seconds: Double) -> String {
        switch seconds {
        case ..<60: "now"
        case ..<3600: "\(Int(seconds / 60))m"
        case ..<86400: "\(Int(seconds / 3600))h"
        case ..<(86400 * 30): "\(Int(seconds / 86400))d"
        default: "\(Int(seconds / (86400 * 30)))mo"
        }
    }
}

// A quiz to practise on the phone: each answer checked here, with its reasons; nothing is recorded. Sitting one for the
// record is done on the Mac.
struct QuizScreen: View {
    let slug: String
    let quiz: String
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: QuizSheet?
    @State private var at = 0
    @State private var picked: Set<Int> = []
    @State private var checked = false
    @State private var revealed = false
    @State private var typed = ""
    @State private var right = 0
    @State private var problem: String?
    @State private var cited: Citation?

    var body: some View {
        VStack(spacing: 12) {
            if let sheet, at < sheet.questions.count {
                let q = sheet.questions[at]
                Text("Question \(at + 1) of \(sheet.questions.count) · practice, not recorded").font(.footnote).foregroundStyle(Color.muted).frame(maxWidth: .infinity, alignment: .leading)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        SizedHTML(html: q.prompt, citations: q.citations, onCite: { cited = $0 }, size: 17)
                        answers(q)
                        if checked || revealed { feedback(q) }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.card, in: RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.hairline, lineWidth: 1))
                HStack(spacing: 10) {
                    if !q.hint.isEmpty && !checked && !revealed { Button("Hint") { revealed = true }.buttonStyle(PillButton()) }
                    if checked || revealed {
                        Button(at + 1 < sheet.questions.count ? "Next" : "Finish") { next() }.buttonStyle(PillButton(fill: Color.accent.opacity(0.6)))
                    } else if Self.choice(q) {
                        Button("Check") { check(q) }.buttonStyle(PillButton(fill: Color.accent.opacity(0.6))).disabled(picked.isEmpty)
                    } else {
                        Button("Show the answer") { revealed = true }.buttonStyle(PillButton(fill: Color.accent.opacity(0.6)))
                    }
                }
            } else if let sheet {
                VStack(spacing: 10) {
                    Text("Done: \(right) of \(sheet.questions.filter(Self.choice).count) choices right.").font(.headline).foregroundStyle(Color.ink)
                    Button("Again") { at = 0; right = 0; reset() }.buttonStyle(PillButton())
                }
                .frame(maxHeight: .infinity)
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).frame(maxHeight: .infinity, alignment: .top) }
            else { ProgressView().tint(Color.dim).frame(maxHeight: .infinity) }
        }
        .padding(16)
        .onWallpaper(0.6)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: sheet?.title ?? "Quiz", back: "Notebook", glass: false) { dismiss() } }
        .sheet(item: $cited) { cite in CitationSheet(citation: cite) { cited = nil; path.append(.source(slug, cite.source, cite.from)) } }
        .task {
            do { sheet = try await link.study("notebook-quiz", ["slug": slug, "id": quiz]) }
            catch { problem = error.localizedDescription }
        }
    }

    static func choice(_ q: QuizQuestion) -> Bool { (q.kind == "choice" || q.kind == "choices") && !q.options.isEmpty }

    @ViewBuilder private func answers(_ q: QuizQuestion) -> some View {
        if Self.choice(q) {
            ForEach(Array(q.options.enumerated()), id: \.offset) { index, option in
                Button {
                    guard !checked else { return }
                    if q.kind == "choice" { picked = [index] } else if picked.contains(index) { picked.remove(index) } else { picked.insert(index) }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: mark(q, index)).foregroundStyle(tint(q, index)).font(.body)
                        SizedHTML(html: option, size: 16).allowsHitTesting(false)
                    }
                    .padding(12)
                    .background(picked.contains(index) ? Color.white.opacity(0.1) : Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                    .contentShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                if checked, picked.contains(index) || q.correct.contains(index), q.rationales.indices.contains(index), !q.rationales[index].isEmpty {
                    SizedHTML(html: q.rationales[index], size: 14).padding(.leading, 34)
                }
            }
        } else if q.kind == "short" || q.kind == "long" || q.kind == "number" || q.kind == "blanks" {
            TextField("Your answer, to check yourself", text: $typed, axis: .vertical).lineLimit(1...6)
                .foregroundStyle(Color.ink).padding(12).background(Color.well, in: RoundedRectangle(cornerRadius: 14))
        }
    }
    @ViewBuilder private func feedback(_ q: QuizQuestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if revealed && !checked && !q.hint.isEmpty && q.modelAnswer.isEmpty && q.explanation.isEmpty { label("Hint"); SizedHTML(html: q.hint, size: 15) }
            if q.kind == "number", let number = q.number { label("Answer"); Text("\(number.formatted())\(q.unit.isEmpty ? "" : " \(q.unit)")").foregroundStyle(Color.ink) }
            if q.kind == "blanks", !q.blanks.isEmpty { label("Blanks"); Text(q.blanks.map { $0.first ?? "" }.joined(separator: " · ")).foregroundStyle(Color.ink) }
            if !q.modelAnswer.isEmpty { label("A model answer"); SizedHTML(html: q.modelAnswer, citations: q.citations, onCite: { cited = $0 }, size: 15) }
            if !q.rubric.isEmpty { label("Marked on"); ForEach(Array(q.rubric.enumerated()), id: \.offset) { _, c in SizedHTML(html: "\(c.text) <span style=\"color:#A2A4AD\">(\(c.points.formatted()))</span>", size: 14) } }
            if !q.explanation.isEmpty { label("Why"); SizedHTML(html: q.explanation, citations: q.citations, onCite: { cited = $0 }, size: 15) }
            if revealed && !q.hint.isEmpty && (!q.modelAnswer.isEmpty || !q.explanation.isEmpty) && !checked { label("Hint"); SizedHTML(html: q.hint, size: 15) }
        }
    }
    private func label(_ text: String) -> some View { Text(text.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(Color.muted) }
    private func mark(_ q: QuizQuestion, _ index: Int) -> String {
        if checked { return q.correct.contains(index) ? "checkmark.circle.fill" : picked.contains(index) ? "xmark.circle.fill" : "circle" }
        return picked.contains(index) ? (q.kind == "choice" ? "largecircle.fill.circle" : "checkmark.square.fill") : (q.kind == "choice" ? "circle" : "square")
    }
    private func tint(_ q: QuizQuestion, _ index: Int) -> Color {
        guard checked else { return picked.contains(index) ? Color.working : Color.muted }
        return q.correct.contains(index) ? Color.added : picked.contains(index) ? Color.removed : Color.muted
    }
    private func check(_ q: QuizQuestion) { checked = true; if Set(q.correct) == picked { right += 1 } }
    private func next() { at += 1; reset() }
    private func reset() { picked = []; checked = false; revealed = false; typed = "" }
}

// An audio overview, played on the phone.
struct AudioScreen: View {
    let slug: String
    let id: String
    let title: String
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var problem: String?
    @State private var playing = false

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "headphones").font(.system(size: 54, weight: .light)).foregroundStyle(Color.working).padding(.top, 60)
            Text(title).font(.title3.weight(.medium)).foregroundStyle(Color.ink).multilineTextAlignment(.center)
            if let player {
                Button {
                    if playing { player.pause() } else { player.play() }
                    playing.toggle()
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 26)).foregroundStyle(Color.ground)
                        .frame(width: 76, height: 76).background(Color.ink, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause" : "Play")
                HStack(spacing: 40) {
                    Button { skip(player, -15) } label: { Image(systemName: "gobackward.15").font(.title2) }
                    Button { skip(player, 30) } label: { Image(systemName: "goforward.30").font(.title2) }
                }
                .foregroundStyle(Color.ink).buttonStyle(.plain)
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            else { ProgressView().tint(Color.dim) }
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .onWallpaper(0.5)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: "Audio overview", back: "Notebook", glass: false) { dismiss() } }
        .task {
            do {
                let (file, _) = try await link.studyDownload("notebook-audio", ["slug": slug, "id": id])
                let kept = URL.temporaryDirectory.appending(path: "overview-\(id).mp3")
                try? FileManager.default.removeItem(at: kept)
                try FileManager.default.moveItem(at: file, to: kept)
                try? await SpeechListener.prepareAudio(forListening: false)
                player = AVPlayer(url: kept)
            } catch { problem = error.localizedDescription }
        }
        .onDisappear { player?.pause(); SpeechListener.releaseAudio() }
    }
    private func skip(_ player: AVPlayer, _ seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, player.currentTime().seconds + seconds), preferredTimescale: 600))
    }
}
