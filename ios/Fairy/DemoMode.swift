#if DEBUG
import Foundation

// Made-up data for -FairyDemo (see LinkClient.loadDemo): enough of everything to see each screen in the Simulator.
enum Demo {
    static let on = ProcessInfo.processInfo.arguments.contains("-FairyDemo")
    private static func ago(_ minutes: Double) -> String { ISO8601DateFormatter().string(from: Date.now.addingTimeInterval(-minutes * 60)) }

    static let approval = Approval(id: "ask-1", kind: "command", title: "Run the test suite", chat: "Notebook search", session: "w1",
                                   detail: "Fairy wants to run the tests after changing the search ranking.", command: "npm test -- test/notebook-search.test.mjs")
    static let calendarAsk = Approval(id: "ask-2", kind: "calendar-event", title: "Create this Google Calendar event?", chat: "From Fairy", session: "c0",
                                      detail: "Title: Dinner with Sam\nCalendar: Personal\nStart: Friday 14 November 2026 at 7:00 pm\nEnd: Friday 14 November 2026 at 8:30 pm")

    static var overview: Overview {
        Overview(chats: [
            SessionRow(id: "w1", title: "Notebook search", folder: "Fairy", state: "waiting", updatedAt: ago(3), progress: .init(done: 2, total: 3), doing: "npm test -- test/notebook-search.test.mjs"),
            SessionRow(id: "w2", title: "Tidy the onboarding copy", folder: "flux", state: "working", updatedAt: ago(8), progress: .init(done: 3, total: 5), doing: "Editing src/onboarding.js"),
            SessionRow(id: "w4", title: "Write the release notes", folder: "Fairy", state: "working", updatedAt: ago(2), parent: "Notebook search", progress: .init(done: 1, total: 4), doing: "Drafting CHANGELOG.md"),
            SessionRow(id: "w3", title: "Fix the PDF page reset", folder: "Fairy", state: "idle", updatedAt: ago(140)),
            SessionRow(id: "w5", title: "Add the Simulator panel", folder: "Fairy", state: "idle", updatedAt: ago(60 * 30), done: ago(60 * 29)),
            SessionRow(id: "w6", title: "Rename Robin to Fairy", folder: "Fairy", state: "idle", updatedAt: ago(60 * 24 * 9)),
        ], approvals: [approval, calendarAsk], thread: "c0", folders: [
            WorkFolder(path: "/Users/demo/Github/Fairy", name: "Fairy"), WorkFolder(path: "/Users/demo/Github/flux", name: "flux"), WorkFolder(path: "/Users/demo/Github/Proton", name: "Proton"),
        ], scheduled: [
            Scheduled(id: "check-in", kind: "check-in", title: "Check-in", every: "Every 3 hours, quiet 10:00 PM–7:00 AM", next: ISO8601DateFormatter().string(from: .now.addingTimeInterval(5400))),
            Scheduled(id: "brief", kind: "brief", title: "Morning brief", every: "Every day at 7:30 AM", next: ISO8601DateFormatter().string(from: Calendar.current.date(bySettingHour: 7, minute: 30, second: 0, of: .now.addingTimeInterval(86400))!)),
            Scheduled(id: "s1", kind: "routine", title: "Weekly review", every: "Sun at 6:00 PM", next: ISO8601DateFormatter().string(from: .now.addingTimeInterval(86400 * 4))),
        ])
    }

