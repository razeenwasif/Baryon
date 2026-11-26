import UserNotifications

// Opens a push from the Mac before it's shown. Apple delivered only "Fairy" and a sealed blob; this puts the real words
// on the Lock Screen, and keeps what tapping it should open. If the blob can't be opened (the key changed, or the push
// wasn't for this phone), the plain "Fairy" alert is shown instead.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private var deliver: ((UNNotificationContent) -> Void)?
    private var shown: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else { contentHandler(request.content); return }
        deliver = contentHandler
        shown = content
        if let sealed = content.userInfo["sealed"] as? String, let key = PushSecret.load(), let message = PushSecret.open(sealed, with: key) {
            content.title = message["title"] ?? "Baryon"
            content.body = message["body"] ?? content.body
            var info = content.userInfo
            info.removeValue(forKey: "sealed")
            for field in ["kind", "chat", "id", "promise"] { if let value = message[field] { info[field] = value } }
            content.userInfo = info
            // A question gets Allow and Don't allow, or only Don't allow when it can only be allowed on the Mac.
            if message["kind"] == "ask" { content.categoryIdentifier = message["allow"] == "no" ? "ask-refuse" : "ask" }
            // A reminder of something you said you'd do gets Done, which ticks it off.
            else if message["promise"] != nil { content.categoryIdentifier = "promise" }
        }
        contentHandler(content)
        deliver = nil
    }

    override func serviceExtensionTimeWillExpire() {
        if let deliver, let shown { deliver(shown) }
        deliver = nil
    }
}
