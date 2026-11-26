import SwiftUI

// What's running on your Mac, by what it needs from you: questions first, then work in progress, then finished work
// waiting for you to check it. Only you mark a task done; Fairy can only finish working on it.
struct TasksView: View {
    @Environment(LinkClient.self) private var link
    @State private var newTask = false
    @State private var marking: Set<String> = []
    @State private var problem: String?
    @State private var runningBrief = false
    @State private var briefNotice: String?

    private var rows: [SessionRow] { link.overview?.chats ?? [] }
    private var working: [SessionRow] { rows.filter { $0.state != "idle" } }
    private var toCheck: [SessionRow] { rows.filter { $0.toCheck && !marking.contains($0.id) } }
    private var finished: [SessionRow] { rows.filter { $0.state == "idle" && (!$0.toCheck || marking.contains($0.id)) } }

    private enum Page: String, CaseIterable { case active = "Active", goals = "Goals", prs = "PRs", upNext = "Up next" }
    @State private var page = Page.active
    private var scheduled: [Scheduled] { link.overview?.scheduled ?? [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Page.allCases, id: \.self) { which in
                            pageButton(which.rawValue, which)
                        }
                    }
                }
                .padding(.bottom, 10)
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(.top, 4) }
                if let overview = link.overview {
                    switch page {
                    case .active: active(overview)
                    case .goals: GoalsSectionView()
                    case .prs: NeutrinoSectionView()
                    case .upNext: upNext
                    }
                } else {
                    HStack { Spacer(); EyeView(mood: .thinking, size: 120); Spacer() }.padding(.top, 80)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 26)
            .padding(.bottom, 96)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade(reach: 4) }
        .onWallpaper(0.45)
        .overlay(alignment: .bottomTrailing) {
            if page == .active {
                Button { newTask = true } label: {
                    Image(systemName: "plus").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white).frame(width: 52, height: 52)
                        .background(Color.accent, in: Circle())
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New task")
                .disabled(link.reach != .connected)
                .opacity(link.reach == .connected ? 1 : 0.45)
                .padding(.trailing, 18)
                .padding(.bottom, 12)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { TabPill() }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $newTask) { NewTaskView().presentationBackground { Color.ground } }
    }

    private func pageButton(_ name: String, _ which: Page) -> some View {
        let selected = page == which
        return Button { withAnimation(.snappy) { page = which } } label: {
            Text(name)
                .font(.system(size: 14, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? Color.ink : Color.dim)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Color.hover : Color.card, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? Color.hairlineStrong : Color.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private func active(_ overview: Overview) -> some View {
        if !overview.approvals.isEmpty {
            heading("Needs you · \(overview.approvals.count)", color: .asking)
            VStack(spacing: 12) { ForEach(overview.approvals) { AskCard(approval: $0, showsSession: true) } }
        }
        if !toCheck.isEmpty {
            HStack(alignment: .firstTextBaseline) {
                heading("Ready for review · \(toCheck.count)", color: .added)
                Spacer()
                if let latest = toCheck.compactMap({ $0.updatedAt.flatMap(parsedDate) }).max() {
                    Text("Updated \(latest.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(Color.muted)
                }
            }
            card { ForEach(Array(toCheck.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().overlay(Color.hairline) }
                ReviewRow(row: row) { markDone(row) }
            } }
        }
        if !working.isEmpty {
            heading("Working · \(working.count)", color: .working)
            card { ForEach(Array(working.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().overlay(Color.hairline) }
                NavigationLink { SessionView(row: row) } label: { WorkingRow(row: row) }.buttonStyle(.plain)
            } }
        }
        if overview.approvals.isEmpty && working.isEmpty && toCheck.isEmpty {
            Text("Nothing’s running. Start a task with +, or on your Mac.").font(.subheadline).foregroundStyle(Color.dim).padding(.vertical, 24)
        }
    }

    @ViewBuilder private var upNext: some View {
        heading("Scheduled · \(scheduled.count)", color: .soft)
        if scheduled.isEmpty {
            Text("Nothing’s scheduled. Turn on the morning brief or check-ins in Baryon’s Settings on your Mac, or add a schedule there.").font(.subheadline).foregroundStyle(Color.dim).padding(.vertical, 8)
        } else {
            card { ForEach(Array(scheduled.enumerated()), id: \.element.id) { index, item in
                if index > 0 { Divider().overlay(Color.hairline) }
                ScheduledRow(item: item)
            } }
        }
        Button {
            runningBrief = true; briefNotice = nil
            Task {
                defer { runningBrief = false }
                do { let res = try await link.runBrief(kind: "brief"); briefNotice = (res.pushed ?? 0) > 0 ? "Morning brief sent." : "Morning brief added to home thread." }
                catch { briefNotice = error.localizedDescription }
            }
        } label: {
            Label(runningBrief ? "Sending morning brief…" : "Run morning brief now", systemImage: "sun.horizon")
        }
        .buttonStyle(PillButton())
        .disabled(runningBrief)
        .padding(.top, 12)
        if let briefNotice { Text(briefNotice).font(.caption).foregroundStyle(Color.working).padding(.top, 6) }
        if !finished.isEmpty {
            heading("Done · \(finished.count)", color: .soft)
            card { ForEach(Array(finished.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().overlay(Color.hairline) }
                NavigationLink { SessionView(row: row) } label: { DoneRow(row: row) }.buttonStyle(.plain)
            } }
        }
    }

    private func heading(_ words: String, color: Color) -> some View {
        Text(words).font(.footnote.weight(.semibold)).foregroundStyle(color).padding(.top, 20).padding(.bottom, 8)
    }
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0, content: content)
            .raised(radius: 18)
    }
    private func markDone(_ row: SessionRow) {
        marking.insert(row.id)
        problem = nil
        Task {
            do { try await link.markDone(row.id) }
            catch { marking.remove(row.id); problem = error.localizedDescription }
        }
    }
}

// A task at work: where, what it's doing now, and how far its plan has got.
private struct WorkingRow: View {
    let row: SessionRow
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 10) {
                if row.state == "waiting" || row.state == "working" { DotLoader(kind: row.state == "waiting" ? .pulse : .orbit, color: row.state == "waiting" ? Color.asking : Color.working) }
                Text(row.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                Spacer(minLength: 8)
                Text(row.place).font(.caption).foregroundStyle(Color.muted).lineLimit(1)
            }
            if let line = [row.parent.map { "Side session of \($0)" }, row.doing, row.state == "waiting" ? "Waiting for your OK" : nil].compactMap(\.self).first {
                // A new step lifts the old line out with a little blur as it rises into place.
                SwapText(line).font(.caption).foregroundStyle(row.state == "waiting" ? Color.asking : Color.soft).lineLimit(1)
            }
            if let progress = row.progress, progress.total > 0 {
                StepBar(fraction: Double(progress.done) / Double(progress.total))
                Text("\(progress.done) of \(progress.total) steps").font(.caption2).foregroundStyle(Color.muted)
                    .contentTransition(.numericText(value: Double(progress.done)))
                    .animation(.easeOut(duration: 0.3), value: progress.done)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// How far a task's plan has got: a thin bar in the working blue that glides to each new step, easing out as it arrives,
// rather than snapping.
private struct StepBar: View {
    let fraction: Double
    @Environment(\.accessibilityReduceMotion) private var still
    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.1))
            .frame(height: 3)
            .overlay(alignment: .leading) {
                GeometryReader { area in
                    Capsule().fill(Color.working).frame(width: area.size.width * min(1, max(0, fraction)))
                }
            }
            .clipShape(Capsule())
            .animation(still ? nil : .timingCurve(0.22, 1, 0.36, 1, duration: 0.55), value: fraction)
            .accessibilityElement()
            .accessibilityLabel("Progress")
            .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
    }
}

