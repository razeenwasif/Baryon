import SwiftUI

struct GoalsSectionView: View {
    @Environment(LinkClient.self) private var link
    @State private var data: GoalList?
    @State private var loading = false
    @State private var problem: String?
    @State private var acting: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            if let data {
                HStack {
                    StratusSectionHeader(title: "Goals · \(data.open)/\(data.max) open")
                    Spacer()
                    Button { Task { await load() } } label: {
                        Image(systemName: "arrow.clockwise").font(.caption).foregroundStyle(Color.dim).padding(6)
                    }.buttonStyle(.plain)
                }
                if data.goals.isEmpty {
                    StratusCard {
                        Text("No goals yet. Create one on \(link.macName) and monitor or steer it here.")
                            .font(.subheadline)
                            .foregroundStyle(Color.dim)
                    }
                } else {
                    ForEach(data.goals) { goal in
                        NavigationLink { GoalDetailScreen(id: goal.id, onChanged: { Task { await load() } }) } label: {
                            StratusCard(padding: 14) {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .center, spacing: 8) {
                                        Text(goal.id).font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Color.muted)
                                        StratusBadge(text: goal.state, tint: GoalStyle.color(goal.state))
                                        Spacer()
                                        if let folder = goal.folder, !folder.isEmpty {
                                            Text(folder.pathEnd).font(.caption).foregroundStyle(Color.muted).lineLimit(1)
                                        }
                                    }
                                    Text(goal.outcome).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).multilineTextAlignment(.leading).lineLimit(3)
                                    if let reason = goal.reason, !reason.isEmpty {
                                        Text(reason).font(.caption).foregroundStyle(GoalStyle.color(goal.state)).lineLimit(2)
                                    } else if let next = goal.next, !next.isEmpty {
                                        Text("Next: \(next)").font(.caption).foregroundStyle(Color.dim).lineLimit(1)
                                    }
                                    if let steps = goal.steps, steps > 0 {
                                        let done = goal.done ?? 0
                                        GeometryReader { geo in
                                            ZStack(alignment: .leading) {
                                                Capsule().fill(Color.well)
                                                Capsule().fill(GoalStyle.color(goal.state)).frame(width: geo.size.width * min(1, CGFloat(done) / CGFloat(steps)))
                                            }
                                        }
                                        .frame(height: 3)
                                        Text("\(done) of \(steps) steps").font(.caption2.monospacedDigit()).foregroundStyle(Color.muted)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if loading {
                HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.vertical, 32)
            }
        }
        .task { await load() }
    }

    private func load() async {
        if data == nil { loading = true }
        defer { loading = false }
        do { data = try await link.goals(); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct GoalDetailScreen: View {
    let id: String
    var onChanged: () -> Void = {}
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var goal: GoalDetail?
    @State private var problem: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                if let goal {
                    StratusCard {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(goal.id).font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Color.muted)
                                StratusBadge(text: goal.state, tint: GoalStyle.color(goal.state))
                                Spacer()
                                if let folder = goal.folder { Text(folder.pathEnd).font(.caption).foregroundStyle(Color.muted) }
                            }
                            Text(goal.outcome).font(.title3.weight(.semibold)).foregroundStyle(Color.ink)
                            if let reason = goal.reason, !reason.isEmpty {
                                Text(reason).font(.footnote).foregroundStyle(GoalStyle.color(goal.state))
                            }
                            if let dw = goal.doneWhen {
                                Text("Done when: \(dw.command ?? dw.metric ?? dw.kind)")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(Color.dim)
                            }
                        }
                    }

                    HStack(spacing: 8) {
                        if goal.state == "active" || goal.state == "waiting-you" {
                            Button { Task { await act("continue") } } label: { Label("Next step", systemImage: "play.fill") }
                                .buttonStyle(PillButton(fill: .accent, ink: .white))
                                .disabled(busy)
                        }
                        if goal.state == "paused" || goal.state == "waiting" || goal.state == "waiting-you" {
                            Button("Resume") { Task { await act("resume") } }
                                .buttonStyle(PillButton())
                                .disabled(busy)
                        } else if goal.state == "active" {
                            Button("Pause") { Task { await act("pause") } }
                                .buttonStyle(PillButton())
                                .disabled(busy)
                        }
                        if goal.state != "done" && goal.state != "dropped" {
                            Button("Done") { Task { await act("done") } }
                                .buttonStyle(PillButton(fill: Color.added.opacity(0.18), ink: .added))
                                .disabled(busy)
                        }
                    }

                    StratusSectionHeader(title: "Steps", trailing: "\(goal.steps.filter { $0.state == "done" }.count)/\(goal.steps.count)")
                    StratusCard(padding: 0) {
                        VStack(spacing: 0) {
                            ForEach(Array(goal.steps.enumerated()), id: \.element.id) { index, step in
                                if index > 0 { Divider().overlay(Color.hairline) }
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: step.state == "done" ? "checkmark.circle.fill" : step.state == "doing" ? "circle.dotted.circle" : step.state == "failed" ? "xmark.circle.fill" : "circle")
                                        .font(.subheadline)
                                        .foregroundStyle(step.state == "done" ? Color.added : step.state == "doing" ? Color.working : step.state == "failed" ? Color.removed : Color.muted)
                                        .padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(step.what).font(.subheadline).foregroundStyle(Color.ink)
                                        if let report = step.report, !report.isEmpty { Text(report).font(.caption).foregroundStyle(Color.dim).lineLimit(3) }
                                        if let err = step.error, !err.isEmpty { Text(err).font(.caption).foregroundStyle(Color.removed) }
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(14)
                            }
                        }
                    }
                } else {
                    HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.top, 40)
                }
            }
            .padding(16)
        }
        .onWallpaper()
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: goal?.id ?? id, back: "Goals") { dismiss() } }
        .task { await load() }
    }

    private func load() async {
        do { goal = try await link.goalDetail(id); problem = nil }
        catch { problem = error.localizedDescription }
    }

    private func act(_ action: String) async {
        busy = true
        defer { busy = false }
        do {
            try await link.goalAction(id: id, action: action)
            onChanged()
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }
}

private enum GoalStyle {
    static func color(_ state: String) -> Color {
        switch state {
        case "active": .working
        case "waiting-you": .asking
        case "waiting": .asking
        case "done": .added
        case "dropped": .removed
        default: .dim
        }
    }
}
