import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('the quiz hint is drawn inside Fairy\'s eye: a clock of six for choices, a nod or shake for yes and no, one icon wide', {skip:process.platform !== 'darwin'}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fairy-quiz-menu-'));
  try {
    // Exercise the actual AppKit presentation without starting the stdin loop.
    const source = readFileSync(new URL('../native/QuizOverlay.swift', import.meta.url), 'utf8');
    const setup = source.slice(0, source.indexOf('DispatchQueue.global(qos: .utility).async'));
    const checks = `
let displayID = (NSScreen.main!.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! NSNumber).uint32Value
app.finishLaunching()
func flushDisplay() { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) }
let d = FairyEyeView.dim
precondition(statusItem.isVisible && eyeIcon.tokens.isEmpty && !eyeIcon.isAnimating)
precondition(statusItem.autosaveName == "RobinBirdAndQuiz")
precondition(baryonIcon.isDescendant(of: statusItem.button!) && baryonIcon.hitTest(NSPoint(x: 8, y: 8)) == nil)
precondition(eyeIcon.isDescendant(of: statusItem.button!) && eyeIcon.hitTest(NSPoint(x: 8, y: 8)) == nil)
precondition(statusItem.button!.toolTip!.contains("idle"))
precondition(eyeIcon.arcEmphasis(elapsed: 0) == [1, 1, 1, 1] && eyeIcon.gaze(elapsed: 0) == .zero)
var widths: [String: Double] = [:]
for text in ["p1", "p3", "p6", "p9", "p12", "p1,p3", "p3,p12", "yes", "no", "true", "false", "star", "thinking", ""] {
    showHint(text, displayID: displayID)
    flushDisplay()
    precondition(statusItem.isVisible && eyeIcon.isDescendant(of: statusItem.button!))
    widths[text.isEmpty ? "idle" : text] = Double(statusItem.length)
}
// Choices: six segments, 1 at the top and on clockwise; past six, segment n - 6 and a closed pupil.
showHint("p3", displayID: displayID)
precondition(eyeIcon.arcEmphasis(elapsed: 0) == [d, d, 1, d, d, d] && !eyeIcon.pupilClosed && !eyeIcon.isAnimating)
let look3 = eyeIcon.gaze(elapsed: 0)
precondition(look3.x > 1 && look3.y > 0, "option 3 sits lower right, so she looks there")
precondition(statusItem.button!.toolTip!.contains("option 3"))
showHint("p1", displayID: displayID)
precondition(eyeIcon.arcEmphasis(elapsed: 0) == [1, d, d, d, d, d] && eyeIcon.gaze(elapsed: 0).y < -1)
showHint("p1,p3", displayID: displayID)
precondition(eyeIcon.arcEmphasis(elapsed: 0) == [1, d, 1, d, d, d] && eyeIcon.gaze(elapsed: 0) == .zero)
showHint("p8", displayID: displayID)
precondition(eyeIcon.litSegments == [2] && eyeIcon.pupilClosed && statusItem.button!.toolTip!.contains("option 8"))
showHint("p3,p12", displayID: displayID)
precondition(eyeIcon.litSegments == [3, 6] && eyeIcon.pupilClosed)
// Yes nods, no shakes.
for text in ["yes", "true"] { showHint(text, displayID: displayID); precondition(eyeIcon.arcEmphasis(elapsed: 5) == [1, d, 1, d] && eyeIcon.gaze(elapsed: 0).y < 0 && !eyeIcon.isAnimating) }
for text in ["no", "false"] { showHint(text, displayID: displayID); precondition(eyeIcon.arcEmphasis(elapsed: 5) == [d, 1, d, 1] && !eyeIcon.isAnimating) }
precondition(statusItem.button!.toolTip!.contains("False"))
// Checking runs light round the arcs; a copy is a blink.
let moving = FairyEyeView(frame: eyeIcon.frame, reduceMotion: { false })
moving.setSymbols("thinking")
precondition(moving.isAnimating)
for step in 0...56 {
    let emphasis = moving.arcEmphasis(elapsed: Double(step) / 20)
    precondition(emphasis.count == 4 && emphasis.allSatisfy { $0 >= d - 0.0001 && $0 <= 1 })
}
precondition(moving.arcEmphasis(elapsed: 0.49)[0] == 1 && moving.arcEmphasis(elapsed: 0.84)[1] == 1)
moving.setSymbols("star")
precondition(moving.isAnimating && moving.openness(elapsed: 0) == 1 && moving.openness(elapsed: 2.4 * 0.78) < 0.1)
moving.setSymbols("p2")
precondition(!moving.isAnimating)
var motionReduced = true
let still = FairyEyeView(frame: eyeIcon.frame, reduceMotion: { motionReduced })
still.setSymbols("thinking")
precondition(!still.isAnimating && still.arcEmphasis(elapsed: 1) == [0.55, 0.55, 0.55, 0.55] && still.gaze(elapsed: 1) == .zero)
still.setSymbols("star")
precondition(!still.isAnimating && still.openness(elapsed: 2.4 * 0.78) == 1)
motionReduced = false
still.refreshAccessibility()
precondition(still.isAnimating)
// The menu is unchanged.
var actions: [String] = []
let testMenu = FairyMenuController(statusItem: statusItem, emit: { actions.append($0) })
testMenu.updateMenu([
    ["id":"show", "label":"Hide Fairy"], ["type":"separator"],
    ["id":"mute", "label":"Mute voice", "type":"checkbox", "checked":true],
    ["id":"quit", "label":"Quit Fairy"], ["id":"unknown", "label":"Ignore me"]
], tooltip: "Fairy · muted")
precondition(testMenu.menu.items.count == 4 && testMenu.menu.items[1].isSeparatorItem)
precondition(testMenu.menu.items[2].state == .on && testMenu.tooltip == "Fairy · muted")
for index in [0, 2, 3] { testMenu.choose(testMenu.menu.items[index]) }
precondition(actions == ["show", "mute", "quit"])
statusItem.button?.target = menuController
// Rendered: the lit segment is solid and the others faint, in light and dark menu bars.
func render() -> NSBitmapImageRep {
    let image = NSImage(size: NSSize(width: 22 * 4, height: 22 * 4), flipped: true) { _ in
        NSGraphicsContext.saveGraphicsState()
        let scale = NSAffineTransform(); scale.scale(by: 4); scale.concat()
        eyeIcon.effectiveAppearance.performAsCurrentDrawingAppearance { eyeIcon.draw(eyeIcon.bounds) }
        NSGraphicsContext.restoreGraphicsState()
        return true
    }
    return NSBitmapImageRep(data: image.tiffRepresentation!)!
}
func alpha(_ bitmap: NSBitmapImageRep, angle: CGFloat, radius: CGFloat = 9.4) -> CGFloat {
    let x = 11 + cos(angle * .pi / 180) * radius, y = 11 + sin(angle * .pi / 180) * radius
    return bitmap.colorAt(x: Int(x * 4), y: Int(y * 4))!.alphaComponent
}
var brightness: [Double] = []
for name in [NSAppearance.Name.aqua, .darkAqua] {
    eyeIcon.appearance = NSAppearance(named: name)
    for selected in 1...6 {
        showHint("p" + String(selected), displayID: displayID)
        let bitmap = render()
        for (i, angle) in FairyEyeView.six.enumerated() {
            let value = alpha(bitmap, angle: angle)
            precondition(i + 1 == selected ? value > 0.8 : value < 0.35)
        }
        if let evidence = ProcessInfo.processInfo.environment["QUIZ_MENU_BAR_EVIDENCE"] {
            try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: evidence + "/option-" + String(selected) + "-" + name.rawValue + ".png"))
        }
    }
    for (text, solid) in [("yes", [0, 2]), ("no", [1, 3]), ("", [0, 1, 2, 3])] {
        showHint(text, displayID: displayID)
        let bitmap = render()
        for (i, angle) in FairyEyeView.four.enumerated() { let value = alpha(bitmap, angle: angle); precondition(solid.contains(i) ? value > 0.8 : value < 0.35) }
        if let evidence = ProcessInfo.processInfo.environment["QUIZ_MENU_BAR_EVIDENCE"] {
            try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: evidence + "/" + (text.isEmpty ? "idle" : text) + "-" + name.rawValue + ".png"))
        }
    }
    showHint("", displayID: displayID)
    let bitmap = render()
    var sum = 0.0, count = 0.0
    for y in 0..<bitmap.pixelsHigh { for x in 0..<bitmap.pixelsWide {
        let color = bitmap.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
        if color.alphaComponent > 0.5 { sum += Double(color.redComponent + color.greenComponent + color.blueComponent) / 3; count += 1 }
    } }
    precondition(count > 0)
    brightness.append(sum / count)
}
for animated in ["thinking", "star"] {
    for text in ["", "invalid", "p2,invalid", String(repeating: "p1,", count: 100)] {
        showHint(animated, displayID: displayID)
        showHint(text, displayID: displayID)
        precondition(statusItem.isVisible && eyeIcon.tokens.isEmpty && !eyeIcon.isAnimating && statusItem.button!.toolTip!.contains("idle"))
    }
}
showHint("p2", displayID: UInt32.max)
precondition(eyeIcon.tokens.isEmpty)
showHint("p2", displayID: displayID)
precondition(eyeIcon.tokens == ["p2"])
precondition(!app.windows.contains(where: { $0 is NSPanel }))
showHint("", displayID: displayID)
let itemFrame = statusItem.button!.window!.frame
let screenFrame = (statusItem.button!.window!.screen ?? NSScreen.main!).frame
precondition(itemFrame.maxX > screenFrame.midX)
let result: [String: Any] = ["widths": widths, "brightness": brightness,
    "rightEdgeDistance": Double(screenFrame.maxX - itemFrame.maxX),
    "systemManagesPlacement": ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 27]
print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
`;
    const path = join(directory, 'QuizMenuBar.swift'), binary = join(directory, 'quiz-menu-test');
    writeFileSync(path, setup + checks);
    // Generous limits: compiling and running AppKit takes far longer while the whole suite runs at once.
    execFileSync('swiftc', ['-module-cache-path', '/tmp/fairy-swift-cache', path, '-o', binary], {timeout:240000});
    const iconPath = new URL('../assets/tray/trayTemplate.png', import.meta.url).pathname;
    const result = JSON.parse(execFileSync(binary, [iconPath], {encoding:'utf8', timeout:60000})) as { widths: Record<string, number>; brightness: number[]; rightEdgeDistance: number; systemManagesPlacement: boolean };
    if (process.env.QUIZ_MENU_BAR_EVIDENCE) writeFileSync(join(process.env.QUIZ_MENU_BAR_EVIDENCE, 'native-menu-result.json'), JSON.stringify(result, null, 2));
    // Paired icon width (Baryon logo + Fairy eye), whatever the hint says.
    for (const width of Object.values(result.widths)) assert.equal(width, 48);
    assert(result.brightness[0] < 0.4, 'light menu bar uses dark monochrome marks');
    assert(result.brightness[1] > 0.7, 'dark menu bar uses light monochrome marks');
    if (!result.systemManagesPlacement) assert(result.rightEdgeDistance >= 0 && result.rightEdgeDistance < 400, 'older AppKit honors the right-side seed');
  } finally { rmSync(directory, {recursive:true, force:true}); }
});
