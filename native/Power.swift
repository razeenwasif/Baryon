import Foundation
import IOKit.ps

// One JSON snapshot at startup and on native notifications. No polling timer.
var last = Data()
func publish() {
    var percent: Int? = nil
    var battery = false
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { exit(1) }
    do {
        battery = (IOPSGetProvidingPowerSourceType(blob)?.takeUnretainedValue() as String?) == kIOPSBatteryPowerValue
        if let sources = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] {
            for source in sources {
                guard let info = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                      info[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
                      let current = info[kIOPSCurrentCapacityKey] as? Int,
                      let maximum = info[kIOPSMaxCapacityKey] as? Int, maximum > 0 else { continue }
                percent = max(0, min(100, Int((Double(current) / Double(maximum) * 100).rounded())))
                break
            }
        }
    }
    var lowPower = false
    if #available(macOS 12, *) { lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled }
    let value: [String: Any] = ["onBattery":battery,"lowPower":lowPower,"batteryPercent":percent as Any? ?? NSNull()]
    guard let data = try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]), data != last else { return }
    last = data
    FileHandle.standardOutput.write(data + Data([10]))
}
let observer = NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { _ in publish() }
guard let source = IOPSNotificationCreateRunLoopSource({ _ in publish() }, nil)?.takeRetainedValue() else { exit(1) }
CFRunLoopAddSource(CFRunLoopGetMain(),source,.defaultMode)
// EOF means the parent quit. Refresh requests follow Electron's resume event.
DispatchQueue.global(qos:.utility).async {
    while let line = readLine() {
        if line == "refresh" { DispatchQueue.main.async { publish() } }
    }
    exit(0)
}
publish()
RunLoop.main.run()