// Finished work, waiting for you to check it: tick it to mark it done, or open it to look it over.
private struct ReviewRow: View {
    let row: SessionRow
    let markDone: () -> Void
    private var finishedAt: String { row.updatedAt.flatMap(parsedDate).map { $0.formatted(.relative(presentation: .named)) } ?? "" }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: markDone) {
                Image(systemName: "square").font(.system(size: 20)).foregroundStyle(Color.soft).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark \(row.title) done")
            NavigationLink { SessionView(row: row) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.title).font(.body).foregroundStyle(Color.ink).lineLimit(2).multilineTextAlignment(.leading)
                    (Text("Ready for review").foregroundStyle(Color.added) + Text(" · \([row.place, finishedAt].filter { !$0.isEmpty }.joined(separator: " · "))").foregroundStyle(Color.muted))
                        .font(.footnote).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}

// Something that runs on its own: what, how often, and when next.
private struct ScheduledRow: View {
    let item: Scheduled
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.kind == "brief" ? "sun.horizon" : item.kind == "check-in" ? "bubble.left.and.text.bubble.right" : "clock")
                .font(.system(size: 17)).foregroundStyle(Color.soft).frame(width: 28, height: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.body).foregroundStyle(Color.ink)
                Text([item.every, item.next.flatMap(parsedDate).map { "next \($0.formatted(.relative(presentation: .named)))" }].compactMap(\.self).joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Color.muted).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

