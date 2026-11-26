import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Files, folders and photos added from the + in the message box. Each goes to the Mac as soon as it's chosen, so the
// message can go the moment you send it; Fairy then reads them there, as she reads files attached on the Mac.
enum AttachSource { case files, folder, photos }

// One thing on its way: uploading, ready (with the Mac's id), or refused with why.
struct Attaching: Identifiable, Equatable {
    let id = UUID()
    var name: String
    var folder = false
    var photo = false
    var ref: AttachmentRef?
    var problem: String?
    var waiting: Bool { ref == nil && problem == nil }
}

// What's attached to the message being written, above the message box.
struct AttachingRow: View {
    let items: [Attaching]
    let remove: (Attaching) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    HStack(spacing: 6) {
                        if item.waiting { ProgressView().controlSize(.mini).tint(Color.soft) }
                        else if item.problem != nil { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.asking) }
                        else { Image(systemName: item.folder ? "folder.fill" : item.photo ? "photo" : "doc.fill").foregroundStyle(Color(hex: 0xA9C4FF)) }
                        Text(item.name).lineLimit(1).truncationMode(.middle).frame(maxWidth: 150, alignment: .leading)
                        Button { remove(item) } label: { Image(systemName: "xmark").font(.caption2.weight(.bold)).frame(width: 20, height: 20) }
                            .accessibilityLabel("Remove \(item.name)")
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.ink)
                    .padding(.leading, 10)
                    .padding(.trailing, 4)
                    .frame(height: 32)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(item.waiting ? "Sending to your Mac" : item.problem ?? "Ready")
                }
            }
            .padding(.horizontal, 16)
        }
        .overlay(alignment: .bottomLeading) {
            if let problem = items.compactMap(\.problem).last {
                Text(problem).font(.caption).foregroundStyle(Color.asking).lineLimit(2).padding(.horizontal, 16).offset(y: 20)
            }
        }
    }
}

// What went with a sent message, under your bubble.
struct AttachedRow: View {
    let items: [Attached]

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            ForEach(items, id: \.self) { item in
                HStack(spacing: 6) {
                    Image(systemName: item.name.contains(".") ? "doc.fill" : "folder.fill").foregroundStyle(Color(hex: 0xA9C4FF))
                    Text(item.name).lineLimit(1).truncationMode(.middle)
                }
                .font(.footnote)
                .foregroundStyle(Color.soft)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Color.white.opacity(0.06), in: Capsule())
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// The pickers behind the + menu: the Files app for files or a folder, and the photo library.
struct AttachPickers: ViewModifier {
    @Binding var source: AttachSource?
    let picked: ([URL]) -> Void
    let photo: (Data, String) -> Void
    @State private var photos: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .fileImporter(isPresented: Binding(get: { source == .files || source == .folder }, set: { if !$0 { source = nil } }),
                          allowedContentTypes: source == .folder ? [.folder] : [.item], allowsMultipleSelection: source != .folder) { result in
                if case .success(let urls) = result { picked(urls) }
            }
            .photosPicker(isPresented: Binding(get: { source == .photos }, set: { if !$0 { source = nil } }), selection: $photos, maxSelectionCount: 10, matching: .images)
            .onChange(of: photos) { _, chosen in
                guard !chosen.isEmpty else { return }
                photos = []
                for (index, item) in chosen.enumerated() {
                    Task {
                        // Sent as JPEG, which the Mac reads; the library's HEIC it doesn't.
                        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) else { return }
                        photo(jpeg, chosen.count == 1 ? "Photo.jpg" : "Photo \(index + 1).jpg")
                    }
                }
            }
    }
}
