import SwiftUI

// A13. For reading only: the Mac has no route for changing a note from a phone.
struct MemoryView: View {
    @Environment(LinkClient.self) private var link
    @Environment(\.dismiss) private var dismiss
    @State private var book: MemoryBook?
    @State private var problem: String?
    @State private var search = ""

    private static let kinds = [("you", "About you"), ("projects", "Projects and goals"), ("self", "Baryon’s history"), ("work", "Development projects")]

    private var found: [MemoryBook.Note] {
        let term = search.trimmingCharacters(in: .whitespaces)
        let notes = book?.notes ?? []
        return term.isEmpty ? notes : notes.filter { $0.text.localizedCaseInsensitiveContains(term) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Saved only on your Mac. Each reply gets just the notes that fit the request.").font(.subheadline).foregroundStyle(Color.dim).padding(.horizontal, 4)
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.muted).accessibilityHidden(true)
                    TextField("Search notes", text: $search).foregroundStyle(Color.ink).autocorrectionDisabled()
                }
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(Color.raised, in: Capsule())
                .padding(.top, 12)
                ForEach(Self.kinds, id: \.0) { kind, label in
                    let notes = found.filter { $0.kind == kind }
                    if !notes.isEmpty {
                        Text(label).font(.footnote).foregroundStyle(Color.muted).padding(.top, 14).padding(.bottom, 4).padding(.leading, 4)
                        VStack(spacing: 0) {
                            ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in
                                if index > 0 { Divider().overlay(Color.hairline) }
                                NoteRow(note: note)
                            }
                        }
                        .padding(.horizontal, 14)
                        .background(Color.side, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                if let problem { Text(problem).font(.subheadline).foregroundStyle(Color.removed).padding(.top, 24) }
                else if book == nil { HStack { Spacer(); EyeView(mood: .thinking, size: 96); Spacer() }.padding(.top, 40) }
                else if found.isEmpty {
                    Text(search.isEmpty ? "Nothing saved yet." : "No notes match that.").font(.subheadline).foregroundStyle(Color.dim).frame(maxWidth: .infinity).padding(.top, 24)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectHidden(true, for: .all)
        .mask { EdgeFade() }
        .onWallpaper(0.45)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 4) {
                Button { dismiss() } label: { Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44).background(Color.black.opacity(0.35), in: Circle()).overlay(Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 1)) }.foregroundStyle(Color.ink).accessibilityLabel("Back to settings")
                Text("Long-term memory").font(.system(size: 28, weight: .light)).foregroundStyle(Color.ink).lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .buttonStyle(.plain)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Divider().overlay(Color.hairline)
                Text("To add, edit or remove a note, use Settings on your Mac.").font(.footnote).foregroundStyle(Color.dim).padding(.top, 6)
                if let words = book?.reflection.summary { Text(words).font(.footnote).foregroundStyle(Color.muted) }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { book = try await link.memory(); problem = nil }
        catch { problem = error.localizedDescription }
    }
}

private struct NoteRow: View {
    let note: MemoryBook.Note
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(note.text).font(.subheadline).foregroundStyle(Color.ink).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            if note.used {
                HStack(spacing: 6) {
                    Circle().fill(Color.working).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text("Went with your last reply").font(.caption).foregroundStyle(Color.working)
                }
            }
            if note.fromReflection { Text("From reflection").font(.caption).foregroundStyle(Color.muted) }
        }
        .padding(.vertical, 9)
        .frame(minHeight: 48)
    }
}

extension MemoryBook.Reflection {
    var summary: String {
        guard on else { return "Reflection is off." }
        guard let at, let date = parsedDate(at) else { return "Reflection is on. It hasn’t run yet." }
        let day = Calendar.current.isDateInToday(date) ? "today" : date.formatted(.dateTime.day().month(.abbreviated))
        let when = "Last run \(day) at \(date.formatted(date: .omitted, time: .shortened))"
        if undone { return "Reflection is on. \(when), and that run was undone." }
        let parts = [added > 0 ? "\(added) \(added == 1 ? "note" : "notes") added" : nil, changed > 0 ? "\(changed) changed" : nil].compactMap(\.self)
        return "Reflection is on. \(when), \(parts.isEmpty ? "nothing new" : parts.joined(separator: ", "))."
    }
}