private struct DoneRow: View {
    let row: SessionRow
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: row.done != nil ? "checkmark.circle.fill" : "circle").foregroundStyle(row.done != nil ? Color.added.opacity(0.8) : Color.muted).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title).font(.subheadline).foregroundStyle(Color.soft).lineLimit(1)
                Text(row.place).font(.caption).foregroundStyle(Color.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.dim).accessibilityHidden(true)
        }
        .padding(.horizontal, 14).frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

// Starting a task from the phone: a folder you've worked in, what to do, and Face ID. It runs on your Mac in Ask
// mode, so each edit and command still asks you first.
struct NewTaskView: View {
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var folder: WorkFolder?
    @State private var prompt = ""
    @State private var starting = false
    @State private var problem: String?
    private var folders: [WorkFolder] { link.overview?.folders ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Where").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted)
                    if folders.isEmpty {
                        Text("Start a work session on your Mac first. Its folder will show here.").font(.subheadline).foregroundStyle(Color.dim)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(folders.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { Divider().overlay(Color.hairline) }
                                Button { folder = item } label: {
                                    HStack {
                                        Image(systemName: "folder").foregroundStyle(Color.dim).accessibilityHidden(true)
                                        Text(item.name).foregroundStyle(Color.ink)
                                        Spacer()
                                        if folder == item { Image(systemName: "checkmark").foregroundStyle(Color.accent) }
                                    }
                                    .padding(.horizontal, 14).frame(minHeight: 48).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(folder == item ? .isSelected : [])
                            }
                        }
                        .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
                    }
                    Text("What to do").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted)
                    TextField("Fix the failing tests and tell me what changed", text: $prompt, axis: .vertical)
                        .lineLimit(4...10)
                        .padding(14)
                        .foregroundStyle(Color.ink)
                        .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
                    Text("It runs on your Mac and asks before each edit and command, here or there.").font(.footnote).foregroundStyle(Color.muted)
                    if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                    Button(action: start) {
                        Label(starting ? "Starting…" : "Start with Face ID", systemImage: "faceid").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButton(fill: .accent, ink: .white))
                    .disabled(starting || folder == nil || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(16)
            }
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { if folder == nil { folder = folders.first } }
        }
    }

    private func start() {
        guard let folder else { return }
        starting = true
        problem = nil
        Task {
            do { _ = try await link.startWork(in: folder, prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines)); dismiss() }
            catch { problem = error.localizedDescription }
            starting = false
        }
    }
}
