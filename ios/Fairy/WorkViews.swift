import SwiftUI

private struct StateLabel: View {
    let state: String
    var body: some View {
        switch state {
        case "waiting": label("Needs your OK", .asking, .pulse)
        case "working": label("Working", .working, .orbit)
        default: EmptyView()
        }
    }
    private func label(_ words: String, _ color: Color, _ kind: DotLoader.Kind) -> some View {
        HStack(spacing: 6) {
            DotLoader(kind: kind, color: color)
            Text(words).font(.footnote).foregroundStyle(color)
        }
    }
}

struct SessionView: View {
    let row: SessionRow
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @Environment(TabState.self) private var tabs
    @State private var myTab: AppTab?

    private var state: String { link.overview?.chats.first { $0.id == row.id }?.state ?? row.state }
    private var asks: [Approval] { link.overview?.approvals.filter { $0.session == row.id } ?? [] }
    private var detail: SessionDetail? { link.chat?.id == row.id ? link.chat : nil }

    var body: some View {
        ScrollView {
            // Duet's task page: what it is, what you asked, then what Fairy is doing as a checklist, and what she's said.
            VStack(alignment: .leading, spacing: 16) {
                Text(row.title).font(.system(size: 26, weight: .semibold)).foregroundStyle(Color.ink)
                if let ask = detail?.messages.first(where: { $0.role == "user" })?.text {
                    Text(ask).font(.body).foregroundStyle(Color.soft).lineLimit(8)
                }
                WavyRule().padding(.vertical, 2)
                ForEach(asks) { AskCard(approval: $0) }
                if let tasks = detail?.live?.tasks, !tasks.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("What Fairy is doing").font(.subheadline.weight(.semibold)).foregroundStyle(Color.muted)
                        ForEach(tasks) { TaskLine(task: $0) }
                    }
                } else if let steps = detail?.live?.rows, !steps.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("What Fairy is doing").font(.subheadline.weight(.semibold)).foregroundStyle(Color.muted)
                        ForEach(steps.suffix(8)) { StepLine(step: $0) }
                    }
                }
                if let writing = detail?.live?.text, !writing.isEmpty { Text(writing).font(.body.weight(.light)).foregroundStyle(Color.soft) }
                let updates = (detail?.messages ?? []).filter { $0.role == "assistant" }
                if !updates.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Decisions and updates").font(.subheadline.weight(.semibold)).foregroundStyle(Color.muted)
                        ForEach(updates.suffix(6).reversed()) { UpdateLine(message: $0) }
                    }
                }
                if detail == nil { HStack { Spacer(); QuillView(); Spacer() }.padding(.top, 40) }
            }
            .padding(16)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.5)
        .navigationBarBackButtonHidden(true)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 4) {
                Button { dismiss() } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44).shadow(color: .black.opacity(0.45), radius: 4).contentShape(Rectangle()) }
                    .foregroundStyle(Color.ink).accessibilityLabel("Back to work sessions")
                VStack(alignment: .leading, spacing: 0) {
                    Text(row.title).font(.headline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                    StateOrPlace(state: state, place: row.place)
                }
                Spacer(minLength: 4)
                EyeView(mood: state == "working" ? .thinking : .idle, size: 44)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .buttonStyle(.plain)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { if myTab == nil { myTab = tabs.current } }
        .task(id: tabs.current == myTab) { if tabs.current == myTab { link.follow(row.id) } }
        .onDisappear { if link.followingChat == row.id { link.follow(nil) } }
    }
}

private struct StateOrPlace: View {
    let state: String
    let place: String
    var body: some View {
        if state == "idle" { Text(place).font(.footnote).foregroundStyle(Color.muted).lineLimit(1) }
        else { StateLabel(state: state) }
    }
}

private struct TaskLine: View {
    let task: SessionDetail.Live.Task
    var body: some View {
        let active = task.status == "in_progress", done = task.status == "done" || task.status == "completed"
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Group {
                if done { Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, Color(hex: 0x3BA55C)) }
                else if active { ProgressView().controlSize(.small).tint(Color(hex: 0xA9C4FF)) }
                else { Image(systemName: "circle.dashed").foregroundStyle(Color.muted) }
            }
            .font(.title3)
            .frame(width: 22)
            .accessibilityHidden(true)
            Text(task.text).font(.body.weight(active ? .medium : .regular)).foregroundStyle(done || active ? Color.ink : Color.muted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(task.text), \(done ? "done" : active ? "in progress" : "to do")")
    }
}

