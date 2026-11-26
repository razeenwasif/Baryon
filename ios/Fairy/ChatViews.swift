import SwiftUI

enum AppTab: Hashable { case fairy, chat, study, tasks, make }

@MainActor
@Observable
final class TabState {
    var current = AppTab.fairy
    var thinking: [AppTab: Bool] = [:]
    var make: String?
    var listen = false
}

struct TabPill: View {
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    @State private var typing = false

    var body: some View {
        Group {
            if !typing {
                HStack(spacing: 4) {
                    item(.fairy, "Baryon", "eye")
                    item(.chat, "Chat", "bubble.left")
                    item(.study, "Study", "books.vertical")
                    item(.tasks, "Work", "checklist", alert: !(link.overview?.approvals.isEmpty ?? true))
                    item(.make, "Hub", "square.grid.2x2")
                }
                .padding(.horizontal, 10)
                .padding(.top, 6)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity)
                .background {
                    Color.ground.opacity(0.96)
                        .overlay(alignment: .top) { Rectangle().fill(Color.hairline).frame(height: 0.5) }
                        .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in typing = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in typing = false }
    }

    private func item(_ tab: AppTab, _ name: String, _ icon: String, alert: Bool = false) -> some View {
        let selected = tabs.current == tab
        return Button { tabs.current = tab } label: {
            VStack(spacing: 3) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon).font(.system(size: 16, weight: selected ? .semibold : .regular))
                    if alert { Circle().fill(Color.asking).frame(width: 7, height: 7).offset(x: 6, y: -2).accessibilityHidden(true) }
                }
                .frame(height: 20)
                Text(name).font(.system(size: 10.5, weight: selected ? .semibold : .medium))
            }
            .foregroundStyle(selected ? Color.ink : Color.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(selected ? Color.hover : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? Color.hairline : .clear, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(alert ? "\(name), needs your OK" : name)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// The Obsidian message box with model/effort pill selector and voice toggle.
struct MessageBox: View {
    var placeholder = "Message Baryon"
    @Binding var text: String
    var replying = false
    var talk: (() -> Void)?
    var send: () -> Void
    var stop: () -> Void = {}
    var attach: ((AttachSource) -> Void)? = nil
    var holding = false
    var catalog: ModelCatalog? = nil
    @Binding var selection: ModelCatalog.Selection?

    init(
        placeholder: String = "Message Baryon",
        text: Binding<String>,
        replying: Bool = false,
        talk: (() -> Void)? = nil,
        send: @escaping () -> Void,
        stop: @escaping () -> Void = {},
        attach: ((AttachSource) -> Void)? = nil,
        holding: Bool = false,
        catalog: ModelCatalog? = nil,
        selection: Binding<ModelCatalog.Selection?> = .constant(nil)
    ) {
        self.placeholder = placeholder
        self._text = text
        self.replying = replying
        self.talk = talk
        self.send = send
        self.stop = stop
        self.attach = attach
        self.holding = holding
        self.catalog = catalog
        self._selection = selection
    }
    @FocusState private var focused: Bool
    @State private var pickingModel = false

    private var canSend: Bool { !holding && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var modelBadgeLabel: String {
        if let s = selection, !s.model.isEmpty {
            let short = s.model.replacingOccurrences(of: "claude-", with: "").replacingOccurrences(of: "gemini-", with: "")
            return s.effort.isEmpty ? short : "\(short) · \(s.effort)"
        }
        return "Auto"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let catalog {
                Button { pickingModel = true } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "cpu").font(.system(size: 10.5))
                        Text(modelBadgeLabel).font(.system(size: 11.5, weight: .medium)).lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(selection == nil ? Color.dim : Color.working)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.card, in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .sheet(isPresented: $pickingModel) {
                    ModelPickerSheet(catalog: catalog, selection: $selection)
                        .presentationDetents([.medium, .large])
                        .presentationBackground { Color.ground }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                if let attach {
                    Menu {
                        Button { attach(.files) } label: { Label("Files", systemImage: "doc") }
                        Button { attach(.folder) } label: { Label("Folder", systemImage: "folder") }
                        Button { attach(.photos) } label: { Label("Photos", systemImage: "photo.on.rectangle") }
                    } label: {
                        Image(systemName: "plus").font(.system(size: 18, weight: .regular)).foregroundStyle(Color.dim).frame(width: 34, height: 40).contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .accessibilityLabel("Attach files, a folder or photos")
                }
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .foregroundStyle(Color.ink)
                    .padding(.vertical, 9)
                if replying {
                    Button(action: stop) {
                        Image(systemName: "stop.fill").font(.system(size: 14)).foregroundStyle(Color.ground).frame(width: 38, height: 38).background(Color.ink, in: Circle())
                    }
                    .accessibilityLabel("Stop Baryon’s reply")
                } else if let talk, !canSend {
                    Button(action: talk) {
                        Image(systemName: "waveform").font(.system(size: 16, weight: .medium)).foregroundStyle(.white).frame(width: 38, height: 38).background(Color.accent, in: Circle())
                    }
                    .accessibilityLabel("Talk to Baryon")
                } else {
                    Button { send(); focused = false } label: {
                        Image(systemName: "arrow.up").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).frame(width: 38, height: 38).background(Color.accent, in: Circle()).opacity(canSend ? 1 : 0.4)
                    }
                    .disabled(!canSend)
                    .accessibilityLabel("Send")
                }
            }
            .padding(.leading, attach == nil ? 14 : 8)
            .padding([.trailing, .vertical], 6)
            .background(Color.raised, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            .buttonStyle(.plain)
            .contentShape(RoundedRectangle(cornerRadius: 22))
            .onTapGesture { focused = true }
        }
    }
}

private struct ModelPickerSheet: View {
    let catalog: ModelCatalog
    @Binding var selection: ModelCatalog.Selection?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Button {
                        selection = nil
                        dismiss()
                    } label: {
                        StratusCard(padding: 12) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Auto · Mac default").font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                                    Text("Uses \(providerName(catalog.current.provider)) · \(catalog.current.model)").font(.caption).foregroundStyle(Color.dim)
                                }
                                Spacer()
                                if selection == nil { Image(systemName: "checkmark").foregroundStyle(Color.working) }
                            }
                        }
                    }
                    .buttonStyle(.plain)

                    ForEach(catalog.providers) { prov in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(prov.name.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(0.8).foregroundStyle(Color.muted)
                                if !prov.connected { StratusBadge(text: "offline", tint: .removed) }
                            }
                            StratusCard(padding: 0) {
                                VStack(spacing: 0) {
                                    ForEach(Array(prov.models.enumerated()), id: \.element.id) { index, mod in
                                        if index > 0 { Divider().overlay(Color.hairline) }
                                        Button {
                                            let eff = selection?.provider == prov.id ? selection?.effort ?? "" : (prov.efforts.contains("medium") ? "medium" : prov.efforts.first ?? "")
                                            selection = ModelCatalog.Selection(provider: prov.id, model: mod.id, effort: eff)
                                            dismiss()
                                        } label: {
                                            HStack {
                                                Text(mod.name).font(.subheadline).foregroundStyle(Color.ink)
                                                Spacer()
                                                if selection?.provider == prov.id && selection?.model == mod.id {
                                                    Image(systemName: "checkmark").foregroundStyle(Color.working)
                                                }
                                            }
                                            .padding(.horizontal, 14)
                                            .frame(minHeight: 44)
                                            .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                            if let sel = selection, sel.provider == prov.id, !prov.efforts.isEmpty {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 6) {
                                        ForEach(prov.efforts, id: \.self) { eff in
                                            let label = eff.isEmpty ? "Default" : eff.capitalized
                                            let active = sel.effort == eff
                                            Button { selection?.effort = eff } label: {
                                                Text(label).font(.caption.weight(.medium))
                                                    .foregroundStyle(active ? Color.ink : Color.dim)
                                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                                    .background(active ? Color.hover : Color.card, in: Capsule())
                                                    .overlay(Capsule().strokeBorder(active ? Color.working : Color.hairline, lineWidth: 1))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                                .padding(.top, 2)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .onWallpaper()
            .navigationTitle("Model & Effort")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

// The Chat tab: a fresh chat with Fairy (her eye on the Aurora, then plain black once it begins), every chat behind the
// menu, and another fresh one from the button that appears once this one has begun.
struct ChatTab: View {
    @Environment(TabState.self) private var tabs
    @State private var fresh = UUID()
    @State private var showingChats = false
    @State private var open: ChatTarget?

    var body: some View {
        ConversationView(target: ChatTarget(id: nil, title: nil, firstMessage: nil), root: true,
                         openChats: { withAnimation(.snappy) { showingChats = true } }, newChat: { fresh = UUID() })
            .id(fresh)
            .overlay {
                if showingChats {
                    ChatDrawer(close: { showingChats = false }, compose: { target in
                        if target.id == nil && target.firstMessage == nil { fresh = UUID() } else { open = target }
                    })
                }
            }
            .navigationDestination(item: $open) { ConversationView(target: $0) }
            .onChange(of: tabs.make, initial: true) { _, words in
                guard let words else { return }
                tabs.make = nil
                open = ChatTarget(id: nil, title: nil, firstMessage: words)
            }
    }
}

struct ChatTarget: Hashable, Identifiable {
    var id: String?
    var title: String?
    var firstMessage: String?
}

// Home is your one thread with Fairy: the morning brief, her check-ins, quick requests from Siri, and anything you say
// here. It's the chat screen in its home form, with Fairy's header and the tabs.
struct HomeView: View {
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    @State private var open: ChatTarget?
    @State private var showingSettings = false
    @State private var showingChats = false
    @State private var showingWeek = false
    @State private var thread: String? = UserDefaults.standard.string(forKey: "homeThread")
    private let launch = LaunchRequest.shared

    var body: some View {
        ConversationView(target: ChatTarget(id: thread, title: "Baryon", firstMessage: nil), home: true, openSettings: { showingSettings = true }, openChats: { withAnimation(.snappy) { showingChats = true } }, openWeek: { showingWeek = true })
            .id(thread ?? "none")
            .fullScreenCover(isPresented: $showingWeek) { WeekDashboard() }
            .overlay { if showingChats { ChatDrawer(close: { showingChats = false }, compose: { open = $0 }) } }
            .navigationDestination(item: $open) { ConversationView(target: $0) }
            .sheet(isPresented: $showingSettings) { NavigationStack { SettingsView() }.presentationBackground { Color.ground } }
            // Siri, the Action button and Control Center ask for these as Fairy opens.
            .onChange(of: launch.listen, initial: true) { _, now in if now { launch.listen = false; open = nil; tabs.current = .fairy; tabs.listen = true } }
            .onChange(of: launch.chat, initial: true) { _, now in if let now { launch.chat = nil; tabs.listen = false; tabs.current = .fairy; if now != thread { open = ChatTarget(id: now, title: nil, firstMessage: nil) } } }
            .onChange(of: launch.answer, initial: true) { _, now in if now { launch.answer = false; tabs.listen = false; tabs.current = .tasks } }
            .onChange(of: link.overview?.thread) { _, now in if let now, now != thread { thread = now } }
            .task { if thread == nil, let made = try? await link.ensureThread() { thread = made } }
    }
}

// Every chat, sliding out from the left when you tap the menu on Fairy's tab: a new chat, search, pinned, work
// sessions, recent and folders. Opening one closes it; so do tapping beside it and swiping it back.
private struct ChatDrawer: View {
    let close: () -> Void
    let compose: (ChatTarget) -> Void
    @Environment(LinkClient.self) private var link
    @State private var search = ""
    @State private var shown = false
    @State private var drag: CGFloat = 0

    private var offline: Bool { link.reach == .outOfReach || link.reach == .tailscaleOff || link.reach == .mismatch }
    private var found: [ChatRow] {
        let term = search.trimmingCharacters(in: .whitespaces)
        return term.isEmpty ? link.chats : link.chats.filter { $0.title.localizedCaseInsensitiveContains(term) }
    }
    private var folders: [(name: String, chats: [ChatRow])] {
        Dictionary(grouping: found.filter { $0.folder != nil && $0.pinned != true }, by: { $0.folder ?? "" }).sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }.map { ($0.key, $0.value) }
    }

    var body: some View {
        GeometryReader { space in
            let width = min(340, space.size.width * 0.86)
            ZStack(alignment: .leading) {
                Color.black.opacity(shown ? 0.45 : 0).ignoresSafeArea().onTapGesture(perform: hide).accessibilityHidden(true)
                list
                    .frame(width: width)
                    .frame(maxHeight: .infinity)
                    .background { Color.well.ignoresSafeArea() }
                    .overlay(alignment: .trailing) { Rectangle().fill(Color.hairline).frame(width: 1).ignoresSafeArea() }
                    .offset(x: (shown ? 0 : -width) + min(0, drag))
                    .gesture(DragGesture().onChanged { drag = $0.translation.width }.onEnded { if $0.translation.width < -width / 3 { hide() } else { withAnimation(.snappy) { drag = 0 } } })
            }
        }
        .onAppear { withAnimation(.snappy) { shown = true } }
        .task { await link.refreshChats() }
        .accessibilityAddTraits(.isModal)
    }

    private func hide() {
        withAnimation(.snappy) { shown = false; drag = 0 } completion: { close() }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Chats").font(.system(size: 28, weight: .light)).foregroundStyle(Color.ink)
                    Spacer()
                    Button { compose(ChatTarget(id: nil, title: nil, firstMessage: nil)); hide() } label: {
                        Image(systemName: "square.and.pencil").font(.body).foregroundStyle(Color.ink).frame(width: 40, height: 40).background(Color.raised, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("New chat")
                }
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.muted).accessibilityHidden(true)
                    TextField("Search chat titles", text: $search).foregroundStyle(Color.ink).autocorrectionDisabled()
                }
                .padding(.horizontal, 14)
                .frame(height: 42)
                .background(Color.raised, in: Capsule())
                .padding(.top, 10)
                if offline { Text("Can’t reach your Mac. You can still read chats saved on this iPhone.").font(.footnote).foregroundStyle(Color.dim).padding(.top, 10) }
                section("Pinned", found.filter { $0.pinned == true })
                section("Work sessions", found.filter { $0.work != nil && $0.pinned != true && $0.folder == nil && $0.state != "idle" })
                section("Recent", found.filter { $0.pinned != true && $0.folder == nil && !($0.work != nil && $0.state != "idle") })
                if !folders.isEmpty {
                    Label2("Folders")
                    ForEach(folders, id: \.name) { folder in
                        NavigationLink { FolderView(name: folder.name, chats: folder.chats) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "folder").foregroundStyle(Color.dim).accessibilityHidden(true)
                                Text(folder.name).font(.subheadline).foregroundStyle(Color.ink).lineLimit(1)
                                Spacer()
                                Text("\(folder.chats.count)").font(.footnote).foregroundStyle(Color.muted)
                            }
                            .frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .simultaneousGesture(TapGesture().onEnded(hide))
                    }
                }
                if found.isEmpty {
                    Text(search.isEmpty ? "No chats yet." : "No chats match that.").font(.subheadline).foregroundStyle(Color.dim).padding(.top, 24)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectStyle(.soft, for: .all)
        .refreshable { await link.refreshChats() }
    }

    @ViewBuilder private func section(_ name: String, _ chats: [ChatRow]) -> some View {
        if !chats.isEmpty {
            Label2(name)
            ForEach(chats) { ChatRowLink(row: $0).simultaneousGesture(TapGesture().onEnded(hide)) }
        }
    }
}

private struct Label2: View {
    let words: String
    init(_ words: String) { self.words = words }
    var body: some View { Text(words).font(.footnote).foregroundStyle(Color.muted).padding(.top, 16).padding(.bottom, 2) }
}

struct FolderView: View {
    let name: String
    let chats: [ChatRow]
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { ForEach(chats) { ChatRowLink(row: $0) } }.padding(.horizontal, 16)
        }
        .onWallpaper(0.45)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: name, back: "Back to chats") { dismiss() } }
    }
}

private struct ChatRowLink: View {
    let row: ChatRow
    @Environment(LinkClient.self) private var link
    @State private var confirming = false
    @State private var problem: String?
    var body: some View {
        NavigationLink {
            if row.work != nil { SessionView(row: SessionRow(id: row.id, title: row.title, folder: row.work, state: row.state)) }
            else { ConversationView(target: ChatTarget(id: row.id, title: row.title, firstMessage: nil)) }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).font(.subheadline).foregroundStyle(Color.ink).lineLimit(1)
                    if row.state == "waiting" { Text("Needs your OK").font(.footnote).foregroundStyle(Color.asking) }
                    else if row.state == "working" { Text("Working").font(.footnote).foregroundStyle(Color.working) }
                    else if let place = row.work { Text(place).font(.footnote).foregroundStyle(Color.muted).lineLimit(1) }
                }
                Spacer(minLength: 8)
                if row.state == "waiting" || row.state == "working" { DotLoader(kind: row.state == "waiting" ? .pulse : .orbit, color: row.state == "waiting" ? Color.asking : Color.working) }
                else if let when = row.shortDate { Text(when).font(.footnote).foregroundStyle(Color.muted) }
            }
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Long-press a chat to delete it. It goes to the Trash on the Mac, so it can still be brought back there.
        .contextMenu {
            Button(role: .destructive) { confirming = true } label: { Label("Delete chat", systemImage: "trash") }
                .disabled(row.state == "working" || row.state == "waiting")
        }
        .confirmationDialog("Delete “\(row.title)”?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete chat", role: .destructive) { Task { do { try await link.deleteChat(row.id) } catch { problem = error.localizedDescription } } }
        } message: { Text("It moves to the Trash on your Mac.") }
        .alert("Couldn’t delete the chat", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) { Button("OK", role: .cancel) {} } message: { Text(problem ?? "") }
    }
}

struct TopBar<Trailing: View>: View {
    let title: String
    let back: String
    var glass = true
    let action: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        ZStack {
            HStack(spacing: 4) {
                Button(action: action) {
                    Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        .background(Color.black.opacity(0.35), in: Circle())
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                }
                .foregroundStyle(Color.ink)
                .buttonStyle(.plain)
                .accessibilityLabel(back)
                Spacer(minLength: 4)
                trailing()
            }
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                .padding(.horizontal, 16)
                .frame(height: 38)
                .background(Color.black.opacity(0.35), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                .padding(.horizontal, 64)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .background { if glass { BarGlass() } }
    }
}
extension TopBar where Trailing == EmptyView {
    init(title: String, back: String, glass: Bool = true, action: @escaping () -> Void) {
        self.init(title: title, back: back, glass: glass, action: action) { EmptyView() }
    }
}

struct ConversationView: View {
    let target: ChatTarget
    var home = false
    // The Chat tab's own chat: the menu instead of a back button, a new-chat button once it has begun, and the tabs.
    var root = false
    var openSettings: () -> Void = {}
    var openChats: () -> Void = {}
    var openWeek: () -> Void = {}
    var newChat: () -> Void = {}
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    @Environment(\.dismiss) private var dismiss
    @State private var chatId: String?
    @State private var myTab: AppTab?
    @State private var text = ""
    @State private var pending: String?
    // Her thinking on the reply in progress: when it began, the latest of it, and once she writes, the folded copy.
    @State private var thinkingSince: Date?
    @State private var lastReasoning = ""
    @State private var thought: Thought?
    @State private var problem: String?
    @State private var timerNote: String?
    @State private var sentFirst = false
    @State private var saved: SessionDetail?
    // Talking to her here, in this chat: the message box becomes the voice bar and the glow runs along the bottom.
    @State private var voice: VoiceTalk?
    @State private var awayFromEnd = false
    // The message scroller: a tick per message, the messages on screen, and whether the chat is at its top or end.
    @State private var railItems: [MessageRail.Item] = []
    @State private var seen: [String] = []
    @State private var railEdges = RailEdges()
    @State private var attaching: [Attaching] = []
    @State private var pendingFiles: [Attached] = []
    @State private var choosing: AttachSource?
    @State private var modelSelection: ModelCatalog.Selection?
    @State private var speaker = ReplySpeaker()
    @AppStorage("speakReplies") private var speakReplies = false

