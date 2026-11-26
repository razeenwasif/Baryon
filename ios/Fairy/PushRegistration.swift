import OSLog
import UIKit

// Receives this iPhone's push token from Apple and hands it to the Mac, with the phone's own key for sealing what
// pushes say. iOS gives the token again on each launch, so the Mac always has the current one.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    private let log = Logger(subsystem: "dev.razeen.fairy", category: "push")
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await AppParts.shared.link.registerPush(token: token) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        log.error("Apple didn’t give a push token: \(String(describing: error), privacy: .public)")
    }
}

// Which of Apple's push servers this build is signed for: development when installed from Xcode, production from the
// App Store or TestFlight. The provisioning profile inside the app says.
enum PushEnvironment {
    static var current: String {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"), let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1), let key = text.range(of: "<key>aps-environment</key>") else { return "production" }
        let rest = text[key.upperBound...]
        guard let open = rest.range(of: "<string>"), let close = rest.range(of: "</string>"), open.upperBound <= close.lowerBound else { return "production" }
        return rest[open.upperBound..<close.lowerBound] == "development" ? "development" : "production"
    }
}
