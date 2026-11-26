import ActivityKit
import SwiftUI
import WidgetKit

private let workLink = URL(string: "fairy://work")!
private let night = Color(hex: 0x0A0B14)

// The app icon's mark, drawn so it stays sharp at any size.
struct FairyMark: View {
    var size: CGFloat
    var body: some View {
        let light = LinearGradient(colors: [Color(hex: 0xC4D5FF), Color(hex: 0x3E5AEC)], startPoint: .topLeading, endPoint: .bottomTrailing)
        ZStack {
            Circle().trim(from: 0, to: 0.853).stroke(light, style: StrokeStyle(lineWidth: size * 0.065, lineCap: .round)).rotationEffect(.degrees(-18.6)).padding(size * 0.033)
            Circle().fill(light).frame(width: size * 0.547, height: size * 0.547)
            Circle().fill(night).frame(width: size * 0.27, height: size * 0.27)
            Circle().fill(.white).frame(width: size * 0.094, height: size * 0.094).offset(x: size * 0.053, y: size * 0.053)
            Image(systemName: "sparkle").font(.system(size: size * 0.2)).foregroundStyle(.white).offset(x: size * 0.33, y: -size * 0.33)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private extension Glance {
    var headline: String {
        if waiting > 0 { return waiting == 1 ? "1 needs your OK" : "\(waiting) need your OK" }
        return working > 0 ? "\(working) working" : "All quiet"
    }
}

struct GlanceEntry: TimelineEntry {
    let date: Date
    let glance: Glance?
}

struct GlanceTimeline: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry { GlanceEntry(date: .now, glance: Glance(waiting: 0, working: 1, rows: [], at: .now)) }
    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) { completion(GlanceEntry(date: .now, glance: Glance.load() ?? placeholder(in: context).glance)) }
    // Only the app has anything new to draw, and it asks for a redraw when it does.
    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        completion(Timeline(entries: [GlanceEntry(date: .now, glance: Glance.load())], policy: .never))
    }
}

private struct SeenLine: View {
    let at: Date
    var body: some View { Text("Seen \(at, style: .relative) ago").lineLimit(1).minimumScaleFactor(0.8) }
}

private struct HomeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GlanceEntry

    var body: some View {
        Group {
            if let glance = entry.glance {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        FairyMark(size: 30)
                        Spacer()
                        if glance.waiting > 0 { Circle().fill(Color.asking).frame(width: 10, height: 10).accessibilityHidden(true) }
                    }
                    Spacer(minLength: 0)
                    Text(glance.headline).font(.headline).foregroundStyle(glance.waiting > 0 ? Color.asking : Color.ink).lineLimit(2).minimumScaleFactor(0.8)
                    if family == .systemMedium {
                        ForEach(glance.rows) { row in
                            Text(row.title).font(.subheadline).foregroundStyle(Color.dim).lineLimit(1).privacySensitive()
                        }
                    }
                    SeenLine(at: glance.at).font(.caption2).foregroundStyle(Color.muted)
                }
            } else {
                VStack(alignment: .leading) {
                    FairyMark(size: 30)
                    Spacer(minLength: 0)
                    Text("Open Baryon to pair with your Mac.").font(.footnote).foregroundStyle(Color.dim)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { Color.ground }
        .widgetURL(workLink)
    }
}

struct FairyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FairyWidget", provider: GlanceTimeline()) { HomeWidgetView(entry: $0) }
            .configurationDisplayName("Baryon")
            .description("What your work sessions were doing when Baryon last looked.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct LockWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GlanceEntry

    var body: some View {
        Group {
            if family == .accessoryCircular {
                ZStack {
                    AccessoryWidgetBackground()
                    if let waiting = entry.glance?.waiting, waiting > 0 { Text("\(waiting)").font(.title2.weight(.semibold)).accessibilityLabel("\(waiting) waiting for your OK") }
                    else { FairyMark(size: 44) }
                }
            } else if let glance = entry.glance {
                VStack(alignment: .leading, spacing: 0) {
                    Text(glance.headline).font(.headline).widgetAccentable().lineLimit(1)
                    if let row = glance.rows.first { Text(row.title).font(.caption).lineLimit(1).privacySensitive() }
                    SeenLine(at: glance.at).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Open Fairy to pair").font(.footnote)
            }
        }
        .containerBackground(.clear, for: .widget)
        .widgetURL(workLink)
    }
}

struct FairyLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FairyLockWidget", provider: GlanceTimeline()) { LockWidgetView(entry: $0) }
            .configurationDisplayName("Fairy")
            .description("What your work sessions were doing when the app last looked.")
            .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

private struct ActivityView: View {
    let state: WorkActivity.ContentState
    let stale: Bool

    var body: some View {
        HStack(spacing: 12) {
            FairyMark(size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                if stale {
                    Text("Last heard \(state.at, style: .time). Open Fairy to update.").font(.footnote).foregroundStyle(Color.muted).lineLimit(1).minimumScaleFactor(0.8)
                } else {
                    Text([state.words, state.more].compactMap(\.self).joined(separator: " · ")).font(.footnote).foregroundStyle(state.waiting ? Color.asking : Color.working).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}

struct WorkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkActivity.self) { context in
            ActivityView(state: context.state, stale: context.isStale)
                .activityBackgroundTint(night)
                .activitySystemActionForegroundColor(Color.ink)
                .widgetURL(workLink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { FairyMark(size: 40) }
                DynamicIslandExpandedRegion(.center) { Text(context.state.title).font(.subheadline.weight(.medium)).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.isStale { Text("Last heard \(context.state.at, style: .time). Open Fairy to update.").font(.footnote).foregroundStyle(Color.muted) }
                    else { Text([context.state.words, context.state.more].compactMap(\.self).joined(separator: " · ")).font(.footnote).foregroundStyle(context.state.waiting ? Color.asking : Color.working) }
                }
            } compactLeading: {
                FairyMark(size: 22)
            } compactTrailing: {
                Text(context.isStale ? "Old" : context.state.waiting ? "Your OK" : "Working").font(.caption2).foregroundStyle(context.isStale ? Color.muted : context.state.waiting ? Color.asking : Color.working).lineLimit(1)
            } minimal: {
                FairyMark(size: 22)
            }
            .widgetURL(workLink)
        }
    }
}

@main
struct FairyWidgets: WidgetBundle {
    var body: some Widget {
        FairyWidget()
        FairyLockWidget()
        WorkActivityWidget()
        TimerActivityWidget()
        TalkToFairyControl()
    }
}
