import SwiftUI

struct BoardsSectionView: View {
    @Environment(LinkClient.self) private var link
    @State private var list: BoardList?
    @State private var loading = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            if let list {
                StratusSectionHeader(title: "Boards", trailing: "\(list.items.count)")
                if list.items.isEmpty {
                    StratusCard { Text("No visual boards yet. Create one in Boards on \(link.macName).").font(.subheadline).foregroundStyle(Color.dim) }
                } else {
                    ForEach(list.items) { board in
                        NavigationLink { BoardViewerScreen(meta: board) } label: {
                            StratusCard(padding: 14) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(board.name).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                                        Text("\(board.elementCount) items\(board.description.map { $0.isEmpty ? "" : " · \($0)" } ?? "")")
                                            .font(.caption).foregroundStyle(Color.muted).lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.muted)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if loading {
                HStack { Spacer(); ProgressView().tint(Color.dim); Spacer() }.padding(.vertical, 32)
            }
        }
        .task { await load() }
    }

    private func load() async {
        if list == nil { loading = true }
        defer { loading = false }
        do { list = try await link.boardsList(); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct BoardViewerScreen: View {
    let meta: BoardList.Meta
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var detail: BoardDetail?
    @State private var problem: String?
    @State private var outlineMode = false
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var zoom: CGFloat = 0.65
    @State private var lastZoom: CGFloat = 0.65

    var body: some View {
        ZStack {
            Color.well.ignoresSafeArea()
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(Color.removed).padding(20)
            } else if let detail {
                if outlineMode {
                    outlineView(detail)
                } else {
                    canvasView(detail)
                }
            } else {
                ProgressView().tint(Color.dim)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            TopBar(title: detail?.meta.name ?? meta.name, back: "Boards") { dismiss() } trailing: {
                Button { outlineMode.toggle() } label: {
                    Image(systemName: outlineMode ? "square.on.square" : "list.bullet")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.ink)
                        .frame(width: 40, height: 40)
                        .background(Color.raised, in: Circle())
                        .overlay(Circle().strokeBorder(Color.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .task {
            do { detail = try await link.boardDetail(meta.id) }
            catch { problem = error.localizedDescription }
        }
    }

    private func canvasView(_ detail: BoardDetail) -> some View {
        let nodes = detail.elements.filter { $0.type != "arrow" && $0.type != "connector" && $0.type != "line" }
        let edges = detail.elements.filter { !$0.from.isEmpty && !$0.to.isEmpty }
        let byId = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })

        return GeometryReader { _ in
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    for edge in edges {
                        guard let a = byId[edge.from], let b = byId[edge.to] else { continue }
                        var p = Path()
                        p.move(to: CGPoint(x: a.x + a.w / 2, y: a.y + a.h / 2))
                        p.addLine(to: CGPoint(x: b.x + b.w / 2, y: b.y + b.h / 2))
                        context.stroke(p, with: .color(Color.working.opacity(0.55)), lineWidth: 1.5)
                    }
                }
                ForEach(nodes) { el in
                    VStack(alignment: .leading, spacing: 4) {
                        if !el.title.isEmpty { Text(el.title).font(.caption.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(2) }
                        if !el.text.isEmpty { Text(el.text).font(.caption2).foregroundStyle(Color.soft).lineLimit(6) }
                    }
                    .padding(10)
                    .frame(width: max(120, el.w), height: max(64, el.h), alignment: .topLeading)
                    .background(Color.card, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(el.type == "frame" ? Color.working.opacity(0.45) : Color.hairlineStrong, lineWidth: 1))
                    .position(x: el.x + el.w / 2, y: el.y + el.h / 2)
                }
            }
            .scaleEffect(zoom)
            .offset(offset)
            .contentShape(Rectangle())
            .gesture(DragGesture().onChanged { v in offset = CGSize(width: lastOffset.width + v.translation.width, height: lastOffset.height + v.translation.height) }.onEnded { _ in lastOffset = offset })
            .simultaneousGesture(MagnificationGesture().onChanged { v in zoom = max(0.25, min(2.0, lastZoom * v)) }.onEnded { _ in lastZoom = zoom })
        }
        .clipped()
    }

    private func outlineView(_ detail: BoardDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(detail.elements.filter { !$0.title.isEmpty || !$0.text.isEmpty }) { el in
                    StratusCard(padding: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(el.type.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.muted)
                            if !el.title.isEmpty { Text(el.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.ink) }
                            if !el.text.isEmpty { Text(el.text).font(.caption).foregroundStyle(Color.soft) }
                        }
                    }
                }
            }
            .padding(16)
        }
    }
}
