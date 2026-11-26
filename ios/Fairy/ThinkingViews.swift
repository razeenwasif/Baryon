import SwiftUI

// What Fairy is doing while she answers: a status that shimmers and slides to its next words, her reasoning streaming
// in under it when the model shares it, folding to "Thought for 9s" once she writes, and her reply's newest words
// fading in. The motion is the Fairy Motion mockups' (transitions.dev's durations and easings); Reduce Motion stills it.

// Her thinking for one reply, kept once she starts writing, and the answer it belongs under once that's saved.
struct Thought: Equatable {
    var seconds: Int
    var text: String
    var answer: Int?
}

// A soft light passing over text, for a status that's still going on.
struct Shimmer: ViewModifier {
    var active = true
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        if !active || still {
            content
        } else {
            content.overlay {
                TimelineView(.animation) { context in
                    let place = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
                    GeometryReader { area in
                        LinearGradient(colors: [.clear, .white.opacity(0.9), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: area.size.width * 0.45)
                            .offset(x: (place * 2.2 - 0.6) * area.size.width)
                    }
                }
                .mask(content)
                .allowsHitTesting(false)
            }
        }
    }
}
extension View {
    func shimmer(_ active: Bool = true) -> some View { modifier(Shimmer(active: active)) }
}

// Words that leave upwards with a blur as the next ones come up from below.
struct SwapText: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        ZStack(alignment: .leading) { Text(text).id(text).transition(BlurSlide()) }
            .animation(.easeInOut(duration: 0.15), value: text)
    }
}
struct BlurSlide: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content
            .opacity(phase.isIdentity ? 1 : 0)
            .blur(radius: phase.isIdentity ? 0 : 2)
            .offset(y: phase == .willAppear ? 4 : phase == .didDisappear ? -4 : 0)
    }
}

// Draws text with its newest glyphs fading in, lifted a little and soft, over 350 ms. Each arrival says how many glyphs
// of the text had come by then.
struct StreamFade: TextRenderer {
    struct Arrival: Equatable { var upTo: Int; var at: TimeInterval }
    var arrivals: [Arrival]
    var now: TimeInterval

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        var index = 0
        for line in layout {
            for run in line {
                for slice in run {
                    let at = arrivals.first { $0.upTo > index }?.at ?? now
                    let x = min(1, max(0, (now - at) / 0.35)), k = 1 - pow(1 - x, 3)
                    if k >= 1 {
                        context.draw(slice)
                    } else {
                        var copy = context
                        copy.opacity = k
                        copy.translateBy(x: 0, y: (1 - k) * 3)
                        copy.addFilter(.blur(radius: (1 - k) * 1.2))
                        copy.draw(slice)
                    }
                    index += 1
                }
            }
        }
    }
}

// Markdown that's still arriving: the last block (the one growing) fades its new words in.
struct StreamingMarkdown: View {
    let text: String
    var font: Font = .body.weight(.light)
    var color: Color = .soft
    @State private var arrivals: [StreamFade.Arrival] = []
    @State private var block = -1
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let fresh = arrivals.contains { Date.timeIntervalSinceReferenceDate - $0.at < 0.5 }
        TimelineView(.animation(paused: still || !fresh)) { context in
            MarkdownText(text: text, font: font, color: color, tail: still ? nil : StreamFade(arrivals: arrivals, now: context.date.timeIntervalSinceReferenceDate))
        }
        .onChange(of: text, initial: true) { old, new in record(new, first: old == new) }
    }

    private func record(_ text: String, first: Bool) {
        let blocks = MarkdownText.blocks(text), length = blocks.last.map(MarkdownText.shownLength) ?? 0
        let now = Date.timeIntervalSinceReferenceDate
        if blocks.count - 1 != block || first {
            // A new block: everything in it so far has just come (or, on first sight, was already there).
            block = blocks.count - 1
            arrivals = [StreamFade.Arrival(upTo: length, at: first ? now - 1 : now)]
        } else if length > (arrivals.last?.upTo ?? 0) {
            // Anything already faded in is folded into one entry, so the list stays short.
            let settled = arrivals.filter { now - $0.at >= 0.5 }.map(\.upTo).max()
            arrivals = (settled.map { [StreamFade.Arrival(upTo: $0, at: 0)] } ?? []) + arrivals.filter { now - $0.at < 0.5 } + [StreamFade.Arrival(upTo: length, at: now)]
        }
    }
}

// While she thinks: what she's doing, shimmering, how long it's been, and her reasoning as it comes when the model
// shares it, the oldest lines fading out at the top.
struct ThinkingBlock: View {
    let label: String
    let since: Date
    var reasoning: String?
    var thoughts: [SessionDetail.Live.ThoughtItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                SwapText(label).font(.footnote.weight(.medium)).foregroundStyle(Color.dim).shimmer()
                TimelineView(.periodic(from: since, by: 1)) { context in
                    Text("\(max(1, Int(context.date.timeIntervalSince(since))))s").font(.caption).foregroundStyle(Color.muted).monospacedDigit()
                }
            }
            if !thoughts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(thoughts.suffix(6)) { item in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: item.status == "done" ? "checkmark" : item.kind == "commentary" ? "text.bubble" : "circle.dotted")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(item.status == "done" ? Color.added : Color.working)
                                .frame(width: 14)
                                .padding(.top, 2)
                            Text(item.text)
                                .font(.caption)
                                .foregroundStyle(item.status == "running" ? Color.soft : Color.dim)
                                .lineLimit(3)
                            Spacer(minLength: 4)
                            if let ms = item.durationMs, ms > 0 {
                                Text("\(max(1, ms / 1000))s")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(Color.muted)
                            }
                        }
                    }
                }
                .padding(10)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            }
            if let reasoning, !reasoning.isEmpty {
                let long = reasoning.count > 240
                StreamingMarkdown(text: reasoning, font: .footnote, color: .muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, maxHeight: 132, alignment: .bottomLeading)
                    .clipped()
                    .mask(LinearGradient(stops: [.init(color: long ? .clear : .black, location: 0), .init(color: .black, location: 0.34)], startPoint: .top, endPoint: .bottom))
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.hairlineStrong).frame(width: 1) }
                    .accessibilityLabel("Baryon’s thinking: \(reasoning)")
            }
        }
        .padding(.leading, 4)
    }
}

// Once she's written: her thinking folded away, a tap from being read again.
struct ThoughtFor: View {
    let seconds: Int
    let reasoning: String
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(.easeOut(duration: 0.26)) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    Text("Thought for \(seconds)s")
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).rotationEffect(.degrees(open ? 90 : 0)).accessibilityHidden(true)
                }
                .font(.footnote)
                .foregroundStyle(Color.muted)
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(open ? "Hides her thinking" : "Shows her thinking")
            if open {
                MarkdownText(text: reasoning, font: .footnote, color: .muted)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.white.opacity(0.1)).frame(width: 1) }
                    .transition(.opacity.combined(with: .offset(y: -4)))
            }
        }
        .padding(.leading, 4)
    }
}