    static var chats: [ChatRow] {
        [
            ChatRow(id: "c0", title: "From Fairy", updatedAt: ago(12), pinned: true, folder: nil, work: nil, state: "idle"),
            ChatRow(id: "w1", title: "Notebook search", updatedAt: ago(3), pinned: false, folder: "Development", work: "Fairy", state: "waiting"),
            ChatRow(id: "w2", title: "Tidy the onboarding copy", updatedAt: ago(8), pinned: false, folder: "Development", work: "flux", state: "working"),
            ChatRow(id: "c1", title: "Dinner ideas for Friday", updatedAt: ago(95), pinned: false, folder: nil, work: nil, state: "idle"),
            ChatRow(id: "c2", title: "COMP3600 exam plan", updatedAt: ago(60 * 26), pinned: false, folder: "Study", work: nil, state: "idle"),
            ChatRow(id: "w3", title: "Fix the PDF page reset", updatedAt: ago(60 * 30), pinned: false, folder: "Development", work: "Fairy", state: "idle"),
            ChatRow(id: "c3", title: "Flight to Melbourne", updatedAt: ago(60 * 75), pinned: false, folder: nil, work: nil, state: "idle"),
        ]
    }

    // Chats begun in the demo, so a new chat's first message gets an answer (and the chat its look once begun).
    nonisolated(unsafe) static var begun: [String: SessionDetail] = [:]
    static func begin(_ text: String, in chat: String?, attachments: [Attached] = []) -> String {
        let id = chat ?? "new-\(begun.count + 1)"
        var detail = begun[id] ?? SessionDetail(id: id, title: String(text.prefix(32)), state: "idle", messages: [])
        detail.messages += [SessionDetail.Message(role: "user", at: ago(0), text: text, attachments: attachments.isEmpty ? nil : attachments),
                            SessionDetail.Message(role: "assistant", at: ago(0), text: "Here’s a start. Monday and Tuesday are your busiest days, so I’d keep Wednesday afternoon free for the lab report and put revision on Thursday.")]
        begun[id] = detail
        return id
    }

