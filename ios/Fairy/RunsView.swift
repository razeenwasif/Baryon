import SwiftUI

// The experiment tracker on the iPhone (docs/tracker-plan.md, stage 5): the projects with runs, a project's runs, and
// one run's parameters, metrics and the end of its printout. For reading only: the Mac has no route for changing a run.

struct RunProject: Decodable, Identifiable, Equatable {
    var folder: String
    var title: String
    var kind: String
    var count: Int
    var latest: String
    var running: Int
    var id: String { folder }
}
struct RunsProjects: Decodable, Equatable { var projects: [RunProject] }
struct RunRecord: Decodable, Identifiable, Equatable {
    struct Metric: Decodable, Equatable { var name: String; var value: Double?; var text: String; var unit: String }
    var id: String
    var label: String
    var name: String
    var state: String
    var `where`: String
    var job: String
    var started: String
    var seconds: Double?
    var exit: Int?
    var params: [String: String]
    var metrics: [Metric]
    var printout: String
    var tags: [String]
    var notes: String
    var commit: String
    var dirty: Bool
}
struct RunsPage: Decodable, Equatable { var folder: String; var kind: String; var runs: [RunRecord] }

private enum RunWords {
    static func state(_ state: String) -> String { ["running": "Running", "done": "Done", "failed": "Failed", "timed-out": "Timed out", "stopped": "Stopped"][state] ?? state }
    static func colour(_ state: String) -> Color { state == "done" ? .added : state == "running" ? .working : state == "failed" || state == "timed-out" ? .removed : .muted }
    static func place(_ run: RunRecord) -> String {
        let place = ["here": "This Mac", "outside": "This Mac", "atlas": "atlas", "forge": "forge", "lab": "Lab"][run.where] ?? run.where
        return run.job.isEmpty ? place : "\(place) · \(run.job)"
    }
    static func value(_ metric: RunRecord.Metric) -> String {
        let number = metric.value.map { $0 == $0.rounded() && abs($0) < 1e9 ? String(Int($0)) : String(format: "%.4g", $0) } ?? metric.text
        return metric.unit.isEmpty ? number : "\(number) \(metric.unit)"
    }
    static func time(_ seconds: Double?) -> String? {
        guard let seconds else { return nil }
        if seconds < 90 { return String(format: "%.3g s", seconds) }
        if seconds < 5400 { return "\(Int((seconds / 60).rounded())) min" }
        return String(format: "%.1f h", seconds / 3600)
    }
    static func when(_ stamp: String) -> String {
        guard let date = parsedDate(stamp) else { return "" }
        return Calendar.current.isDateInToday(date) ? "Today, \(date.formatted(date: .omitted, time: .shortened))" : date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }
}

// A screen in the manner of Long-term memory: a back button and a title over the wallpaper.
private struct RunsScreen<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let back: String
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 16)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.45)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 4) {
                Button { dismiss() } label: { Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44).background(Color.black.opacity(0.35), in: Circle()).overlay(Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 1)) }.foregroundStyle(Color.ink).accessibilityLabel(back)
                Text(title).font(.system(size: 28, weight: .light)).foregroundStyle(Color.ink).lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .buttonStyle(.plain)
        }
    }
}

private struct StatePill: View {
    let state: String
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(RunWords.colour(state)).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(RunWords.state(state)).font(.caption.weight(.semibold)).foregroundStyle(RunWords.colour(state))
        }
    }
}

struct RunsView: View {
    @Environment(LinkClient.self) private var link
    @State private var projects: [RunProject]?
    @State private var problem: String?

