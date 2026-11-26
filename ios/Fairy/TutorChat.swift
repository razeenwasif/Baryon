import AVFoundation
import SwiftUI

// A chat with a notebook's tutor: its answers drawn as on the Mac, each citation a number that opens where it points,
// the answer being written streamed in, Read aloud in Fairy's voice, and talking to it as Fairy's chats are talked to.
struct TutorChatScreen: View {
    let slug: String
    @Binding var path: [StudyRoute]
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var chatId: String?
    @State private var chat: TutorChat?
    @State private var text = ""
    @State private var problem: String?
    @State private var pending: String?
    @State private var voice: VoiceTalk?
    @State private var cited: Citation?
    @State private var playing: TutorAnimation?
    @State private var reader = TutorReader()
    @State private var since = Date.now

    init(slug: String, chat: String?, path: Binding<[StudyRoute]>) {
        self.slug = slug
        _path = path
        _chatId = State(initialValue: chat)
    }

    private var live: TutorLive? { link.tutor.flatMap { $0.slug == slug && $0.chat == chatId ? $0 : nil } }
    private var working: Bool { live?.working == true || pending != nil }
    // While an answer is written, its question is already saved with no answer: shown once, as the live one.
    private var turns: [TutorTurn] {
        guard let chat else { return [] }
        if working, let last = chat.turns.last, last.html.isEmpty, last.error == nil { return Array(chat.turns.dropLast()) }
        return chat.turns
    }

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if let chat, chat.earlier > 0 { Text("\(chat.earlier) earlier question\(chat.earlier == 1 ? "" : "s") are on the Mac.").font(.caption).foregroundStyle(Color.muted) }
                    if chat == nil && chatId == nil && !working {
                        Text("Ask about anything in this notebook’s sources. Answers cite where they come from; tap a number to see it.")
                            .font(.subheadline).foregroundStyle(Color.dim).padding(.top, 24)
                    }
                    ForEach(Array(turns.enumerated()), id: \.offset) { index, turn in
                        question(turn.asked)
                        answer(turn, index: (chat?.earlier ?? 0) + index)
                    }
                    if working {
                        question(live?.asked ?? pending ?? "")
                        VStack(alignment: .leading, spacing: 8) {
                            if let html = live?.html, !html.isEmpty {
                                SizedHTML(html: html)
                            }
                            ThinkingBlock(label: live?.step?.isEmpty == false ? live!.step! : "Reading your sources", since: since)
                        }
                    }
                    if let failure = live?.failure ?? problem { Text(failure).font(.footnote).foregroundStyle(Color.removed) }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollEdgeEffectHidden(true, for: .all)
            .mask { EdgeFade() }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: turns.count) { withAnimation { scroller.scrollTo("end", anchor: .bottom) } }
            .onChange(of: working) { if working { since = .now; withAnimation { scroller.scrollTo("end", anchor: .bottom) } } }
        }
        .onWallpaper(0.75)
        .background(alignment: .bottom) {
            if let voice {
                VoiceGlow(level: voice.mode == .listening ? voice.level : 0, working: voice.mode == .thinking || voice.mode == .starting)
                    .frame(height: 300).ignoresSafeArea().transition(.opacity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) { TopBar(title: chat?.title ?? "Ask the tutor", back: "Notebook") { dismiss() } }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if let voice {
                VoiceBar(talk: voice, close: endVoice).padding(.bottom, 8).transition(.opacity.combined(with: .offset(y: 8)))
            } else {
                MessageBox(placeholder: "Ask the tutor", text: $text, replying: working, talk: { startVoice() }, send: submit, stop: stop)
                    .padding(.horizontal, 12).padding(.bottom, 8)
            }
        }
        .sheet(item: $cited) { cite in CitationSheet(citation: cite) { cited = nil; path.append(.source(slug, cite.source, cite.from)) } }
        .sheet(item: Binding(get: { playing.map(Playing.init) }, set: { playing = $0?.animation })) { AnimationPlayer(animation: $0.animation) }
        .task { link.followTutor(TutorFollow(slug: slug, chat: chatId)); await load() }
        .onChange(of: link.tutor) { old, now in
            voice?.refresh()
            reader.refresh(link: link, slug: slug, chat: chatId)
            guard let now, now.slug == slug, now.chat == chatId else { return }
            if now.working { pending = nil }
            // An answer finished: the chat as saved, notes, files and all.
            if !now.working, old?.working == true || old?.last != now.last { Task { await load() } }
        }
        .onChange(of: voice?.chat) { _, now in if let now, chatId != now { chatId = now; link.followTutor(TutorFollow(slug: slug, chat: now)) } }
        .onDisappear { endVoice(); reader.stop(); link.followTutor(nil) }
    }

    private func load() async {
        guard let chatId else { return }
        do { chat = try await link.study("notebook-chat", ["slug": slug, "id": chatId]) }
        catch { problem = error.localizedDescription }
    }

    private func submit() {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty, !working else { return }
        text = ""
        pending = words
        problem = nil
        reader.stop()
        Task {
            var body: [String: Any] = ["slug": slug, "text": words, "voice": false]
            if let chatId { body["chat"] = chatId }
            do {
                let asked: AskedTutor = try await link.studyPost("notebook-ask", body)
                if chatId != asked.chat { chatId = asked.chat }
                link.followTutor(TutorFollow(slug: slug, chat: asked.chat))
            } catch {
                pending = nil
                text = words
                problem = error.localizedDescription
            }
        }
    }
    private func stop() {
        guard let chatId else { return }
        Task { let _: SpeakReply? = try? await link.studyPost("notebook-stop", ["slug": slug, "chat": chatId]); pending = nil }
    }

    private func startVoice() {
        guard voice == nil else { return }
        reader.stop()
        let talk = VoiceTalk(link: link, chat: chatId, backend: TutorVoice(link: link, slug: slug))
        withAnimation(.easeOut(duration: 0.3)) { voice = talk }
        Task { await talk.begin() }
    }
    private func endVoice() {
        guard let talk = voice else { return }
        talk.end()
        if let chat = talk.chat, chatId != chat { chatId = chat }
        withAnimation(.easeOut(duration: 0.3)) { voice = nil }
        Task { await load() }
    }

    private func question(_ words: String) -> some View {
        Text(words).font(.body).foregroundStyle(Color.ink)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.accent.opacity(0.42), in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 4, topTrailingRadius: 18))
            .frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 48)
            .textSelection(.enabled)
    }

    @ViewBuilder private func answer(_ turn: TutorTurn, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !turn.html.isEmpty {
                SizedHTML(html: turn.html, citations: turn.citations, animations: turn.animations, onCite: { cited = $0 }, onAnimation: { playing = $0 })
            }
            if let error = turn.error { Text(error == "Stopped." ? "Stopped." : "The tutor couldn’t answer: \(error)").font(.footnote).foregroundStyle(error == "Stopped." ? Color.muted : Color.removed) }
            let made = turn.notes.map { (label: "Note: \($0.title ?? $0.id ?? "")", route: StudyRoute.note(slug, $0.id ?? "")) } + turn.files.map { name in (label: name.name ?? "", route: (name.name ?? "").lowercased().hasSuffix(".pdf") ? StudyRoute.pdfFile(slug, name.name ?? "") : StudyRoute.file(slug, name.name ?? "")) }
            if !turn.citations.isEmpty || !made.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(made, id: \.label) { item in
                            Button { path.append(item.route) } label: { chip(item.label, icon: "doc.text") }.buttonStyle(.plain)
                        }
                        ForEach(turn.citations) { cite in
                            Button { cited = cite } label: { chip("\(cite.n) · \(Self.short(cite.title.isEmpty ? cite.source : cite.title))\(cite.place.isEmpty ? "" : ", \(cite.place)")", icon: nil) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            if !turn.html.isEmpty {
                HStack(spacing: 16) {
                    Button { reader.toggle(link: link, slug: slug, chat: chatId, index: index, answer: turn.answer) } label: {
                        Label(reader.reading == index ? "Stop reading" : "Read aloud", systemImage: reader.reading == index ? "stop.fill" : "speaker.wave.2")
                    }
                    Button { UIPasteboard.general.string = turn.answer } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
                .font(.footnote).foregroundStyle(Color.muted).buttonStyle(.plain).labelStyle(.titleAndIcon)
                if reader.reading == index, let note = reader.note { Text(note).font(.caption).foregroundStyle(Color.muted) }
            }
        }
    }
    private func chip(_ label: String, icon: String?) -> some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.caption2) }
            Text(label).lineLimit(1)
        }
        .font(.caption).foregroundStyle(Color.working)
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Color.white.opacity(0.07), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 1))
    }
    static func short(_ title: String) -> String {
        let plain = title.replacingOccurrences(of: #"\.(pdf|md|tex|txt|pptx?)$"#, with: "", options: [.regularExpression, .caseInsensitive])
        return plain.count > 28 ? String(plain.prefix(26)) + "…" : plain
    }
}