    // A made-up week around today, for the week dashboard.
    static var week: WeekData {
        let calendar = Calendar.current, today = calendar.startOfDay(for: .now)
        let monday = calendar.date(byAdding: .day, value: -((calendar.component(.weekday, from: today) + 5) % 7), to: today)!
        func day(_ offset: Int) -> Date { calendar.date(byAdding: .day, value: offset, to: monday)! }
        func at(_ offset: Int, _ hour: Int, _ minute: Int = 0) -> String { ISO8601DateFormatter().string(from: calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day(offset))!) }
        func key(_ date: Date) -> String { let p = calendar.dateComponents([.year, .month, .day], from: date); return String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!) }
        let plans: [[(String, Int, Int, Int)]] = [
            [("COMP3600 lecture", 10, 0, 60), ("Study group", 15, 0, 90)],
            [("Tutorial 6", 11, 0, 60)],
            [("COMP3600 lecture", 10, 0, 60), ("Lunch with Sam", 13, 30, 60), ("Lab report review", 16, 0, 30)],
            [("Gym", 7, 30, 60)],
            [("COMP3600 lecture", 10, 0, 60), ("Dinner with Sam", 19, 0, 90), ("Movie night", 21, 0, 120)],
            [],
            [("Call home", 18, 0, 30)],
        ]
        let days = plans.enumerated().map { index, events in
            WeekData.Day(date: key(day(index)), events: events.map { title, hour, minute, length in
                WeekData.Event(title: title, start: at(index, hour, minute), end: ISO8601DateFormatter().string(from: calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day(index))!.addingTimeInterval(Double(length) * 60)), allDay: false)
            })
        }
        let all = days.flatMap(\.events)
        let left = all.filter { (ISO8601DateFormatter().date(from: $0.end ?? "") ?? .distantPast) > .now }.count
        let exam = calendar.date(byAdding: .day, value: 9, to: today)!
        return WeekData(updated: ISO8601DateFormatter().string(from: .now), start: key(day(0)), end: key(day(6)), days: days,
                        meetings: .init(week: all.count, left: left), unread: 33,
                        countdown: .init(title: "COMP3600 exam", date: ISO8601DateFormatter().string(from: calendar.date(bySettingHour: 9, minute: 0, second: 0, of: exam)!), allDay: false, days: 9),
                        sources: .init(calendar: .init(connected: true, error: "", off: false), email: .init(connected: true, error: "", off: false)),
                        promises: [.init(id: "p1", what: "Email Sam about the report", due: at(0, 13, 30), allDay: false, said: "I'll email Sam after lunch", overdue: false),
                                   .init(id: "p2", what: "Call Mum", due: key(day(1)), allDay: true, said: "remind me to call Mum tomorrow", overdue: false),
                                   .init(id: "p3", what: "Finish the KKT practice set", due: nil, allDay: false, said: "I need to finish the KKT practice set", overdue: false)],
                        goals: [.init(id: "G1", outcome: "The parser handles every file in fixtures/ without a crash", state: "active", reason: nil, next: "Fix the tokenizer for nested quotes", running: true, done: 1, steps: 3),
                                .init(id: "G2", outcome: "Validation accuracy of the small classifier reaches 0.9", state: "waiting", reason: "Waiting on Nexus job sweep-41", next: "Compare the sweep's runs", running: false, done: 2, steps: 4),
                                .init(id: "G3", outcome: "A one-page summary of the three grokking papers", state: "waiting-you", reason: "A step asks: Which of the two definitions should the summary use?", next: "", running: false, done: 2, steps: 3)])
    }

    static func chat(_ id: String) -> SessionDetail? {
        typealias Message = SessionDetail.Message
        if let made = begun[id] { return made }
        switch id {
        case "c0":
            return SessionDetail(id: id, title: "From Fairy", state: "idle", messages: [
                Message(role: "assistant", at: ago(300), text: "Good morning. COMP3600 at 10, lunch with Sam at 1, and the lab report is due at 5.\n\n- Sam asked whether Friday at 7 still works.\n- Notebook search finished overnight and is waiting for you to check it."),
                Message(role: "assistant", at: ago(150), text: "**Lunch moved**\n\nSam moved lunch to 1:30, same place."),
                Message(role: "user", at: ago(6), text: "Add dinner with Sam on Friday at 7 to my calendar"),
                Message(role: "assistant", at: ago(5), text: "Here it is. Add it to your calendar?"),
            ])
        case "w1":
            return SessionDetail(id: id, title: "Notebook search", state: "waiting", messages: [
                Message(role: "user", at: ago(20), text: "Rank sources by how recently they were opened as well as by match, and keep the tests passing."),
                Message(role: "assistant", at: ago(4), text: "I've added a recency boost to the ranking and updated two tests. I'd like to run the search tests to check nothing else moved."),
            ], live: SessionDetail.Live(rows: [
                .init(id: "s1", tool: "read_file", summary: "Read desktop/notebook/search.mjs", status: "done"),
                .init(id: "s2", tool: "edit_file", summary: "Edit desktop/notebook/search.mjs", status: "done"),
                .init(id: "s3", tool: "run_command", summary: "npm test -- test/notebook-search.test.mjs", status: "waiting"),
            ], tasks: [.init(text: "Add a recency boost", status: "done"), .init(text: "Update the tests", status: "done"), .init(text: "Run the search tests", status: "in_progress")], text: nil))
        case "w2":
            return SessionDetail(id: id, title: "Tidy the onboarding copy", state: "working", messages: [
                Message(role: "user", at: ago(10), text: "Make the onboarding screens shorter and friendlier."),
            ], live: SessionDetail.Live(rows: [.init(id: "s1", tool: "read_file", summary: "Read src/onboarding.js", status: "done"), .init(id: "s2", tool: "edit_file", summary: "Edit src/onboarding.js", status: "running")], tasks: nil, text: "Shortening the second screen…"))
        case "c1":
            return SessionDetail(id: id, title: "Dinner ideas for Friday", state: "idle", messages: [
                Message(role: "user", at: ago(100), text: "Something easy for four people on Friday, one is vegetarian."),
                Message(role: "assistant", at: ago(98), text: "A tray of roasted vegetables with halloumi works well: everyone shares it, and it's vegetarian.\n\n- Roast capsicum, zucchini and red onion at 220°C for 25 minutes.\n- Add sliced halloumi for the last 10.\n- Serve with couscous and a lemon yoghurt.\n\nIt takes about 40 minutes, most of it in the oven."),
            ])
        default:
            return SessionDetail(id: id, title: chats.first { $0.id == id }?.title ?? "Chat", state: "idle", messages: [
                Message(role: "user", at: ago(60 * 26), text: "Can you help me plan revision for the exam?"),
                Message(role: "assistant", at: ago(60 * 26 - 1), text: "Yes. You have nine days, so let's give the first four to graphs and dynamic programming, two to past papers, and keep the last three for your weakest topics."),
            ])
        }
    }

    static var pages: [PageItem] {
        [
            PageItem(id: "p1", kind: "doc", title: "Lab report outline", description: "Sections and the figures to make", updatedAt: ago(90), session: "c2", opens: true, versions: [.init(seq: 1, at: ago(90), file: "index.html", concepts: [])]),
            PageItem(id: "p2", kind: "dashboard", title: "Study progress", description: "Learning objectives, weakest first", updatedAt: ago(60 * 20), session: nil, opens: true, versions: [.init(seq: 1, at: ago(60 * 20), file: "index.html", concepts: [])]),
            PageItem(id: "p4", kind: "sheet", title: "Melbourne trip budget", description: "Flights, stay and food", updatedAt: ago(60 * 60), session: nil, opens: true, versions: [.init(seq: 2, at: ago(60 * 60), file: "index.html", concepts: [])]),
            PageItem(id: "p5", kind: "canvas", title: "Onboarding screens", description: "Three directions", updatedAt: ago(60 * 80), session: nil, opens: true, versions: [.init(seq: 1, at: ago(60 * 80), file: "index.html", concepts: [])]),
            PageItem(id: "p6", kind: "whiteboard", title: "Revision plan", description: "Topics by week", updatedAt: ago(60 * 100), session: nil, opens: true, versions: [.init(seq: 1, at: ago(60 * 100), file: "index.html", concepts: [])]),
            PageItem(id: "p3", kind: "slides", title: "Tutorial 6 slides", description: "Twelve slides on shortest paths", updatedAt: ago(60 * 50), session: nil, opens: true, versions: [.init(seq: 1, at: ago(60 * 50), file: "index.html", concepts: [])]),
        ]
    }

    static var memory: MemoryBook {
        MemoryBook(notes: [
            .init(id: "n1", kind: "preference", text: "Prefers short answers with the steps first.", fromReflection: false, used: true),
            .init(id: "n2", kind: "fact", text: "Studies COMP3600 this semester; the exam is on 20 November.", fromReflection: true, used: true),
            .init(id: "n3", kind: "fact", text: "Sam is a friend from the lab; they often have lunch on Wednesdays.", fromReflection: true, used: false),
        ], reflection: .init(on: true, at: ago(60 * 9), undone: false, added: 2, changed: 1))
    }

    static let about = AboutMac(
        pages: 3, notes: 3, routines: 1, workProvider: "antigravity", appName: "Baryon",
        brief: .init(enabled: true, time: "07:30", lastBrief: "2026-11-25", lastError: nil),
        checkIns: .init(enabled: true, everyHours: 6, lastCheck: ago(45), lastError: nil),
        providers: ["claude": false, "antigravity": true, "codex": true, "openai": false]
    )

    static let models = ModelCatalog(
        current: .init(provider: "antigravity", model: "gemini-3.8-flash", effort: "low"),
        providers: [
            .init(id: "claude", name: "Claude", connected: false, models: [.init(id: "claude-opus-5-5", name: "Opus 5.5"), .init(id: "claude-sonnet-5-5", name: "Sonnet 5.5")], efforts: ["", "low", "medium", "high", "xhigh", "max"]),
            .init(id: "antigravity", name: "Gemini", connected: true, models: [.init(id: "gemini-3.8-flash", name: "Gemini 3.8 Flash"), .init(id: "gemini-4-neon-medium", name: "Gemini 4 Neon"), .init(id: "gemini-4-carbon-high", name: "Gemini 4 Carbon")], efforts: ["low", "medium", "high"]),
            .init(id: "codex", name: "Codex", connected: true, models: [.init(id: "gpt-6-astra", name: "GPT-6 Astra"), .init(id: "gpt-6.1-sol", name: "GPT-6.1 Sol")], efforts: ["low", "medium", "high"]),
            .init(id: "deepseek", name: "DeepSeek", connected: true, models: [.init(id: "deepseek-flash", name: "DeepSeek Flash")], efforts: ["low", "medium", "high"]),
        ]
    )

    static let usageReport = TokenUsageReport(
        generatedAt: ago(2),
        summary30: .init(totalTokens: 14_820_000, inputTokens: 11_400_000, outputTokens: 3_420_000, cachedTokens: 6_840_000, totalCost: 42.18, cacheSaved: 18.4, cacheHitRate: 0.60, turns: 412, activeDays: 18, avgPerDay: 823_333, avgCostPerDay: 2.34),
        summary24: .init(totalTokens: 920_000, inputTokens: 710_000, outputTokens: 210_000, cachedTokens: 430_000, totalCost: 2.65, cacheSaved: 1.12, cacheHitRate: 0.60, turns: 28, activeDays: 1, avgPerDay: 920_000, avgCostPerDay: 2.65),
        byProvider: [
            .init(provider: "gemini", label: "Gemini", color: "#818cf8", turns: 210, sessions: 34, input: 6_100_000, output: 1_900_000, cached: 3_800_000, total: 8_000_000, cost: 19.4, cacheSaved: 9.2, share: 0.54),
            .init(provider: "claude", label: "Claude", color: "#e58b5b", turns: 118, sessions: 19, input: 3_400_000, output: 980_000, cached: 2_100_000, total: 4_380_000, cost: 16.5, cacheSaved: 6.4, share: 0.30),
            .init(provider: "codex", label: "Codex", color: "#34d399", turns: 84, sessions: 14, input: 1_900_000, output: 540_000, cached: 940_000, total: 2_440_000, cost: 6.28, cacheSaved: 2.8, share: 0.16),
        ],
        byModel: [
            .init(model: "gemini-4-neon-medium", provider: "gemini", turns: 160, total: 6_200_000, cost: 15.2, cacheHitRate: 0.62, share: 0.42),
            .init(model: "claude-opus-5-5", provider: "claude", turns: 72, total: 2_800_000, cost: 12.1, cacheHitRate: 0.58, share: 0.19),
            .init(model: "gpt-6-astra", provider: "codex", turns: 84, total: 2_440_000, cost: 6.28, cacheHitRate: 0.49, share: 0.16),
        ],
        daily: (0..<14).map { i in .init(day: "2026-11-\(String(format: "%02d", 12 + i))", label: "Nov \(12 + i)", tokens: Double(450_000 + (i % 5) * 210_000), cost: Double(1.4 + Double(i % 4) * 0.85)) },
        plans: [
            "gemini": PlanUsage(at: nil, failed: nil, meters: [.init(short: "5h", label: "5-hour window", used: 34, resets: "6:10pm")]),
            "codex": PlanUsage(at: nil, failed: nil, meters: [.init(short: "5h", label: "5-hour window", used: 18, resets: "7:20pm"), .init(short: "Wk", label: "Weekly limit", used: 42, resets: "Mon")]),
        ]
    )

    static let goals = GoalList(goals: [
        .init(id: "G1", outcome: "Catch Baryon iOS app up to T3/Stratus pitch-black UI", state: "active", folder: "Lyra", reason: nil, next: "Ship iOS Simulator verification", running: true, done: 3, steps: 5),
        .init(id: "G2", outcome: "GEM-RSI ablation sweep across quantization bits", state: "waiting-you", folder: "GEM-RSI", reason: "Approve GPU sweep budget", next: nil, running: false, done: 1, steps: 4),
    ], open: 2, max: 5, problem: nil)

    static func goalDetail(_ id: String) -> GoalDetail {
        GoalDetail(id: id, outcome: "Catch Baryon iOS app up to T3/Stratus pitch-black UI", state: "active", folder: "/Users/demo/Github/Lyra", reason: nil, moves: "ask", steps: [
            .init(id: "S1", what: "Fix morning brief fallback", state: "done", report: "Added Antigravity/Codex fallback in integration-provider.mjs", error: nil),
            .init(id: "S2", what: "Expand phone-link endpoints", state: "doing", report: nil, error: nil),
            .init(id: "S3", what: "Reskin & build iOS app", state: "todo", report: nil, error: nil),
        ], doneWhen: .init(kind: "command", command: "npm test", metric: nil), history: [.init(at: ago(30), what: "Started S2")], created: ago(120), updated: ago(5))
    }

    static let researchHome = ResearchHome(investigations: [
        .init(slug: "gem-rsi", title: "GEM-RSI Quantization Scaling Laws", discipline: "computerScience", rounds: 4, hypotheses: 8, active: 5, round: .init(round: 4, status: "idle", stage: "complete"), leading: .init(id: "H003", text: "Sub-4-bit Hessian-weighted routing preserves 98% perplexity", status: "active", seat: "claude", model: "claude-opus-5-5", elo: 1294, wins: 7, losses: 1), waiting: [], climb: [1200, 1232, 1268, 1294]),
    ], papers: [], runs: [])

    static func researchDetail(_ slug: String) -> ResearchDetail {
        ResearchDetail(slug: slug, title: "GEM-RSI Quantization Scaling Laws", discipline: "computerScience", rounds: 4, round: .init(round: 4, status: "idle", stage: "complete"), waiting: [], hypotheses: [
            .init(id: "H003", title: "Hessian-weighted mixed precision", status: "active", elo: 1294, wins: 7, losses: 1, statement: "Protecting top 1.5% outlier channels removes degradation down to 3-bit averages."),
        ], papers: [], runs: [], report: "# Summary\nMixed-precision gating reduced perplexity delta to 0.04.")
    }

    static let neutrinoInbox = NeutrinoInbox(host: "neutrino.local", ready: [
        .init(repo: "Baryon", number: 42, title: "T3/Stratus pitch-black iOS catch-up", state: "open", source: "ios-stratus", target: "main", draft: false, checks: "passing", authorName: "Razeen", updatedAt: ago(15), body: "Full Stratus redesign and hub tabs.", openNotes: 0),
    ], open: [], runs: [.init(id: 91, repo: "Baryon", workflow: "ci.yml", name: "Checks", state: "success", branch: "ios-stratus", pull: 42, createdAt: ago(14))])

    static func neutrinoPR(repo: String, number: Int) -> NeutrinoPRDetail {
        NeutrinoPRDetail(repo: repo, number: number, title: "T3/Stratus pitch-black iOS catch-up", state: "open", source: "ios-stratus", target: "main", body: "Catches iOS up with desktop Usage, Goals, Research, Neutrino, Analytics, and Boards.", checks: neutrinoInbox.runs, files: [.init(path: "ios/Shared/Theme.swift", status: "modified", additions: 42, deletions: 18)], commits: [.init(sha: "abcdef123456", short: "abcdef1", subject: "Pitch-black Stratus palette", author: "Razeen")], notes: [], diffText: "+ static let ground = Color(hex: 0x050507)")
    }

    static let analyticsOverview = AnalyticsOverview(state: .init(folder: "~/Analytics", datasetCount: 2, runCount: 2, nexusAvailable: true), datasets: [
        .init(id: "ds-1", name: "telemetry_v4.parquet", source: "upload", format: "parquet", sizeBytes: 4_820_000, modifiedAt: ago(90), profileSummary: .init(rows: 48200, columns: 24, format: "parquet")),
    ], runs: [
        .init(id: "run-1", kind: "automl", datasetName: "telemetry_v4.parquet", task: "classification", target: "regressed", primaryMetric: "roc_auc", primaryValue: 0.948, bestModel: "LightGBM", status: "completed", computeTarget: "local", runtimeSeconds: 18.4, createdAt: ago(60)),
    ])

    static func analyticsRun(_ id: String) -> AnalyticsRunDetail {
        AnalyticsRunDetail(id: id, datasetName: "telemetry_v4.parquet", task: "classification", target: "regressed", status: "completed", bestModelLabel: "LightGBM", bestModel: "lightgbm", primaryMetric: "roc_auc", primaryValue: 0.948, leaderboard: [.init(model: "lightgbm", label: "LightGBM", score: 0.948, trainTime: 4.1), .init(model: "catboost", label: "CatBoost", score: 0.941, trainTime: 8.2)], featureImportances: [.init(feature: "cache_hit_rate", importance: 0.42), .init(feature: "latency_p95", importance: 0.31)], runtimeSeconds: 18.4)
    }

    static let boardsList = BoardList(items: [
        .init(id: "brd-1", name: "Baryon Architecture", description: "Mac Mini + iPhone + Bridge", elementCount: 4, updatedAt: ago(40)),
    ])

    static func boardDetail(_ id: String) -> BoardDetail {
        BoardDetail(meta: boardsList.items[0], background: "dots", elements: [
            .init(id: "e1", type: "sticky", x: 40, y: 40, w: 200, h: 110, title: "PhoneLink TLS", text: "Tailscale HTTPS + Pinned Cert + DPoP/Bearer", color: "#3e5aec", from: "", to: ""),
            .init(id: "e2", type: "card", x: 300, y: 40, w: 200, h: 110, title: "iOS Client", text: "Pure Stratus #050507 + Face ID gates", color: "#111114", from: "", to: ""),
            .init(id: "e3", type: "arrow", x: 0, y: 0, w: 0, h: 0, title: "", text: "SSE + REST", color: "#9fb2ff", from: "e1", to: "e2"),
        ])
    }

    // The experiment tracker (RunsView.swift).
    static var runsProjects: RunsProjects {
        RunsProjects(projects: [RunProject(folder: "/Users/demo/Github/tiny-gpt", title: "tiny-gpt", kind: "project", count: 3, latest: ago(20), running: 1),
                                RunProject(folder: "/Users/demo/Github/Research/sky-blue", title: "sky-blue", kind: "investigation", count: 1, latest: ago(60 * 40), running: 0)])
    }
    static func runsPage(_ folder: String) -> RunsPage {
        func run(_ id: String, _ name: String, _ state: String, _ place: String, _ minutes: Double, lr: String, loss: Double?, acc: Double?) -> RunRecord {
            RunRecord(id: id, label: id, name: name, state: state, where: place, job: place == "forge" ? "j8f2c1a" : "", started: ago(minutes), seconds: state == "running" ? nil : 912, exit: state == "running" ? nil : 0,
                      params: ["lr": lr, "batch": "64", "epochs": "20"], metrics: [loss.map { .init(name: "loss", value: $0, text: "", unit: "") }, acc.map { .init(name: "acc", value: $0, text: "", unit: "%") }].compactMap { $0 },
                      printout: state == "running" ? "" : "epoch 20/20  loss \(loss ?? 0)  acc \(acc ?? 0)%\nsaved checkpoints/model.pt", tags: id == "R2" ? ["best"] : [], notes: id == "R2" ? "Best so far." : "", commit: "a1b2c3d4e5", dirty: id == "R3")
        }
        return RunsPage(folder: folder, kind: "project", runs: [run("R3", "longer run", "running", "forge", 20, lr: "0.0003", loss: nil, acc: nil),
                                                               run("R2", "lr 3e-4", "done", "forge", 300, lr: "0.0003", loss: 0.41, acc: 91.2),
                                                               run("R1", "baseline", "done", "here", 900, lr: "0.001", loss: 0.52, acc: 88.1)])
    }
}
#endif
