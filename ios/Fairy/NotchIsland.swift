import SwiftUI
import AlarmKit

// A Dynamic Island for phones with a notch (iPhone X to 14, and 16e), until one with the real thing. While Fairy is open,
// a black pill around the notch springs open for her live things: an OK she's waiting on, a reply being written, a work
// session running, a timer counting down. It's drawn by the app, not the system, so it goes when you leave Fairy; phones
// that have a Dynamic Island use Live Activities instead and never show this.

enum NotchGeometry {
    // The model, from the simulator's environment there and uname on a phone.
    static let machine: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname(); uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }()
    // The notch's size in points, or nil for a phone without one: a Dynamic Island's top inset is 59 or more, a home
    // button's 20. iPhone 13, 14 and 16e have a narrower notch than X to 12.
    static func notch(topInset: CGFloat) -> CGSize? {
        guard (40...54).contains(topInset) else { return nil }
        let narrow = ["iPhone14,", "iPhone17,5"].contains { machine.hasPrefix($0) }
        return CGSize(width: narrow ? 162 : 210, height: 31)
    }
}

// Fairy's timers, with when each ends, since AlarmKit doesn't say how long a countdown has left.
enum IslandTimers {
    struct Entry: Codable, Equatable { var id: UUID; var name: String; var ends: Date }
    private static let key = "island.timers"
    static func add(id: UUID, name: String, seconds: Int) {
        var list = running.filter { $0.id != id }
        list.append(Entry(id: id, name: name, ends: .now.addingTimeInterval(TimeInterval(seconds))))
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }
    // Still counting down, and not stopped from the Lock Screen.
    static var running: [Entry] {
        guard let data = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        let alive = Set(((try? AlarmManager.shared.alarms) ?? []).map(\.id))
        return list.filter { $0.ends > .now && (alive.isEmpty || alive.contains($0.id)) }.sorted { $0.ends < $1.ends }
    }
}

// What the island shows, most pressing first.
struct IslandItem: Equatable {
    enum Kind: Equatable { case ok, writing, working, timer, usage }
    var kind: Kind
    var symbol: String
    var tint: Color
    var short: String          // beside the notch, a word or a number
    var title: String          // opened: what it is
    var detail: String         // opened: a line more
    var opens: AppTab?         // opened: where "Open" goes
    var ends: Date? = nil      // a timer's end, for its countdown
    var usage: [String: PlanUsage]? = nil  // plan usage, for the rings while nothing else is going on
}

// For trying the island without waiting for the real thing: launch with -IslandDemo ok|writing|working|timer
// (and -IslandOpen to start it opened), as -FairyDemo does for the rest of the app.
enum IslandDemo {
    static let arguments = ProcessInfo.processInfo.arguments
    static let kind: String? = arguments.firstIndex(of: "-IslandDemo").flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : "timer" }
    static let opened = arguments.contains("-IslandOpen")
    static let started = Date.now
    static func item(now: Date) -> IslandItem? {
        switch kind {
        case "ok": return IslandItem(kind: .ok, symbol: "hand.raised.fill", tint: Color(hex: 0xFFC46B), short: "OK?", title: "Needs your OK", detail: "Run npm test in Fairy", opens: .tasks)
        case "writing": return IslandItem(kind: .writing, symbol: "pencil.line", tint: Color(hex: 0x9FB2FF), short: "writing", title: "Fairy is writing", detail: "In Chat", opens: .chat)
        case "working": return IslandItem(kind: .working, symbol: "gearshape.2.fill", tint: Color(hex: 0x74E2A6), short: "3/7", title: "Notch island", detail: "Building the iPhone app", opens: .tasks)
        case "usage": return IslandItem(kind: .usage, symbol: "gauge.with.dots.needle.33percent", tint: .white, short: "", title: "Plan usage", detail: "", opens: nil, usage: [
            "claude": PlanUsage(at: nil, failed: nil, meters: [.init(short: "", label: "5-hour limit", used: 23, resets: "5:39pm"), .init(short: "", label: "Weekly limit", used: 41, resets: "Mon")]),
            "gemini": PlanUsage(at: nil, failed: nil, meters: [.init(short: "5h", label: "5-hour limit", used: 64, resets: "6:10pm")]),
            "codex": PlanUsage(at: nil, failed: nil, meters: [.init(short: "5h", label: "5-hour limit", used: 92, resets: "7:02pm")])])
        case "timer": let ends = started.addingTimeInterval(5 * 60); return ends > now ? IslandItem(kind: .timer, symbol: "timer", tint: Color(hex: 0xFF9F5F), short: "", title: "Pasta", detail: "Rings at \(ends.formatted(date: .omitted, time: .shortened))", opens: nil, ends: ends) : nil
        default: return nil
        }
    }
}

