import Foundation

// Study notebooks as the Mac sends them (desktop/phone-notebooks.mjs).

struct TutorFollow: Equatable { var slug: String; var chat: String? }

// A tutor chat as the stream sees it: an answer being written there (html, step), or the last one, finished (text).
struct TutorLive: Decodable, Equatable {
    var slug: String
    var chat: String?
    var state: String
    var asked: String?
    var html: String?
    var text: String?
    var step: String?
    var voice: TutorVoiceState?
    var failure: String?
    var last: Double?
    var working: Bool { state == "working" }
}
struct TutorVoiceState: Decodable, Equatable { var parts: Int; var done: Bool; var failed: String?; var problem: String? }

struct NotebookList: Decodable { var notebooks: [NotebookRow] }
struct NotebookRow: Decodable, Identifiable, Hashable {
    var slug: String
    var title: String
    var course: String
    var exam: String?
    var daysToExam: Int?
    var archived: Bool
    var sources: Int
    var notes: Int
    var chats: Int
    var cardsDue: Int
    var heldBy: String?
    var id: String { slug }
}

struct NotebookDetail: Decodable {
    var slug: String
    var title: String
    var course: String
    var exam: String?
    var daysToExam: Int?
    var categories: [String]
    var sources: [NotebookSource]
    var notes: [NotebookNote]
    var files: [FileRow]
    var chats: [TutorChatRow]
    var made: [MadeRow]
    var flashcards: Flashcards
    // The clippings shelf (a Mac from before 17 Nov sends none).
    var clips: [ClipRow]?
}
struct NotebookSource: Decodable, Identifiable, Hashable {
    var id: String
    var title: String
    var kind: String
    var role: String
    var units: String?
    var count: Int
    var state: String
    var hasWords: Bool
    var category: String?
    var pdf: Bool
    var size: String {
        switch units {
        case "pages": "\(count) page\(count == 1 ? "" : "s")"
        case "seconds": "\(max(1, count / 60)) min"
        case "lines": "\(count) line\(count == 1 ? "" : "s")"
        default: ""
        }
    }
}
struct NotebookNote: Decodable, Identifiable, Hashable { var id: String; var title: String; var updated: Double?; var words: Int }
struct FileRow: Decodable, Identifiable, Hashable { var name: String; var size: Int; var id: String { name } }
struct TutorChatRow: Decodable, Identifiable, Hashable { var id: String; var title: String; var updated: Double?; var turns: Int }
struct MadeRow: Decodable, Identifiable, Hashable {
    var id: String
    var kind: String
    var title: String
    var made: Double?
    var count: Int?
    var state: String?
    var opens: String
}
struct Flashcards: Decodable { var due: Int; var decks: [DeckRow] }
// A clipping on the shelf: where it's from, its words when it's words, and whether the Mac can send a picture of it.
struct ClipRow: Decodable, Identifiable, Hashable { var id: String; var title: String; var from: String; var words: String?; var picture: Bool }
struct ClipPicture: Decodable { var url: String; var old: Bool? }
struct DeckRow: Decodable, Identifiable, Hashable { var id: String; var title: String; var cards: Int; var due: Int }

struct SourceWords: Decodable {
    struct Cue: Decodable, Hashable { var start: Double; var end: Double; var text: String }
    var id: String
    var title: String
    var pdf: Bool
    var units: String?
    var total: Int
    var page: Int?
    var text: String?
    var from: Int?
    var to: Int?
    var lines: [String]?
    var cues: [Cue]?
}

struct Citation: Decodable, Identifiable, Hashable {
    var n: Int
    var raw: String
    var source: String
    var title: String
    var units: String?
    var from: Double?
    var to: Double?
    var quote: String
    var resolved: Bool
    var id: Int { n }
    // Where it points, said plainly: "page 12", "lines 40–58", "3:12".
    var place: String {
        guard let from else { return "" }
        let to = self.to ?? from
        switch units {
        case "pages": return from == to ? "page \(Int(from))" : "pages \(Int(from))–\(Int(to))"
        case "lines": return from == to ? "line \(Int(from))" : "lines \(Int(from))–\(Int(to))"
        case "seconds": return Self.clock(from)
        default: return ""
        }
    }
    static func clock(_ seconds: Double) -> String { let s = Int(seconds); return String(format: "%d:%02d", s / 60, s % 60) }
}
struct TutorAnimation: Decodable, Hashable { var title: String; var code: String }

