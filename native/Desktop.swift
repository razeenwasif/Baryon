import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("Invalid desktop request.") }
guard AXIsProcessTrusted() else { fail("Enable Accessibility for Fairy in System Settings → Privacy & Security → Accessibility, then retry. If Fairy is already enabled after a signing change, remove and re-add the installed Fairy.app once.") }
if payload["check"] as? Bool == true { print("ready"); exit(0) }
// Fairy herself is never the app a task acts on: her app ids, old and new, and the app that started this helper (which
// covers a copy run from the repo).
let fairyBundles: Set<String> = ["dev.razeen.stella", "dev.razeen.lyra"]
func isFairy(_ app: NSRunningApplication) -> Bool { fairyBundles.contains(app.bundleIdentifier ?? "") || app.processIdentifier == getppid() }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func focusedApplication() -> NSRunningApplication? {
    if let element = elementAttribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute) {
        var pid: pid_t = 0
        if AXUIElementGetPid(element, &pid) == .success { return NSRunningApplication(processIdentifier: pid) }
    }
    return NSWorkspace.shared.frontmostApplication
}
func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attribute(element, name) else { return nil }
    if let string = value as? String { return string }
    if CFGetTypeID(value) == CFURLGetTypeID() { return (value as! URL).absoluteString }
    return nil
}
func browserSnapshot(_ window: AXUIElement, includeText: Bool) -> [String: Any] {
    let deadline = Date(timeIntervalSinceNow: 1.2)
    var stack = [window]; var visited = 0; var web: AXUIElement?
    var address = ""
    while let element = stack.popLast(), visited < 350, Date() < deadline {
        visited += 1
        let role = stringAttribute(element, kAXRoleAttribute) ?? ""
        if role == "AXWebArea" { web = element; break }
        if stringAttribute(element, kAXIdentifierAttribute) == "WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD" { address = stringAttribute(element, kAXValueAttribute) ?? "" }
        // Do not walk every inactive tab's contents or start-page favourites.
        stack.append(contentsOf: (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).reversed())
    }
    var result: [String: Any] = ["title": stringAttribute(window, kAXTitleAttribute) ?? "",
        "url": web.flatMap { stringAttribute($0, kAXURLAttribute) } ?? stringAttribute(window, kAXDocumentAttribute) ?? address]
    guard includeText, let web = web else { return result }
    stack = [web]; visited = 0
    var text = ""; var links: [[String: String]] = []
    while let element = stack.popLast(), visited < 800, text.count < 12000, Date() < deadline {
        visited += 1
        let role = stringAttribute(element, kAXRoleAttribute) ?? ""
        if ["AXTextField", "AXTextArea", "AXSecureTextField", "AXComboBox"].contains(role) { continue }
        if attribute(element, "AXHidden") as? Bool == true { continue }
        if role == "AXStaticText", let value = stringAttribute(element, kAXValueAttribute) ?? stringAttribute(element, kAXTitleAttribute), !value.isEmpty { text += String(value.prefix(2000)) + "\n" }
        if role == "AXLink", links.count < 30, let url = stringAttribute(element, kAXURLAttribute), url.hasPrefix("https://") || url.hasPrefix("http://") {
            links.append(["title": String((stringAttribute(element, kAXTitleAttribute) ?? stringAttribute(element, kAXDescriptionAttribute) ?? "").prefix(200)), "url": String(url.prefix(2048))])
        }
        stack.append(contentsOf: (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).reversed())
    }
    result["text"] = String(text.prefix(12000)); result["links"] = links
    result["truncated"] = !stack.isEmpty || text.count >= 12000 || Date() >= deadline
    return result
}
// Fairy in front (you just typed to her, or answered her): the app whose window is frontmost under hers is brought
// forward, so a task sees and works your app. Windows are listed front to back; only ordinary ones (layer 0) count.
func yieldFront() -> NSRunningApplication? {
    if let app = focusedApplication(), !isFairy(app) { return app }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for window in windows where (window[kCGWindowLayer as String] as? Int) == 0 {
        guard let pid = window[kCGWindowOwnerPID as String] as? pid_t, let app = NSRunningApplication(processIdentifier: pid),
              !isFairy(app), app.activationPolicy == .regular, !app.isTerminated else { continue }
        app.activate(options: [])
        for _ in 0..<20 {
            if focusedApplication()?.processIdentifier == pid { return app }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        return focusedApplication().flatMap { isFairy($0) ? nil : $0 }
    }
    // No window of anyone else's: Finder is always there.
    if let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first {
        finder.activate(options: [])
        for _ in 0..<20 { if focusedApplication()?.processIdentifier == finder.processIdentifier { return finder }; RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) }
    }
    return nil
}
if payload["yield"] as? Bool == true {
    guard let app = yieldFront() else { fail("Could not bring your app back to the front.") }
    print(String(data: try JSONSerialization.data(withJSONObject: ["pid": Int(app.processIdentifier), "bundleId": app.bundleIdentifier ?? ""]), encoding: .utf8)!); exit(0)
}
if payload["context"] as? Bool == true {
    guard let app = yieldFront(), let bundle = app.bundleIdentifier,
          !isFairy(app) else { fail("Could not identify the target application. Bring it to the front and retry.") }
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    var value: [String: Any] = ["pid": Int(app.processIdentifier), "bundleId": bundle, "bundlePath": app.bundleURL?.path ?? ""]
    if let window = elementAttribute(ax, kAXFocusedWindowAttribute),
       let position = attribute(window, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
       let size = attribute(window, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() {
        var point = CGPoint.zero; var extent = CGSize.zero
        if AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) {
            let children = attribute(window, kAXChildrenAttribute) as? [AXUIElement] ?? []
            value["window"] = ["x": point.x, "y": point.y, "width": extent.width, "height": extent.height,
                "id": stringAttribute(window, kAXIdentifierAttribute) ?? "", "title": stringAttribute(window, kAXTitleAttribute) ?? "",
                "standard": attribute(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole,
                "hasSheet": children.contains { attribute($0, kAXRoleAttribute) as? String == kAXSheetRole }]
        }
    }
    if bundle == "com.apple.Safari", let window = elementAttribute(ax, kAXFocusedWindowAttribute) {
        value["browser"] = browserSnapshot(window, includeText: payload["includeBrowserText"] as? Bool == true)
    }
    if bundle == "com.apple.Spotlight", let field = elementAttribute(ax, kAXFocusedUIElementAttribute),
       let query = attribute(field, kAXValueAttribute) as? String { value["query"] = query }
    print(String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!); exit(0)
}
guard let actions = payload["actions"] as? [[String: Any]], actions.count <= 20,
      let width = payload["width"] as? Double, width > 0,
      let height = payload["height"] as? Double, height > 0,
      let bounds = payload["bounds"] as? [String: Double],
      let bw = bounds["width"], let bh = bounds["height"] else { fail("Missing display geometry.") }
// Native approval sheets activate Fairy. Restore the app that was visible
// when the model chose its actions before posting any input events.
if let focus = payload["focus"] as? [String: Any] {
    guard let pid = focus["pid"] as? Int32, let bundle = focus["bundleId"] as? String,
          let target = NSRunningApplication(processIdentifier: pid), !isFairy(target),
          !target.isTerminated, target.bundleIdentifier == bundle else { fail("The target application changed or closed. Start a new desktop task.") }
    if focusedApplication()?.processIdentifier != pid {
        if payload["restoreFocus"] as? Bool == false { fail("Keyboard focus changed before execution. No desktop actions were run.") }
        target.activate(options: [])
    }
    for _ in 0..<20 {
        if focusedApplication()?.processIdentifier == pid { break }
        // NSWorkspace/NSRunningApplication refresh their cached activation
        // state on the run loop; sleeping here reports stale focus forever.
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
    }
    guard focusedApplication()?.processIdentifier == pid else { fail("Could not restore the target application's focus. No desktop actions were run.") }
    Thread.sleep(forTimeInterval: 0.2)
}
func point(_ action: [String: Any]) -> CGPoint {
    guard let x = action["x"] as? Double, let y = action["y"] as? Double,
          x.isFinite, y.isFinite, x >= 0, y >= 0, x < width, y < height else { fail("Point outside captured display.") }
    return CGPoint(x: (bounds["x"] ?? 0) + x * bw / width, y: (bounds["y"] ?? 0) + y * bh / height)
}
func mouse(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton = .left, _ count: Int64 = 1) {
    let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)
    event?.setIntegerValueField(.mouseEventClickState, value: count)
    event?.post(tap: .cghidEventTap)
}
let keyCodes: [String: CGKeyCode] = [
 "A":0,"S":1,"D":2,"F":3,"H":4,"G":5,"Z":6,"X":7,"C":8,"V":9,"B":11,"Q":12,"W":13,"E":14,"R":15,"Y":16,"T":17,
 "1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,
 "]":30,"O":31,"U":32,"[":33,"I":34,"P":35,"ENTER":36,"RETURN":36,"L":37,"J":38,"'":39,"K":40,";":41,"\\":42,",":43,"/":44,"N":45,"M":46,".":47,
 "TAB":48,"SPACE":49,"`":50,"BACKSPACE":51,"ESC":53,"ESCAPE":53,"DELETE":117,"ARROWLEFT":123,"LEFT":123,"ARROWRIGHT":124,"RIGHT":124,"ARROWDOWN":125,"DOWN":125,"ARROWUP":126,"UP":126,"HOME":115,"END":119,"PAGEUP":116,"PAGEDOWN":121,
 "F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111
]
func press(_ code: CGKeyCode, flags: CGEventFlags = []) {
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); down?.flags = flags; down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); up?.flags = flags; up?.post(tap: .cghidEventTap)
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
}
func safariWindow() -> (NSRunningApplication, AXUIElement) {
    guard let app = focusedApplication(), app.bundleIdentifier == "com.apple.Safari",
          let window = elementAttribute(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedWindowAttribute),
          stringAttribute(window, kAXSubroleAttribute) == kAXStandardWindowSubrole,
          !(attribute(window, kAXChildrenAttribute) as? [AXUIElement] ?? []).contains(where: { stringAttribute($0, kAXRoleAttribute) == kAXSheetRole }) else { fail("Safari is not focused or has a dialog open. Observe the screen before trying another browser action.") }
    return (app, window)
}
func navigateSafari(_ address: String) {
    guard address.count <= 2048, !address.contains(where: { $0.isWhitespace || $0.asciiValue.map { $0 < 32 || $0 == 127 } == true }),
          let url = URLComponents(string: address), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil, url.user == nil, url.password == nil else { fail("Only HTTP(S) website addresses without credentials are supported.") }
    let (app, _) = safariWindow()
    press(17, flags: .maskCommand) // New tab preserves the existing page and any draft.
    _ = safariWindow()
    press(37, flags: .maskCommand)
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    guard focusedApplication()?.processIdentifier == app.processIdentifier,
          let field = elementAttribute(ax, kAXFocusedUIElementAttribute),
          stringAttribute(field, kAXIdentifierAttribute) == "WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD",
          stringAttribute(field, kAXRoleAttribute) == kAXTextFieldRole else { fail("Safari's address field did not receive focus. No address was entered.") }
    guard AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, address as CFString) == .success else { fail("Safari's address field could not be updated. No page was opened.") }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.15))
    guard focusedApplication()?.processIdentifier == app.processIdentifier,
          let current = elementAttribute(ax, kAXFocusedUIElementAttribute), CFEqual(current, field),
          stringAttribute(current, kAXValueAttribute) == address else { fail("Safari's address field changed before navigation. No Return key was sent.") }
    press(36)
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.7))
}
for action in actions {
    guard let kind = action["type"] as? String else { fail("Missing action type.") }
    switch kind {
    case "browser_navigate":
        guard let url = action["url"] as? String else { fail("Missing browser URL.") }
        navigateSafari(url)
    case "browser_search":
        guard let query = action["query"] as? String, !query.trimmingCharacters(in: .whitespaces).isEmpty,
              query.count <= 300, !query.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { fail("Invalid browser search query.") }
        var url = URLComponents(string: "https://www.google.com/search")!
        url.queryItems = [URLQueryItem(name: "q", value: query)]
        navigateSafari(url.url!.absoluteString)
    case "browser_tab":
        guard let direction = action["direction"] as? String, ["next", "previous"].contains(direction) else { fail("Choose next or previous tab.") }
        _ = safariWindow()
        press(48, flags: direction == "next" ? .maskControl : [.maskControl, .maskShift])
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    case "open_app":
        guard let bundle = action["bundle_id"] as? String,
              bundle.range(of: "^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$", options: .regularExpression) != nil,
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle),
              NSWorkspace.shared.open(url) else { fail("The requested application could not be opened.") }
        for _ in 0..<30 {
            if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundle { break }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
        }
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundle else { fail("The requested application did not become active. Observe the screen before retrying.") }
        Thread.sleep(forTimeInterval: 0.3)
    case "screenshot": break
    case "wait": Thread.sleep(forTimeInterval: 0.5)
    case "move": mouse(.mouseMoved, point(action))
    case "click", "double_click":
        let p = point(action); let button = action["button"] as? String ?? "left"
        guard ["left", "right", "middle"].contains(button) else { fail("Unknown mouse button.") }
        let b: CGMouseButton = button == "right" ? .right : button == "middle" ? .center : .left
        let down: CGEventType = b == .right ? .rightMouseDown : b == .center ? .otherMouseDown : .leftMouseDown
        let up: CGEventType = b == .right ? .rightMouseUp : b == .center ? .otherMouseUp : .leftMouseUp
        for count in 1...(kind == "double_click" ? 2 : 1) { mouse(down, p, b, Int64(count)); mouse(up, p, b, Int64(count)); Thread.sleep(forTimeInterval: 0.06) }
    case "drag":
        guard let path = action["path"] as? [[String: Any]], path.count >= 2, path.count <= 200 else { fail("Invalid drag path.") }
        mouse(.leftMouseDown, point(path[0]))
        for p in path.dropFirst() { mouse(.leftMouseDragged, point(p)); Thread.sleep(forTimeInterval: 0.01) }
        mouse(.leftMouseUp, point(path.last!))
    case "scroll":
        mouse(.mouseMoved, point(action))
        guard let x = action["scroll_x"] as? Int32, let y = action["scroll_y"] as? Int32, abs(Int64(x)) <= 5000, abs(Int64(y)) <= 5000 else { fail("Invalid scroll distance.") }
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: -y, wheel2: -x, wheel3: 0)?.post(tap: .cghidEventTap)
    case "type":
        guard let text = action["text"] as? String, text.count <= 12000 else { fail("Invalid text.") }
        // Unicode events avoid replacing the user's clipboard.
        for character in text {
            let units = Array(String(character).utf16)
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
            event?.flags = []
            event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            event?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            up?.flags = []
            up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            up?.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.025)
        }
        if focusedApplication()?.bundleIdentifier == "com.apple.Spotlight" {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.6))
        }
    case "keypress":
        guard let keys = action["keys"] as? [String], !keys.isEmpty, keys.count <= 8 else { fail("Invalid key combination.") }
        var flags: CGEventFlags = []; var codes: [CGKeyCode] = []
        for key in keys {
            switch key.uppercased() {
            case "META", "CMD", "COMMAND", "SUPER": flags.insert(.maskCommand)
            case "CTRL", "CONTROL": flags.insert(.maskControl)
            case "ALT", "OPTION": flags.insert(.maskAlternate)
            case "SHIFT": flags.insert(.maskShift)
            default: guard let code = keyCodes[key.uppercased()] else { fail("Unsupported key: \(key)") }; codes.append(code)
            }
        }
        guard !codes.isEmpty else { fail("A modifier needs a key.") }
        for code in codes { let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); e?.flags = flags; e?.post(tap: .cghidEventTap) }
        for code in codes.reversed() { let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); e?.flags = flags; e?.post(tap: .cghidEventTap) }
        if flags == .maskCommand && codes == [49] {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.6))
            guard focusedApplication()?.bundleIdentifier == "com.apple.Spotlight" else { fail("Spotlight did not receive keyboard focus. No search text was typed.") }
        }
    default: fail("Unsupported action: \(kind)")
    }
    Thread.sleep(forTimeInterval: 0.08)
}
print("done")