    private var offline: Bool { link.reach == .outOfReach || link.reach == .tailscaleOff || link.reach == .mismatch }
    private var detail: SessionDetail? { (chatId != nil && link.chat?.id == chatId) ? link.chat : saved }
    private var replying: Bool { detail?.state == "working" }
    private var queued: [QueuedMessage] { chatId == nil ? [] : link.queue.filter { $0.chat == chatId } }
    private var writing: String? { detail?.live?.text.flatMap { $0.isEmpty ? nil : $0 } }
    private var failure: String? { problem ?? detail?.failure }
    // Once the Mac's copy has the message, the local one goes.
    private var showPending: Bool { guard let pending else { return false }; return detail?.messages.last(where: { $0.role == "user" })?.text != pending }
    // A chat starts with Fairy's eye in the middle of the Aurora; from its first message it's plain black, the eye up top.
    private var started: Bool { target.id != nil || chatId != nil || pending != nil || !(detail?.messages.isEmpty ?? true) }
    // The Living Aurora plays until Fairy answers: then the velvet pours in from her eye and the eye goes up top. A chat
    // opened with history is answered already.
    // On the Fairy tab, once her thread has an answer in it. A chat opened from the list has been answered already.
    private var answered: Bool { (!home && target.id != nil) || writing != nil || detail?.messages.contains(where: { $0.role == "assistant" }) == true }
    // An answer arriving now, as opposed to one already there when the chat opened: only that one gets the ripple.
    private var answeringNow: Bool { writing != nil || showPending || replying }
    private var mood: EyeMood { offline ? .sleeping : voice?.eyeMood ?? (replying ? .thinking : .idle) }
    // Home shows its greeting only once it knows its thread is empty; a chat until its first message.
    private var showsGreeting: Bool { home ? (detail != nil && detail?.messages.isEmpty == true && !showPending && queued.isEmpty) : !answered }
    // Said under her eye while she works on a reply, as Duet does.
    private var doing: String? {
        if writing != nil { return "Writing a reply" }
        if replying || (showPending && failure == nil && !offline) { return "Thinking it through" }
        return nil
    }