struct RenderedNote: Decodable { var id: String; var title: String; var html: String; var citations: [Citation]; var animations: [TutorAnimation] }
struct RenderedMade: Decodable { var id: String; var kind: String; var title: String; var html: String; var citations: [Citation]; var animations: [TutorAnimation] }
struct NotebookFile: Decodable { var name: String; var kind: String; var size: Int; var text: String?; var pdf: String? }

struct TutorChat: Decodable, Equatable {
    var id: String
    var title: String
    var updated: Double?
    var earlier: Int
    var compacted: Int
    var turns: [TutorTurn]
}
struct TutorTurn: Decodable, Equatable {
    struct Made: Decodable, Equatable, Hashable { var id: String?; var title: String?; var name: String? }
    var asked: String
    var at: Double?
    // As written, for the iPhone's own voice when Fairy's can't read it.
    var answer: String
    var html: String
    var animations: [TutorAnimation]
    var citations: [Citation]
    var notes: [Made]
    var files: [Made]
    var error: String?
}

struct Review: Decodable { var card: ReviewCard?; var due: Int; var waiting: Double? }
struct ReviewCard: Decodable, Equatable {
    var deck: String
    var deckTitle: String
    var id: String
    var kind: String
    var topic: String
    var front: String
    var back: String
    var citations: [Citation]
    var after: [Double]
}

struct QuizSheet: Decodable { var id: String; var title: String; var questions: [QuizQuestion] }
struct QuizQuestion: Decodable, Identifiable {
    struct Criterion: Decodable { var text: String; var points: Double }
    var id: String
    var kind: String
    var prompt: String
    var options: [String]
    var correct: [Int]
    var rationales: [String]
    var blanks: [[String]]
    var number: Double?
    var unit: String
    var tolerance: Double
    var hint: String
    var explanation: String
    var modelAnswer: String
    var rubric: [Criterion]
    var citations: [Citation]
}

struct AskedTutor: Decodable { var chat: String }
struct SpeakReply: Decodable { var ok: Bool; var problem: String? }

// Where a Study screen goes next.
enum StudyRoute: Hashable {
    case notebook(String, String)
    case chat(String, String?)
    case source(String, String, Double?)
    case note(String, String)
    case file(String, String)
    case pdfFile(String, String)
    case made(String, String, String)
    case review(String, String?)
    case quiz(String, String)
    case audio(String, String, String)
}

// The tutor as the in-chat voice talks to it (VoiceTalk): its questions go to the notebook, its answers come on the
// stream, and its clips are Fairy's voice reading them.
@MainActor
final class TutorVoice: VoiceBackend {
    private let link: LinkClient
    let slug: String
    init(link: LinkClient, slug: String) { self.link = link; self.slug = slug }
    var timers: Bool { false }
    func follow(_ conversation: String?) { link.followTutor(TutorFollow(slug: slug, chat: conversation)) }
    func send(_ words: String, to conversation: String?, voice: Bool) async throws -> String {
        var body: [String: Any] = ["slug": slug, "text": words, "voice": voice]
        if let conversation { body["chat"] = conversation }
        let asked: AskedTutor = try await link.studyPost("notebook-ask", body)
        return asked.chat
    }
    func stop(_ conversation: String) async { let _: SpeakReply? = try? await link.studyPost("notebook-stop", ["slug": slug, "chat": conversation]) }
    func clip(_ conversation: String, _ index: Int) async -> Data? { await link.studyVoicePart(slug: slug, chat: conversation, index: index) }
    func reply(for conversation: String?, sent: String) -> VoiceReply? {
        guard let live = link.tutor, live.slug == slug, live.chat == conversation, live.asked == sent else { return nil }
        return VoiceReply(working: live.working, text: live.text ?? "", failure: live.failure, parts: live.voice?.parts, done: live.voice?.done ?? false)
    }
}
