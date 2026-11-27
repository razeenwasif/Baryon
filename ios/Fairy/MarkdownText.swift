import SwiftUI

// A reply's Markdown, drawn the way it reads on the Mac: paragraphs, bulleted and numbered lists with their text hanging
// clear of the marker, headings, and code blocks. Bold, italics, links and code words inside a line come from iOS's own
// inline Markdown.
struct MarkdownText: View {
    let text: String
    var font: Font = .body.weight(.light)
    var color: Color = .soft
    // While the text is still arriving, the last block fades its new words in (StreamingMarkdown).
    var tail: StreamFade? = nil

    enum Block: Equatable {
        case paragraph(String)
        case heading(String)
        case item(marker: String, text: String, depth: Int)
        case code(String)
    }

    // Splits the text into blocks a line at a time. Anything unusual stays as a paragraph, so nothing is lost.
    static func blocks(_ text: String) -> [Block] {
        var blocks: [Block] = [], paragraph: [String] = [], code: [String]? = nil
        func flush() { if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] } }
        for raw in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let open = code { blocks.append(.code(open.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
                continue
            }
            if code != nil { code?.append(raw); continue }
            if line.isEmpty { flush(); continue }
            let indent = raw.prefix { $0 == " " || $0 == "\t" }.count, depth = min(3, indent / 2)
            if let match = line.firstMatch(of: /^#{1,6}\s+(.+)$/) { flush(); blocks.append(.heading(String(match.1))); continue }
            if let match = line.firstMatch(of: /^[-*•]\s+(.+)$/) { flush(); blocks.append(.item(marker: "•", text: String(match.1), depth: depth)); continue }
            if let match = line.firstMatch(of: /^(\d{1,3})[.)]\s+(.+)$/) { flush(); blocks.append(.item(marker: "\(match.1).", text: String(match.2), depth: depth)); continue }
            paragraph.append(line)
        }
        if let open = code { blocks.append(.code(open.joined(separator: "\n"))) }
        flush()
        return blocks
    }

    private static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
    private func inline(_ text: String) -> AttributedString { Self.inline(text) }
    // How many characters a block shows, once its Markdown marks are taken out.
    static func shownLength(_ block: Block) -> Int {
        switch block {
        case .paragraph(let words), .heading(let words): inline(words).characters.count
        case .item(_, let words, _): inline(words).characters.count
        case .code(let source): source.count
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            let blocks = Self.blocks(text)
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                let fade = index == blocks.count - 1 ? tail : nil
                switch block {
                case .paragraph(let words):
                    Text(inline(words)).font(font).lineSpacing(3).foregroundStyle(color).modifier(FadingTail(renderer: fade))
                case .heading(let words):
                    Text(inline(words)).font(.headline.weight(.semibold)).foregroundStyle(Color.ink).padding(.top, 4).modifier(FadingTail(renderer: fade))
                case .item(let marker, let words, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(marker).font(font.monospacedDigit()).foregroundStyle(Color.muted).frame(minWidth: 14, alignment: .leading).accessibilityHidden(true)
                        Text(inline(words)).font(font).lineSpacing(3).foregroundStyle(color).frame(maxWidth: .infinity, alignment: .leading).modifier(FadingTail(renderer: fade))
                    }
                    .padding(.leading, CGFloat(depth) * 18)
                case .code(let source):
                    CodeBlock(text: source)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

private struct FadingTail: ViewModifier {
    let renderer: StreamFade?
    func body(content: Content) -> some View {
        if let renderer { content.textRenderer(renderer) } else { content }
    }
}
