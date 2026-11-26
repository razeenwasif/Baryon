import Foundation

// What the Mac sends, from phoneOverview and phoneChat in desktop/phone-access.mjs. Anything it adds later is ignored.
struct Overview: Codable, Equatable {
    var chats: [SessionRow]
    var approvals: [Approval]
    var thread: String? = nil
    var folders: [WorkFolder]? = nil
    var scheduled: [Scheduled]? = nil
    var usage: [String: PlanUsage]? = nil
}

struct PlanUsage: Codable, Equatable {
    struct Meter: Codable, Equatable {
        var short: String
        var label: String
        var used: Double?
        var resets: String
    }
    var at: Double?
    var failed: Bool?
    var meters: [Meter]
}

struct Scheduled: Codable, Identifiable, Equatable {
    var id: String
    var kind: String
    var title: String
    var every: String
    var next: String?
}

struct WorkFolder: Codable, Identifiable, Equatable, Hashable {
    var path: String
    var name: String
    var id: String { path }
}

struct SessionRow: Codable, Identifiable, Equatable {
    struct Progress: Codable, Equatable {
        var done: Int
        var total: Int
    }
    var id: String
    var title: String
    var folder: String?
    var state: String
    var updatedAt: String? = nil
    var done: String? = nil
    var parent: String? = nil
    var progress: Progress? = nil
    var doing: String? = nil

    var place: String { folder ?? "" }
    var toCheck: Bool {
        guard state == "idle", done == nil, let updatedAt, let date = parsedDate(updatedAt) else { return false }
        return Date.now.timeIntervalSince(date) < 7 * 24 * 3600
    }
}

struct Approval: Codable, Identifiable, Equatable {
    struct Diff: Codable, Equatable {
        struct Row: Codable, Equatable {
            var type: String
            var text: String
        }
        var rows: [Row]?
        var truncated: Bool?
    }
    var id: String
    var kind: String?
    var title: String
    var chat: String?
    var session: String?
    var detail: String?
    var command: String?
    var plan: String?
    var diff: Diff?
    var note: String?
    var tooBig: Bool?
    var macOnly: Bool?

    var isPlan: Bool { kind == "plan" }
    var isCalendarEvent: Bool { kind == "calendar-event" }
    var phoneMayAllow: Bool { tooBig != true && macOnly != true }
}

struct Attached: Codable, Equatable, Hashable {
    var name: String
    var size: Int
}

struct AttachmentRef: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var size: Int
    var folder: Bool?
}

struct SessionDetail: Codable, Equatable {
    struct Message: Codable, Identifiable, Equatable {
        var role: String
        var at: String?
        var text: String
        var attachments: [Attached]? = nil
        struct From: Codable, Equatable {
            var title: String
            var kind: String
            var project: String?
            var heading: String
        }
        var from: From? = nil
        var a2ui: [A2UISurface]? = nil
        var id: String { "\(at ?? "")\(role)\(text.prefix(40))" }
    }
    struct Live: Codable, Equatable {
        struct Step: Codable, Identifiable, Equatable {
            var id: String
            var tool: String?
            var summary: String?
            var status: String?
        }
        struct Task: Codable, Identifiable, Equatable {
            var text: String
            var status: String?
            var id: String { text }
        }
        struct ThoughtItem: Codable, Identifiable, Equatable {
            var id: String
            var kind: String
            var text: String
            var status: String
            var durationMs: Int?
        }
        var rows: [Step]?
        var tasks: [Task]?
        var text: String?
        var thinking: String?
        var thoughts: [ThoughtItem]? = nil
        var a2ui: [A2UISurface]? = nil
    }
    var id: String
    var title: String
    var state: String?
    var messages: [Message]
    var live: Live?
    var failure: String?
    var voice: VoiceState?
}

struct VoiceState: Codable, Equatable {
    var parts: Int
    var done: Bool
    var failed: String?
}

