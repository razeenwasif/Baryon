import SwiftUI

// Baryon Hub: Usage & Limits, Research investigations, Analytics & AutoML, Boards, and Pages.
struct MakeView: View {
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    @State private var section = HubSection.usage
    @State private var making: MakeKind?
    @State private var kind: String?
    @State private var problem: String?
    @State private var showingWeek = false

    enum HubSection: String, CaseIterable {
        case usage = "Usage"
        case research = "Research"
        case analytics = "Analytics"
        case boards = "Boards"
        case pages = "Pages"
    }

    private var shown: [PageItem] {
        link.pages.filter { kind == nil || MakeKind.matches(kind!, $0.kind) }.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Hub").font(.system(size: 30, weight: .semibold)).foregroundStyle(Color.ink)
                        Text(link.macName).font(.subheadline).foregroundStyle(Color.muted)
                    }
                    Spacer()
                    Button { showingWeek = true } label: {
                        Label("Week", systemImage: "calendar")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Color.soft)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Color.raised, in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(HubSection.allCases, id: \.self) { item in
                            let selected = section == item
                            Button { withAnimation(.snappy) { section = item } } label: {
                                Text(item.rawValue)
                                    .font(.system(size: 13.5, weight: selected ? .semibold : .medium))
                                    .foregroundStyle(selected ? Color.ink : Color.dim)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(selected ? Color.hover : Color.card, in: Capsule())
                                    .overlay(Capsule().strokeBorder(selected ? Color.hairlineStrong : Color.hairline, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.top, 14)
                .padding(.bottom, 16)

                switch section {
                case .usage: UsageView()
                case .research: ResearchSectionView()
                case .analytics: AnalyticsSectionView()
                case .boards: BoardsSectionView()
                case .pages: pagesSection
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 26)
            .padding(.bottom, 32)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade(reach: 4) }
        .fullScreenCover(isPresented: $showingWeek) { WeekDashboard() }
        .sheet(item: $making) { kind in MakeSheet(kind: kind) { words in making = nil; make(words) }.presentationDetents([.medium]).presentationBackground { Color.ground } }
        .onWallpaper(0.45)
        .safeAreaInset(edge: .bottom, spacing: 0) { TabPill() }
        .toolbar(.hidden, for: .navigationBar)
        .task { problem = await link.refreshPages() }
        .refreshable { problem = await link.refreshPages() }
    }

    @ViewBuilder private var pagesSection: some View {
        WeekCard { showingWeek = true }
        Text("Templates").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 18)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) { ForEach(MakeTemplate.all) { template in TemplateCard(template: template) { make(template.prompt) } } }
        }
        .padding(.top, 8)
        HStack(spacing: 0) {
            chip("All", icon: "square.grid.2x2", tint: Color.ink, selected: kind == nil, has: true) { kind = nil }
            ForEach(MakeKind.all) { item in
                let has = link.pages.contains { MakeKind.matches(item.id, $0.kind) }
                chip(item.name, icon: item.symbol, tint: item.tint, selected: kind == item.id, has: has) {
                    if has { kind = kind == item.id ? nil : item.id } else if link.reach == .connected { making = item }
                }
            }
        }
        .padding(.top, 16)
        if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(.top, 10) }
        if shown.isEmpty {
            Text("Nothing yet. Tap a kind above to make one, or ask Baryon for a document, slides or a dashboard.").font(.subheadline).foregroundStyle(Color.dim).padding(.top, 24)
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                if let chosen = MakeKind.all.first(where: { $0.id == kind }) {
                    NewTile(kind: chosen) { making = chosen }.disabled(link.reach != .connected)
                }
                ForEach(shown) { MakeTile(page: $0) }
            }
            .padding(.top, 16)
        }
    }

    // Starts it in a new chat in the Chat tab, where you can watch her make it.
    private func make(_ words: String) {
        tabs.make = words
        tabs.current = .chat
    }

    // A kind's icon on its own: bright in its colour when chosen, dimmed otherwise. Its name is for VoiceOver.
    private func chip(_ name: String, icon: String, tint: Color, selected: Bool, has: Bool, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            Image(systemName: icon).font(.system(size: 19, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? tint : has ? tint.opacity(0.75) : Color.dim.opacity(0.35))
                // An equal share of the row each, so all eight fit without scrolling, and the whole share takes the tap.
                .frame(maxWidth: .infinity, minHeight: 40)
                .contentShape(Rectangle())
                .shadow(color: selected ? tint.opacity(0.5) : .clear, radius: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityValue(has ? "" : "None yet")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct MakeTile: View {
    let page: PageItem
    @Environment(LinkClient.self) private var link
    private var when: String { page.updatedAt.flatMap(parsedDate).map { $0.formatted(.relative(presentation: .named)) } ?? "" }
    var body: some View {
        NavigationLink { PageView(page: page) } label: {
            VStack(alignment: .leading, spacing: 0) {
                // A picture of the page's top once it's made (see PagePreviews), and its kind's icon until then.
                ZStack {
                    LinearGradient(colors: [page.tint.opacity(0.3), page.tint.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    if let picture = PagePreviews.shared.picture(for: page) {
                        Image(uiImage: picture).resizable().scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .clipped()
                            .transition(.opacity)
                    } else {
                        Image(systemName: page.symbol)
                            .font(.system(size: 30, weight: .light))
                            .foregroundStyle(page.tint)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 124)
                .clipped()
                .animation(.easeOut(duration: 0.3), value: PagePreviews.shared.picture(for: page) != nil)
                .task(id: PagePreviews.key(page)) { PagePreviews.shared.want(page, link: link) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(page.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(2).multilineTextAlignment(.leading)
                    Text([page.kindName, when].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(Color.muted).lineLimit(1)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .raised(radius: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(page.title), \(page.kindName)")
    }
}

// The kinds of thing Fairy makes, each with the words that ask the Mac for it.
struct MakeKind: Identifiable, Hashable {
    let id: String
    let name: String
    let symbol: String
    let tint: Color
    let ask: String
    let placeholder: String
    func prompt(_ topic: String) -> String { "\(ask) \(topic)" }
    // Whether a page of this kind, as the Mac names it, is one of these.
    static func matches(_ id: String, _ kind: String) -> Bool {
        switch id {
        case "doc": kind == "doc" || kind == "document"
        case "canvas": kind == "canvas" || kind == "design"
        default: kind == id
        }
    }

    static let all: [MakeKind] = [
        MakeKind(id: "page", name: "Web page", symbol: "globe", tint: Color(hex: 0xE5707E), ask: "Make a web page about", placeholder: "My trip to Melbourne"),
        MakeKind(id: "doc", name: "Docs", symbol: "doc.text", tint: Color(hex: 0x6E86FF), ask: "Make a document about", placeholder: "A study guide for COMP3600"),
        MakeKind(id: "slides", name: "Slides", symbol: "rectangle.on.rectangle.angled", tint: Color(hex: 0xF2A65A), ask: "Make slides about", placeholder: "My research project"),
        MakeKind(id: "sheet", name: "Sheet", symbol: "tablecells", tint: Color(hex: 0x5FC98A), ask: "Make a spreadsheet for", placeholder: "Splitting rent and bills"),
        MakeKind(id: "dashboard", name: "Dashboard", symbol: "chart.bar.xaxis", tint: Color(hex: 0x4FC3B6), ask: "Make a dashboard for", placeholder: "My study hours this semester"),
        MakeKind(id: "whiteboard", name: "Whiteboard", symbol: "scribble.variable", tint: Color(hex: 0xB9A6FF), ask: "Make a whiteboard to map out", placeholder: "Ideas for my app"),
        MakeKind(id: "canvas", name: "Design", symbol: "paintpalette", tint: Color(hex: 0xE59BD6), ask: "Make design mock-ups for", placeholder: "An onboarding screen"),
        MakeKind(id: "a2ui", name: "Interactive UI", symbol: "rectangle.3.group", tint: Color(hex: 0x7BA4FF), ask: "Make an interactive UI for", placeholder: "A loan payment calculator"),
    ]
}

// What it should be about, then off it goes.
private struct MakeSheet: View {
    let kind: MakeKind
    let start: (String) -> Void
    @State private var topic = ""
    @FocusState private var focused: Bool
    private var ready: Bool { !topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: kind.symbol).font(.headline).foregroundStyle(kind.tint).frame(width: 36, height: 36).background(kind.tint.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                Text("New \(kind.name == "Docs" ? "document" : kind.name.lowercased())").font(.title3.weight(.semibold)).foregroundStyle(Color.ink)
            }
            Text("\(kind.ask)…").font(.subheadline).foregroundStyle(Color.muted)
            TextField(kind.placeholder, text: $topic, axis: .vertical)
                .lineLimit(2...5).focused($focused).foregroundStyle(Color.ink)
                .padding(14).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            Button { start(kind.prompt(topic.trimmingCharacters(in: .whitespacesAndNewlines))) } label: {
                Text("Make it").font(.headline).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 50).background(Color.accent.opacity(ready ? 1 : 0.4), in: Capsule())
            }
            .disabled(!ready)
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear { focused = true }
    }
}

// Ready-made starts, as Duet has, that need nothing but Fairy.
struct MakeTemplate: Identifiable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let tint: Color
    let prompt: String
    static let all: [MakeTemplate] = [
        MakeTemplate(id: "todo", title: "Daily todo", detail: "Today’s list, by priority", symbol: "checklist", tint: Color(hex: 0x5FC98A), prompt: "Make a spreadsheet for a daily to-do list with priority, time needed and a done column"),
        MakeTemplate(id: "week", title: "Week planner", detail: "Lay out the week ahead", symbol: "calendar", tint: Color(hex: 0x6E86FF), prompt: "Make a whiteboard to map out my week, with a column for each day"),
        MakeTemplate(id: "study", title: "Study plan", detail: "Topics, days and revision", symbol: "graduationcap", tint: Color(hex: 0xF2A65A), prompt: "Make a document about a study plan for my next exam, with topics spread over the days left"),
        MakeTemplate(id: "budget", title: "Trip budget", detail: "Costs, split and totals", symbol: "airplane", tint: Color(hex: 0x4FC3B6), prompt: "Make a spreadsheet for a trip budget with travel, stay, food and activities, and totals"),
    ]
}

private struct TemplateCard: View {
    let template: MakeTemplate
    let start: () -> Void
    var body: some View {
        Button(action: start) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: template.symbol).font(.headline).foregroundStyle(template.tint)
                    Spacer()
                    Image(systemName: "plus").font(.footnote.weight(.semibold)).foregroundStyle(Color.dim)
                }
                Spacer(minLength: 0)
                Text(template.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                Text(template.detail).font(.caption).foregroundStyle(Color.muted).lineLimit(2)
            }
            .padding(14)
            .frame(width: 150, height: 120, alignment: .topLeading)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Makes a \(template.title.lowercased())")
    }
}

// First in a chosen kind's grid: make another of it.
private struct NewTile: View {
    let kind: MakeKind
    let start: () -> Void
    var body: some View {
        Button(action: start) {
            VStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 26, weight: .light)).foregroundStyle(kind.tint)
                Text("New \(kind.name == "Docs" ? "document" : kind.name.lowercased())").font(.subheadline.weight(.medium)).foregroundStyle(Color.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 180)
            .background(kind.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(kind.tint.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        }
        .buttonStyle(.plain)
    }
}
