// Show me how: what Fairy needs to point at the real controls of the app you're using.
//   {"elements": true, "skipPID": n}  -> the app in front (not Fairy) and its buttons, menus, menu items, tabs and fields,
//                                       each with its label and its frame on screen, as one JSON object.
//   {"watch": true}                   -> keeps running and prints a JSON line for each mouse click: {"x","y","button"}.
//                                       Listen-only: clicks are never changed or held. Ends when stdin closes.
//   {"keys": true, "hold": "control+option", "tap": "option+command", "area": true}
//                                    -> quicker ways to ask: keeps running and prints {"hold":"start|end|cancel"} for
//                                       holding the hold keys alone, {"tap":"type"} for a quick tap of the tap keys alone,
//                                       and {"area":true} for the hold keys + A (⌃⌥A when holding is off). "off" turns one
//                                       off. Listen-only; any other key during a hold makes it a shortcut, not a hold.
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}

// The request is one JSON line, so watch mode can keep stdin open to know when to stop.
guard let line = readLine(strippingNewline: true), let payload = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { fail("Invalid guide request.") }
guard AXIsProcessTrusted() else { fail("Enable Accessibility for Fairy in System Settings → Privacy & Security → Accessibility, then retry.") }

if payload["watch"] as? Bool == true {
    let mask = (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
        let point = event.location
        emit(["x": Double(point.x), "y": Double(point.y), "button": type == .rightMouseDown ? "right" : "left"])
        return Unmanaged.passUnretained(event)
    }, userInfo: nil) else { fail("Fairy can't watch for clicks: allow it in Privacy & Security → Accessibility.") }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    emit(["ready": true])
    // Stop when Fairy closes our stdin (or goes away).
    Thread.detachNewThread { while readLine() != nil {}; exit(0) }
    CFRunLoopRun()
    exit(0)
}

if payload["keys"] as? Bool == true {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let watched: NSEvent.ModifierFlags = [.control, .option, .command, .shift, .function]
    var holding = false, started = false, dirty = false, holdTimer: Timer?
    var tapAt: Date?, tapDirty = false
    func modifiers(_ name: Any?, _ fallback: String) -> NSEvent.ModifierFlags? {
        let text = (name as? String) ?? fallback
        if text == "off" { return nil }
        var flags: NSEvent.ModifierFlags = []
        for part in text.split(separator: "+") {
            switch part { case "control": flags.insert(.control); case "option": flags.insert(.option); case "command": flags.insert(.command); case "shift": flags.insert(.shift); default: return nil }
        }
        return flags.rawValue.nonzeroBitCount >= 2 ? flags : nil
    }
    let holdKeys = modifiers(payload["hold"], "control+option"), tapKeys = modifiers(payload["tap"], "option+command")
    let areaOn = payload["area"] as? Bool ?? true, areaKeys = holdKeys ?? [.control, .option]
    // An unused pattern no keyboard can make, for a key that's turned off.
    let never: NSEvent.ModifierFlags = [.control, .option, .command, .shift, .function]
    let hold = holdKeys ?? never, tap = tapKeys ?? never
    NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { event in
        let flags = event.modifierFlags.intersection(watched)
        if event.type == .keyDown {
            // ⌃⌥A asks about an area; any other key makes a held ⌃⌥ or ⌥⌘ a shortcut instead.
            if areaOn && flags == areaKeys && event.keyCode == 0 { emit(["area": true]) }
            if holding { dirty = true; holdTimer?.invalidate(); if started { started = false; emit(["hold": "cancel"]) } }
            tapDirty = true
            return
        }
        if flags == hold && !holding {
            holding = true; started = false; dirty = false
            // A quarter of a second in, so a ⌃⌥ shortcut on its way doesn't start listening.
            holdTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { _ in if holding && !dirty { started = true; emit(["hold": "start"]) } }
        } else if flags != hold && holding {
            holding = false; holdTimer?.invalidate()
            // Letting go of ⌃ or ⌥ sends it; adding another modifier (⌃⌥⌘…) makes it a shortcut instead.
            if started { started = false; emit(["hold": dirty || !hold.contains(flags) ? "cancel" : "end"]) }
        }
        if flags == tap { tapAt = Date(); tapDirty = false }
        else if flags.isEmpty, let at = tapAt { if !tapDirty && Date().timeIntervalSince(at) < 0.45 { emit(["tap": "type"]) }; tapAt = nil }
        else if !tap.contains(flags) { tapAt = nil }  // letting go of ⌘ before ⌥ (or ⌥ first) still counts
    }
    emit(["ready": true])
    Thread.detachNewThread { while readLine() != nil {}; exit(0) }
    app.run()
    exit(0)
}