    // Which tick is lit: the first at the top, the last at the end, otherwise the middle one of the messages on screen.
    private var railActive: Int {
        if railEdges.atEnd || railItems.isEmpty { return railItems.count - 1 }
        if railEdges.atTop { return 0 }
        let shown = railItems.indices.filter { seen.contains(railItems[$0].id) }
        return shown.isEmpty ? railItems.count - 1 : shown[shown.count / 2]
    }
    // The scroll geometry only reports changes, not how the chat first lays out, so a chat that opens long and isn't
    // scrolled counts as overflowing once some of its messages are off screen.
    private var railOverflows: Bool { railEdges.overflows || (!seen.isEmpty && railItems.contains { !seen.contains($0.id) }) }
    private static func rail(_ messages: [SessionDetail.Message]) -> [MessageRail.Item] {
        messages.enumerated().map { index, message in
            let reply = message.role == "user" ? messages[(index + 1)...].first(where: { $0.role == "assistant" })?.text : nil
            let preview = MessageRail.preview(message.text, reply: reply)
            return MessageRail.Item(id: message.id, title: preview.title, detail: preview.detail, mine: message.role == "user")
        }
    }

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    let messages = detail?.messages ?? []
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if let stamp = DayStamp.between(index > 0 ? messages[index - 1].at : nil, message.at) { DayStamp(words: stamp) }
                        if index == thought?.answer, let thought { ThoughtFor(seconds: thought.seconds, reasoning: thought.text) }
                        if let from = message.from { NoteCard(from: from, text: message.text).id(message.id) } else { ChatBubble(role: message.role, text: message.text, attachments: message.attachments ?? []).id(message.id) }
                        if message.role == "assistant", let surfaces = message.a2ui, !surfaces.isEmpty {
                            ForEach(surfaces) { surface in
                                A2UISurfaceView(
                                    surface: surface,
                                    onDataChange: { surfaceId, path, value in
                                        guard let chatId else { return }
                                        Task { await link.sendA2UIData(chat: chatId, messageAt: message.at, surfaceId: surfaceId, path: path, value: value) }
                                    },
                                    onAction: { surfaceId, actionName, componentId, context in
                                        do {
                                            _ = try await link.sendA2UIAction(chat: chatId, surfaceId: surfaceId, title: surface.title, actionName: actionName, sourceComponentId: componentId, context: context)
                                        } catch {
                                            problem = error.localizedDescription
                                        }
                                    }
                                )
                            }
                        }
                        // Seen: under your latest message, once she has picked it up.
                        if message.role == "user", index == messages.lastIndex(where: { $0.role == "user" }), !showPending, index < messages.count - 1 || replying {
                            Text("Seen").font(.caption).foregroundStyle(Color.muted).frame(maxWidth: .infinity, alignment: .trailing).padding(.top, -10)
                        }
                        // Under her latest reply, a quick way to ask for it again, differently.
                        if message.role == "assistant", index == messages.count - 1, !replying, !showPending, !offline {
                            HStack(spacing: 8) {
                                SuggestChip(words: "Shorter", icon: "arrow.down.right.and.arrow.up.left") { send("Make that shorter.") }
                                SuggestChip(words: "Say more", icon: "text.append") { send("Tell me more about that.") }
                            }
                            .padding(.top, -6)
                        }
                    }
                    if showPending, let pending { ChatBubble(role: "user", text: pending, attachments: pendingFiles) }
                    ForEach(queued) { message in
                        VStack(alignment: .trailing, spacing: 4) {
                            ChatBubble(role: "user", text: message.text)
                            Text("Waiting for your Mac").font(.caption).foregroundStyle(Color.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    // A question this chat is waiting on, answered right here (a Calendar event, a step).
                    ForEach(link.overview?.approvals.filter { $0.session != nil && $0.session == chatId } ?? []) { AskCard(approval: $0) }
                    ForEach(link.pages.filter { $0.session != nil && $0.session == chatId }) { PageCard(page: $0) }
                    // While she replies, her quill writes: on its own until words arrive, then under them.
                    if let writing {
                        if let thought, thought.answer == nil { ThoughtFor(seconds: thought.seconds, reasoning: thought.text) }
                        ChatBubble(role: "assistant", text: writing, streaming: true)
                        QuillView(width: 100).padding(.leading, 10)
                    } else if replying || (showPending && failure == nil && !offline) {
                        ThinkingBlock(label: doing ?? "Thinking it through", since: thinkingSince ?? .now, reasoning: detail?.live?.thinking, thoughts: detail?.live?.thoughts ?? [])
                        QuillView().padding(.leading, 6)
                    }
                    if (replying || writing != nil), let liveSurfaces = detail?.live?.a2ui, !liveSurfaces.isEmpty {
                        ForEach(liveSurfaces) { surface in
                            A2UISurfaceView(surface: surface)
                        }
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(Color.removed) }
                    if let timerNote { Text(timerNote).font(.footnote).foregroundStyle(Color.soft) }
                    Color.clear.frame(height: 1).id("end")
                }
                .scrollTargetLayout()
                // Room on the right for the message scroller.
                .padding(.leading, 16)
                .padding(.trailing, 26)
                .padding(.top, 8)
                // Room under the last message, so at rest it sits clear of the fade above the message box.
                .padding(.bottom, 30)
            }
            .defaultScrollAnchor(.bottom)
            // The message scroller stands in for the scroll bar, which would sit right beside it.
            .scrollIndicators(railOverflows && railItems.count > 1 ? .hidden : .automatic)
            .scrollDismissesKeyboard(.interactively)
            // No bars: what scrolls up to the header or down to the message box fades out instead (see EdgeFade).
            .scrollEdgeEffectHidden(true, for: .all)
            // Scrolled back through the chat, a button brings you to the latest.
            .onScrollGeometryChange(for: Bool.self) { $0.contentSize.height - $0.contentOffset.y - $0.containerSize.height > 280 } action: { _, away in
                withAnimation(.snappy) { awayFromEnd = away }
            }
            // The message scroller's: the messages on screen, and whether the chat overflows and is at its top or end.
            .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.2) { seen = $0 }
            .onScrollGeometryChange(for: RailEdges.self) {
                RailEdges(overflows: $0.contentSize.height > $0.containerSize.height + 1, atTop: $0.contentOffset.y + $0.contentInsets.top <= 56,
                          atEnd: $0.contentSize.height - $0.contentOffset.y - $0.containerSize.height + $0.contentInsets.bottom <= 56)
            } action: { _, edges in railEdges = edges }
            .overlay(alignment: .bottomTrailing) {
                if awayFromEnd {
                    Button { withAnimation { scroller.scrollTo("end", anchor: .bottom) } } label: {
                        Image(systemName: "arrow.down").font(.body.weight(.semibold)).foregroundStyle(Color.ink).frame(width: 40, height: 40).background(Color.black.opacity(0.45), in: Circle())
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Go to the latest message")
                    .padding(.trailing, 16)
                    .padding(.bottom, 8)
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
                }
            }
            .mask { EdgeFade() }
            .overlay(alignment: .trailing) {
                if railOverflows, railItems.count > 1, !showsGreeting {
                    MessageRail(items: railItems, active: railActive) { index in
                        guard railItems.indices.contains(index) else { return }
                        withAnimation(.smooth(duration: 0.45)) {
                            if index == railItems.count - 1 { scroller.scrollTo("end", anchor: .bottom) }
                            else { scroller.scrollTo(railItems[index].id, anchor: .center) }
                        }
                    }
                    .padding(.trailing, 2)
                    .padding(.top, 40)
                    .padding(.bottom, 72)
                    .transition(.opacity)
                }
            }
            .onChange(of: detail?.messages, initial: true) { railItems = Self.rail(detail?.messages ?? []) }
            // The greeting sits over the list, never in it: swapping a screen-tall item out of a lazy list that keeps to
            // its bottom left the list blank until something else redrew it.
            .overlay {
                if showsGreeting {
                    FairyGreeting(offline: offline, size: home ? 140 : 170, note: home ? "Your briefs, check-ins and anything you ask, from here or Siri, land here." : nil, eyeSpot: !home, quiet: !home && started, talk: offline ? nil : { startVoice() }, paused: tabs.current != myTab)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.35), value: showsGreeting)
            .onChange(of: writing) { scroller.scrollTo("end", anchor: .bottom) }
            .onChange(of: detail?.messages.count) { scroller.scrollTo("end", anchor: .bottom) }
            // Keeps the latest message above the keyboard.
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in withAnimation { scroller.scrollTo("end", anchor: .bottom) } }
        }
        .onWallpaper(home && !answered ? 0.5 : 0.15)
        .background {
            ZStack(alignment: .bottom) {
                Color.ground
                if let voice {
                    VoiceGlow(level: voice.mode == .listening ? voice.level : 0, working: voice.mode == .thinking || voice.mode == .starting)
                        .frame(height: 300)
                        .transition(.opacity)
                }
            }
            .ignoresSafeArea()
            .animation(.easeOut(duration: 0.5), value: voice == nil)
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaBar(edge: .top, spacing: 0) {
            if home { HomeHeader(offline: offline, mood: mood, doing: doing, thread: chatId, menu: openChats, settings: openSettings, week: openWeek) }
            else { ChatHeader(title: detail?.title ?? target.title ?? "New chat", doing: doing, started: answered, back: { dismiss() }, menu: root ? openChats : nil, newChat: root ? newChat : nil) }
        }
        .buttonStyle(.plain)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if !attaching.isEmpty { AttachingRow(items: attaching) { item in attaching.removeAll { $0.id == item.id } }.padding(.bottom, attaching.contains { $0.problem != nil } ? 22 : 6) }
                if let voice {
                    VoiceBar(talk: voice, close: endVoice)
                        .padding(.bottom, 8)
                        .transition(.opacity.combined(with: .offset(y: 8)))
                } else {
                    MessageBox(placeholder: offline ? "Leave a message for later" : "Message Baryon", text: $text, replying: replying, talk: offline ? nil : { startVoice() }, send: submit, stop: stopReply,
                               attach: offline ? nil : { choosing = $0 }, holding: attaching.contains(where: \.waiting), catalog: link.modelCatalog, selection: $modelSelection)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                if home || root { TabPill() }
            }
        }
        .modifier(AttachPickers(source: $choosing, picked: { urls in urls.forEach(upload) }, photo: { data, name in upload(data: data, name: name) }))
        // In chat mode one eye moves between the middle of the greeting and its place in the header.
        .overlayPreferenceValue(EyeSpots.self) { spots in
            if !home {
                GeometryReader { space in
                    if let spot = spots[answered ? "top" : "middle"] ?? spots["top"] {
                        let place = space[spot]
                        Button { if !offline { if let voice { voice.tap() } else { startVoice() } } } label: { FairyOrb(mood: mood, size: place.width, paused: tabs.current != myTab) }
                            .buttonStyle(.plain)
                            .frame(width: place.width, height: place.height)
                            .offset(x: place.minX, y: place.minY)
                            .accessibilityLabel(started ? "Fairy" : "Talk to Fairy")
                            .animation(.spring(duration: 0.8, bounce: 0.18), value: answered)
                    }
                }
                // Over the whole screen, so only the eye itself may take a tap, and only while it waits in the middle
                // (not disabled, which would grey her out).
                .allowsHitTesting(!started && !offline)
            }
        }
        .onAppear {
            if myTab == nil { myTab = tabs.current }
            if let key = chatId ?? (home ? "home" : nil), let savedSel = link.chatSelections[key] { modelSelection = savedSel }
            Task { if link.modelCatalog == nil { await link.refreshModels() } }
        }
        .onChange(of: modelSelection) { _, now in
            if let key = chatId ?? (home ? "home" : nil) {
                if let now { link.chatSelections[key] = now } else { link.chatSelections.removeValue(forKey: key) }
            }
        }
        // What Baryon is doing.
        .onChange(of: doing != nil, initial: true) { _, busy in if let myTab, tabs.current == myTab || !busy { tabs.thinking[myTab] = busy } }
        .onChange(of: replying || showPending, initial: true) { _, busy in
            if busy && thinkingSince == nil { thinkingSince = .now; lastReasoning = ""; thought = nil }
        }
        .onChange(of: detail?.live?.thinking) { _, now in if let now, !now.isEmpty { lastReasoning = now } }
        .onChange(of: writing != nil) { _, now in
            if now, let since = thinkingSince, !lastReasoning.isEmpty, thought == nil {
                thought = Thought(seconds: max(1, Int(Date.now.timeIntervalSince(since))), text: lastReasoning)
            }
            if !now && !replying {
                thinkingSince = nil
                if thought?.answer == nil { thought?.answer = (detail?.messages ?? []).lastIndex { $0.role == "assistant" } }
            }
        }
        .task {
            if myTab == nil { myTab = tabs.current }
            if chatId == nil { chatId = target.id }
            if let chatId, saved == nil { saved = ChatStore.loadChat(chatId) }
            if let first = target.firstMessage, !sentFirst { sentFirst = true; send(first) }
        }
        .task { await link.refreshPages() }
        .onChange(of: detail) { speaker.update(detail, link: link) }
        .task(id: [tabs.current == myTab ? "shown" : "hidden", chatId ?? ""]) {
            if tabs.current == myTab, let chatId { link.follow(chatId) }
        }
        .onDisappear { speaker.stop(); endVoice(); if let myTab { tabs.thinking[myTab] = false }; if link.followingChat == chatId { link.follow(nil) } }
        // Talking here: each update from the Mac plays her reply, and a chat it starts becomes this one.
        .onChange(of: link.chat) { _, now in voice?.update(now) }
        .onChange(of: voice?.chat) { _, now in if let now, chatId != now { chatId = now } }
        // Leaving the tab ends it, so the microphone is never left on behind another screen.
        .onChange(of: tabs.current) { _, now in if now != myTab { endVoice() } }
        .onChange(of: tabs.listen, initial: true) { _, now in if home, now, !offline { tabs.listen = false; startVoice() } }
    }

    private func startVoice() {
        guard voice == nil else { return }
        speaker.stop()
        let talk = VoiceTalk(link: link, chat: chatId)
        withAnimation(.easeOut(duration: 0.3)) { voice = talk }
        Task { await talk.begin() }
    }
    private func endVoice() {
        guard let talk = voice else { return }
        talk.end()
        if let chat = talk.chat, chatId != chat { chatId = chat }
        withAnimation(.easeOut(duration: 0.3)) { voice = nil }
    }

    private func submit() {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty, !attaching.contains(where: \.waiting) else { return }
        text = ""
        if offline { link.queueMessage(words, to: chatId) } else { send(words) }
    }
    // Each file, folder or photo goes to the Mac as soon as it's chosen.
    private func upload(_ url: URL) {
        let folder = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        let item = Attaching(name: url.lastPathComponent, folder: folder)
        attaching.append(item)
        Task {
            do { let ref = try await link.attach(url); settle(item.id) { $0.ref = ref } }
            catch { settle(item.id) { $0.problem = error.localizedDescription } }
        }
    }
    private func upload(data: Data, name: String) {
        let item = Attaching(name: name, photo: true)
        attaching.append(item)
        Task {
            do { let ref = try await link.attach(data: data, name: name); settle(item.id) { $0.ref = ref } }
            catch { settle(item.id) { $0.problem = error.localizedDescription } }
        }
    }
    private func settle(_ id: UUID, _ change: (inout Attaching) -> Void) {
        guard let index = attaching.firstIndex(where: { $0.id == id }) else { return }
        change(&attaching[index])
    }
    private func send(_ words: String) {
        // A timer is set here, on the iPhone, and isn't sent to the Mac.
        if let timer = TimerWords.parse(words) {
            Task { do { timerNote = try await Timers.start(timer) } catch { timerNote = error.localizedDescription } }
            return
        }
        // What's attached and ready goes with it; anything refused stays behind, its reason shown.
        let files = attaching.compactMap(\.ref)
        pendingFiles = files.map { Attached(name: $0.name, size: $0.size) }
        attaching.removeAll { $0.ref != nil }
        pending = words
        problem = nil
        Task {
            do {
                if speakReplies { speaker.expect(words) }
                // Home always speaks into its thread, making it first if the Mac hasn't yet.
                if home, chatId == nil { chatId = try await link.ensureThread() }
                chatId = try await link.send(words, to: chatId, voice: speakReplies, attachments: files, selection: modelSelection)
            } catch {
                speaker.stop()
                problem = error.localizedDescription
                pending = nil
                text = words
                attaching.insert(contentsOf: files.map { Attaching(name: $0.name, folder: $0.folder ?? false, ref: $0) }, at: 0)
            }
        }
    }
    private func stopReply() {
        guard let chatId else { return }
        speaker.stop()
        Task { do { try await link.stop(chatId) } catch { problem = error.localizedDescription } }
    }
}

