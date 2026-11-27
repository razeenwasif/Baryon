import SwiftUI

// The message scroller, the same as the Mac's (src/message-rail.js): a thin tick for each message down the right edge,
// the one in view longer and brighter. Touch the rail and slide to scrub: the ticks swell under your finger, a card
// shows that message and the start of Fairy's answer, and letting go glides there. VoiceOver reads it as one control
// that swipes up and down through the messages.
struct MessageRail: View {
    struct Item: Equatable {
        var id: String
        var title: String
        var detail: String
        var mine: Bool
    }
    let items: [Item]
    let active: Int
    let go: (Int) -> Void
    @State private var held: Int?

    private static let tick: CGFloat = 10, wide: CGFloat = 18, column: CGFloat = 24

    // What the card says, as on the Mac: a short message and the reply after it, or a long one cut into two.
    static func preview(_ text: String, reply: String?) -> (title: String, detail: String) {
        func squash(_ text: String) -> String { text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
        func shorten(_ text: String, _ limit: Int) -> String {
            guard text.count > limit else { return text }
            let excerpt = String(text.prefix(limit))
            let cut = excerpt.lastIndex(of: " ").map { excerpt.distance(from: excerpt.startIndex, to: $0) } ?? 0
            return String(excerpt.prefix(cut > limit * 65 / 100 ? cut : limit)).trimmingCharacters(in: .whitespaces) + "…"
        }
        let clean = squash(text), answer = squash(reply ?? "")
        if clean.isEmpty { return ("Message", answer.isEmpty ? "" : shorten(answer, 88)) }
        if clean.count <= 56 { return (clean, answer.isEmpty ? "" : shorten(answer, 88)) }
        let title = shorten(clean, 56), rest = answer.isEmpty ? String(clean.dropFirst(title.count - 1)).trimmingCharacters(in: .whitespaces) : answer
        return (title, rest.isEmpty ? "" : shorten(rest, 88))
    }

    private func width(_ index: Int) -> CGFloat {
        let base = index == (held ?? active) ? Self.wide : Self.tick
        guard let held, index != held else { return base }
        let swell = max(0, 1 - CGFloat(abs(index - held)) / 2.5)
        return base + (Self.wide - Self.tick) * swell * swell
    }

    var body: some View {
        GeometryReader { area in
            let count = max(items.count, 1)
            let step = min(16, max(3, area.size.height / CGFloat(count)))
            let top = (area.size.height - step * CGFloat(count)) / 2
            let index = { (y: CGFloat) in min(items.count - 1, max(0, Int((y - top) / step))) }
            VStack(alignment: .trailing, spacing: 0) {
                ForEach(items.indices, id: \.self) { index in
                    Rectangle()
                        .fill(index == (held ?? active) ? Color.ink : Color.ink.opacity(0.38))
                        .frame(width: width(index), height: 1)
                        .frame(width: Self.column, height: step, alignment: .trailing)
                }
            }
            .frame(width: Self.column, height: area.size.height)
            .contentShape(Rectangle())
            .animation(.spring(duration: 0.22), value: held)
            .animation(.easeOut(duration: 0.2), value: active)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { held = index($0.location.y) }
                    .onEnded { done in held = nil; go(index(done.location.y)) }
            )
            .sensoryFeedback(.selection, trigger: held) { _, new in new != nil }
            .overlay(alignment: .topTrailing) {
                if let held, items.indices.contains(held) {
                    let item = items[held], y = top + step * (CGFloat(held) + 0.5)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title).font(.caption.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1)
                        if !item.detail.isEmpty { Text(item.detail).font(.caption).foregroundStyle(Color.muted).lineLimit(2) }
                    }
                    .padding(12)
                    .frame(width: 240, alignment: .leading)
                    .background(Color(red: 0.03, green: 0.04, blue: 0.09).opacity(0.94), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                    .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
                    .alignmentGuide(.top) { $0[VerticalAlignment.center] - min(max(y, 40), area.size.height - 40) }
                    .offset(x: -(Self.column + 8))
                    .allowsHitTesting(false)
                    .transition(.opacity.combined(with: .offset(x: 4)))
                }
            }
        }
        .frame(width: Self.column)
        .accessibilityElement()
        .accessibilityLabel("Messages in this chat")
        .accessibilityValue(items.indices.contains(active) ? "\(items[active].mine ? "Your" : "Fairy’s") message, \(active + 1) of \(items.count): \(items[active].title)" : "")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: go(min(items.count - 1, active + 1))
            case .decrement: go(max(0, active - 1))
            @unknown default: break
            }
        }
    }
}
