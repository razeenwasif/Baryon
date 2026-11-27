import ActivityKit
import Foundation

// What a Live Activity shows of your work sessions. Shared by the app, which starts it, and the widget, which draws it.
// The Mac can't update it yet, as it doesn't send pushes, so it's only as new as the app's last look, and says so once it's stale.
struct WorkActivity: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var waiting: Bool
        var others: Int
        var at: Date
        var phase: String? = nil
        var progress: Double? = nil
        var toolName: String? = nil
        var staleAfter: Date? = nil

        var words: String { waiting ? "Needs your OK" : (phase ?? "Working") }
        var more: String? { others > 0 ? "\(others) more" : nil }
        var isStale: Bool { if let staleAfter { return Date() > staleAfter }; return false }
    }
}
