import SwiftUI
import UIKit

// The clippings shelf on the phone, read-only beside a paper (docs: "Notebook paper view and clippings", follow-ons):
// what you pinned on the Mac, from papers, notes, the Studio and Pages, in a sheet that leaves the paper above it to
// scroll. Pictures are drawn on the Mac and kept here while the app runs.

struct ShelfButton: View {
    let slug: String
    @State private var showing = false
    var body: some View {
        Button { showing = true } label: {
            Image(systemName: "pin").font(.body.weight(.semibold)).foregroundStyle(Color.ink)
                .frame(width: 44, height: 44).background(Color.black.opacity(0.35), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clippings shelf")
        .sheet(isPresented: $showing) {
            ClipShelf(slug: slug)
                .presentationDetents([.fraction(0.42), .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.42)))
                .presentationBackground { Wallpaper(still: true) }
        }
    }
}

struct ClipShelf: View {
    let slug: String
    @Environment(LinkClient.self) private var link
    @State private var clips: [ClipRow]?
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Clippings").font(.headline).foregroundStyle(Color.ink)
                Spacer()
                if let clips, !clips.isEmpty { Text("\(clips.count) pinned").font(.caption).foregroundStyle(Color.muted) }
            }
            if let clips {
                if clips.isEmpty {
                    Text("Nothing pinned yet. Parts of papers, notes and pages you pin on the Mac wait here, beside the paper.")
                        .font(.subheadline).foregroundStyle(Color.dim)
                } else {
                    ScrollView { LazyVStack(spacing: 12) { ForEach(clips) { ClipCard(slug: slug, clip: $0) } }.padding(.bottom, 20) }
                        .refreshable { await load() }
                }
            } else if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            else { ProgressView().tint(Color.dim).frame(maxWidth: .infinity) }
        }
        .padding(.horizontal, 20).padding(.top, 22)
        .frame(maxHeight: .infinity, alignment: .top)
        .task { await load() }
    }

    private func load() async {
        do { let detail: NotebookDetail = try await link.study("notebook", ["slug": slug]); clips = detail.clips ?? []; problem = nil }
        catch { problem = error.localizedDescription }
    }
}

struct ClipCard: View {
    let slug: String
    let clip: ClipRow
    @Environment(LinkClient.self) private var link
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if clip.picture && !failed {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, alignment: .leading)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .accessibilityLabel(clip.title)
                } else {
                    RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.05)).frame(height: 90)
                        .overlay(ProgressView().tint(Color.dim))
                }
            }
            if let words = clip.words, !words.isEmpty, !clip.picture || failed {
                MarkdownText(text: words, font: .subheadline, color: .soft)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(clip.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink).lineLimit(2)
                Text(clip.from).font(.caption).foregroundStyle(Color.muted).lineLimit(2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.well, in: RoundedRectangle(cornerRadius: 16))
        .task { await loadPicture() }
    }

    private func loadPicture() async {
        guard clip.picture, image == nil else { return }
        let key = "\(slug)/\(clip.id)"
        if let kept = ClipPictures.kept[key] { image = kept; return }
        do {
            let reply: ClipPicture = try await link.study("notebook-clip-picture", ["slug": slug, "id": clip.id])
            guard let comma = reply.url.firstIndex(of: ","), let data = Data(base64Encoded: String(reply.url[reply.url.index(after: comma)...])), let picture = UIImage(data: data) else { failed = true; return }
            ClipPictures.kept[key] = picture
            image = picture
        } catch { failed = true }
    }
}

// Pictures fetched while the app runs, so opening the shelf again is instant.
@MainActor enum ClipPictures { static var kept: [String: UIImage] = [:] }
