import ActivityKit
import AlarmKit
import AppIntents
import SwiftUI
import WidgetKit

private let night = Color(hex: 0x0A0B14)

// What's left on a timer, counting down live while it runs.
private struct Remaining: View {
    let mode: AlarmPresentationState.Mode
    var body: some View {
        switch mode {
        case .countdown(let countdown):
            Text(timerInterval: Date.now...max(Date.now, countdown.fireDate), countsDown: true).monospacedDigit()
        case .paused(let paused):
            let left = max(0, paused.totalCountdownDuration - paused.previouslyElapsedDuration)
            Text(Duration.seconds(left).formatted(.time(pattern: left >= 3600 ? .hourMinuteSecond : .minuteSecond))).monospacedDigit()
        case .alert:
            Text("Time’s up")
        @unknown default:
            Text("")
        }
    }
}

// A timer Fairy set, on the Lock Screen and in the Dynamic Island. AlarmKit rings it; this only shows it counting down.
struct TimerActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<FairyTimer>.self) { context in
            HStack(spacing: 12) {
                FairyMark(size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.metadata?.label ?? "Timer").font(.subheadline.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                    Text("Set by Fairy").font(.footnote).foregroundStyle(Color.muted)
                }
                Spacer(minLength: 0)
                Remaining(mode: context.state.mode).font(.title2.weight(.light)).foregroundStyle(Color.ink)
            }
            .padding(14)
            .activityBackgroundTint(night)
            .activitySystemActionForegroundColor(Color.ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { FairyMark(size: 40) }
                DynamicIslandExpandedRegion(.center) { Text(context.attributes.metadata?.label ?? "Timer").font(.subheadline.weight(.medium)).lineLimit(1) }
                DynamicIslandExpandedRegion(.trailing) { Remaining(mode: context.state.mode).font(.title3.weight(.light)) }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(Color.accent)
            } compactTrailing: {
                Remaining(mode: context.state.mode).font(.caption2).frame(maxWidth: 48)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(Color.accent)
            }
        }
    }
}

// A button for Control Center, the Lock Screen and the Action button that opens Fairy listening.
struct TalkToFairyControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "dev.razeen.fairy.talk") {
            ControlWidgetButton(action: TalkToFairyIntent()) {
                Label("Talk to Fairy", systemImage: "waveform")
            }
        }
        .displayName("Talk to Fairy")
        .description("Opens Fairy listening, so you can ask her to do something.")
    }
}