// Something Fairy said along the way, newest first, as Duet's decisions and updates.
private struct UpdateLine: View {
    let message: SessionDetail.Message
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                MarkdownText(text: message.text).lineLimit(10)
                if let when = message.at.flatMap(parsedDate) {
                    Text("Fairy · \(when.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(Color.muted)
                }
            }
        }
    }
}

// The wavy rule under a task's brief, as on Duet's task page.
struct WavyRule: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            path.move(to: CGPoint(x: 0, y: size.height / 2))
            for x in stride(from: 0, through: size.width, by: 2) { path.addLine(to: CGPoint(x: x, y: size.height / 2 + sin(x / 5) * 2.2)) }
            context.stroke(path, with: .color(Color.white.opacity(0.22)), lineWidth: 1.2)
        }
        .frame(height: 8)
        .accessibilityHidden(true)
    }
}

private struct StepLine: View {
    let step: SessionDetail.Live.Step
    var body: some View {
        // Done, running, waiting for your OK, or failed, each with its own mark and colour.
        let (mark, color): (String, Color) = switch step.status {
        case "running": ("circle.dotted.circle", Color.working)
        case "failed": ("xmark.circle.fill", Color.removed)
        case "done": ("checkmark", Color.muted)
        case "waiting": ("hand.raised.fill", Color.asking)
        default: ("circle", Color.muted)
        }
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: mark).font(.caption.weight(.semibold)).foregroundStyle(color).frame(width: 16).symbolEffect(.pulse, isActive: step.status == "running").accessibilityHidden(true)
            Text(step.summary ?? step.tool ?? "").font(step.status == "running" || step.status == "waiting" ? .footnote.weight(.medium) : .footnote)
                .foregroundStyle(step.status == "waiting" ? Color.asking : step.status == "running" ? Color.ink : Color.soft).lineLimit(2)
        }
    }
}

private struct MessageLine: View {
    let message: SessionDetail.Message
    var body: some View {
        if let from = message.from {
            NoteCard(from: from, text: message.text)
        } else if message.role == "user" {
            HStack { Spacer(minLength: 48); Text(message.text).font(.subheadline).foregroundStyle(Color.ink).padding(.horizontal, 14).padding(.vertical, 10).background(Color.raised, in: RoundedRectangle(cornerRadius: 20)) }
        } else {
            MarkdownText(text: message.text)
        }
    }
}

// Shown when the Mac can't be reached. It says which end is the problem when the app can tell.
struct OutOfReachView: View {
    @Environment(LinkClient.self) private var link
    @State private var showingSettings = false
    var body: some View {
        ZStack {
            // Covers Work completely, so nobody answers an old question, with the wallpaper still showing through.
            Rectangle().fill(.ultraThickMaterial).overlay(Color(hex: 0x000208).opacity(0.4)).ignoresSafeArea()
            VStack(spacing: 10) {
                EyeView(mood: .sleeping, size: 200)
                OutOfReachWords()
                Button("Settings") { showingSettings = true }.font(.subheadline).foregroundStyle(Color.dim).frame(minHeight: 44)
            }
            .padding(.horizontal, 28)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { TabPill() }
        .sheet(isPresented: $showingSettings) { NavigationStack { SettingsView() }.presentationBackground { Color.ground } }
    }
}

// Says why the Mac can't be reached, in the same words wherever it's shown.
struct OutOfReachWords: View {
    @Environment(LinkClient.self) private var link
    var body: some View {
        let words: (title: String, detail: String) = switch link.reach {
        case .tailscaleOff: ("Tailscale is off", "Turn it on in the Tailscale app, and this iPhone can reach your Mac from anywhere.")
        // Connected fine, but what came back made no sense, so it isn't the network at fault.
        case .mismatch: ("Time to update", "Your Mac answered, but this app can’t read what it sent. Update the app and Fairy on your Mac.")
        default: ("Baryon’s out of reach", "Your Mac may be asleep, or Baryon may be closed. It’ll answer once they’re both back.")
        }
        VStack(spacing: 10) {
            Text(words.title).font(.system(size: 30, weight: .light)).foregroundStyle(Color.ink)
            Text(words.detail).font(.subheadline).foregroundStyle(Color.dim).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            if let heard = link.heardAt { Text("Last heard from at \(heard.formatted(date: .omitted, time: .shortened))").font(.footnote).foregroundStyle(Color.muted) }
            Button("Try again") { link.start() }.buttonStyle(PillButton()).frame(maxWidth: 180).padding(.top, 4)
        }
    }
}

struct SettingsView: View {
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    @State private var about: AboutMac?
    @State private var runningBrief = false
    @State private var briefStatusNote: String?
    @AppStorage("speakReplies") private var speakReplies = false
    @AppStorage(Lookout.lastCheck) private var lastCheck = 0.0
    @AppStorage(Lookout.lastCheckReached) private var lastCheckReached = false
    @State private var alertsAllowed: Bool?

