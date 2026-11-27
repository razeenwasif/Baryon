import SwiftUI

struct UsageScreen: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            UsageView()
                .padding(16)
                .padding(.bottom, 24)
        }
        .scrollEdgeEffectHidden(true, for: .all)
        .onWallpaper()
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { TopBar(title: "Usage & Limits", back: "Settings") { dismiss() } }
    }
}

// T3 Code / Stratus-inspired Token Usage & Plan Limits dashboard.
struct UsageView: View {
    @Environment(LinkClient.self) private var link
    @State private var report: TokenUsageReport?
    @State private var loading = false
    @State private var refreshingLimits = false
    @State private var problem: String?
    @State private var window = Window.month

    enum Window: String, CaseIterable { case day = "24h", month = "30d" }

    private var summary: TokenUsageReport.Summary? {
        guard let report else { return nil }
        return window == .day ? report.summary24 : report.summary30
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                StratusSectionHeader(title: "Plan Limits")
                Button {
                    Task { await load(force: true) }
                } label: {
                    HStack(spacing: 5) {
                        if refreshingLimits { ProgressView().controlSize(.mini).tint(Color.working) }
                        else { Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold)) }
                        Text("Refresh").font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(Color.soft)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.raised, in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(refreshingLimits)
            }

            planLimitsSection

