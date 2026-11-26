import Foundation

// A message waiting for the Mac to come back.
struct QueuedMessage: Codable, Identifiable, Equatable {
    var id = UUID()
    var chat: String?
    var text: String
}

// What the app keeps so chats can still be read when the Mac is out of reach. It's only readable while the phone
// is unlocked, stays out of backups, and goes when the phone is removed.
enum ChatStore {
    private static let folder: URL = {
        var url = URL.applicationSupportDirectory.appending(path: "chats", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }()
    private static func file(_ name: String) -> URL {
        // A chat's id comes from the Mac, so it's reduced to safe characters before it names a file.
        let safe = name.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" }.map(String.init).joined()
        return folder.appending(path: "\(safe).json")
    }
    private static func save(_ value: some Encodable, as name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: file(name), options: [.atomic, .completeFileProtection])
    }
    private static func load<Value: Decodable>(_ name: String) -> Value? {
        guard let data = try? Data(contentsOf: file(name)) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    static func saveList(_ chats: [ChatRow]) { save(chats, as: "list") }
    static func loadList() -> [ChatRow] { load("list") ?? [] }
    static func saveChat(_ chat: SessionDetail) { save(chat, as: "chat-\(chat.id)") }
    static func loadChat(_ id: String) -> SessionDetail? { load("chat-\(id)") }
    static func saveQueue(_ queue: [QueuedMessage]) { save(queue, as: "queue") }
    static func loadQueue() -> [QueuedMessage] { load("queue") ?? [] }
    static func forget() { try? FileManager.default.removeItem(at: folder); try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
}
