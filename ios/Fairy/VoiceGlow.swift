import SwiftUI

// Talking to Fairy inside a chat, as on the Mac: the message box becomes a voice bar, and a glow along the bottom edge
// rises and blooms with your voice, after transitions.dev's voice assistant card and its voice-glow beam. While what
// you said is being answered the glow gathers into one beam that sweeps along the edge. White and Fairy's blues.

// The glow. Seven soft lobes sit along the bottom edge, the centre first and then pairs outwards; your voice lifts and
// widens them, and while it's heard the colours drift sideways so each takes a turn in the middle. The motion follows
// voice-glow's numbers: 0.325 s to rise, 0.86 s to settle, a resting breath every 5.2 s, and a 1.1 s sweep while working.
struct VoiceGlow: View {
    // The microphone's level, as VoiceTalk measures it (loud speech is around 0.07).
    var level: Float
    var working: Bool
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var drive = GlowDrive()

    static let colours: [Color] = [0xCFE0FF, 0x4F8DFF, 0x2D4DFF, 0x7FB4FF, 0x3E5AEC, 0xA9C4FF, 0x1F5BFF].map { Color(hex: $0) }

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            let now = context.date.timeIntervalSinceReferenceDate
            let state = drive.step(level: still ? 0.3 : min(1, CGFloat(level) * 14), working: working, at: now)
            ZStack(alignment: .bottom) {
                Canvas { canvas, size in
                    let mid = size.width / 2, spacing = size.width * 0.17
                    let ring = spacing * 7
                    let offsets: [CGFloat] = [0, -1, 1, -2, 2, -3, 3]
                    let beam = mid + size.width * 0.32 * state.sweep
                    for (index, offset) in offsets.enumerated() {
                        // Drifting sideways and wrapping round, so the colours take turns at the centre.
                        var x = offset * spacing + state.flow
                        x = (x + ring * 1.5).truncatingRemainder(dividingBy: ring) - ring / 2
                        x = mid + x
                        // Each lobe answers the voice a little differently, so it ripples rather than pumps.
                        let band = state.level * (0.72 + 0.28 * sin(now * (2.1 + Double(index) * 0.7) + Double(index)))
                        let width = spacing * (1.5 + 0.5 * state.level)
                        let height = 36 + 150 * band
                        // Working, the lobes gather into one beam that travels the edge.
                        let at = x + (beam - x) * state.gather
                        let wide = width * (1 - 0.45 * state.gather)
                        let rect = CGRect(x: at - wide, y: size.height - height, width: wide * 2, height: height * 2)
                        let fade = abs(x - mid) / (ring / 2)
                        canvas.opacity = Double(max(0.25, 1 - fade * 0.6)) * (index == 0 ? 0.95 : 0.85)
                        canvas.fill(Ellipse().path(in: rect), with: .radialGradient(
                            Gradient(colors: [Self.colours[index], Self.colours[index].opacity(0)]),
                            center: CGPoint(x: rect.midX, y: rect.midY), startRadius: 0, endRadius: max(wide, height)))
                    }
                }
                .blur(radius: 26)
                // The bright edge itself: a thin line, white at its heart and blue outwards.
                Capsule()
                    .fill(LinearGradient(colors: [.clear, Color(hex: 0x3E5AEC), .white, Color(hex: 0x3E5AEC), .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(height: 2)
                    .scaleEffect(x: 0.55 + 0.45 * state.level, anchor: .center)
                    .offset(x: (state.sweep * 0.32) * state.gather * 390)
                    .blur(radius: 0.6)
                    .opacity(0.5 + 0.5 * state.level)
            }
            .blendMode(.plusLighter)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// Where the glow is from one frame to the next: the level easing towards the voice, the colours' drift, and how far it
// has gathered into the working beam.
final class GlowDrive {
    private var last: Double?
    private var level: CGFloat = 0
    private var flow: CGFloat = 0
    private var gather: CGFloat = 0
    private var started: Double = 0

    struct State { var level: CGFloat; var flow: CGFloat; var gather: CGFloat; var sweep: CGFloat }

    func step(level target: CGFloat, working: Bool, at now: Double) -> State {
        let delta = min(0.1, max(0, now - (last ?? now)))
        if last == nil { started = now }
        last = now
        // A resting breath, so it never looks dead while you're quiet.
        let breath = 0.12 + 0.04 * sin((now - started) * 2 * .pi / 5.2)
        let goal = working ? 0.55 : max(breath, target)
        let time = goal > level ? 0.325 : 0.86
        level += (goal - level) * CGFloat(1 - exp(-delta * 3 / time))
        gather += ((working ? 1 : 0) - gather) * CGFloat(1 - exp(-delta * 3 / 0.6))
        flow += CGFloat(delta) * 48 * level * (1 - gather)
        // Back and forth, easing into each turn.
        let phase = (now - started).truncatingRemainder(dividingBy: 2.2) / 2.2
        let swing = sin(phase * 2 * .pi)
        let sweep = CGFloat(copysign(pow(abs(swing), 1 / 2.1), swing))
        return State(level: level, flow: flow, gather: gather, sweep: sweep)
    }
}

// The voice bar that takes the message box's place: what you're saying as it's heard, a caption saying what's
// happening, and the buttons to type instead, to stop or cut in, and to keep Fairy quiet.
struct VoiceBar: View {
    let talk: VoiceTalk
    let close: () -> Void

    private var caption: String {
        switch talk.mode {
        case .starting: "Getting ready"
        case .listening: "Listening…"
        case .thinking: "One moment"
        case .speaking: "Speaking · tap to cut in"
        case .paused: "Microphone off · tap to talk"
        case .blocked: "Type instead"
        }
    }
    private var live: Bool { talk.mode == .listening || talk.mode == .speaking }
    private var blockedWords: String? { if case .blocked(let words) = talk.mode, !words.isEmpty { words } else { nil } }

    var body: some View {
        VStack(spacing: 10) {
            if !talk.heard.isEmpty, talk.mode == .listening || talk.mode == .thinking {
                StreamingWords(text: talk.heard)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.leading, 40)
            }
            if let note = talk.hint ?? blockedWords {
                Text(note).font(.footnote).foregroundStyle(Color.dim).multilineTextAlignment(.center)
            }
            if let problem = talk.problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).multilineTextAlignment(.center) }
            SwapText(caption).font(.footnote).foregroundStyle(Color.dim)
            HStack(spacing: 18) {
                round("keyboard", "Type instead", action: close)
                Button {
                    if talk.mode == .listening, talk.heard.isEmpty { talk.toggleMicrophone() } else { talk.tap() }
                } label: {
                    WaveBars(moving: live)
                        .foregroundStyle(Color.ground)
                        .frame(width: 64, height: 64)
                        .background(Color.ink, in: Circle())
                }
                .accessibilityLabel(talk.mode == .listening ? (talk.heard.isEmpty ? "Turn the microphone off" : "Send what you said") : talk.mode == .paused ? "Turn the microphone on" : "Cut in")
                round(talk.quiet ? "speaker.slash" : "speaker.wave.2", talk.quiet ? "Let Fairy speak" : "Keep Fairy quiet") { talk.toggleQuiet() }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .buttonStyle(.plain)
    }

    private func round(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 19)).foregroundStyle(Color.ink).frame(width: 50, height: 50).background(Color.tool, in: Circle())
        }
        .accessibilityLabel(label)
    }
}

