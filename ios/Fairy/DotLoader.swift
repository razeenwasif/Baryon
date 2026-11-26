import SwiftUI

// Fairy's four-by-four dot loader, the same as the Mac sidebar's (src/dot-loader.js): every dot shares one 1.2 s pulse,
// and each state is a table of delays. Scan (Fairy replying) runs across in columns, orbit (a work session running)
// circles a lit middle, pulse (waiting for your OK) beats from the centre out, twinkle (up next) lights at random.
// Drawn in one Canvas at 30 frames a second; Reduce Motion holds every dot at half light.
struct DotLoader: View {
    enum Kind { case scan, orbit, pulse, twinkle }
    var kind: Kind
    var color: Color
    var dot: CGFloat = 2.5
    var gap: CGFloat = 2
    @Environment(\.accessibilityReduceMotion) private var still

    private struct Dot { var delay: Double; var gap = false; var hold = false }
    private static let cycle = 1200.0
    private static func plan(_ kind: Kind) -> [Dot] {
        let corners = [0, 3, 12, 15], ring = [1, 2, 7, 11, 14, 13, 8, 4], inner = [5, 6, 9, 10]
        let twinkle = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4]
        return (0..<16).map { index in
            switch kind {
            case .scan: return Dot(delay: Double(index % 4) * cycle / 10)
            case .twinkle: return Dot(delay: Double(twinkle[index]) * cycle / 16)
            case .orbit:
                if corners.contains(index) { return Dot(delay: 0, gap: true) }
                if let place = ring.firstIndex(of: index) { return Dot(delay: Double(place) * cycle / 8) }
                return Dot(delay: 0, hold: true)
            case .pulse:
                if corners.contains(index) { return Dot(delay: 0, gap: true) }
                return Dot(delay: inner.contains(index) ? 0 : cycle * 0.16)
            }
        }
    }
    private static let plans: [Kind: [Dot]] = [.scan: plan(.scan), .orbit: plan(.orbit), .pulse: plan(.pulse), .twinkle: plan(.twinkle)]

    // How lit a dot is at this moment of its pulse: up over the first 15%, back down by 45%, then resting.
    private static func level(_ ms: Double) -> Double {
        let t = (ms.truncatingRemainder(dividingBy: cycle) + cycle).truncatingRemainder(dividingBy: cycle) / cycle
        func ease(_ x: Double) -> Double { x * x * (3 - 2 * x) }
        if t < 0.15 { return ease(t / 0.15) }
        if t < 0.45 { return 1 - ease((t - 0.15) / 0.3) }
        return 0
    }

    var body: some View {
        let side = dot * 4 + gap * 3, dots = Self.plans[kind] ?? []
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still)) { context in
            let now = context.date.timeIntervalSinceReferenceDate * 1000
            Canvas { canvas, _ in
                for (index, plan) in dots.enumerated() where !plan.gap {
                    let lit = plan.hold ? 1 : still ? 0.55 : Self.level(now - plan.delay)
                    let place = CGRect(x: CGFloat(index % 4) * (dot + gap), y: CGFloat(index / 4) * (dot + gap), width: dot, height: dot)
                    canvas.fill(Path(roundedRect: place, cornerRadius: dot * 0.25), with: .color(color.opacity(0.2 + 0.8 * lit)))
                }
            }
        }
        .frame(width: side, height: side)
        .accessibilityHidden(true)
    }
}