guard payload["elements"] as? Bool == true else { fail("Unknown guide request.") }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func string(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attribute(element, name) else { return nil }
    if let text = value as? String { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
    return nil
}
func frame(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = attribute(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, extent = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
    return CGRect(origin: point, size: extent)
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }

// The app you're using: the owner of the topmost ordinary window that isn't Fairy's.
let skip = (payload["skipPID"] as? NSNumber)?.int32Value ?? -1
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
guard let front = windows.first(where: { window in
    guard let owner = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, owner != skip,
          (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
          let bounds = window[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
    return rect.width >= 120 && rect.height >= 80
}), let pid = (front[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value else { fail("No app window in front to show you around.") }
let app = AXUIElementCreateApplication(pid)
let running = NSRunningApplication(processIdentifier: pid)
// Electron and Chrome apps only build their full accessibility tree when asked, the way VoiceOver asks; give it a moment.
let chromium = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
    || AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) == .success

let CONTROLS: Set<String> = ["AXButton", "AXMenuButton", "AXPopUpButton", "AXMenuBarItem", "AXMenuItem", "AXCheckBox", "AXRadioButton",
    "AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXSlider", "AXIncrementor", "AXDisclosureTriangle", "AXLink", "AXTab", "AXRow", "AXCell", "AXSegmentedControl"]
let screens = NSScreen.screens.map { screen -> CGRect in
    // NSScreen frames are bottom-up; AX frames are top-down from the main display's top left.
    let main = NSScreen.screens.first?.frame.height ?? screen.frame.height
    return CGRect(x: screen.frame.minX, y: main - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
}
var deadline = Date(timeIntervalSinceNow: 1.6)
var found: [[String: Any]] = [], visited = 0
// A row or cell's label is usually the first text inside it.
func innerText(_ element: AXUIElement) -> String? {
    var stack = children(element), seen = 0
    while let next = stack.popLast(), seen < 20 {
        seen += 1
        if string(next, kAXRoleAttribute) == "AXStaticText", let value = string(next, kAXValueAttribute), !value.isEmpty { return value }
        stack.append(contentsOf: children(next).reversed())
    }
    return nil
}
func walk(_ roots: [AXUIElement], area: String) {
    var queue = roots.map { ($0, 0) }, index = 0
    while index < queue.count, visited < 3000, found.count < 420, Date() < deadline {
        let (element, depth) = queue[index]; index += 1; visited += 1
        let role = string(element, kAXRoleAttribute) ?? ""
        if CONTROLS.contains(role), let rect = frame(element), rect.width > 2, rect.height > 2,
           screens.contains(where: { $0.intersects(rect) }) {
            var label = string(element, kAXTitleAttribute) ?? ""
            if label.isEmpty { label = string(element, kAXDescriptionAttribute) ?? "" }
            if label.isEmpty, ["AXRow", "AXCell", "AXRadioButton", "AXCheckBox", "AXPopUpButton"].contains(role) { label = innerText(element) ?? "" }
            if label.isEmpty, ["AXTextField", "AXSearchField", "AXComboBox", "AXTextArea"].contains(role) { label = string(element, kAXPlaceholderValueAttribute) ?? "" }
            let help = string(element, kAXHelpAttribute) ?? ""
            if !label.isEmpty || !help.isEmpty {
                found.append(["role": role, "label": String(label.prefix(120)), "help": String(help.prefix(160)), "area": area,
                              "enabled": attribute(element, kAXEnabledAttribute) as? Bool ?? true,
                              "x": Double(rect.minX), "y": Double(rect.minY), "w": Double(rect.width), "h": Double(rect.height)])
            }
        }
        // Menus only have items worth listing while they're open, which their frames show.
        if depth < 30 { queue.append(contentsOf: children(element).map { ($0, depth + 1) }) }
    }
}
// Open menus, sheets and popovers first, then the window, then the menu bar's titles.
var windowFrame: CGRect? = nil
func collect() {
if let menuBar = attribute(app, kAXMenuBarAttribute), CFGetTypeID(menuBar) == AXUIElementGetTypeID() {
    let bar = menuBar as! AXUIElement
    let open = children(bar).flatMap { children($0) }.filter { menu in frame(menu).map { $0.width > 2 && $0.height > 2 } ?? false }
    walk(open, area: "menu")
    walk(children(bar), area: "menu bar")
}
if let focused = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
    let window = focused as! AXUIElement
    windowFrame = frame(window)
    walk([window], area: "window")
}
}
collect()
// A Chromium app builds its tree a moment after being asked, so a thin first look is taken again.
if chromium && found.filter({ $0["area"] as? String == "window" }).count < 12 {
    Thread.sleep(forTimeInterval: 0.9); found = []; visited = 0; deadline = Date(timeIntervalSinceNow: 1.6); collect()
}
// The same control can be listed twice (a menu bar title is also found from its menu); keep the first.
var seen = Set<String>()
let unique = found.filter { element in
    let key = "\(element["role"]!)|\(element["label"]!)|\(Int(element["x"] as! Double))|\(Int(element["y"] as! Double))"
    return seen.insert(key).inserted
}
var result: [String: Any] = ["pid": Int(pid), "app": running?.localizedName ?? "", "bundle": running?.bundleIdentifier ?? "", "elements": unique, "truncated": Date() >= deadline || found.count >= 420]
if let rect = windowFrame { result["window"] = ["x": Double(rect.minX), "y": Double(rect.minY), "w": Double(rect.width), "h": Double(rect.height)] }
emit(result)
