// Step 1 of docs/fairy-on-two-macs-plan.md, the pointer test. Prints one line of JSON every 100 ms: the time, where the
// pointer is, and how long this Mac has gone without keyboard or mouse input. Run it on both Macs at once, then give
// both logs to scripts/pointer-report.mjs.
//
//   swiftc -O scripts/pointer-log.swift -o pointer-log
//   ./pointer-log > macbook.jsonl         Ctrl-C stops it; ./pointer-log 240 stops itself after 240 seconds.
//
// It reads no screen and needs no permission. Its only output is those lines.
import AppKit
import CoreGraphics

setbuf(stdout, nil)
let limit = CommandLine.arguments.dropFirst().first.flatMap(Double.init)
let started = Date()
// kCGAnyInputEventType: a key, the mouse or the trackpad.
let anyInput = CGEventType(rawValue: ~0)!
while limit == nil || Date().timeIntervalSince(started) < limit! {
    let point = NSEvent.mouseLocation
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    let at = Int((Date().timeIntervalSince1970 * 1000).rounded())
    print("{\"t\":\(at),\"x\":\(Int(point.x.rounded())),\"y\":\(Int(point.y.rounded())),\"idle\":\(String(format: "%.3f", idle))}")
    usleep(100_000)
}
