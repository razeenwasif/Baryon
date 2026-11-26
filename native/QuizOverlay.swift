import AppKit

// Fairy's menu-bar icon, with the quiz hint drawn inside it rather than beside it: her eye inside four arcs.
// Multiple choice splits the arcs into six like a clock, 1 at the top and on clockwise; the answer's segment stays
// bright, the rest dim, and her pupil looks toward it. Past six (rare), segment n − 6 lights and her pupil closes.
// Yes and True keep the top and bottom arcs (a nod), No and False the sides (a shake). Checking runs light round
// the arcs while her pupil glances about; a copied written answer is a blink. The tooltip says it all in words.
final class FairyEyeView: NSView {
    private(set) var tokens: [String] = []
    private var pulse: Timer?
    private var animationStart = ProcessInfo.processInfo.systemUptime
    private var accessibilityObserver: NSObjectProtocol?
    private let reduceMotion: () -> Bool
    var isAnimating: Bool { pulse != nil }

    static let four: [CGFloat] = [-90, 0, 90, 180]            // top, right, bottom, left
    static let six: [CGFloat] = [-90, -30, 30, 90, 150, 210]  // 1 at the top, then clockwise
    static let dim: CGFloat = 0.2

    init(frame: NSRect, reduceMotion: @escaping () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }) {
        self.reduceMotion = reduceMotion
        super.init(frame: frame)
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil, queue: .main
        ) { [weak self] _ in self?.refreshAccessibility() }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit {
        pulse?.invalidate()
        if let observer = accessibilityObserver { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    }
    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    @discardableResult func setSymbols(_ text: String) -> Bool {
        let next = text.components(separatedBy: ",")
        let valid = !text.isEmpty && text.count <= 180 && next.allSatisfy {
            ["yes", "no", "true", "false", "star", "thinking"].contains($0) ||
            $0.range(of: "^p[0-9]{1,3}$", options: .regularExpression) != nil
        }
        let accepted = valid ? next : []
        if accepted != tokens { animationStart = ProcessInfo.processInfo.systemUptime }
        tokens = accepted
        refreshAccessibility()
        return valid
    }
    private var moves: Bool { tokens == ["thinking"] || tokens == ["star"] }
    func refreshAccessibility() {
        if moves && !reduceMotion() {
            if pulse == nil {
                let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.needsDisplay = true }
                pulse = timer
                RunLoop.main.add(timer, forMode: .common)
            }
        } else { pulse?.invalidate(); pulse = nil }
        needsDisplay = true
    }

    var isChoice: Bool { !tokens.isEmpty && tokens.allSatisfy { $0.hasPrefix("p") } }
    private var numbers: [Int] { tokens.compactMap { Int($0.dropFirst()) }.filter { $0 > 0 } }
    // The segments lit for a choice, 1 to 6: option n lights segment ((n − 1) mod 6) + 1.
    var litSegments: Set<Int> { isChoice ? Set(numbers.map { ($0 - 1) % 6 + 1 }) : [] }
    // A choice past six closes her pupil: add six to the lit segment.
    var pupilClosed: Bool { isChoice && numbers.contains { $0 > 6 } }

    // Each arc's brightness, 0 to 1: four arcs, or six for a choice.
    func arcEmphasis(elapsed: TimeInterval) -> [CGFloat] {
        if isChoice { return (1...6).map { litSegments.contains($0) ? 1 : Self.dim } }
        switch tokens.first.map({ tokens.count == 1 ? $0 : "" }) ?? "" {
        case "yes", "true": return [1, Self.dim, 1, Self.dim]
        case "no", "false": return [Self.dim, 1, Self.dim, 1]
        case "thinking":
            if reduceMotion() { return Array(repeating: 0.55, count: 4) }
            // Light runs round the arcs: each brightens in turn, 0.35 s apart, over 1.4 s.
            return (0..<4).map { i in
                let x = (elapsed - Double(i) * 0.35).truncatingRemainder(dividingBy: 1.4) / 1.4
                let phase = x < 0 ? x + 1 : x
                return Self.dim + (1 - Self.dim) * CGFloat(max(0, 1 - abs(phase - 0.35) / 0.35))
            }
        case "star":
            if reduceMotion() { return [1, 1, 1, 1] }
            let t = elapsed.truncatingRemainder(dividingBy: 2.4) / 2.4
            return Array(repeating: t > 0.7 && t < 0.9 ? 0.35 : 1, count: 4)
        default: return [1, 1, 1, 1]
        }
    }
    // Where her pupil looks, as an offset from the eye's centre.
    func gaze(elapsed: TimeInterval) -> NSPoint {
        if isChoice, litSegments.count == 1, let segment = litSegments.first {
            let angle = Self.six[segment - 1] * .pi / 180
            return NSPoint(x: cos(angle) * 1.35, y: sin(angle) * 1.35)
        }
        if tokens == ["yes"] || tokens == ["true"] { return NSPoint(x: 0, y: -0.9) }
        if tokens == ["thinking"] && !reduceMotion() {
            let t = elapsed.truncatingRemainder(dividingBy: 3.2) / 3.2 * 2 * .pi
            return NSPoint(x: sin(t) * 1.1, y: -cos(t * 2) * 0.6)
        }
        return .zero
    }
    // How open her eye is: 1 open, a sliver in a blink.
    func openness(elapsed: TimeInterval) -> CGFloat {
        guard tokens == ["star"], !reduceMotion() else { return 1 }
        let t = elapsed.truncatingRemainder(dividingBy: 2.4) / 2.4
        if t < 0.7 || t > 0.86 { return 1 }
        return t < 0.78 ? 1 - 0.92 * CGFloat((t - 0.7) / 0.08) : 0.08 + 0.92 * CGFloat((t - 0.78) / 0.08)
    }

    var hintDescription: String {
        if tokens.isEmpty { return "Fairy · Quiz hints idle" }
        if tokens == ["thinking"] { return "Fairy · Checking quiz answer" }
        if isChoice { return "Fairy · Quiz answer: option " + tokens.map { String($0.dropFirst()) }.joined(separator: ", ") }
        let names = ["yes": "Yes", "no": "No", "true": "True", "false": "False", "star": "Written answer copied"]
        return "Fairy · " + tokens.map { names[$0] ?? $0 }.joined(separator: ", ")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let elapsed = ProcessInfo.processInfo.systemUptime - animationStart
        let center = NSPoint(x: bounds.midX, y: bounds.midY)
        let strong = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        let ink = NSColor.labelColor
        let emphasis = arcEmphasis(elapsed: elapsed)
        let centres = isChoice ? Self.six : Self.four, half: CGFloat = isChoice ? 20 : 28
        for (i, angle) in centres.enumerated() {
            let arc = NSBezierPath()
            arc.appendArc(withCenter: center, radius: 9.4, startAngle: angle - half, endAngle: angle + half, clockwise: false)
            arc.lineWidth = 1.6
            arc.lineCapStyle = .round
            ink.withAlphaComponent(strong ? (emphasis[i] > 0.5 ? 1 : 0.35) : emphasis[i]).setStroke()
            arc.stroke()
        }
        // The eye: a disc with the iris cut out as a ring, and the pupil cut from its middle.
        NSGraphicsContext.saveGraphicsState()
        let squash = NSAffineTransform()
        squash.translateX(by: center.x, yBy: center.y)
        squash.scaleX(by: 1, yBy: openness(elapsed: elapsed))
        squash.translateX(by: -center.x, yBy: -center.y)
        squash.concat()
        let circle = { (c: NSPoint, r: CGFloat) in NSRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2) }
        let eye = NSBezierPath(ovalIn: circle(center, 6.3))
        eye.appendOval(in: circle(center, 4.55))
        eye.appendOval(in: circle(center, 2.85))
        if !pupilClosed {
            let look = gaze(elapsed: elapsed)
            eye.appendOval(in: circle(NSPoint(x: center.x + look.x, y: center.y + look.y), 1.45))
        }
        eye.windingRule = .evenOdd
        ink.setFill()
        eye.fill()
        NSGraphicsContext.restoreGraphicsState()
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