struct ChatRow: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var updatedAt: String?
    var pinned: Bool?
    var folder: String?
    var work: String?
    var state: String

    var shortDate: String? {
        guard let updatedAt, let date = parsedDate(updatedAt) else { return nil }
        return Calendar.current.isDateInToday(date) ? date.formatted(date: .omitted, time: .shortened) : date.formatted(.dateTime.day().month(.abbreviated))
    }
}

func parsedDate(_ text: String) -> Date? {
    let reader = ISO8601DateFormatter()
    reader.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return reader.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}

struct PageItem: Codable, Identifiable, Equatable, Hashable {
    struct Concept: Codable, Equatable, Hashable {
        var name: String
        var file: String
    }
    struct Version: Codable, Equatable, Hashable {
        var seq: Int
        var at: String?
        var file: String
        var concepts: [Concept]
    }
    var id: String
    var kind: String
    var title: String
    var description: String?
    var updatedAt: String?
    var session: String?
    var opens: Bool
    var versions: [Version]
}
struct PageList: Decodable { var pages: [PageItem] }

struct MemoryBook: Decodable, Equatable {
    struct Note: Decodable, Identifiable, Equatable {
        var id: String
        var kind: String
        var text: String
        var fromReflection: Bool
        var used: Bool
    }
    struct Reflection: Decodable, Equatable {
        var on: Bool
        var at: String?
        var undone: Bool
        var added: Int
        var changed: Int
    }
    var notes: [Note]
    var reflection: Reflection
}

struct AboutMac: Decodable, Equatable {
    struct BriefStatus: Decodable, Equatable {
        struct ErrorInfo: Decodable, Equatable { var at: String; var message: String }
        var enabled: Bool
        var time: String
        var lastBrief: String
        var lastError: ErrorInfo?
    }
    struct CheckInStatus: Decodable, Equatable {
        var enabled: Bool
        var everyHours: Int
        var lastCheck: String
        var lastError: BriefStatus.ErrorInfo?
    }
    var pages: Int
    var notes: Int
    var routines: Int
    var workProvider: String
    var appName: String? = nil
    var brief: BriefStatus? = nil
    var checkIns: CheckInStatus? = nil
    var providers: [String: Bool]? = nil
}

struct ChatList: Decodable { var chats: [ChatRow] }
struct SentReply: Decodable { var chat: String }

struct LinkFrame: Decodable {
    var overview: Overview
    var chat: SessionDetail?
    var tutor: TutorLive?
}

struct PairingReply: Decodable {
    var readKey: String
    var approveKey: String
}

// MARK: - Usage & Plan Limits (/v1/usage)
struct TokenUsageReport: Codable, Equatable {
    struct Summary: Codable, Equatable {
        var totalTokens: Double
        var inputTokens: Double
        var outputTokens: Double
        var cachedTokens: Double
        var totalCost: Double
        var cacheSaved: Double
        var cacheHitRate: Double
        var turns: Int
        var activeDays: Int
        var avgPerDay: Double
        var avgCostPerDay: Double
    }
    struct ProviderRow: Codable, Identifiable, Equatable {
        var provider: String
        var label: String
        var color: String
        var turns: Int
        var sessions: Int
        var input: Double
        var output: Double
        var cached: Double
        var total: Double
        var cost: Double
        var cacheSaved: Double
        var share: Double
        var id: String { provider }
    }
    struct ModelRow: Codable, Identifiable, Equatable {
        var model: String
        var provider: String
        var turns: Int
        var total: Double
        var cost: Double
        var cacheHitRate: Double
        var share: Double
        var id: String { "\(provider):\(model)" }
    }
    struct DailyPoint: Codable, Identifiable, Equatable {
        var day: String
        var label: String
        var tokens: Double
        var cost: Double?
        var id: String { day }
    }
    var generatedAt: String
    var summary30: Summary
    var summary24: Summary
    var byProvider: [ProviderRow]
    var byModel: [ModelRow]
    var daily: [DailyPoint]
    var plans: [String: PlanUsage]
}

