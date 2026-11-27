import SwiftUI

struct AnalyticsSectionView: View {
    @Environment(LinkClient.self) private var link
    @State private var overview: AnalyticsOverview?
    @State private var loading = false
    @State private var problem: String?
    @State private var selectedRun: AnalyticsOverview.RunSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            if let overview {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    statCard("Datasets", "\(overview.state.datasetCount)", "Ready")
                    statCard("AutoML Runs", "\(overview.state.runCount)", overview.state.nexusAvailable == true ? "Forge ready" : "Local")
                }

                StratusSectionHeader(title: "Runs", trailing: "\(overview.runs.count)")
                if overview.runs.isEmpty {
                    StratusCard { Text("No Analytics runs recorded yet.").font(.subheadline).foregroundStyle(Color.dim) }
                } else {
                    ForEach(overview.runs) { run in
                        Button { selectedRun = run } label: {
                            StratusCard(padding: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(run.bestModel ?? run.task.capitalized).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                                        StratusBadge(text: run.status, tint: run.status == "completed" ? .added : .asking)
                                        Spacer()
                                        if let v = run.primaryValue {
                                            Text(String(format: "%.3f", v)).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Color.working)
                                        }
                                    }
                                    Text([run.datasetName, run.target, run.primaryMetric].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(Color.muted).lineLimit(1)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                StratusSectionHeader(title: "Datasets", trailing: "\(overview.datasets.count)")
                if overview.datasets.isEmpty {
                    StratusCard { Text("No datasets uploaded yet.").font(.subheadline).foregroundStyle(Color.dim) }
                } else {
                    ForEach(overview.datasets) { ds in
                        StratusCard(padding: 12) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(ds.name).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                                    let rowsCols = ds.profileSummary.map { "\($0.rows ?? 0) rows × \($0.columns ?? 0) cols" } ?? ds.format.uppercased()
                                    Text("\(ds.source) · \(rowsCols)").font(.caption).foregroundStyle(Color.muted)
                                }
                                Spacer()
                                Text(ByteCountFormatter.string(fromByteCount: Int64(ds.sizeBytes), countStyle: .file))
                                    .font(.caption.monospacedDigit()).foregroundStyle(Color.dim)
                            }
                        }
                    }
                }
            } else if loading {
                HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.vertical, 32)
            }
        }
        .sheet(item: $selectedRun) { run in NavigationStack { AnalyticsRunSheet(run: run) } }
        .task { await load() }
    }

    private func statCard(_ title: String, _ value: String, _ note: String) -> some View {
        StratusCard(padding: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(Color.muted)
                Text(value).font(.system(size: 22, weight: .semibold).monospacedDigit()).foregroundStyle(Color.ink)
                Text(note).font(.caption).foregroundStyle(Color.dim)
            }
        }
    }

    private func load() async {
        if overview == nil { loading = true }
        defer { loading = false }
        do { overview = try await link.analyticsOverview(); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

private struct AnalyticsRunSheet: View {
    let run: AnalyticsOverview.RunSummary
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var detail: AnalyticsRunDetail?
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                if let detail {
                    StratusCard {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(detail.bestModelLabel ?? detail.bestModel ?? run.task).font(.title3.weight(.semibold)).foregroundStyle(Color.ink)
                            Text([detail.datasetName, detail.target, detail.primaryMetric.flatMap { m in detail.primaryValue.map { "\(m): \(String(format: "%.4f", $0))" } }].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote.monospacedDigit()).foregroundStyle(Color.working)
                        }
                    }
                    if let board = detail.leaderboard, !board.isEmpty {
                        StratusSectionHeader(title: "Leaderboard")
                        StratusCard(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(board.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { Divider().overlay(Color.hairline) }
                                    HStack {
                                        Text(row.label ?? row.model ?? "").font(.subheadline).foregroundStyle(Color.ink)
                                        Spacer()
                                        if let s = row.score { Text(String(format: "%.4f", s)).font(.subheadline.monospacedDigit()).foregroundStyle(Color.added) }
                                    }
                                    .padding(12)
                                }
                            }
                        }
                    }
                    if let feats = detail.featureImportances, !feats.isEmpty {
                        StratusSectionHeader(title: "Top Features")
                        StratusCard(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(feats.prefix(10).enumerated()), id: \.element.id) { index, f in
                                    if index > 0 { Divider().overlay(Color.hairline) }
                                    HStack {
                                        Text(f.feature).font(.caption.monospaced()).foregroundStyle(Color.ink)
                                        Spacer()
                                        Text(String(format: "%.3f", f.importance)).font(.caption.monospacedDigit()).foregroundStyle(Color.dim)
                                    }
                                    .padding(12)
                                }
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
        .navigationTitle("Run Details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        .task {
            do { detail = try await link.analyticsRun(run.id) }
            catch { problem = error.localizedDescription }
        }
    }
}
