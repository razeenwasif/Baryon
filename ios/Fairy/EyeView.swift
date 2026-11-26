import SwiftUI

// Fairy's eye, drawn smooth at any size: the same eye as the Mac window's (src/fairy-smooth.js), with the same shapes,
// colours, lids, gaze and expressions in the same 80-unit grid as the pixel art (src/fairy-pixels.js), and soft
// gradients where the pixel art dithers. Each mood moves continuously rather than frame by frame.
enum EyeMood: String {
    case idle, listening, thinking, speaking, sleeping, happy

    var seconds: Double {
        switch self {
        case .idle: 6
        case .listening: 1.2
        case .thinking: 1.4
        case .speaking: 0.8
        case .sleeping: 3.6
        case .happy: 1
        }
    }
    var moves: Bool { self != .happy }
}

struct EyeView: View {
    var mood: EyeMood = .idle
    var size: CGFloat = 44
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still || !mood.moves)) { context in
            let place = still ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: mood.seconds) / mood.seconds
            Canvas { canvas, area in
                let (look, extras) = FairyLook.of(mood, at: place)
                FairyDrawing.draw(in: &canvas, size: area.width, look: look, extras: extras)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// An expression, as fairy-pixels.js names its fields: lids in sclera radii (-1.2 open, 1.1 closed), gaze in grid units,
// pupil dilation, glow 0–1, squint 0–1 (the happy ^ eye), and the scanning iris while she thinks.
struct FairyLook {
    var lid = -1.2, low = 1.2, squint = 0.0, tilt = 0.0, gx = 0.0, gy = 0.0, pupil = 1.0, glow = 0.45, spin = 0.0, dashed = 0.0
}
struct FairyGlyph { var kind: String; var x: Double; var y: Double; var alpha = 1.0 }

extension FairyLook {
    // The expressions of scripts/render-fairy-sprites.mjs, followed smoothly through each mood's cycle (0–1).
    static func of(_ mood: EyeMood, at place: Double) -> (FairyLook, [FairyGlyph]) {
        let tau = 2 * Double.pi, wave = sin(place * tau)
        var look = FairyLook()
        switch mood {
        case .idle:
            // Rests, glances left, then right, then back, with a quick blink between the glances.
            let stops: [(Double, Double, Double)] = [(0, 0, 0), (0.18, 0, 0), (0.26, -1.4, 0.6), (0.48, -1.4, 0.6), (0.6, 1.2, -0.5), (0.78, 1.2, -0.5), (0.88, 0, 0), (1, 0, 0)]
            let after = stops.firstIndex { $0.0 > place } ?? stops.count - 1, before = max(0, after - 1)
            let (t0, x0, y0) = stops[before], (t1, x1, y1) = stops[after]
            let k = t1 > t0 ? smooth((place - t0) / (t1 - t0)) : 0
            look.gx = x0 + (x1 - x0) * k
            look.gy = y0 + (y1 - y0) * k
            let blink = max(0, 1 - abs(place - 0.545) / 0.025)
            look.lid = -1.2 + (1.1 + 1.2) * blink
            look.glow = 0.42 + wave * 0.08
        case .listening:
            look.pupil = 1.12 + wave * 0.06
            look.glow = 0.8 + wave * 0.2
        case .thinking:
            look.lid = -0.2
            look.gx = 2 + wave * 0.9
            look.gy = -2.2
            look.dashed = 1
            look.spin = place * .pi / 2 * 3
            look.glow = 0.5
        case .speaking:
            let mouth = 0.55 + 0.45 * sin(place * tau * 2) * sin(place * tau * 3 + 1)
            look.lid = -0.8
            look.pupil = 1 + mouth * 0.28
            look.glow = 0.55 + mouth * 0.45
            look.gx = wave * 0.8
        case .sleeping:
            look.lid = 1.15
            look.glow = 0.12
            let zs = (0..<3).map { k -> FairyGlyph in
                let p = (place + Double(k) / 3).truncatingRemainder(dividingBy: 1)
                return FairyGlyph(kind: "z", x: 62 + p * 10, y: 16 - p * 14, alpha: 1 - p)
            }
            return (look, zs)
        case .happy:
            look.squint = 1
            look.glow = 0.85
            return (look, [FairyGlyph(kind: "spark", x: 10, y: 14), FairyGlyph(kind: "spark", x: 70, y: 14)])
        }
        return (look, [])
    }
    private static func smooth(_ x: Double) -> Double { let t = min(1, max(0, x)); return t * t * (3 - 2 * t) }
}

// The drawing itself, a port of drawFairySmooth.
enum FairyDrawing {
    private static let grid = 80.0, center = CGPoint(x: 40, y: 41)
    private static let disc = 29.0, casing = 21.8, ear = 28.0, sclera = 18.0, lavender = 13.5, iris = 10.3, pupil = 7.6
    private static func c(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> Color { Color(red: r / 255, green: g / 255, blue: b / 255, opacity: a) }
    private static let glow = (110.0, 160.0, 255.0), rim = c(234, 240, 255), discColor = c(62, 90, 236), discShade = c(52, 76, 216)
    private static let casingColor = c(22, 30, 146), casingShade = c(16, 22, 118), casingDeep = c(19, 26.4, 133.4)
    private static let scleraColor = c(238, 239, 248), scleraShade = c(212, 216, 240), lavenderColor = c(160, 169, 228)
    private static let irisColor = c(58, 140, 232), irisLight = c(112, 182, 246), pupilColor = c(28, 36, 150)
    private static let spark = c(250, 251, 255), sparkGlow = (178.0, 202.0, 255.0), heart = c(255, 156, 206), zColor = c(226, 234, 255)

    static func draw(in context: inout GraphicsContext, size: CGFloat, look e: FairyLook, extras: [FairyGlyph]) {
        let unit = size / grid
        var g = context
        g.scaleBy(x: unit, y: unit)
        let glowAmount = min(1, max(0, e.glow))
        let pupilR = max(4.5, min(9.4, pupil * e.pupil)), irisR = max(pupilR + 2.2, iris), lavR = max(irisR + 2.4, lavender)
        let squint = min(1, max(0, e.squint))

        var eye = g
        eye.translateBy(x: center.x, y: center.y)
        // Halo, brighter as she speaks.
        let inner = disc + 1.4, outer = inner + 4.2, haloAlpha = (0.25 + 0.6 * glowAmount) * (90 + 110 * glowAmount) / 255
        eye.fill(circle(outer), with: .radialGradient(Gradient(stops: [.init(color: c(glow.0, glow.1, glow.2, haloAlpha), location: inner / outer), .init(color: c(glow.0, glow.1, glow.2, 0), location: 1)]),
                                                      center: .zero, startRadius: 0, endRadius: outer))
        // Rim and disc, shaded toward the lower right.
        eye.fill(circle(inner), with: .color(rim))
        eye.fill(circle(disc), with: .linearGradient(Gradient(colors: [discColor, discShade]), startPoint: .zero, endPoint: CGPoint(x: disc / 0.9, y: disc / 0.9)))
        // The casing: diagonal ears behind a squircle, darker below.
        var ears = eye
        ears.clip(to: circle(ear))
        for turn in [Double.pi / 4, -Double.pi / 4] {
            var bar = ears
            bar.rotate(by: .radians(turn))
            bar.fill(Path(CGRect(x: -ear, y: -3.2, width: ear * 2, height: 6.4)), with: .color(casingShade))
        }
        eye.fill(squircle(casing), with: .linearGradient(Gradient(colors: [casingColor, casingDeep]), startPoint: CGPoint(x: 0, y: 4), endPoint: CGPoint(x: 0, y: casing)))

        // The eye, a little below the centre. Lids are the casing, covering it from above and below.
        eye.translateBy(x: 0, y: 0.5)
        var ball = eye
        ball.clip(to: circle(sclera))
        ball.fill(Path(CGRect(x: -sclera, y: -sclera, width: sclera * 2, height: sclera * 2)), with: .color(casingColor))
        let lid = lids(e)
        var open = ball
        open.clip(to: band { let l = lid($0); return (l.upper, l.lower) })
        if squint > 0.5 {
            // The happy ^ eye: the white below the arched lid, with a bright edge.
            open.fill(Path(CGRect(x: -sclera, y: -sclera, width: sclera * 2, height: sclera * 2)), with: .color(scleraColor))
            open.fill(band { let l = lid($0); return (l.happy - 2, l.happy + 1.2) }, with: .color(spark))
        } else {
            let ux = 0.4 / 1.077, uy = 1 / 1.077
            open.fill(Path(CGRect(x: -sclera, y: -sclera, width: sclera * 2, height: sclera * 2)),
                      with: .linearGradient(Gradient(colors: [scleraColor, scleraShade]), startPoint: CGPoint(x: ux * 9.2, y: uy * 9.2), endPoint: CGPoint(x: ux * 17.6, y: uy * 17.6)))
            open.translateBy(x: e.gx, y: e.gy)
            open.fill(circle(lavR), with: .color(lavenderColor))
            open.fill(circle(irisR), with: .color(irisColor))
            if e.dashed > 0 {
                // The scanning iris: lighter arcs turning round the ring while she thinks.
                let width = Double.pi / 4 * 0.55 * e.dashed
                for k in 0..<4 {
                    let start = Double(k) * .pi / 2 - e.spin
                    var arc = Path()
                    arc.addArc(center: .zero, radius: irisR, startAngle: .radians(start), endAngle: .radians(start + width), clockwise: false)
                    arc.addArc(center: .zero, radius: pupilR, startAngle: .radians(start + width), endAngle: .radians(start), clockwise: true)
                    arc.closeSubpath()
                    open.fill(arc, with: .color(irisLight))
                }
            }
            open.fill(circle(pupilR + 1.1), with: .color(irisLight))
            open.fill(circle(pupilR), with: .color(pupilColor))
            // The highlight at the lower right of the iris.
            open.translateBy(x: 4.2, y: 5.4)
            open.fill(circle(4.8), with: .radialGradient(Gradient(stops: [.init(color: c(sparkGlow.0, sparkGlow.1, sparkGlow.2, 0.6), location: 3.2 / 4.8), .init(color: c(sparkGlow.0, sparkGlow.1, sparkGlow.2, 0), location: 1)]),
                                                         center: .zero, startRadius: 0, endRadius: 4.8))
            open.fill(circle(3.4), with: .color(spark))
        }
        // The upper lid's edge, a shade darker, once it has come down into the eye.
        if e.lid * sclera > -sclera {
            ball.fill(band { let l = lid($0); return (l.upper - 1.2, l.upper) }, with: .color(casingShade))
        }

        // Glyphs in the margin, upright whatever the eye is doing.
        for item in extras {
            var mark = g
            mark.opacity = min(1, max(0, item.alpha))
            mark.translateBy(x: item.x, y: item.y)
            if item.kind == "z" {
                mark.draw(Text("z").font(.system(size: 5.2, weight: .bold, design: .rounded)).foregroundColor(zColor), at: .zero)
            } else {
                var star = Path()
                for i in 0..<8 {
                    let r = i % 2 == 1 ? 0.45 : 2.1, t = -Double.pi / 2 + Double(i) * .pi / 4
                    let point = CGPoint(x: cos(t) * r, y: sin(t) * r)
                    i == 0 ? star.move(to: point) : star.addLine(to: point)
                }
                star.closeSubpath()
                mark.addFilter(.shadow(color: c(sparkGlow.0, sparkGlow.1, sparkGlow.2, 0.9), radius: 1))
                mark.fill(star, with: .color(spark))
            }
        }
    }

    private static func circle(_ r: Double) -> Path { Path(ellipseIn: CGRect(x: -r, y: -r, width: r * 2, height: r * 2)) }
    // The casing's squircle: |x|⁴ + |y|⁴ = r⁴.
    private static func squircle(_ r: Double) -> Path {
        var path = Path()
        for i in 0...96 {
            let t = Double(i) / 96 * 2 * .pi, co = cos(t), si = sin(t)
            let point = CGPoint(x: r * (co < 0 ? -1 : 1) * sqrt(abs(co)), y: r * (si < 0 ? -1 : 1) * sqrt(abs(si)))
            i == 0 ? path.move(to: point) : path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }
    // The lids as two curves across the eye.
    private static func lids(_ e: FairyLook) -> (Double) -> (upper: Double, lower: Double, happy: Double) {
        let lidY = e.lid * sclera, lowY = e.low * sclera, sq = min(1, max(0, e.squint))
        return { ex in
            let bulge = 1 - min(1, pow(ex / sclera, 2))
            var upper = lidY + bulge * 2.2 + e.tilt * ex, lower = lowY - bulge * 3.2
            if sq > 0 { upper = upper * (1 - sq) + (1.5 - 8 * bulge) * sq; lower = lower * (1 - sq) + (6 - 8 * bulge) * sq }
            return (upper, lower, 1.5 - 8 * bulge)
        }
    }
    // A band between two curves across the eye.
    private static func band(_ f: (Double) -> (Double, Double)) -> Path {
        let steps = 48
        var path = Path()
        for i in 0...steps { let ex = -sclera + 2 * sclera * Double(i) / Double(steps); let top = f(ex).0; i == 0 ? path.move(to: CGPoint(x: ex, y: top)) : path.addLine(to: CGPoint(x: ex, y: top)) }
        for i in stride(from: steps, through: 0, by: -1) { let ex = -sclera + 2 * sclera * Double(i) / Double(steps); path.addLine(to: CGPoint(x: ex, y: f(ex).1)) }
        path.closeSubpath()
        return path
    }
}