            HStack {
                StratusSectionHeader(title: "Telemetry")
                Picker("Window", selection: $window) {
                    ForEach(Window.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 120)
            }
            .padding(.top, 4)

            if let problem {
                Text(problem).font(.footnote).foregroundStyle(Color.removed)
            } else if let summary, let report {
                kpiGrid(summary)
                if !report.daily.isEmpty {
                    dailyChartCard(report.daily)
                }
                if !report.byProvider.isEmpty {
                    providersCard(report.byProvider)
                }
                if !report.byModel.isEmpty {
                    modelsCard(report.byModel)
                }
            } else if loading {
                HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.vertical, 28)
            }
        }
        .task { await load(force: false) }
    }

    @ViewBuilder private var planLimitsSection: some View {
        let plans = report?.plans ?? link.overview?.usage ?? [:]
        if plans.isEmpty {
            StratusCard {
                Text("No active subscription meters yet. Tap Refresh or sign in to a provider on \(link.macName).")
                    .font(.footnote)
                    .foregroundStyle(Color.dim)
            }
        } else {
            VStack(spacing: 10) {
                ForEach(["claude", "gemini", "codex"], id: \.self) { key in
                    if let plan = plans[key] {
                        StratusCard(padding: 12) {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(planDisplayName(key))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Color.ink)
                                    Spacer()
                                    if plan.failed == true {
                                        StratusBadge(text: "Check sign-in", tint: .removed)
                                    } else if let maxUsed = plan.meters.compactMap(\.used).max() {
                                        Text("\(Int(maxUsed.rounded()))% peak")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(meterColor(maxUsed))
                                    }
                                }
                                ForEach(plan.meters, id: \.label) { meter in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            Text(meter.label).font(.caption).foregroundStyle(Color.dim)
                                            Spacer()
                                            Text(meter.used.map { "\(Int($0.rounded()))% · \(meter.resets)" } ?? meter.resets)
                                                .font(.caption.monospacedDigit())
                                                .foregroundStyle(Color.soft)
                                        }
                                        GeometryReader { geo in
                                            let pct = max(0, min(100, meter.used ?? 0)) / 100
                                            ZStack(alignment: .leading) {
                                                Capsule().fill(Color.well)
                                                Capsule().fill(meterColor(meter.used ?? 0))
                                                    .frame(width: geo.size.width * pct)
                                            }
                                        }
                                        .frame(height: 5)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func kpiGrid(_ s: TokenUsageReport.Summary) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            kpiCard("Total Tokens", Self.formatTokens(s.totalTokens), "\(s.turns) turns", .working)
            kpiCard("Est. Cost", Self.formatCost(s.totalCost), "Avg \(Self.formatCost(s.avgCostPerDay))/day", .ink)
            kpiCard("Cache Hit", "\(Int((s.cacheHitRate * 100).rounded()))%", "Saved \(Self.formatCost(s.cacheSaved))", .added)
            kpiCard("Input / Out", Self.formatTokens(s.inputTokens), "\(Self.formatTokens(s.outputTokens)) out", .soft)
        }
    }

    private func kpiCard(_ label: String, _ value: String, _ sub: String, _ tint: Color) -> some View {
        StratusCard(padding: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(Color.muted)
                Text(value)
                    .font(.system(size: 20, weight: .semibold).monospacedDigit())
                    .foregroundStyle(tint)
                Text(sub)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.dim)
                    .lineLimit(1)
            }
        }
    }

    private func dailyChartCard(_ points: [TokenUsageReport.DailyPoint]) -> some View {
        let maxTokens = max(1, points.map(\.tokens).max() ?? 1)
        return StratusCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("14-Day Volume")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.ink)
                    Spacer()
                    if let first = points.first, let last = points.last {
                        Text("\(first.label) – \(last.label)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Color.muted)
                    }
                }
                HStack(alignment: .bottom, spacing: 5) {
                    ForEach(points) { pt in
                        let h = max(3, CGFloat(pt.tokens / maxTokens) * 68)
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(pt.tokens > 0 ? Color.working : Color.raised)
                                .frame(height: h)
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("\(pt.label): \(Self.formatTokens(pt.tokens)) tokens")
                    }
                }
                .frame(height: 76, alignment: .bottom)
            }
        }
    }

    private func providersCard(_ rows: [TokenUsageReport.ProviderRow]) -> some View {
        StratusCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("By Provider")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ink)
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(row.label).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink)
                            Text("\(row.turns) turns").font(.caption.monospacedDigit()).foregroundStyle(Color.muted)
                            Spacer()
                            Text("\(Self.formatTokens(row.total)) · \(Self.formatCost(row.cost))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Color.soft)
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.well)
                                Capsule().fill(providerTint(row.provider))
                                    .frame(width: geo.size.width * max(0.03, min(1, row.share)))
                            }
                        }
                        .frame(height: 4)
                    }
                }
            }
        }
    }

    private func modelsCard(_ rows: [TokenUsageReport.ModelRow]) -> some View {
        StratusCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Top Models")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ink)
                ForEach(Array(rows.prefix(8).enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Divider().overlay(Color.hairline) }
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.model).font(.footnote.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                            Text("\(providerName(row.provider)) · \(row.turns) turns · \(Int((row.cacheHitRate * 100).rounded()))% cache")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Color.muted)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Self.formatTokens(row.total)).font(.footnote.weight(.medium).monospacedDigit()).foregroundStyle(Color.soft)
                            Text(Self.formatCost(row.cost)).font(.caption.monospacedDigit()).foregroundStyle(Color.muted)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func load(force: Bool) async {
        if force { refreshingLimits = true } else if report == nil { loading = true }
        defer { loading = false; refreshingLimits = false }
        do {
            report = try await link.usage(force: force)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func planDisplayName(_ key: String) -> String {
        switch key {
        case "claude": "Claude Code"
        case "gemini": "Antigravity"
        case "codex": "Codex"
        default: providerName(key)
        }
    }

    private func providerTint(_ p: String) -> Color {
        switch p {
        case "claude": Color(hex: 0xE58B5B)
        case "gemini": Color(hex: 0x818CF8)
        case "codex": Color(hex: 0x34D399)
        case "deepseek": Color(hex: 0x38BDF8)
        default: Color.working
        }
    }

    private func meterColor(_ pct: Double) -> Color {
        if pct >= 90 { return .removed }
        if pct >= 70 { return .asking }
        return .added
    }

    static func formatTokens(_ n: Double) -> String {
        if n >= 1_000_000_000 { return String(format: "%.2fB", n / 1_000_000_000) }
        if n >= 1_000_000 { return String(format: "%.1fM", n / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", n / 1_000) }
        return "\(Int(n.rounded()))"
    }

    static func formatCost(_ n: Double) -> String {
        if n >= 100 { return String(format: "$%.0f", n) }
        if n >= 10 { return String(format: "$%.1f", n) }
        return String(format: "$%.2f", n)
    }
}