// MARK: - Models & Efforts (/v1/models)
struct ModelCatalog: Codable, Equatable {
    struct ModelOption: Codable, Identifiable, Equatable, Hashable {
        var id: String
        var name: String
    }
    struct ProviderEntry: Codable, Identifiable, Equatable {
        var id: String
        var name: String
        var connected: Bool
        var models: [ModelOption]
        var efforts: [String]
    }
    struct Selection: Codable, Equatable, Hashable {
        var provider: String
        var model: String
        var effort: String
    }
    var current: Selection
    var providers: [ProviderEntry]
}

struct BriefRunResult: Decodable, Equatable {
    var said: Bool?
    var unchanged: Bool?
    var pushed: Int?
    var thread: String?
}

// MARK: - Goals (/v1/goals, /v1/goal, /v1/goal-action)
struct GoalList: Codable, Equatable {
    struct Card: Codable, Identifiable, Equatable {
        var id: String
        var outcome: String
        var state: String
        var folder: String?
        var reason: String?
        var next: String?
        var running: Bool?
        var done: Int?
        var steps: Int?
    }
    var goals: [Card]
    var open: Int
    var max: Int
    var problem: String?
}

struct GoalDetail: Codable, Identifiable, Equatable {
    struct Step: Codable, Identifiable, Equatable {
        var id: String
        var what: String
        var state: String
        var report: String?
        var error: String?
    }
    struct DoneWhen: Codable, Equatable {
        var kind: String
        var command: String?
        var metric: String?
    }
    struct HistoryEntry: Codable, Identifiable, Equatable {
        var at: String
        var what: String
        var id: String { "\(at)-\(what.prefix(24))" }
    }
    var id: String
    var outcome: String
    var state: String
    var folder: String?
    var reason: String?
    var moves: String?
    var steps: [Step]
    var doneWhen: DoneWhen?
    var history: [HistoryEntry]?
    var created: String?
    var updated: String?
}

// MARK: - Research (/v1/research, /v1/research-detail)
struct ResearchHome: Codable, Equatable {
    struct HypothesisChip: Codable, Identifiable, Equatable {
        var id: String
        var text: String
        var status: String
        var seat: String?
        var model: String?
        var elo: Int
        var wins: Int
        var losses: Int
    }
    struct WaitingExp: Codable, Identifiable, Equatable {
        var id: String
        var hypothesis: String
        var seat: String?
        var model: String?
        var purpose: String
    }
    struct PaperRef: Codable, Identifiable, Equatable {
        var id: String
        var title: String
        var venue: String?
        var slug: String?
    }
    struct RunRef: Codable, Identifiable, Equatable {
        var job: String
        var target: String
        var machine: String
        var state: String
        var experiment: String
        var slug: String?
        var title: String?
        var id: String { "\(slug ?? "")-\(job)" }
    }
    struct RoundState: Codable, Equatable {
        var round: Int?
        var status: String?
        var stage: String?
    }
    struct Investigation: Codable, Identifiable, Equatable {
        var slug: String
        var title: String
        var discipline: String
        var rounds: Int
        var hypotheses: Int
        var active: Int
        var round: RoundState?
        var leading: HypothesisChip?
        var waiting: [WaitingExp]
        var climb: [Int]?
        var id: String { slug }
    }
    var investigations: [Investigation]
    var papers: [PaperRef]?
    var runs: [RunRef]?
}

struct ResearchDetail: Codable, Equatable {
    struct Hypothesis: Codable, Identifiable, Equatable {
        var id: String
        var title: String
        var status: String
        var elo: Int
        var wins: Int
        var losses: Int
        var statement: String
    }
    struct Paper: Codable, Identifiable, Equatable {
        var id: String
        var title: String
        var authors: String?
        var venue: String?
        var arxiv: String?
    }
    var slug: String
    var title: String
    var discipline: String
    var rounds: Int
    var round: ResearchHome.RoundState?
    var waiting: [ResearchHome.WaitingExp]
    var hypotheses: [Hypothesis]
    var papers: [Paper]
    var runs: [ResearchHome.RunRef]
    var report: String
}

