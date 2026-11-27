import SwiftUI

// Pure pitch-black T3 / Stratus background surfaces (Living Aurora & video wallpaper removed on iOS).
struct Wallpaper: View {
    var busy = false
    var listening = false
    var still = false
    var thinking = false
    var rippleAt: Date? = nil
    var covered = false

    var body: some View {
        Color.ground
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

extension View {
    func onWallpaper(_ veil: Double = 0) -> some View {
        background(Color.ground.ignoresSafeArea())
            .containerBackground(Color.ground, for: .navigation)
    }
}

// Top scroll header bar in pitch-black Stratus style with a crisp hairline bottom divider.
struct BarGlass: View {
    var body: some View {
        Color.ground.opacity(0.96)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.hairline).frame(height: 0.5)
            }
            .ignoresSafeArea(edges: .top)
    }
}

// Flat tonal Obsidian card modifier replacing glossy raised surfaces.
struct Raised: ViewModifier {
    var tint: Color = .card
    var radius: CGFloat = 14

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                shape.fill(tint)
                    .overlay(shape.strokeBorder(Color.hairline, lineWidth: 1))
            }
    }
}

extension View {
    func raised(_ tint: Color = .card, radius: CGFloat = 14) -> some View {
        modifier(Raised(tint: tint, radius: radius))
    }
}