@MainActor
func islandItem(link: LinkClient, tabs: TabState, now: Date) -> IslandItem? {
    if IslandDemo.kind != nil { return IslandDemo.item(now: now) }
    if let ask = link.overview?.approvals.first {
        return IslandItem(kind: .ok, symbol: "hand.raised.fill", tint: Color(hex: 0xFFC46B), short: "OK?", title: "Needs your OK", detail: ask.title, opens: .tasks)
    }
    if let writing = tabs.thinking.first(where: { $0.value }) {
        return IslandItem(kind: .writing, symbol: "pencil.line", tint: Color(hex: 0x9FB2FF), short: "writing", title: "Fairy is writing", detail: writing.key == .chat ? "In Chat" : "On the Fairy tab", opens: writing.key)
    }
    if let work = link.overview?.chats.first(where: { $0.state != "idle" }) {
        let progress = work.progress.map { "\($0.done)/\($0.total)" } ?? "on it"
        return IslandItem(kind: .working, symbol: "gearshape.2.fill", tint: Color(hex: 0x74E2A6), short: progress, title: work.title, detail: work.doing ?? "Working on your Mac", opens: .tasks)
    }
    if let timer = IslandTimers.running.first {
        return IslandItem(kind: .timer, symbol: "timer", tint: Color(hex: 0xFF9F5F), short: "", title: timer.name, detail: "Rings at \(timer.ends.formatted(date: .omitted, time: .shortened))", opens: nil, ends: timer.ends)
    }
    // Nothing going on: Claude Code, agy and Codex's plan usage, as rings.
    if let usage = link.overview?.usage, !usage.isEmpty {
        return IslandItem(kind: .usage, symbol: "gauge.with.dots.needle.33percent", tint: .white, short: "", title: "Plan usage", detail: "", opens: nil, usage: usage)
    }
    return nil
}

struct NotchIsland: View {
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs
    @State private var open = IslandDemo.opened
    @State private var shown: IslandItem?
    let notch: CGSize
    let screenWidth: CGFloat
    var onActive: (Bool) -> Void = { _ in }

