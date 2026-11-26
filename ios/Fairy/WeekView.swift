import SwiftUI

// Your week, from the Mac (GET /v1/week): this week's calendar day by day, something to count down to, and the inbox.
struct WeekData: Codable, Equatable {
    struct Event: Codable, Equatable, Hashable {
        var title: String
        var start: String
        var end: String?
        var allDay: Bool
    }
    struct Day: Codable, Equatable, Identifiable {
        var date: String
        var events: [Event]
        var id: String { date }
    }
    struct Meetings: Codable, Equatable { var week: Int; var left: Int }
    struct Countdown: Codable, Equatable { var title: String; var date: String; var allDay: Bool; var days: Int }
    struct Source: Codable, Equatable { var connected: Bool; var error: String; var off: Bool }
    struct Sources: Codable, Equatable { var calendar: Source; var email: Source }
    // Something you told Fairy you'd do: due at a time, on a day (allDay), or with no date.
    struct Promise: Codable, Equatable, Identifiable { var id: String; var what: String; var due: String?; var allDay: Bool; var said: String; var overdue: Bool }
    var updated: String
    var start: String
    var end: String
    var days: [Day]
    var meetings: Meetings
    var unread: Int?
    var countdown: Countdown?
    var sources: Sources
    // Missing from a Mac that hasn't been updated yet.
    var promises: [Promise]?
    // What Fairy is working towards for you (goals), still open: read only here; a goal's cards come as any card does.
    struct Repro: Codable, Equatable { var arxiv: String; var reproduced: Int; var total: Int; var notReproduced: Int?; var couldntRun: Int?; var hasReport: Bool?; var summary: String }
    struct Goal: Codable, Equatable, Identifiable { var id: String; var outcome: String; var state: String; var reason: String?; var next: String; var running: Bool?; var done: Int; var steps: Int; var repro: Repro? }
    var goals: [Goal]?
}

// Dates as the Mac sends them: a time with its offset, or a plain day for all-day events.
enum WeekDates {
    static func date(_ text: String) -> Date? {
        if text.count == 10 {
            let day = DateFormatter()
            day.calendar = Calendar(identifier: .gregorian)
            day.locale = Locale(identifier: "en_US_POSIX")
            day.dateFormat = "yyyy-MM-dd"
            return day.date(from: text)
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        if let found = iso.date(from: text) { return found }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let found = iso.date(from: text) { return found }
        // Without an offset, it's the Mac's (and so this phone's) local time.
        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        local.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return local.date(from: String(text.prefix(19)))
    }
    static func format(_ date: Date, _ style: String) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate(style)
        return formatter.string(from: date)
    }
}

// The week as a page, the way Claude Duet draws a dashboard: paper, a dark card counting down, three numbers, and the
// days with their agenda. Opened from Make; it asks the Mac again whenever it opens or you refresh it.
struct WeekDashboard: View {
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var week: WeekData?
    @State private var loading = false
    @State private var problem: String?
    @State private var chosen: String?
    @State private var ticked: Set<String> = []

    static let paper = Color(hex: 0xF3F1EC), ink = Color(hex: 0x17181C), quiet = Color(hex: 0x6B6B73), line = Color(hex: 0xE4E1D9)
    static let accent = Color(hex: 0x3E5AEC), soft = Color(hex: 0xDFE5FF)