// A message between Fairy's sessions: who it's from (or to), then what it says, drawn apart from your own messages.
struct NoteCard: View {
    let from: SessionDetail.Message.From
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(from.project.map { "\(from.heading) · \($0)" } ?? from.heading, systemImage: from.kind == "sent" ? "arrow.up.right" : "arrow.down.left")
                .font(.caption).foregroundStyle(Color.muted).lineLimit(2)
            MarkdownText(text: text)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.1)))
        .accessibilityElement(children: .combine)
    }
}

struct ChatBubble: View {
    let role: String
    let text: String
    var attachments: [Attached] = []
    // A reply still arriving fades its newest words in.
    var streaming = false

    // Bold, italics, links and code words. Whole documents stay as plain text rather than something half-drawn.
    private var words: AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    var body: some View {
        if role == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                if !attachments.isEmpty { AttachedRow(items: attachments) }
                HStack {
                    Spacer(minLength: 48)
                    Text(words).font(.subheadline).foregroundStyle(Color.ink).padding(.horizontal, 16).padding(.vertical, 10).raised(Color.raised, radius: 18).textSelection(.enabled)
                }
            }
        } else {
            HStack {
                // Fairy's words straight on the background, with nothing drawn around them.
                Group { if streaming { StreamingMarkdown(text: text) } else { MarkdownText(text: text) } }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 4)
                Spacer(minLength: 24)
            }
        }
    }
}

