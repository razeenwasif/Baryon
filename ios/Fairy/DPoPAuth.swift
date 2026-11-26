import CryptoKit
import Foundation

/// RFC 9449 ES256 DPoP proof generator backed by CryptoKit P-256 keys for device-bound requests.
struct DPoPProofGenerator {
    let privateKey: P256.Signing.PrivateKey

    init(privateKey: P256.Signing.PrivateKey = P256.Signing.PrivateKey()) {
        self.privateKey = privateKey
    }

    var publicJwk: [String: String] {
        let raw = privateKey.publicKey.rawRepresentation
        let x = raw.prefix(32).base64URLEncodedString()
        let y = raw.suffix(32).base64URLEncodedString()
        return ["kty": "EC", "crv": "P-256", "x": x, "y": y]
    }

    func jwkThumbprint() throws -> String {
        let jwk = publicJwk
        let canonical = "{\"crv\":\"\(jwk["crv"] ?? "P-256")\",\"kty\":\"EC\",\"x\":\"\(jwk["x"] ?? "")\",\"y\":\"\(jwk["y"] ?? "")\"}"
        let digest = SHA256.hash(data: Data(canonical.utf8))
        return Data(digest).base64URLEncodedString()
    }

    func makeProof(method: String, url: URL, nonce: String? = nil, issuedAt: Date = Date()) throws -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        let htu = components?.string ?? url.absoluteString

        let headerObj: [String: Any] = [
            "typ": "dpop+jwt",
            "alg": "ES256",
            "jwk": publicJwk,
        ]
        var payloadObj: [String: Any] = [
            "jti": UUID().uuidString,
            "htm": method.uppercased(),
            "htu": htu,
            "iat": Int(issuedAt.timeIntervalSince1970),
        ]
        if let nonce, !nonce.isEmpty { payloadObj["nonce"] = nonce }

        let headerB64 = try JSONSerialization.data(withJSONObject: headerObj).base64URLEncodedString()
        let payloadB64 = try JSONSerialization.data(withJSONObject: payloadObj).base64URLEncodedString()
        let signingInput = "\(headerB64).\(payloadB64)"
        let sig = try privateKey.signature(for: Data(signingInput.utf8))
        return "\(signingInput).\(sig.rawRepresentation.base64URLEncodedString())"
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