func emitMenuEvent(_ value: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
    data.append(10)
    FileHandle.standardOutput.write(data)
}

final class FairyMenuController: NSObject {
    static let actions: Set<String> = ["show", "floating", "mute", "meeting", "ideas", "login", "quit"]
    let statusItem: NSStatusItem
    let emit: (String) -> Void
    private(set) var menu = NSMenu(title: "Fairy")
    private(set) var tooltip = "Fairy"

    init(statusItem: NSStatusItem, emit: @escaping (String) -> Void = { emitMenuEvent(["action": $0]) }) {
        self.statusItem = statusItem
        self.emit = emit
        super.init()
        statusItem.button?.target = self
        statusItem.button?.action = #selector(activate(_:))
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem.button?.setAccessibilityHelp("Click to show or hide Fairy. Right-click for Fairy's menu.")
        updateMenu([["id": "show", "label": "Show Fairy"], ["id": "quit", "label": "Quit Fairy"]], tooltip: "Fairy")
    }

    func updateMenu(_ rows: [[String: Any]], tooltip: String) {
        guard rows.count <= 20, tooltip.count <= 180 else { return }
        let next = NSMenu(title: "Fairy")
        next.autoenablesItems = false
        for row in rows {
            if row["type"] as? String == "separator" { next.addItem(.separator()); continue }
            guard let id = row["id"] as? String, Self.actions.contains(id),
                  let label = row["label"] as? String, label.count <= 180 else { continue }
            let item = NSMenuItem(title: label, action: #selector(choose(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = id
            if row["type"] as? String == "checkbox" { item.state = row["checked"] as? Bool == true ? .on : .off }
            next.addItem(item)
        }
        self.menu = next
        self.tooltip = tooltip
    }

    @objc func choose(_ item: NSMenuItem) {
        guard let action = item.representedObject as? String, Self.actions.contains(action) else { return }
        emit(action)
    }
    @objc func activate(_ sender: Any?) {
        guard let button = statusItem.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
        } else { emit("show") }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let menuAutosaveName = "RobinBirdAndQuiz"
let menuPositionKey = "NSStatusItem Preferred Position " + menuAutosaveName
// Older AppKit honors these initial right-side slots. macOS 27 manages order
// centrally; its user can Command-drag this single item without splitting it.
if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 27 {
    for key in [menuPositionKey, "NSStatusItem Preferred Position Item-0"] {
        if UserDefaults.standard.object(forKey: key) == nil {
            UserDefaults.standard.set(0, forKey: key)
        }
    }
}
final class PassiveImageView: NSImageView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

let birdWidth: CGFloat = 48
let statusItem = NSStatusBar.system.statusItem(withLength: birdWidth)
statusItem.autosaveName = menuAutosaveName
// Paired Baryon logo (CommandLine.arguments[1]) on the left + animated FairyEyeView on the right.
let baryonImage: NSImage? = {
    guard CommandLine.arguments.count > 1, let img = NSImage(contentsOfFile: CommandLine.arguments[1]) else { return nil }
    img.isTemplate = true
    img.size = NSSize(width: 18, height: 18)
    return img
}()
let baryonIcon = PassiveImageView(frame: NSRect(x: 2, y: 0, width: 19, height: 19))
baryonIcon.image = baryonImage
baryonIcon.imageScaling = .scaleProportionallyDown
statusItem.button?.addSubview(baryonIcon)
let eyeIcon = FairyEyeView(frame: NSRect(x: 24, y: 0, width: 22, height: 22))
statusItem.button?.addSubview(eyeIcon)
let menuController = FairyMenuController(statusItem: statusItem)

func layoutStatusItem() {
    guard let button = statusItem.button else { return }
    statusItem.length = birdWidth
    statusItem.isVisible = true
    baryonIcon.frame.origin.y = (button.bounds.height - baryonIcon.frame.height) / 2
    eyeIcon.frame.origin.y = (button.bounds.height - eyeIcon.frame.height) / 2
    eyeIcon.needsDisplay = true
    let description = menuController.tooltip + "\n" + eyeIcon.hintDescription
    button.toolTip = description
    button.setAccessibilityLabel(description)
}

func showHint(_ text: String, displayID: UInt32?) {
    let valid = eyeIcon.setSymbols(text)
    let connected = NSScreen.screens.contains(where: {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID
    })
    if !valid || !connected {
        eyeIcon.setSymbols("")
    }
    layoutStatusItem()
}

// Remain visible from launch until stdin closes when Fairy quits.
showHint("", displayID: nil)

DispatchQueue.global(qos: .utility).async {
    while let line = readLine() {
        guard line.utf8.count <= 4096, let data = line.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        if let menu = value["menu"] as? [[String: Any]], let tooltip = value["tooltip"] as? String {
            DispatchQueue.main.async { menuController.updateMenu(menu, tooltip: tooltip); layoutStatusItem() }
        } else if let text = value["text"] as? String, text.count <= 180 {
            let displayID = (value["displayId"] as? NSNumber)?.uint32Value
            DispatchQueue.main.async { showHint(text, displayID: displayID) }
        }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
DispatchQueue.main.async { emitMenuEvent(["ready": true]) }
app.run()
