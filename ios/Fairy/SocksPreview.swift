import Foundation

/// Per-message deflate configuration helper for URLSessionWebSocketTask links.
enum WebSocketDeflateConfig {
    static let extensionHeader = "permessage-deflate; client_max_window_bits"

    static func apply(to request: inout URLRequest) {
        request.setValue(extensionHeader, forHTTPHeaderField: "Sec-WebSocket-Extensions")
    }
}

/// Enforces loopback-only hosts before routing WKWebView preview requests through a localhost SOCKS tunnel.
enum LocalhostPreviewPolicy {
    private static let allowedHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

    static func isAllowed(_ url: URL, allowedPorts: Set<Int> = []) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
        guard let host = url.host?.lowercased(), allowedHosts.contains(host) else { return false }
        let port = url.port ?? (scheme == "https" ? 443 : 80)
        guard (1...65535).contains(port) else { return false }
        if !allowedPorts.isEmpty && !allowedPorts.contains(port) { return false }
        return true
    }

    static func validatedPreviewURL(_ url: URL, allowedPorts: Set<Int> = []) -> URL? {
        isAllowed(url, allowedPorts: allowedPorts) ? url : nil
    }
}
