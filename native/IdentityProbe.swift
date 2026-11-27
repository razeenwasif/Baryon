// The link security plan's Link 4: can a helper signed as Fairy's helpers are make and use Secure Enclave keys?
// It prints what worked, one key=value per line, and keeps nothing: the keys it makes are thrown away.
//
//   swiftc -O native/IdentityProbe.swift -o /tmp/fairy-identity-probe      (then sign it as the build signs a helper)
//   fairy-identity-probe               the device key, and the Keychain route
//   fairy-identity-probe --touch-id    also the approve key: shows one Touch ID sheet, so run it at the Mac
import CryptoKit
import Foundation
import LocalAuthentication
import Security

func line(_ key: String, _ value: Any) { print("\(key)=\(value)") }
func ms(since start: Date) -> Int { Int(Date().timeIntervalSince(start) * 1000) }

line("secure_enclave", SecureEnclave.isAvailable)

// 1. The device key: made in the chip, usable while the Mac is unlocked. What would be saved is the wrapped key, which
// only this Mac's chip can use.
do {
  let message = Data("fairy-session-v1".utf8), started = Date()
  let key = try SecureEnclave.P256.Signing.PrivateKey()
  let signature = try key.signature(for: message)
  line("device_key", key.publicKey.isValidSignature(signature, for: message) ? "ok" : "bad signature")
  line("device_key_ms", ms(since: started))
  let again = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: key.dataRepresentation)
  line("device_key_restored", again.publicKey.rawRepresentation == key.publicKey.rawRepresentation ? "ok" : "differs")
  line("wrapped_key_bytes", key.dataRepresentation.count)
} catch { line("device_key", "failed: \(error)") }

// 2. The fallback: a Secure Enclave key kept by the Keychain. This is the route expected to need an entitlement.
do {
  let tag = Data("dev.razeen.lyra.identity-probe".utf8)
  var failure: Unmanaged<CFError>?
  guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &failure) else { throw failure!.takeRetainedValue() as Error }
  let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
    kSecUseDataProtectionKeychain as String: true,
    kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag, kSecAttrAccessControl as String: access] as [String: Any]]
  if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &failure) {
    _ = key
    line("keychain_key", "ok")
    let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecUseDataProtectionKeychain as String: true]
    line("keychain_key_removed", SecItemDelete(query as CFDictionary) == errSecSuccess ? "yes" : "no")
  } else { line("keychain_key", "failed: \(failure!.takeRetainedValue())") }
} catch { line("keychain_key", "failed: \(error)") }

// 3. The approve key: every signature needs a fingerprint. The sheet's words are the reason given here.
if CommandLine.arguments.contains("--touch-id") {
  do {
    var failure: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &failure) else { throw failure!.takeRetainedValue() as Error }
    let context = LAContext()
    context.localizedReason = "allow a step Fairy asked about (a test)"
    line("touch_id_available", context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil))
    let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access, authenticationContext: context)
    let message = Data("fairy-approve-v1".utf8), started = Date()
    let signature = try key.signature(for: message)
    line("approve_key", key.publicKey.isValidSignature(signature, for: message) ? "ok" : "bad signature")
    line("approve_key_ms", ms(since: started))
  } catch { line("approve_key", "failed: \(error)") }
} else { line("approve_key", "not tried (run with --touch-id at the Mac)") }
