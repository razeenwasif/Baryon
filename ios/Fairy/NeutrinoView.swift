import SwiftUI

struct NeutrinoSectionView: View {
    @Environment(LinkClient.self) private var link
    @State private var inbox: NeutrinoInbox?
    @State private var loading = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            if let inbox {
                if !inbox.ready.isEmpty {
                    StratusSectionHeader(title: "Ready to review", color: .working, trailing: "\(inbox.ready.count)")
                    ForEach(inbox.ready) { prRow($0) }
                }
                if !inbox.open.isEmpty {
                    StratusSectionHeader(title: "Open PRs", trailing: "\(inbox.open.count)")
                    ForEach(inbox.open) { prRow($0) }
                }
                if !inbox.runs.isEmpty {
                    StratusSectionHeader(title: "Recent CI Runs", trailing: "\(inbox.runs.count)")
                    StratusCard(padding: 0) {
                        VStack(spacing: 0) {
                            ForEach(Array(inbox.runs.prefix(8).enumerated()), id: \.element.id) { index, run in
                                if index > 0 { Divider().overlay(Color.hairline) }
                                HStack(spacing: 10) {
                                    Circle().fill(ciColor(run.state)).frame(width: 8, height: 8)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(run.repo ?? "") · \(run.name ?? run.workflow ?? "Run #\(run.id)")")
                                            .font(.subheadline).foregroundStyle(Color.ink).lineLimit(1)
                                        Text([run.branch, run.state].compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(Color.muted)
                                    }
                                    Spacer()
                                }
                                .padding(12)
                            }
                        }
                    }
                }
                if inbox.ready.isEmpty && inbox.open.isEmpty && inbox.runs.isEmpty {
                    StratusCard {
                        Text("Neutrino inbox is clear. No open pull requests or active CI runs.")
                            .font(.subheadline)
                            .foregroundStyle(Color.dim)
                    }
                }
            } else if loading {
                HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.vertical, 32)
            }
        }
        .task { await load() }
    }

    private func prRow(_ pr: NeutrinoInbox.PRSummary) -> some View {
        NavigationLink { NeutrinoPRScreen(repo: pr.repo, number: pr.number) { Task { await load() } } } label: {
            StratusCard(padding: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("\(pr.repo)#\(pr.number)").font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Color.muted)
                        if let checks = pr.checks, !checks.isEmpty {
                            StratusBadge(text: checks, tint: ciColor(checks))
                        }
                        if pr.draft == true { StratusBadge(text: "draft", tint: .dim) }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.muted)
                    }
                    Text(pr.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).multilineTextAlignment(.leading).lineLimit(2)
                    Text("\(pr.source) → \(pr.target)").font(.caption.monospaced()).foregroundStyle(Color.dim).lineLimit(1)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        if inbox == nil { loading = true }
        defer { loading = false }
        do { inbox = try await link.neutrinoInbox(); problem = nil }
        catch { problem = error.localizedDescription }
    }

    private func ciColor(_ state: String) -> Color {
        switch state.lowercased() {
        case "passing", "success": .added
        case "failing", "failure", "cancelled": .removed
        case "running", "queued", "waiting": .asking
        default: .dim
        }
    }
}

struct NeutrinoPRScreen: View {
    let repo: String
    let number: Int
    var onMerged: () -> Void = {}
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var detail: NeutrinoPRDetail?
    @State private var problem: String?
    @State private var noteText = ""
    @State private var busy = false
    @State private var confirmMerge = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                if let detail {
                    StratusCard {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("\(detail.repo)#\(detail.number)").font(.caption.monospacedDigit()).foregroundStyle(Color.muted)
                                StratusBadge(text: detail.state, tint: detail.state == "open" ? .added : .dim)
                            }
                            Text(detail.title).font(.title3.weight(.semibold)).foregroundStyle(Color.ink)
                            Text("\(detail.source) → \(detail.target)").font(.caption.monospaced()).foregroundStyle(Color.dim)
                            if let body = detail.body, !body.isEmpty {
                                Text(body).font(.footnote).foregroundStyle(Color.soft).padding(.top, 2)
                            }
                        }
                    }

                    if detail.state == "open" {
                        HStack(spacing: 8) {
                            Button { confirmMerge = true } label: { Label("Merge PR", systemImage: "arrow.triangle.merge") }
                                .buttonStyle(PillButton(fill: .accent, ink: .white))
                                .disabled(busy)
                            if let lastRun = detail.checks?.first {
                                Button("Rerun CI") { Task { await rerun(lastRun.id) } }
                                    .buttonStyle(PillButton())
                                    .disabled(busy)
                            }
                        }
                    }

                    if !detail.files.isEmpty {
                        StratusSectionHeader(title: "Files", trailing: "\(detail.files.count)")
                        StratusCard(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(detail.files.prefix(25).enumerated()), id: \.element.id) { index, file in
                                    if index > 0 { Divider().overlay(Color.hairline) }
                                    HStack {
                                        Text(file.path).font(.caption.monospaced()).foregroundStyle(Color.ink).lineLimit(1)
                                        Spacer()
                                        Text("+\(file.additions ?? 0) -\(file.deletions ?? 0)")
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(Color.muted)
                                    }
                                    .padding(12)
                                }
                            }
                        }
                    }

                    if let diff = detail.diffText, !diff.isEmpty {
                        StratusSectionHeader(title: "Diff Preview")
                        CodeBlock(text: diff)
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
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: "#\(number)", back: "PRs") { dismiss() } }
        .confirmationDialog("Merge \(repo)#\(number) into \(detail?.target ?? "main")?", isPresented: $confirmMerge, titleVisibility: .visible) {
            Button("Merge with Face ID") { Task { await merge() } }
        }
        .task { await load() }
    }

    private func load() async {
        do { detail = try await link.neutrinoPR(repo: repo, number: number); problem = nil }
        catch { problem = error.localizedDescription }
    }

    private func merge() async {
        busy = true
        defer { busy = false }
        do {
            try await link.neutrinoAction(action: "merge", repo: repo, number: number)
            onMerged()
            await load()
        } catch { problem = error.localizedDescription }
    }

    private func rerun(_ runId: Int) async {
        busy = true
        defer { busy = false }
        do {
            try await link.neutrinoAction(action: "rerun", repo: repo, run: runId)
            await load()
        } catch { problem = error.localizedDescription }
    }
}