    private let wing: CGFloat = 46
    private var spring: Animation { .spring(response: 0.42, dampingFraction: 0.68) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let item = islandItem(link: link, tabs: tabs, now: context.date)
            island(item, now: context.date)
                .onChange(of: item?.kind) { _, _ in withAnimation(spring) { shown = item; if item == nil { open = false } }; onActive(item != nil) }
                .onChange(of: item) { _, value in if value?.kind == shown?.kind { shown = value } }
                .onAppear { shown = item; onActive(item != nil) }
        }
    }

    // Closed it hugs the notch, so it can't be seen; with something to show it grows wings either side; tapped, it
    // drops down into a card.
    @ViewBuilder private func island(_ item: IslandItem?, now: Date) -> some View {
        let active = shown != nil
        let width = open ? screenWidth - 22 : active ? notch.width + wing * 2 : notch.width
        let height = open ? notch.height + (shown?.kind == .usage ? 136 : 92) : notch.height + (active ? 3 : 0)
        let radius: CGFloat = open ? 34 : active ? 16 : 10
        ZStack(alignment: .top) {
            UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous)
                .fill(.black)
                .shadow(color: .black.opacity(open ? 0.45 : 0), radius: 18, y: 8)
            if let shown {
                if open { Group { if shown.kind == .usage { usageCard(shown.usage ?? [:]) } else { expanded(shown, now: now) } }.transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .top))) }
                else if shown.kind == .usage { usageWings(shown.usage ?? [:]).transition(.opacity) }
                else { compact(shown, now: now).transition(.opacity) }
            }
        }
        .frame(width: width, height: height)
        .contentShape(Rectangle())
        .onTapGesture { guard shown != nil else { return }; withAnimation(spring) { open.toggle() } }
        .animation(spring, value: width)
        .animation(spring, value: height)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(shown.map { "\($0.title). \($0.detail)" } ?? "")
        .accessibilityHidden(shown == nil)
        .task(id: open) { if open && !IslandDemo.opened { try? await Task.sleep(for: .seconds(8)); withAnimation(spring) { open = false } } }
    }

    // Beside the notch: a symbol on the left wing, a word or a countdown on the right.
    private func compact(_ item: IslandItem, now: Date) -> some View {
        HStack(spacing: 0) {
            Image(systemName: item.symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(item.tint)
                .symbolEffect(.pulse, options: .repeating, isActive: item.kind != .timer)
                .frame(width: wing, alignment: .center)
            Spacer(minLength: notch.width)
            Text(item.ends.map { countdown(to: $0, now: now) } ?? item.short)
                .font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(item.tint).lineLimit(1).minimumScaleFactor(0.7)
                .frame(width: wing, alignment: .center)
        }
        .frame(height: notch.height)
    }

    // Dropped down: what it is, a line more, and a way to go to it.
    private func expanded(_ item: IslandItem, now: Date) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: item.symbol).font(.system(size: 22, weight: .semibold)).foregroundStyle(item.tint)
                .frame(width: 44, height: 44).background(item.tint.opacity(0.16), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(item.ends.map { "\(countdown(to: $0, now: now)) left · \(item.detail)" } ?? item.detail)
                    .font(.system(size: 12.5)).foregroundStyle(.white.opacity(0.65)).lineLimit(2)
            }
            Spacer(minLength: 4)
            if let tab = item.opens {
                Button { withAnimation(spring) { open = false }; tabs.current = tab } label: {
                    Text("Open").font(.system(size: 13, weight: .semibold)).foregroundStyle(.black)
                        .padding(.horizontal, 14).padding(.vertical, 7).background(item.tint, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, notch.height + 10)
        .padding(.bottom, 14)
    }

    // The three services, in the order they sit on the wings: Claude Code and agy on the left, Codex on the right.
    private static let services: [(key: String, name: String, tint: Color)] = [("claude", "Claude Code", Color(hex: 0xE0876A)), ("gemini", "agy", Color(hex: 0x7F9CFF)), ("codex", "Codex", Color(hex: 0x74E2A6))]
    private func usageWings(_ usage: [String: PlanUsage]) -> some View {
        let rings = Self.services.map { UsageRing(used: usage[$0.key]?.meters.first?.used, tint: $0.tint, size: 15) }
        return HStack(spacing: 0) {
            HStack(spacing: 7) { rings[0]; rings[1] }.frame(width: wing)
            Spacer(minLength: notch.width)
            rings[2].frame(width: wing)
        }
        .frame(height: notch.height)
    }
    // Opened: each service's limits, how far through them, and when they reset.
    private func usageCard(_ usage: [String: PlanUsage]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Self.services, id: \.key) { service in
                let plan = usage[service.key], first = plan?.meters.first
                HStack(spacing: 10) {
                    UsageRing(used: first?.used, tint: service.tint, size: 24)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(service.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                        Text(plan.map { plan in plan.meters.map { "\($0.short.isEmpty ? ($0.label.contains("5-hour") ? "5h" : $0.label.contains("Weekly") ? "week" : $0.label) : $0.short.lowercased()) \($0.used.map { "\(Int($0))%" } ?? "–")" }.joined(separator: " · ") } ?? "no reading from the Mac")
                            .font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if let resets = first?.resets, !resets.isEmpty { Text("resets \(resets)").font(.system(size: 11)).foregroundStyle(.white.opacity(0.45)).lineLimit(1) }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, notch.height + 10)
        .padding(.bottom, 12)
    }

    private func countdown(to end: Date, now: Date) -> String {
        let left = max(0, Int(end.timeIntervalSince(now).rounded(.up)))
        return left >= 3600 ? String(format: "%d:%02d:%02d", left / 3600, left / 60 % 60, left % 60) : String(format: "%d:%02d", left / 60, left % 60)
    }
}

// Over the whole app, at the very top: only on a phone with a notch, and hiding the status bar while it's showing so its
// wings don't sit over the time and battery. It measures itself inside its own overlay, leaving the app's layout alone.
struct NotchIslandLayer: ViewModifier {
    @State private var active = false
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                GeometryReader { space in
                    if let notch = NotchGeometry.notch(topInset: space.safeAreaInsets.top) {
                        NotchIsland(notch: notch, screenWidth: space.size.width) { active = $0 }
                            .frame(width: space.size.width, alignment: .top)
                            .offset(y: -space.safeAreaInsets.top)
                    }
                }
            }
            .statusBarHidden(active)
    }
}

// One plan's usage as a ring: how much of its first limit (usually the 5-hour one) is used, red when nearly full, a faint
// dotted ring when the Mac has no reading.
struct UsageRing: View {
    var used: Double?
    var tint: Color
    var size: CGFloat
    var body: some View {
        let share = min(1, max(0, (used ?? 0) / 100)), colour = (used ?? 0) >= 90 ? Color(hex: 0xFF6B6B) : tint
        ZStack {
            Circle().stroke(colour.opacity(used == nil ? 0.35 : 0.22), style: StrokeStyle(lineWidth: size > 20 ? 3 : 2.4, dash: used == nil ? [2, 2] : []))
            Circle().trim(from: 0, to: share).stroke(colour, style: StrokeStyle(lineWidth: size > 20 ? 3 : 2.4, lineCap: .round)).rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: share)
    }
}
