import SwiftUI

// Pure pitch-black T3 / Stratus Obsidian palette aligned with desktop src/workspace.css and commit 35f5536.
extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double(hex >> 16 & 255) / 255,
            green: Double(hex >> 8 & 255) / 255,
            blue: Double(hex & 255) / 255
        )
    }

    static let ground = Color(hex: 0x050507)
    static let well = Color(hex: 0x030304)
    static let side = Color(hex: 0x0B0B0E)
    static let card = Color(hex: 0x0B0B0E)
    static let surface = Color(hex: 0x0E0E12)
    static let raised = Color(hex: 0x111114)
    static let hover = Color(hex: 0x16161B)
    static let tool = Color(hex: 0x111114)
    static let ink = Color(hex: 0xF4F4F6)
    static let soft = Color(hex: 0xD5D8E2)
    static let dim = Color(hex: 0x8E8E99)
    static let muted = Color(hex: 0x6E7382)
    static let accent = Color(hex: 0x3E5AEC)
    static let working = Color(hex: 0x9FB2FF)
    static let asking = Color(hex: 0xFFD27A)
    static let added = Color(hex: 0x74E2A6)
    static let removed = Color(hex: 0xFF8A98)
    static let hairline = Color.white.opacity(0.06)
    static let hairlineStrong = Color.white.opacity(0.11)
}

struct PillButton: ButtonStyle {
    var fill = Color.raised
    var ink = Color.ink
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.8 : 1)
    }
}

struct StratusCard<Content: View>: View {
    var padding: CGFloat = 14
    var radius: CGFloat = 14
    var fill: Color = .card
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
    }
}

struct StratusSectionHeader: View {
    let title: String
    var color: Color = .muted
    var trailing: String? = nil

    var body: some View {
        HStack {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(color)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.muted)
            }
        }
    }
}

struct StratusBadge: View {
    let text: String
    var tint: Color = .dim
    var background: Color? = nil

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background((background ?? tint.opacity(0.14)), in: Capsule())
    }
}

extension String {
    var pathEnd: String { (self as NSString).lastPathComponent }
}
