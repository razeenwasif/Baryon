// Two Macs, step 5 (docs/fairy-on-two-macs-plan.md): how long this Mac has gone without a key, a click or the pointer
// moving, to the fraction of a second, which Electron's powerMonitor gives only in whole seconds. One line of JSON
// every interval (milliseconds, the first argument, 200 if none). It reads nothing else, needs no permission, and stops
// when Fairy closes its input, so it never outlives her.
import CoreGraphics
import Foundation

setbuf(stdout, nil)
let every = max(50, CommandLine.arguments.dropFirst().first.flatMap { Int($0) } ?? 200)
Thread.detachNewThread {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}
// kCGAnyInputEventType: a key, the mouse or the trackpad.
let anyInput = CGEventType(rawValue: ~0)!
while true {
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    print("{\"idle\":\(String(format: "%.3f", idle))}")
    usleep(useconds_t(every * 1000))
}
