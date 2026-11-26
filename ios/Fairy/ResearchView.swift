import SwiftUI

struct ResearchSectionView: View {
    @Environment(LinkClient.self) private var link
    @State private var home: ResearchHome?
    @State private var loading = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            if let home {
                StratusSectionHeader(title: "Investigations", trailing: "\(home.investigations.count)")
                if home.investigations.isEmpty {
                    StratusCard {
                        Text("No investigations in ~/Research yet. Start one in Research on \(link.macName).")
                            .font(.subheadline)
                            .foregroundStyle(Color.dim)
                    }
                } else {
                    ForEach(home.investigations) { inv in
                        NavigationLink { ResearchDetailScreen(slug: inv.slug) } label: {
                            StratusCard(padding: 14) {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(spacing: 8) {
                                        if !inv.discipline.isEmpty {
                                            StratusBadge(text: inv.discipline, tint: .working)
                                        }
                                        Text("\(inv.rounds) rounds · \(inv.active) active")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(Color.muted)
                                        Spacer()
                                        if !inv.waiting.isEmpty {
                                            StratusBadge(text: "\(inv.waiting.count) waiting", tint: .asking)
                                        }
                                    }
                                    Text(inv.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Color.ink)
                                        .multilineTextAlignment(.leading)
                                    if let lead = inv.leading {
                                        HStack(spacing: 6) {
                                            Text("Elo \(lead.elo)").font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Color.added)
                                            Text(lead.text).font(.caption).foregroundStyle(Color.dim).lineLimit(2)
                                        }
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
        if home == nil { loading = true }
        defer { loading = false }
        do { home = try await link.researchHome(); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct ResearchDetailScreen: View {
    let slug: String
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ResearchDetail?
    @State private var problem: String?
    @State private var tab = DetailTab.hypotheses

    enum DetailTab: String, CaseIterable { case hypotheses = "Hypotheses", report = "Report", papers = "Papers" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
                if let detail {
                    StratusCard {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                if !detail.discipline.isEmpty { StratusBadge(text: detail.discipline, tint: .working) }
                                Text("\(detail.rounds) rounds").font(.caption.monospacedDigit()).foregroundStyle(Color.muted)
                                Spacer()
                            }
                            Text(detail.title).font(.title3.weight(.semibold)).foregroundStyle(Color.ink)
                        }
                    }

                    Picker("View", selection: $tab) {
                        ForEach(DetailTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    switch tab {
                    case .hypotheses:
                        ForEach(detail.hypotheses) { h in
                            StratusCard(padding: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(h.id).font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Color.muted)
                                        StratusBadge(text: "Elo \(h.elo) · \(h.wins)W-\(h.losses)L", tint: h.status == "active" ? .added : .dim)
                                        Spacer()
                                        Text(h.status).font(.caption).foregroundStyle(Color.muted)
                                    }
                                    Text(h.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink)
                                    if !h.statement.isEmpty {
                                        Text(h.statement).font(.caption).foregroundStyle(Color.dim).lineLimit(5)
                                    }
                                }
                            }
                        }
                    case .report:
                        if detail.report.isEmpty {
                            StratusCard { Text("No REPORT.md written yet.").font(.subheadline).foregroundStyle(Color.dim) }
                        } else {
                            StratusCard { MarkdownText(text: detail.report) }
                        }
                    case .papers:
                        if detail.papers.isEmpty {
                            StratusCard { Text("No saved papers in this investigation yet.").font(.subheadline).foregroundStyle(Color.dim) }
                        } else {
                            ForEach(detail.papers) { p in
                                StratusCard(padding: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(p.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink)
                                        Text([p.authors, p.venue, p.arxiv].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(Color.muted).lineLimit(2)
                                    }
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
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: detail?.title ?? slug, back: "Research") { dismiss() } }
        .task { await load() }
    }

    private func load() async {
        do { detail = try await link.researchDetail(slug); problem = nil }
        catch { problem = error.localizedDescription }
    }
}