// Home's top, Duet's way and straight on the Aurora: the menu of every chat on the left, settings on the right, and
// Fairy's eye between them with what she's up to under it. When something needs your OK or tasks are running, that
// line takes you to Tasks.
private struct HomeHeader: View {
    let offline: Bool
    let mood: EyeMood
    var doing: String? = nil
    let thread: String?
    let menu: () -> Void
    let settings: () -> Void
    var week: () -> Void = {}
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    private var elsewhere: [Approval] { link.overview?.approvals.filter { $0.session == nil || $0.session != thread } ?? [] }
    private var working: Int { link.overview?.chats.filter { $0.state == "working" }.count ?? 0 }

    private var status: (words: String, colour: Color, tasks: Bool) {
        if offline { return ("Can’t reach \(link.macName)", Color.muted, false) }
        if let doing { return (doing, Color(hex: 0xA9C4FF), false) }
        if !elsewhere.isEmpty { return (elsewhere.count == 1 ? "Needs your OK" : "\(elsewhere.count) need your OK", Color.asking, true) }
        if working > 0 { return ("Working on your tasks", Color.working, true) }
        return (link.macName, link.reach == .connected ? Color.added : Color.muted, false)
    }

    var body: some View {
        HStack(alignment: .top) {
            // Every chat, and under it your week.
            VStack(spacing: -18) {
                round("line.3.horizontal", "All chats", action: menu)
                round("calendar", "Your week", action: week)
            }
            Spacer(minLength: 8)
            VStack(spacing: 6) {
                FairyOrb(mood: mood, size: 70, paused: tabs.current != .fairy)
                    .accessibilityLabel("Baryon")
                let now = status
                Button { if now.tasks { tabs.current = .tasks } } label: {
                    HStack(spacing: 7) {
                        // Busy states move; the plain connected dot doesn't.
                        if doing != nil { DotLoader(kind: .scan, color: Color(hex: 0xA9C4FF), dot: 2, gap: 1.5) }
                        else if now.tasks { DotLoader(kind: now.colour == Color.asking ? .pulse : .orbit, color: now.colour, dot: 2, gap: 1.5) }
                        else { Circle().fill(now.colour).frame(width: 7, height: 7).accessibilityHidden(true) }
                        SwapText(now.words).font(.footnote.weight(.medium)).foregroundStyle(now.tasks ? now.colour : Color.soft).lineLimit(1).shimmer(doing != nil)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .shadow(color: .black.opacity(0.6), radius: 3)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!now.tasks)
                .accessibilityHint(now.tasks ? "Opens Tasks" : "")
            }
            Spacer(minLength: 8)
            round("slider.horizontal.3", "Settings", action: settings)
        }
        .padding(.horizontal, 16)
        .padding(.top, 2)
        .padding(.bottom, 8)
    }

    private func round(_ icon: String, _ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // Just the icon on the Aurora, with a soft shadow to keep it readable; the tap area stays 44 points.
            Image(systemName: icon).font(.system(size: 20, weight: .medium)).foregroundStyle(Color.ink).frame(width: 44, height: 44)
                .shadow(color: .black.opacity(0.45), radius: 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .padding(.top, 13)
    }
}

// Where a chat's eye can be: "middle" in the greeting before the first message, "top" in the header after it.
struct EyeSpots: PreferenceKey {
    static var defaultValue: [String: Anchor<CGRect>] { [:] }
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) { value.merge(nextValue()) { $1 } }
}

// A chat's top, Duet's way: a round back button, and once the chat has begun, Fairy's eye in a circle with the chat's
// name under it. The eye itself is the chat's one moving eye, drawn over this place.
private struct ChatHeader: View {
    let title: String
    // While she works on a reply, what she's doing shows in place of the name.
    var doing: String? = nil
    let started: Bool
    let back: () -> Void
    // In the Chat tab: the menu of every chat in place of Back, and a new chat once this one has begun.
    var menu: (() -> Void)? = nil
    var newChat: (() -> Void)? = nil