// MARK: - Neutrino (/v1/neutrino, /v1/neutrino-pr)
struct NeutrinoInbox: Codable, Equatable {
    struct PRSummary: Codable, Identifiable, Equatable {
        var repo: String
        var number: Int
        var title: String
        var state: String
        var source: String
        var target: String
        var draft: Bool?
        var checks: String?
        var authorName: String?
        var updatedAt: String?
        var body: String?
        var openNotes: Int?
        var id: String { "\(repo)#\(number)" }
    }
    struct CIRun: Codable, Identifiable, Equatable {
        var id: Int
        var repo: String?
        var workflow: String?
        var name: String?
        var state: String
        var branch: String?
        var pull: Int?
        var createdAt: String?
    }
    var host: String?
    var ready: [PRSummary]
    var open: [PRSummary]
    var runs: [CIRun]
}

struct NeutrinoPRDetail: Codable, Equatable {
    struct ChangedFile: Codable, Identifiable, Equatable {
        var path: String
        var status: String
        var additions: Int?
        var deletions: Int?
        var id: String { path }
    }
    struct CommitItem: Codable, Identifiable, Equatable {
        var sha: String
        var short: String
        var subject: String
        var author: String?
        var id: String { sha }
    }
    struct NoteItem: Codable, Identifiable, Equatable {
        var id: Int
        var path: String?
        var line: Int?
        var resolved: Bool
        var text: String
    }
    var repo: String
    var number: Int
    var title: String
    var state: String
    var source: String
    var target: String
    var body: String?
    var checks: [NeutrinoInbox.CIRun]?
    var files: [ChangedFile]
    var commits: [CommitItem]
    var notes: [NoteItem]
    var diffText: String?
}

// MARK: - Analytics (/v1/analytics, /v1/analytics-run)
struct AnalyticsOverview: Codable, Equatable {
    struct EngineState: Codable, Equatable {
        var folder: String?
        var datasetCount: Int
        var runCount: Int
        var nexusAvailable: Bool?
    }
    struct Dataset: Codable, Identifiable, Equatable {
        struct ProfileSummary: Codable, Equatable {
            var rows: Int?
            var columns: Int?
            var format: String?
        }
        var id: String
        var name: String
        var source: String
        var format: String
        var sizeBytes: Int
        var modifiedAt: String?
        var profileSummary: ProfileSummary?
    }
    struct RunSummary: Codable, Identifiable, Equatable {
        var id: String
        var kind: String?
        var datasetName: String?
        var task: String
        var target: String?
        var primaryMetric: String?
        var primaryValue: Double?
        var bestModel: String?
        var status: String
        var computeTarget: String?
        var runtimeSeconds: Double?
        var createdAt: String?
    }
    var state: EngineState
    var datasets: [Dataset]
    var runs: [RunSummary]
}

struct AnalyticsRunDetail: Codable, Equatable {
    struct LeaderboardEntry: Codable, Identifiable, Equatable {
        var model: String?
        var label: String?
        var score: Double?
        var trainTime: Double?
        var id: String { label ?? model ?? UUID().uuidString }
    }
    struct FeatureImportance: Codable, Identifiable, Equatable {
        var feature: String
        var importance: Double
        var id: String { feature }
    }
    var id: String
    var datasetName: String?
    var task: String?
    var target: String?
    var status: String?
    var bestModelLabel: String?
    var bestModel: String?
    var primaryMetric: String?
    var primaryValue: Double?
    var leaderboard: [LeaderboardEntry]?
    var featureImportances: [FeatureImportance]?
    var runtimeSeconds: Double?
}

// MARK: - Boards (/v1/boards, /v1/board)
struct BoardList: Codable, Equatable {
    struct Meta: Codable, Identifiable, Equatable {
        var id: String
        var name: String
        var description: String?
        var elementCount: Int
        var updatedAt: String?
    }
    var items: [Meta]
}

struct BoardDetail: Codable, Equatable {
    struct Element: Codable, Identifiable, Equatable {
        var id: String
        var type: String
        var x: Double
        var y: Double
        var w: Double
        var h: Double
        var title: String
        var text: String
        var color: String
        var from: String
        var to: String
    }
    var meta: BoardList.Meta
    var background: String
    var elements: [Element]
}