// Five bars that rise and fall in the button while Fairy is listening or speaking.
private struct WaveBars: View {
    let moving: Bool
    @Environment(\.accessibilityReduceMotion) private var still
    private let heights: [CGFloat] = [8, 16, 24, 16, 8]
    private let delays: [Double] = [0, -0.27, -0.54, -0.135, -0.405]

    var body: some View {
        TimelineView(.animation(paused: !moving || still)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(heights.indices, id: \.self) { index in
                    // 900 ms, easing between full height and 35 %.
                    let phase = ((time - delays[index]) / 0.9).truncatingRemainder(dividingBy: 1)
                    let scale = moving && !still ? 0.35 + 0.65 * (0.5 + 0.5 * cos(phase * 2 * .pi)) : 1
                    Capsule().frame(width: 3, height: heights[index] * scale)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// What you're saying, each word fading in from a slight blur as it's heard.
struct StreamingWords: View {
    let text: String
    private var words: [String] { text.split(separator: " ").map(String.init) }
    var body: some View {
        WordFlow(spacing: 5) {
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                Text(word).transition(BlurSlide())
            }
        }
        .font(.system(size: 17, weight: .light))
        .foregroundStyle(Color.ink)
        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.35), value: words.count)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

// Words in lines, right-aligned, wrapping as needed.
private struct WordFlow: Layout {
    var spacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let lines = lines(subviews, width: proposal.width ?? .infinity)
        let width = lines.map(\.width).max() ?? 0
        let height = lines.reduce(0) { $0 + $1.height } + CGFloat(max(0, lines.count - 1)) * 2
        return CGSize(width: proposal.width ?? width, height: height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(subviews, width: bounds.width) {
            var x = bounds.maxX - line.width
            for index in line.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += line.height + 2
        }
    }
    private func lines(_ subviews: Subviews, width: CGFloat) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var result: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        var items: [Int] = [], used: CGFloat = 0, tall: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = items.isEmpty ? size.width : used + spacing + size.width
            if needed > width, !items.isEmpty {
                result.append((items, used, tall))
                items = [index]; used = size.width; tall = size.height
            } else {
                items.append(index); used = needed; tall = max(tall, size.height)
            }
        }
        if !items.isEmpty { result.append((items, used, tall)) }
        return result
    }
}