    private var lastCheckWords: String {
        guard lastCheck > 0 else { return "Not yet" }
        let at = Date(timeIntervalSince1970: lastCheck), day = Calendar.current.isDateInToday(at) ? at.formatted(date: .omitted, time: .shortened) : at.formatted(.dateTime.day().month(.abbreviated).hour().minute())
        return lastCheckReached ? day : "\(day), Mac out of reach"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    EyeView(mood: link.reach == .connected ? .idle : .sleeping, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(link.pairing?.host.split(separator: ".").first.map(String.init) ?? "Your Mac").font(.body.weight(.medium)).foregroundStyle(Color.ink)
                        HStack(spacing: 6) {
                            Circle().fill(link.reach == .connected ? Color.added : Color.muted).frame(width: 8, height: 8).accessibilityHidden(true)
                            Text(link.reach == .connected ? "Connected" : link.reach == .tailscaleOff ? "Tailscale is off" : link.reach == .mismatch ? "Needs an update" : "Can’t reach it right now").font(.footnote).foregroundStyle(Color.dim)
                        }
                    }
                    Spacer()
                }
                .padding(10)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 20))
                heading("On this phone")
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        twoLines("Face ID before I allow a step", "Always on. Your passcode works if Face ID can’t.")
                        Spacer(minLength: 0)
                        Image(systemName: "faceid").foregroundStyle(Color.added).accessibilityHidden(true)
                    }
                    .frame(minHeight: 58)
                    Divider().overlay(Color.hairline)
                    Toggle(isOn: $speakReplies) { twoLines("Speak replies out loud", "Uses the voice you chose on your Mac") }
                        .tint(Color.accent)
                        .frame(minHeight: 58)
                }
                .padding(.horizontal, 14)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 20))
                heading("Notifications")
                VStack(spacing: 0) {
                    if alertsAllowed == false, let settings = URL(string: UIApplication.openSettingsURLString) {
                        Link(destination: settings) { row("Alerts", "Off, tap to turn on", opens: true) }
                    } else {
                        row("Alerts", alertsAllowed == true ? "On" : nil)
                    }
                    Divider().overlay(Color.hairline)
                    row("From your Mac", link.pushRegistered && alertsAllowed != false ? "Straight away" : "Not set up")
                    if !link.pushRegistered {
                        Divider().overlay(Color.hairline)
                        row("Last looked", lastCheckWords)
                    }
                }
                .padding(.horizontal, 14)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 20))
                Text(link.pushRegistered
                     ? "While you’re away from your Mac, it tells you as soon as Baryon needs your OK, finishes work, checks in or sends your morning brief."
                     : "To be told straight away, add your APNs key in Baryon’s Settings on your Mac, under Phone. Until then, iOS decides when Baryon may look, which can be hours apart.")
                    .font(.footnote).foregroundStyle(Color.muted).padding(.horizontal, 4)

                heading("Morning brief & check-ins")
                VStack(spacing: 0) {
                    let brief = about?.brief
                    row("Morning brief", brief.map { $0.enabled ? "Daily at \($0.time)" : "Off" })
                    if let last = brief?.lastBrief, !last.isEmpty {
                        Divider().overlay(Color.hairline)
                        row("Last delivered", last)
                    }
                    if let err = brief?.lastError {
                        Divider().overlay(Color.hairline)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Brief issue").font(.caption.weight(.semibold)).foregroundStyle(Color.removed)
                            Text(err.message).font(.footnote).foregroundStyle(Color.removed)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 10)
                    }
                    Divider().overlay(Color.hairline)
                    Button {
                        runningBrief = true; briefStatusNote = nil
                        Task {
                            defer { runningBrief = false }
                            do {
                                let res = try await link.runBrief(kind: "brief")
                                briefStatusNote = (res.pushed ?? 0) > 0 ? "Morning brief sent to your iPhone." : "Morning brief added to your thread."
                                about = await link.about()
                            } catch { briefStatusNote = error.localizedDescription }
                        }
                    } label: {
                        HStack {
                            Text(runningBrief ? "Running morning brief…" : "Run morning brief now").font(.subheadline.weight(.medium)).foregroundStyle(Color.working)
                            Spacer()
                            if runningBrief { ProgressView().controlSize(.small).tint(Color.working) }
                        }
                        .frame(minHeight: 46)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(runningBrief || link.reach != .connected)
                }
                .padding(.horizontal, 14)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.hairline, lineWidth: 1))
                if let briefStatusNote {
                    Text(briefStatusNote).font(.caption).foregroundStyle(Color.working).padding(.horizontal, 4)
                }

                heading("Baryon, on your Mac")
                VStack(spacing: 0) {
                    NavigationLink { UsageScreen() } label: { row("Usage & limits", nil, opens: true) }
                    Divider().overlay(Color.hairline)
                    NavigationLink { MemoryView() } label: { row("Long-term memory", about.map { "\($0.notes) \($0.notes == 1 ? "note" : "notes")" }, opens: true) }
                    Divider().overlay(Color.hairline)
                    NavigationLink { PagesView() } label: { row("Pages", about.map { "\($0.pages)" }, opens: true) }
                    Divider().overlay(Color.hairline)
                    NavigationLink { RunsView() } label: { row("Runs", nil, opens: true) }
                    Divider().overlay(Color.hairline)
                    row("Work sessions run on", about.map { providerName($0.workProvider) })
                    Divider().overlay(Color.hairline)
                    row("Routines", about.map { $0.routines == 0 ? "None on a schedule" : "\($0.routines) on a schedule" })
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 14)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.hairline, lineWidth: 1))
                Text("You can see these here. To change them, use Settings on your Mac.").font(.footnote).foregroundStyle(Color.muted).padding(.horizontal, 4)
                Button("Remove this phone") { confirming = true }.buttonStyle(PillButton(fill: Color.removed.opacity(0.14), ink: .removed)).padding(.top, 16)
            }
            .padding(16)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.45)
        .navigationBarBackButtonHidden(true)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 4) {
                Button { dismiss() } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44).shadow(color: .black.opacity(0.45), radius: 4).contentShape(Rectangle()) }.foregroundStyle(Color.ink).accessibilityLabel("Back")
                Text("Settings").font(.system(size: 28, weight: .light)).foregroundStyle(Color.ink)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .buttonStyle(.plain)
        }
        .toolbar(.hidden, for: .navigationBar)
        .confirmationDialog("Remove this phone from Baryon?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Remove this phone", role: .destructive) { Task { await link.forget(tellingMac: true) } }
        } message: {
            Text("You’ll need a new code from your Mac to pair again.")
        }
        .task {
            alertsAllowed = await link.lookout.alertsAllowed()
            about = await link.about()
        }
    }

    private func heading(_ words: String) -> some View {
        Text(words).font(.footnote).foregroundStyle(Color.muted).padding(.top, 12).padding(.leading, 4)
    }
    private func twoLines(_ title: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.subheadline).foregroundStyle(Color.ink)
            Text(note).font(.footnote).foregroundStyle(Color.muted)
        }
    }
    private func row(_ title: String, _ value: String?, opens: Bool = false) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.subheadline).foregroundStyle(Color.ink)
            Spacer(minLength: 8)
            if let value { Text(value).font(.subheadline).foregroundStyle(Color.muted) }
            if opens { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.dim).accessibilityHidden(true) }
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}

// How a provider is named to people, from the Mac's setting value.
func providerName(_ value: String) -> String {
    switch value.lowercased() {
    case "claude": "Claude"
    case "codex": "Codex"
    case "antigravity", "gemini": "Gemini"
    case "openai": "OpenAI"
    case "deepseek": "DeepSeek"
    default: value.isEmpty ? "—" : value.prefix(1).uppercased() + value.dropFirst()
    }
}
