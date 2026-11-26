import CryptoKit
import Foundation

// Trusts one certificate and nothing else, by its SHA-256 fingerprint. The fingerprint arrives in the
// pairing code, so no certificate authority is involved and no other server can stand in for your Mac.
final class CertificatePin: NSObject, URLSessionTaskDelegate, Sendable {
    let fingerprint: String
    init(fingerprint: String) { self.fingerprint = fingerprint.lowercased() }

    private func decide(_ challenge: URLAuthenticationChallenge) -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = challenge.protectionSpace.serverTrust,
              let certificate = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else { return (.cancelAuthenticationChallenge, nil) }
        let found = SHA256.hash(data: SecCertificateCopyData(certificate) as Data).map { String(format: "%02x", $0) }.joined()
        guard found == fingerprint else { return (.cancelAuthenticationChallenge, nil) }
        // Also checks the name and purpose, with the pinned certificate as the only thing trusted.
        SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        return SecTrustEvaluateWithError(trust, nil) ? (.useCredential, URLCredential(trust: trust)) : (.cancelAuthenticationChallenge, nil)
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) { decide(challenge) }
    // Streaming requests ask here instead of above.
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) { decide(challenge) }
}