// Read aloud: an answer said in Fairy's voice, its clips fetched from the Mac in turn; or by the iPhone itself, saying
// why, when her voice can't be used.
@MainActor
@Observable
final class TutorReader: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    private(set) var reading: Int?
    private(set) var note: String?
    private var answer = ""
    private var nextPart = 0
    private var fetching = false
    private var player: AVAudioPlayer?
    private let fallback = AVSpeechSynthesizer()
    private weak var link: LinkClient?
    private var slug = ""
    private var chat = ""

    override init() { super.init(); fallback.delegate = self }

    func toggle(link: LinkClient, slug: String, chat: String?, index: Int, answer: String) {
        if reading == index { return stop() }
        stop()
        guard let chat else { return }
        (self.link, self.slug, self.chat, self.answer, reading, nextPart, note) = (link, slug, chat, answer, index, 0, nil)
        Task {
            try? await SpeechListener.prepareAudio(forListening: false)
            do {
                let said: SpeakReply = try await link.studyPost("notebook-speak", ["slug": slug, "chat": chat, "index": index])
                if let problem = said.problem { note = problem; speakHere() }
            } catch { note = error.localizedDescription; speakHere() }
        }
    }
    func refresh(link: LinkClient, slug: String, chat: String?) {
        guard reading != nil, slug == self.slug, chat == self.chat, let live = link.tutor, live.slug == slug, live.chat == chat, let voice = live.voice, voice.problem == nil else { return }
        guard player?.isPlaying != true, !fetching else { return }
        if voice.parts > nextPart { return fetchClip() }
        if voice.done { if voice.parts == 0 { speakHere() } else { finish() } }
    }
    private func fetchClip() {
        guard let link else { return }
        let index = nextPart
        fetching = true
        Task {
            defer { fetching = false }
            guard let data = await link.studyVoicePart(slug: slug, chat: chat, index: index), reading != nil else { return }
            nextPart = index + 1
            guard let clip = try? AVAudioPlayer(data: data) else { return }
            clip.delegate = self
            clip.prepareToPlay()
            player = clip
            clip.play()
        }
    }
    private func speakHere() {
        guard reading != nil, !fallback.isSpeaking else { return }
        fallback.speak(AVSpeechUtterance(string: VoiceTalk.plain(answer)))
    }
    private func finish() { reading = nil; player = nil; SpeechListener.releaseAudio() }
    func stop() {
        let was = reading != nil
        reading = nil
        player?.stop(); player = nil
        fallback.stopSpeaking(at: .immediate)
        if was {
            if let link, !chat.isEmpty { Task { [slug, chat] in let _: SpeakReply? = try? await link.studyPost("notebook-stop", ["slug": slug, "chat": chat]) } }
            SpeechListener.releaseAudio()
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in if let link = self.link { self.refresh(link: link, slug: self.slug, chat: self.chat) } }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }
}