    private var todayKey: String { let parts = Calendar.current.dateComponents([.year, .month, .day], from: .now); return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0) }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let week { content(week) }
                    else if let problem { note(problem).padding(.top, 40) }
                    else { ProgressView().tint(Self.quiet).frame(maxWidth: .infinity).padding(.top, 80) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 40)
            }
            .refreshable { await load(force: true) }
        }
        .background(Self.paper.ignoresSafeArea())
        // A paper page, with a dark clock and battery over it.
        .preferredColorScheme(.light)
        .task { await load(force: false) }
    }

    private var header: some View {
        VStack(spacing: 6) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(Self.ink).frame(width: 44, height: 44)
                        .background(.white, in: Circle()).shadow(color: .black.opacity(0.06), radius: 6, y: 2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                VStack(alignment: .leading, spacing: 1) {
                    Text("Your week").font(.system(size: 17, weight: .semibold)).foregroundStyle(Self.ink)
                    Text("Refreshes when you open it").font(.caption).foregroundStyle(Self.quiet)
                }
                Spacer()
                Button { Task { await load(force: true) } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 15, weight: .semibold)).foregroundStyle(Self.ink).frame(width: 40, height: 40)
                        .background(.white, in: Circle()).shadow(color: .black.opacity(0.06), radius: 6, y: 2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh")
                .disabled(loading)
            }
            HStack(spacing: 6) {
                if loading { ProgressView().controlSize(.mini).tint(Self.quiet); Text("Loading \(sourceCount) sources") }
                else if let week, let updated = WeekDates.date(week.updated) { Text(Date.now.timeIntervalSince(updated) < 60 ? "Updated now" : "Updated \(updated.formatted(.relative(presentation: .named)))") }
                Spacer()
            }
            .font(.footnote)
            .foregroundStyle(Self.quiet)
            .padding(.leading, 4)
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }
    private var sourceCount: Int { 2 + (link.overview == nil ? 0 : 1) }

    @ViewBuilder private func content(_ week: WeekData) -> some View {
        let start = WeekDates.date(week.start) ?? .now
        Text("WEEK OF \(WeekDates.format(start, "MMMd").uppercased())").font(.footnote.weight(.semibold)).tracking(1.2).foregroundStyle(Self.accent).padding(.top, 14)
        Text("Your week").font(.system(size: 34, weight: .bold)).foregroundStyle(Self.ink).padding(.top, 4)
        Text("Meetings, inbox and what needs you in one place.").font(.body).foregroundStyle(Self.quiet).padding(.top, 2)
        hero(week).padding(.top, 18)
        HStack(spacing: 10) {
            tile("\(week.meetings.week)", "meetings this week · \(week.meetings.left) left")
            tile(week.unread.map { "\($0)" } ?? "–", week.sources.email.connected ? "unread in your inbox" : week.sources.email.error.isEmpty ? "Gmail isn’t connected" : "Gmail needs reconnecting")
            tile("\(needYou)", ready > 0 ? "need your OK · \(ready) ready to check" : "need your OK")
        }
        .padding(.top, 12)
        if let reason = sourceNote(week) { note(reason).padding(.top, 12) }
        if let promises = week.promises, !promises.isEmpty { said(promises).padding(.top, 26) }
        if let goals = week.goals, !goals.isEmpty { workingOn(goals).padding(.top, 26) }
        HStack(alignment: .firstTextBaseline) {
            Text("This week").font(.system(size: 22, weight: .bold)).foregroundStyle(Self.ink)
            Spacer()
            Text(range(week)).font(.subheadline).foregroundStyle(Self.quiet)
        }
        .padding(.top, 26)
        days(week).padding(.top, 10)
    }

    // What you said you'd do, ticked off here; it's gone from the list on the next refresh.
    private func said(_ promises: [WeekData.Promise]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("You said you’d").font(.system(size: 22, weight: .bold)).foregroundStyle(Self.ink)
            VStack(spacing: 0) {
                ForEach(Array(promises.enumerated()), id: \.element.id) { index, promise in
                    let done = ticked.contains(promise.id)
                    HStack(alignment: .top, spacing: 12) {
                        Button { Task { await tick(promise, !done) } } label: {
                            ZStack {
                                Circle().strokeBorder(done ? Self.accent : Self.quiet.opacity(0.6), lineWidth: 1.5).background(Circle().fill(done ? Self.accent : .clear))
                                if done { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
                            }
                            .frame(width: 24, height: 24).frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(done ? "Not done yet" : "Done")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(promise.what).font(.body.weight(.medium)).foregroundStyle(done ? Self.quiet : Self.ink).strikethrough(done)
                            Text(whenText(promise)).font(.footnote).foregroundStyle(promise.overdue && !done ? Color(hex: 0xC2410C) : Self.quiet).lineLimit(2)
                        }
                        .padding(.top, 10)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .accessibilityElement(children: .combine)
                    if index < promises.count - 1 { Rectangle().fill(Self.line).frame(height: 1).padding(.leading, 60) }
                }
            }
            .padding(.vertical, 4)
            .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Self.line, lineWidth: 1))
        }
    }
    // Fairy's goals: each one's outcome, where it stands, and its next step or why it waits.
    private func workingOn(_ goals: [WeekData.Goal]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Fairy is working on").font(.system(size: 22, weight: .bold)).foregroundStyle(Self.ink)
            VStack(spacing: 0) {
                ForEach(Array(goals.enumerated()), id: \.element.id) { index, goal in
                    HStack(alignment: .top, spacing: 12) {
                        Text(goal.id).font(.caption.weight(.semibold)).foregroundStyle(Self.accent)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Self.accent.opacity(0.12), in: Capsule())
                            .frame(width: 44, alignment: .center).padding(.top, 12)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(goal.outcome).font(.body.weight(.medium)).foregroundStyle(Self.ink).lineLimit(3)
                            if let repro = goal.repro {
                                HStack(spacing: 6) {
                                    Text("arXiv:\(repro.arxiv)").font(.caption2.weight(.semibold)).foregroundStyle(Self.accent)
                                        .padding(.horizontal, 6).padding(.vertical, 2).background(Self.soft, in: Capsule())
                                    Text(repro.hasReport == true ? "\(repro.summary) · Report ready" : repro.summary)
                                        .font(.caption).foregroundStyle(Self.quiet).lineLimit(1)
                                }
                            }
                            Text(goalLine(goal)).font(.footnote).foregroundStyle(goal.state == "waiting-you" ? Color(hex: 0xC2410C) : Self.quiet).lineLimit(3)
                        }
                        .padding(.vertical, 10)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .accessibilityElement(children: .combine)
                    if index < goals.count - 1 { Rectangle().fill(Self.line).frame(height: 1).padding(.leading, 60) }
                }
            }
            .padding(.vertical, 4)
            .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Self.line, lineWidth: 1))
        }
    }
    private func goalLine(_ goal: WeekData.Goal) -> String {
        let progress = goal.steps > 0 ? "\(goal.done) of \(goal.steps) steps" : "No steps yet"
        if goal.running == true { return "A step is running · \(progress)" }
        switch goal.state {
        case "waiting-you": return "Waiting for you · \(goal.reason ?? "open it on your Mac")"
        case "waiting": return goal.reason ?? "Waiting"
        case "paused": return "Paused · \(progress)"
        default: return goal.next.isEmpty ? progress : "Next: \(goal.next) · \(progress)"
        }
    }
    private func whenText(_ promise: WeekData.Promise) -> String {
        var parts: [String] = []
        if let due = promise.due, let date = WeekDates.date(due) {
            let day = Calendar.current.isDateInToday(date) ? "Today" : Calendar.current.isDateInTomorrow(date) ? "Tomorrow" : WeekDates.format(date, "EEEdMMM")
            parts.append((promise.overdue ? "Overdue · " : "") + (promise.allDay ? day : "\(day) \(WeekDates.format(date, "jmm"))"))
        } else { parts.append("No date") }
        if !promise.said.isEmpty { parts.append("“\(promise.said)”") }
        return parts.joined(separator: " · ")
    }
    private func tick(_ promise: WeekData.Promise, _ done: Bool) async {
        if done { ticked.insert(promise.id) } else { ticked.remove(promise.id) }
        do { try await link.promiseDone(promise.id, done: done) }
        catch { if done { ticked.remove(promise.id) } else { ticked.insert(promise.id) }; problem = error.localizedDescription }
    }

    private var needYou: Int { link.overview?.approvals.count ?? 0 }
    private var ready: Int { link.overview?.chats.filter(\.toCheck).count ?? 0 }

    // The dark card: counting down to the next thing with a date, or else today.
    @ViewBuilder private func hero(_ week: WeekData) -> some View {
        let today = week.days.first { $0.date == todayKey }?.events.filter { !$0.allDay } ?? []
        let next = today.first { (WeekDates.date($0.end ?? $0.start) ?? .distantPast) > .now }
        let number: String, label: String, title: String, detail: String, progress: Double
        if let countdown = week.countdown, let when = WeekDates.date(countdown.date) {
            number = "\(countdown.days)"; label = countdown.days == 1 ? "day to go" : "days to go"; title = countdown.title
            detail = "\(WeekDates.format(when, countdown.allDay ? "EEEdMMM" : "EEEdMMMjmm")) · from your calendar"
            progress = max(0.04, min(1, 1 - Double(countdown.days) / 30))
        } else {
            let done = today.filter { (WeekDates.date($0.end ?? $0.start) ?? .distantFuture) <= .now }.count
            number = "\(today.count)"; label = today.count == 1 ? "meeting today" : "meetings today"
            title = next?.title ?? (today.isEmpty ? "A clear day" : "All done for today")
            detail = next.flatMap { WeekDates.date($0.start) }.map { "Next at \(WeekDates.format($0, "jmm"))" } ?? "Nothing else on your calendar"
            progress = today.isEmpty ? 1 : Double(done) / Double(today.count)
        }
        return ZStack(alignment: .topTrailing) {
            Circle().fill(Self.accent).frame(width: 190, height: 190).offset(x: 70, y: -70)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .lastTextBaseline, spacing: 8) {
                    Text(number).font(.system(size: 64, weight: .bold)).foregroundStyle(.white)
                    Text(label).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                }
                Text(title).font(.system(size: 18, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
                Text(detail).font(.subheadline).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                GeometryReader { space in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.15))
                        Capsule().fill(Self.accent).frame(width: max(8, space.size.width * progress))
                    }
                }
                .frame(height: 6)
                .padding(.top, 10)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Self.ink)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func tile(_ number: String, _ words: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(number).font(.system(size: 28, weight: .bold)).foregroundStyle(Self.ink)
            Text(words).font(.footnote).foregroundStyle(Self.quiet).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
        .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Self.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    // The days of the week with dots for what's on, and the agenda for the chosen day and the one after.
    private func days(_ week: WeekData) -> some View {
        let selected = chosen ?? (week.days.contains { $0.date == todayKey } ? todayKey : week.days.first?.date ?? "")
        let index = week.days.firstIndex { $0.date == selected } ?? 0
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(week.days) { day in
                    let date = WeekDates.date(day.date) ?? .now, on = day.date == selected, isToday = day.date == todayKey
                    Button { chosen = day.date } label: {
                        VStack(spacing: 4) {
                            Text(WeekDates.format(date, "EEEEE")).font(.caption2.weight(.medium)).foregroundStyle(on ? Self.accent : Self.quiet)
                            Text(WeekDates.format(date, "d")).font(.system(size: 19, weight: on || isToday ? .bold : .medium)).foregroundStyle(on ? Self.accent : Self.ink)
                            HStack(spacing: 3) {
                                ForEach(0..<min(3, day.events.count), id: \.self) { _ in Circle().fill(Self.accent).frame(width: 4, height: 4) }
                            }
                            .frame(height: 5)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(on ? Self.soft : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(WeekDates.format(date, "EEEEdMMMM")), \(day.events.count) events")
                }
            }
            .padding(10)
            Rectangle().fill(Self.line).frame(height: 1)
            VStack(alignment: .leading, spacing: 0) {
                agenda(week.days[index])
                if index + 1 < week.days.count { agenda(week.days[index + 1]) }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 8)
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Self.line, lineWidth: 1))
    }

    @ViewBuilder private func agenda(_ day: WeekData.Day) -> some View {
        let date = WeekDates.date(day.date) ?? .now
        let name = day.date == todayKey ? "TODAY" : Calendar.current.isDateInTomorrow(date) ? "TOMORROW" : WeekDates.format(date, "EEEE").uppercased()
        Text("\(name) · \(WeekDates.format(date, "MMMd").uppercased())").font(.caption.weight(.semibold)).tracking(1).foregroundStyle(Self.quiet).padding(.top, 16).padding(.bottom, 6)
        if day.events.isEmpty {
            Text("Nothing on").font(.subheadline).foregroundStyle(Self.quiet).padding(.vertical, 8)
        }
        ForEach(day.events, id: \.self) { event in
            let starts = WeekDates.date(event.start), ends = event.end.flatMap(WeekDates.date)
            let past = (ends ?? starts ?? .distantFuture) < .now
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(event.allDay ? "All day" : starts.map { WeekDates.format($0, "jmm") } ?? "").font(.subheadline.weight(.medium))
                    if !event.allDay, let starts, let ends { Text(length(ends.timeIntervalSince(starts))).font(.caption).foregroundStyle(Self.quiet) }
                }
                .frame(width: 62, alignment: .leading)
                Text(event.title).font(.body.weight(.medium)).lineLimit(2)
                Spacer(minLength: 0)
            }
            .foregroundStyle(past ? Self.quiet : Self.ink)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
    }

    private func length(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        return minutes < 60 ? "\(minutes)m" : minutes % 60 == 0 ? "\(minutes / 60)h" : "\(minutes / 60)h \(minutes % 60)m"
    }
    private func range(_ week: WeekData) -> String {
        guard let start = WeekDates.date(week.start), let end = WeekDates.date(week.end) else { return "" }
        return "\(WeekDates.format(start, "MMMd")) – \(WeekDates.format(end, Calendar.current.isDate(start, equalTo: end, toGranularity: .month) ? "d" : "MMMd"))"
    }
    private func sourceNote(_ week: WeekData) -> String? {
        if week.sources.calendar.off { return "Gmail and Calendar from your iPhone are turned off. Turn them on in Fairy’s Settings on your Mac, under Phone." }
        if !week.sources.calendar.connected { return week.sources.calendar.error.isEmpty ? "Connect Google Calendar in Fairy’s Settings on your Mac to see your week here." : "\(week.sources.calendar.error) Do it on your Mac." }
        let errors = [week.sources.calendar.error, week.sources.email.error.isEmpty ? "" : "\(week.sources.email.error) Do it on your Mac."].filter { !$0.isEmpty }
        return errors.isEmpty ? nil : errors.joined(separator: " ")
    }
    private func note(_ words: String) -> some View {
        Text(words).font(.footnote).foregroundStyle(Self.quiet).padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func load(force: Bool) async {
        loading = true
        defer { loading = false }
        do { week = try await link.week(force: force); problem = nil }
        catch { if week == nil { problem = error.localizedDescription } }
    }
}

// The way into it, at the top of Make: a small version of the page.
struct WeekCard: View {
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(WeekDashboard.paper)
                    Image(systemName: "calendar").font(.system(size: 20, weight: .semibold)).foregroundStyle(WeekDashboard.accent)
                }
                .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your week").font(.headline).foregroundStyle(Color.ink)
                    Text("Meetings, inbox and what needs you").font(.footnote).foregroundStyle(Color.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.dim)
            }
            .padding(14)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens your week as a dashboard")
    }
}
