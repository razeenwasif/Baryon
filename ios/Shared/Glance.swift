import Foundation

// What the widgets show. They can't reach the Mac themselves, so this is the app's last look, kept where they can read it.
// It's readable while the phone is locked, as widgets need it to be, so it holds only what they draw, and stays out of backups.
struct Glance: Codable, Equatable {
    struct Row: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var waiting: Bool
    }
    var waiting: Int
    var working: Int
    var rows: [Row]
    var at: Date

    private static var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.dev.razeen.fairy")?.appending(path: "glance.json")
    }
    static func load() -> Glance? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Glance.self, from: data)
    }
    func save() {
        guard var file = Self.file, let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? file.setResourceValues(values)
    }
    static func forget() { if let file { try? FileManager.default.removeItem(at: file) } }
}
