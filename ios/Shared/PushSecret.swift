import CryptoKit
import Foundation

// The key this iPhone gave the Mac for sealing what its pushes say. Apple carries only a sealed blob; the notification
// extension opens it with this key, which lives in the app group's container so the extension can read it, and never
// leaves this phone except to the Mac over the pinned link.
enum PushSecret {
    static let group = "group.dev.razeen.fairy"
    private static var file: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("push-key", isDirectory: false) }

    static func load() -> SymmetricKey? {
        guard let file, let data = try? Data(contentsOf: file), data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }

    // Made once, the first time the app registers for pushes. Readable once the phone has been unlocked after a restart,
    // which is when pushes arrive.
    static func loadOrMake() throws -> SymmetricKey {
        if let key = load() { return key }
        guard let file else { throw CocoaError(.fileNoSuchFile) }
        let key = SymmetricKey(size: .bits256)
        try key.withUnsafeBytes { Data($0) }.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return key
    }

    static func base64(_ key: SymmetricKey) -> String { key.withUnsafeBytes { Data($0) }.base64EncodedString() }

    // What a push said: title, body, and what tapping it opens (kind, chat, id). Nil if it wasn't sealed for this phone.
    static func open(_ sealed: String, with key: SymmetricKey) -> [String: String]? {
        guard let data = Data(base64Encoded: sealed), let box = try? AES.GCM.SealedBox(combined: data), let plain = try? AES.GCM.open(box, using: key),
              let object = try? JSONSerialization.jsonObject(with: plain) as? [String: Any] else { return nil }
        return object.compactMapValues { $0 as? String }
    }
}
