import SwiftUI

// One question from a work session. It's the same card in the list and on the session's own screen.
struct AskCard: View {
    let approval: Approval
    var showsSession = false
    @Environment(LinkClient.self) private var link
    @State private var settled = false
    @State private var sending = false
    @State private var problem: String?

    private var yes: String { approval.isPlan ? "Approve" : approval.isCalendarEvent ? "Add event" : "Allow once" }
    private var no: String { approval.isPlan ? "Not yet" : approval.isCalendarEvent ? "Cancel" : "Don’t allow" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Needs your OK").font(.footnote.weight(.semibold)).foregroundStyle(Color.asking)
                Text(approval.title).font(.headline).foregroundStyle(Color.ink)
                if showsSession, let chat = approval.chat { Text(chat).font(.footnote).foregroundStyle(Color.dim) }
            }
            if approval.tooBig == true {
                Text("This one is too long to show here. To allow it, answer on your Mac.").font(.body.weight(.light)).foregroundStyle(Color.soft)
                Text("The session will keep waiting until you do.").font(.subheadline).foregroundStyle(Color.dim)
            } else {
                if let detail = approval.detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(Color.soft) }
                if let command = approval.command { CodeBlock(text: command) }
                if let plan = approval.plan { Text(plan).font(.subheadline).foregroundStyle(Color.soft).fixedSize(horizontal: false, vertical: true) }
                if let rows = approval.diff?.rows, !rows.isEmpty { DiffBlock(rows: rows, truncated: approval.diff?.truncated == true) }
                if let note = approval.note, !note.isEmpty { Text(note).font(.footnote).foregroundStyle(Color.dim) }
                if approval.macOnly == true { Text("This reaches beyond the sandbox, so it can only be allowed on your Mac. You can refuse it here.").font(.footnote).foregroundStyle(Color.dim) }
                if approval.isPlan { Text("Fairy will still ask before each edit and command. To let it run on its own, approve on your Mac.").font(.footnote).foregroundStyle(Color.muted) }
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed) }
            HStack(spacing: 8) {
                Button(no) { answer(allow: false) }.buttonStyle(PillButton())
                if approval.phoneMayAllow { Button(yes) { answer(allow: true) }.buttonStyle(PillButton(fill: .accent, ink: .white)) }
            }
            .disabled(!settled || sending)
        }
        // Nothing drawn around it: straight on the background, like Fairy's words, its heading saying what it is.
        .padding(.horizontal, 4)
        .padding(.vertical, 8)
        // A new card waits a moment before taking a tap, so a tap meant for the last card can't land on it.
        .task(id: approval.id) {
            settled = false
            try? await Task.sleep(for: .milliseconds(800))
            settled = true
        }
    }

    private func answer(allow: Bool) {
        sending = true
        problem = nil
        Task {
            defer { sending = false }
            do { try await link.answer(approval, allow: allow) }
            catch { problem = error.localizedDescription }
        }
    }
}

struct CodeBlock: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.soft)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.well, in: RoundedRectangle(cornerRadius: 10))
            .textSelection(.enabled)
    }
}

struct DiffBlock: View {
    let rows: [Approval.Diff.Row]
    let truncated: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Text("\(row.type) \(row.text)")
                    .foregroundStyle(row.type == "+" ? Color.added : row.type == "-" ? Color.removed : Color.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if truncated { Text("… more lines not shown").foregroundStyle(Color.muted) }
        }
        .font(.system(.caption, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.well, in: RoundedRectangle(cornerRadius: 10))
    }
}
