import SwiftUI

// Fairy writing: a quill running along a line of looped handwriting in her blue ink, the line fading behind it, then
// lifting and starting again. Shown while she works on a reply and under a reply as it arrives.
struct QuillView: View {
    var width: CGFloat = 130
    // Tall enough for the quill to stay whole at the top of its highest loop and as it lifts away: loops rise up to
    // 20 points, the feather stands 28 above its nib, and it lifts 10 more.
    var height: CGFloat = 64
    @Environment(\.accessibilityReduceMotion) private var still

    private static let seconds = 2.4
    private static let ink = Color(hex: 0xA9C4FF)
    private static let loops = 5.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: still)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            let phase = still ? 0.7 : (time / Self.seconds).truncatingRemainder(dividingBy: 1)
            Canvas { canvas, size in draw(in: &canvas, size: size, phase: phase, time: time) }
        }
        .frame(width: width, height: height)
        .accessibilityElement()
        .accessibilityLabel("Fairy is writing")
    }

    // A point on the line, s from 0 to 1 across the width: joined-up loops that alternate tall and short, like an l
    // then an e, slanting forward a little and drifting gently up and down the line.
    private func point(_ s: Double, in size: CGSize) -> CGPoint {
        let run = Double(size.width) - 30, turn = s * Self.loops * 2 * .pi
        let tall = 0.5 + 0.5 * sin(turn / 2 + 1.2)
        let radius = 4 + 4 * tall
        let rise = radius * (1 - cos(turn)) * (0.85 + 0.4 * tall)
        let x = 6 + s * run - radius * sin(turn) * 0.75 + rise * 0.22
        let y = Double(size.height) - 6 - rise + sin(s * 7 + 0.5) * 1.5
        return CGPoint(x: x, y: y)
    }

    private func draw(in canvas: inout GraphicsContext, size: CGSize, phase: Double, time: Double) {
        // Writing for the first 80%, then the whole line fades as the quill lifts away.
        let written = min(1, phase / 0.8), lift = max(0, (phase - 0.8) / 0.2)
        let steps = 160
        let end = max(1, Int(Double(steps) * written))
        // The ink as one stroke, fading toward where it began.
        var line = Path()
        line.move(to: point(0, in: size))
        for step in 1...end { line.addLine(to: point(Double(step) / Double(steps), in: size)) }
        let start = point(0, in: size).x, tip = point(Double(end) / Double(steps), in: size).x
        canvas.stroke(line, with: .linearGradient(Gradient(colors: [Self.ink.opacity(0.15 * (1 - lift)), Self.ink.opacity(1 - lift)]),
                                                  startPoint: CGPoint(x: start, y: 0), endPoint: CGPoint(x: max(start + 1, tip), y: 0)),
                      style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
        // The quill, its nib on the end of the line, nodding a little as it writes.
        let nib = point(Double(end) / Double(steps), in: size)
        let raise = CGFloat(lift) * 10, nod = sin(time * 14) * 0.06
        var quill = canvas
        quill.translateBy(x: nib.x, y: nib.y - raise)
        quill.rotate(by: .radians(-0.15 + nod))
        quill.opacity = 1 - lift * 0.6
        quill.fill(feather, with: .linearGradient(Gradient(colors: [.white, Self.ink.opacity(0.85)]), startPoint: CGPoint(x: 18, y: -26), endPoint: CGPoint(x: 0, y: 0)))
        var shaft = Path()
        shaft.move(to: .zero)
        shaft.addQuadCurve(to: CGPoint(x: 20, y: -27), control: CGPoint(x: 6, y: -15))
        quill.stroke(shaft, with: .color(Color(hex: 0x3E5AEC)), lineWidth: 1)
    }

    // A feather drawn with its nib at the origin, leaning up and to the right.
    private var feather: Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: 0))
        path.addQuadCurve(to: CGPoint(x: 21, y: -28), control: CGPoint(x: -1, y: -18))
        path.addQuadCurve(to: CGPoint(x: 4, y: -5), control: CGPoint(x: 18, y: -10))
        path.closeSubpath()
        return path
    }
}