    var body: some View {
        ZStack(alignment: .top) {
            HStack {
                if let menu { round("line.3.horizontal", "All chats", action: menu) }
                else { round("chevron.left", "Back", action: back) }
                Spacer()
                if let newChat, started { round("square.and.pencil", "New chat", action: newChat).transition(.opacity) }
            }
            .padding(.top, 13)
            VStack(spacing: 6) {
                Color.clear
                    .frame(width: 70, height: 70)
                    .overlay { Color.clear.frame(width: 58, height: 58).anchorPreference(key: EyeSpots.self, value: .bounds) { ["top": $0] } }
                    .opacity(started ? 1 : 0)
                HStack(spacing: 7) {
                    if doing != nil { DotLoader(kind: .scan, color: Color(hex: 0xA9C4FF), dot: 2, gap: 1.5) }
                    SwapText(doing ?? title).font(.footnote.weight(.medium)).foregroundStyle(doing == nil ? Color.soft : Color(hex: 0xA9C4FF)).lineLimit(1)
                        .shimmer(doing != nil)
                }
                    .animation(.easeInOut(duration: 0.3), value: doing)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .shadow(color: .black.opacity(0.6), radius: 3)
                    .padding(.horizontal, 60)
                    .opacity(started ? 1 : 0)
                    .accessibilityAddTraits(.isHeader)
            }
            .animation(.easeOut(duration: 0.4).delay(started ? 0.45 : 0), value: started)
        }
        .padding(.horizontal, 16)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .animation(.easeOut(duration: 0.3), value: started)
    }

