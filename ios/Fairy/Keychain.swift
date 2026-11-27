import Foundation
@preconcurrency import LocalAuthentication
import Security

// What the phone keeps from pairing. It stays on this device, and never goes in a backup.
struct Pairing: Codable, Equatable {
    var host: String
    var port: Int
    var pin: String
    var readKey: String
}

enum KeychainError: LocalizedError {
    case noPasscode, cancelled, failed(OSStatus)
    var errorDescription: String? {
        switch self {
        case .noPasscode: "Set a passcode on this iPhone first, so only you can allow steps."
        case .cancelled: "Not confirmed, so nothing was sent."
        case .failed(let status): "This iPhone couldn’t reach its Keychain (\(status))."
        }
    }
}

enum Keychain {
    private static let service = "dev.razeen.fairy.link"
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func savePairing(_ pairing: Pairing) throws {
        let data = try JSONEncoder().encode(pairing)
        SecItemDelete(query("pairing") as CFDictionary)
        var item = query("pairing")
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.failed(status) }
    }

    static func loadPairing() -> Pairing? {
        var search = query("pairing"), result: CFTypeRef?
        search[kSecReturnData as String] = true
        guard SecItemCopyMatching(search as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }

    // The key that says yes. Getting it back takes Face ID or the passcode, and the Mac won't allow a step without it.
    static func saveApproveKey(_ key: String) throws {
        SecItemDelete(query("approve") as CFDictionary)
        guard let control = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) else { throw KeychainError.failed(errSecParam) }
        var item = query("approve")
        item[kSecValueData as String] = Data(key.utf8)
        item[kSecAttrAccessControl as String] = control
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecDecode || status == errSecAuthFailed || status == errSecNotAvailable || status == errSecParam { throw KeychainError.noPasscode }
        guard status == errSecSuccess else { throw KeychainError.failed(status) }
    }

    static func approveKey(reason: String) async throws -> String {
        // Asking first gives a clear answer when someone cancels. The Keychain's own rule is the real lock, and using
        // the same context means it doesn't ask a second time.
        let context = LAContext()
        do { try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) }
        catch let error as LAError where error.code == .passcodeNotSet { throw KeychainError.noPasscode }
        catch { throw KeychainError.cancelled }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                var search = query("approve"), result: CFTypeRef?
                search[kSecReturnData as String] = true
                search[kSecUseAuthenticationContext as String] = context
                let status = SecItemCopyMatching(search as CFDictionary, &result)
                if status == errSecSuccess, let data = result as? Data, let key = String(data: data, encoding: .utf8) { continuation.resume(returning: key) }
                else if status == errSecUserCanceled || status == errSecAuthFailed { continuation.resume(throwing: KeychainError.cancelled) }
                else { continuation.resume(throwing: KeychainError.failed(status)) }
            }
        }
    }

    static func forget() {
        SecItemDelete(query("pairing") as CFDictionary)
        SecItemDelete(query("approve") as CFDictionary)
    }
}