    var body: some View {
        RunsScreen(title: "Runs", back: "Back to settings") {
            Text("Experiments Fairy ran for you, here and on atlas and forge, with what they found.").font(.subheadline).foregroundStyle(Color.dim).padding(.horizontal, 4)
            if let problem { Text(problem).font(.subheadline).foregroundStyle(Color.removed).padding(.top, 24) }
            else if let projects {
                if projects.isEmpty {
                    Text("No runs yet. When a work session runs an experiment, it shows here.").font(.subheadline).foregroundStyle(Color.dim).frame(maxWidth: .infinity).padding(.top, 24)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
                            if index > 0 { Divider().overlay(Color.hairline) }
                            NavigationLink { RunsListView(project: project) } label: {
                                HStack(spacing: 8) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            Text(project.title).font(.subheadline).foregroundStyle(Color.ink).lineLimit(1)
                                            if project.kind == "investigation" { Text("Research").font(.caption2.weight(.semibold)).foregroundStyle(Color.working) }
                                        }
                                        Text("\(project.count) \(project.count == 1 ? "run" : "runs")\(project.running > 0 ? " · \(project.running) running" : "")\(project.latest.isEmpty ? "" : " · \(RunWords.when(project.latest))")").font(.caption).foregroundStyle(Color.muted)
                                    }
                                    Spacer(minLength: 8)
                                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).accessibilityHidden(true)
                                }
                                .padding(.vertical, 10)
                                .frame(minHeight: 52)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 14)
                    .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
                    .padding(.top, 14)
                }
            } else { HStack { Spacer(); EyeView(mood: .thinking, size: 96); Spacer() }.padding(.top, 40) }
            Text("To name, tag or delete a run, or to compare runs, use Runs on your Mac.").font(.footnote).foregroundStyle(Color.muted).padding(.horizontal, 4).padding(.top, 14)
        }
        .task { await load() }
        .refreshable { await load() }
    }
    private func load() async {
        do { projects = try await link.runsProjects().projects; problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct RunsListView: View {
    @Environment(LinkClient.self) private var link
    let project: RunProject
    @State private var page: RunsPage?
    @State private var problem: String?

    var body: some View {
        RunsScreen(title: project.title, back: "Back to runs") {
            if let problem { Text(problem).font(.subheadline).foregroundStyle(Color.removed).padding(.top, 24) }
            else if let page {
                VStack(spacing: 0) {
                    ForEach(Array(page.runs.enumerated()), id: \.element.id) { index, run in
                        if index > 0 { Divider().overlay(Color.hairline) }
                        NavigationLink { RunDetailView(run: run, project: project.title) } label: { RunRow(run: run) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14)
                .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
                .padding(.top, 8)
            } else { HStack { Spacer(); EyeView(mood: .thinking, size: 96); Spacer() }.padding(.top, 40) }
        }
        .task { await load() }
        .refreshable { await load() }
    }
    private func load() async {
        do { page = try await link.runsList(project.folder); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

private struct RunRow: View {
    let run: RunRecord
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(run.label).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                    if !run.name.isEmpty { Text(run.name).font(.subheadline).foregroundStyle(Color.dim).lineLimit(1) }
                }
                HStack(spacing: 8) {
                    StatePill(state: run.state)
                    Text([RunWords.place(run), RunWords.when(run.started)].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(Color.muted).lineLimit(1)
                }
                if !run.metrics.isEmpty {
                    Text(run.metrics.prefix(3).map { "\($0.name) \(RunWords.value($0))" }.joined(separator: " · ")).font(.caption.monospacedDigit()).foregroundStyle(Color.ink).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 4).accessibilityHidden(true)
        }
        .padding(.vertical, 10)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

struct RunDetailView: View {
    let run: RunRecord
    let project: String

    var body: some View {
        RunsScreen(title: run.name.isEmpty ? run.label : "\(run.label) · \(run.name)", back: "Back to \(project)") {
            HStack(spacing: 8) {
                StatePill(state: run.state)
                Text([RunWords.place(run), RunWords.when(run.started), RunWords.time(run.seconds).map { "took \($0)" }, run.exit.map { "exit \($0)" }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Color.muted)
            }
            .padding(.horizontal, 4)
            if !run.metrics.isEmpty { box("Metrics", rows: run.metrics.map { ($0.name, RunWords.value($0)) }) }
            if !run.params.isEmpty { box("Parameters", rows: run.params.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }) }
            if !run.commit.isEmpty { box("Code", rows: [("Commit", run.commit + (run.dirty ? " + changes" : ""))]) }
            if !run.printout.isEmpty {
                Text("Printout").font(.footnote).foregroundStyle(Color.muted).padding(.top, 14).padding(.bottom, 4).padding(.leading, 4)
                Text(run.printout).font(.caption.monospaced()).foregroundStyle(Color.ink).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color.well, in: RoundedRectangle(cornerRadius: 14))
            }
            if !run.notes.isEmpty || !run.tags.isEmpty {
                Text("Your notes").font(.footnote).foregroundStyle(Color.muted).padding(.top, 14).padding(.bottom, 4).padding(.leading, 4)
                VStack(alignment: .leading, spacing: 4) {
                    if !run.tags.isEmpty { Text(run.tags.joined(separator: ", ")).font(.caption).foregroundStyle(Color.working) }
                    if !run.notes.isEmpty { Text(run.notes).font(.subheadline).foregroundStyle(Color.ink) }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color.side, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
    private func box(_ title: String, rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.footnote).foregroundStyle(Color.muted).padding(.top, 14).padding(.bottom, 4).padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if index > 0 { Divider().overlay(Color.hairline) }
                    HStack {
                        Text(row.0).font(.subheadline).foregroundStyle(Color.dim)
                        Spacer(minLength: 12)
                        Text(row.1).font(.subheadline.monospacedDigit()).foregroundStyle(Color.ink).textSelection(.enabled)
                    }
                    .padding(.vertical, 9)
                }
            }
            .padding(.horizontal, 14)
            .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
        }
    }
}