    private func round(_ icon: String, _ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .medium)).foregroundStyle(Color.ink).frame(width: 44, height: 44)
                .shadow(color: .black.opacity(0.45), radius: 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
    }
}

// "Today 18:52" above a message when the day changes or after a quiet spell, as Duet does.
struct DayStamp: View {
    let words: String
    var body: some View {
        Text(words).font(.caption).foregroundStyle(Color.muted).frame(maxWidth: .infinity).padding(.vertical, 2)
    }
    static func between(_ earlier: String?, _ now: String?) -> String? {
        guard let now, let when = WeekDates.date(now) else { return nil }
        if let earlier, let before = WeekDates.date(earlier), Calendar.current.isDate(before, inSameDayAs: when), when.timeIntervalSince(before) < 3 * 3600 { return nil }
        let time = WeekDates.format(when, "jmm")
        if Calendar.current.isDateInToday(when) { return "Today \(time)" }
        if Calendar.current.isDateInYesterday(when) { return "Yesterday \(time)" }
        return "\(WeekDates.format(when, "EEEdMMM")) \(time)"
    }
}

// A suggestion under her reply that sends itself.
struct SuggestChip: View {
    let words: String
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label(words, systemImage: icon).font(.footnote.weight(.medium)).foregroundStyle(Color.soft)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Color.white.opacity(0.07), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// Shows a scrolling screen only between its top and bottom bars, fading out as it reaches them, so with no bars drawn
// nothing reads through behind the header or the message box.
struct EdgeFade: View {
    // How far above the top of the contents the fade starts. Under a header it starts just above the header's bottom
    // edge, so nothing reads through the header; on a screen whose title scrolls (Tasks, Make), at the status bar.
    var reach: CGFloat = 8
    var body: some View {
        GeometryReader { space in
            let top = space.safeAreaInsets.top, bottom = space.safeAreaInsets.bottom
            let whole = max(1, space.size.height + top + bottom)
            let fadeIn = min(max(0, top - reach), whole), shown = min(fadeIn + 40, whole)
            let hidden = max(shown, whole - bottom), fadeOut = max(shown, hidden - 28)
            LinearGradient(stops: [
                .init(color: .clear, location: fadeIn / whole), .init(color: .black, location: shown / whole),
                .init(color: .black, location: fadeOut / whole), .init(color: .clear, location: hidden / whole),
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
        }
    }
}

// Fairy's eye in the middle of an empty chat, with a greeting under it. Tapping the eye talks to her.
struct FairyGreeting: View {
    let offline: Bool
    var size: CGFloat = 170
    var note: String?
    // Leaves an empty place for the chat's one moving eye (see EyeSpots) instead of drawing its own.
    var eyeSpot = false
    // After you've sent: the words fade, and the eye waits in the middle for her answer.
    var quiet = false
    var talk: (() -> Void)?
    var paused = false
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening"
    }

    var body: some View {
        VStack(spacing: 12) {
            if eyeSpot {
                Color.clear.frame(width: size, height: size).anchorPreference(key: EyeSpots.self, value: .bounds) { ["middle": $0] }
            } else {
                Button { talk?() } label: { FairyOrb(mood: offline ? .sleeping : .idle, size: size, paused: paused) }
                    .buttonStyle(.plain)
                    .disabled(talk == nil)
                    .accessibilityLabel("Talk to Baryon")
            }
            if offline { OutOfReachWords() }
            else {
                VStack(spacing: 4) {
                    Text(greeting).font(.system(size: 32, weight: .light)).foregroundStyle(Color.ink)
                    Text("What’s on your mind?").font(.body).foregroundStyle(Color.soft)
                    if let note { Text(note).font(.footnote).foregroundStyle(Color.muted).padding(.top, 6) }
                }
                .multilineTextAlignment(.center)
                .opacity(quiet ? 0 : 1)
                .animation(.easeOut(duration: 0.4), value: quiet)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
    }
}

// Where a chat's scrolled to, for the message scroller.
struct RailEdges: Equatable {
    var overflows = false
    // A chat opens at its end.
    var atTop = false
    var atEnd = true
}
