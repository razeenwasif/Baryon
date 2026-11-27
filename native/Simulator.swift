import CoreImage
import Foundation
import IOSurface
import ObjectiveC
import XPC

// Fairy's simulator helper: the screen of one iOS Simulator device, live, and touches, keys and buttons sent to it.
// It reads the device's own framebuffer through CoreSimulator, so the Simulator app needn't be open and no Screen
// Recording permission is needed, and it sends input the way the Simulator app itself does, through SimulatorKit's
// HID client (as Meta's idb and AXe do). From Xcode 27 the device ignores that client's buttons and keys and drops its
// touches, so input goes to the device's own HID service, dtuhidd, over XPC instead, as idb now does, and the HID client
// is kept for older Xcodes. Both frameworks are private, so everything is looked up at run time and a missing piece is
// reported rather than crashing.
//
//   fairy-simulator check          says whether this Mac's Xcode has what the helper needs
//   fairy-simulator serve <udid>   reads a JSON request a line on stdin, answers a JSON line on stdout
//
// Requests: {"id":1,"op":"info"}, {"op":"screenshot","maxWidth":0}, {"op":"frames","on":true,"fps":60,"maxWidth":480},
// {"op":"touch","phase":"down|move|up","x":..,"y":..}, {"op":"tap","x":..,"y":..}, {"op":"swipe","x":..,"y":..,"x2":..,"y2":..,"duration":0.3},
// {"op":"keys","codes":[4],"modifiers":[227]}, {"op":"text","text":"hi"}, {"op":"button","name":"home"}.
// Positions are in the device's points. Frames arrive as {"frame":"<base64 JPEG>","width":..,"height":..} without an id.

setvbuf(stdout, nil, _IOFBF, 1 << 20)
let developerDir: String = {
  if let dir = ProcessInfo.processInfo.environment["DEVELOPER_DIR"], !dir.isEmpty { return dir }
  let pipe = Pipe(), task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select"); task.arguments = ["-p"]; task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
  if (try? task.run()) != nil { task.waitUntilExit() }
  let found = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  return found.isEmpty ? "/Applications/Xcode.app/Contents/Developer" : found
}()
let xcodeContents = URL(fileURLWithPath: developerDir).deletingLastPathComponent().path

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}
func load() -> UnsafeMutableRawPointer? {
  guard dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW) != nil else { fail("CoreSimulator isn’t installed. Install Xcode and open it once.") }
  return dlopen("\(xcodeContents)/SharedFrameworks/SimulatorKit.framework/SimulatorKit", RTLD_NOW)
}
let simulatorKit = load()

// SimulatorKit's message builders. Each returns a message SimulatorKit allocates, which the HID client frees once sent.
typealias MouseMessage = @convention(c) (UnsafePointer<CGPoint>, UnsafePointer<CGPoint>?, UInt32, UInt, CGSize, UInt32) -> UnsafeMutableRawPointer?
typealias KeyMessage = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias ButtonMessage = @convention(c) (UInt32, UInt32, UInt32) -> UnsafeMutableRawPointer?
func symbol<T>(_ name: String, as type: T.Type) -> T? { simulatorKit.flatMap { dlsym($0, name) }.map { unsafeBitCast($0, to: type) } }
let mouseMessage = symbol("IndigoHIDMessageForMouseNSEvent", as: MouseMessage.self)
let keyMessage = symbol("IndigoHIDMessageForKeyboardArbitrary", as: KeyMessage.self)
let buttonMessage = symbol("IndigoHIDMessageForButton", as: ButtonMessage.self)
let hidClass: AnyClass? = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient")

if CommandLine.arguments.dropFirst().first == "check" {
  let missing = [("CoreSimulator", NSClassFromString("SimServiceContext") != nil), ("SimulatorKit", simulatorKit != nil), ("the HID client", hidClass != nil), ("touch messages", mouseMessage != nil), ("key messages", keyMessage != nil), ("button messages", buttonMessage != nil)].filter { !$0.1 }.map { $0.0 }
  if missing.isEmpty { print("{\"ok\":true,\"developerDir\":\(String(data: try! JSONSerialization.data(withJSONObject: [developerDir]), encoding: .utf8)!.dropFirst().dropLast())}"); fflush(stdout); exit(0) }
  fail("This Xcode is missing \(missing.joined(separator: ", ")), so Fairy can’t drive its simulators.")
}
func requestedDevice() -> UUID {
  guard CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "serve", let id = UUID(uuidString: CommandLine.arguments[2]) else { fail("Usage: fairy-simulator check | serve <udid>") }
  return id
}
let udid = requestedDevice()

// The device, from the default device set, the one simctl uses.
func call(_ target: NSObject, _ name: String, _ argument: Any? = nil, _ second: Any? = nil) -> NSObject? {
  let selector = NSSelectorFromString(name)
  guard target.responds(to: selector) else { return nil }
  return target.perform(selector, with: argument, with: second)?.takeUnretainedValue() as? NSObject
}
func findDevice() -> NSObject {
  guard let contextClass: AnyObject = NSClassFromString("SimServiceContext"),
        let context = contextClass.perform(NSSelectorFromString("sharedServiceContextForDeveloperDir:error:"), with: developerDir, with: nil)?.takeUnretainedValue() as? NSObject,
        let deviceSet = call(context, "defaultDeviceSetWithError:", nil) else { fail("Couldn’t reach the simulator service.") }
  guard let found = (deviceSet.value(forKey: "devicesByUDID") as? NSDictionary)?[udid] as? NSObject else { fail("There’s no simulator \(udid.uuidString).") }
  return found
}
let device = findDevice()
let scale = CGFloat((device.value(forKey: "deviceType") as? NSObject)?.value(forKey: "mainScreenScale") as? Double ?? 3)
let deviceName = device.value(forKey: "name") as? String ?? "Simulator"

// Output, a line at a time from any thread.
let output = DispatchQueue(label: "output")
func send(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
  output.async { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write("\n".data(using: .utf8)!) }
}

// The screen. Its framebuffer is an IOSurface that the device draws into; a change of seed means a new frame.
final class Screen {
  var descriptor: NSObject?
  var surface: IOSurface?
  var screenID: Int32 = .max
  let token = UUID()
  let context = CIContext(options: [.useSoftwareRenderer: false])
  func attach() throws {
    if descriptor != nil, surface != nil { return }
    guard let io = device.value(forKey: "io") as? NSObject else { throw Failure("The device has no screen. Boot it first.") }
    // A device lists a screen port for each display it could have (CarPlay, an external display, a second panel); only
    // the ones in use have a framebuffer. The primary display has the lowest screen ID, as simctl numbers them.
    // The first framebuffer can take a moment after boot.
    for attempt in 0..<20 {
      var best: (NSObject, IOSurface, Int32)?
      for port in call(io, "ioPorts") as? [NSObject] ?? [] {
        guard let found = call(port, "descriptor"), found.responds(to: NSSelectorFromString("framebufferSurface")), let next = call(found, "framebufferSurface") as? IOSurface else { continue }
        let id = call(found, "screenProperties").map { number32($0, "screenID") } ?? Int32.max
        if best == nil || id < best!.2 { best = (found, next, id) }
      }
      if let (found, next, id) = best {
        descriptor = found; surface = next; screenID = id
        listen(found)
        return
      }
      if attempt < 19 { Thread.sleep(forTimeInterval: 0.1) }
    }
    throw Failure("The device’s screen isn’t drawing. Boot it, and wait for it to finish starting up.")
  }
  // Told of each frame the device draws and of each new framebuffer, the way the Simulator app is. Without this the
  // device can go on drawing into a buffer we no longer hold, and the panel shows a picture from before. Xcodes without
  // the screen callbacks get the older surface callback, and the frames timer polls.
  let callbacks = DispatchQueue(label: "screen")
  var onFrame: (() -> Void)?
  var pushes = false
  func listen(_ found: NSObject) {
    let register = NSSelectorFromString("registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:")
    let swapped: @convention(block) (AnyObject?, AnyObject?) -> Void = { [weak self] update, _ in
      guard let self else { return }
      if let update = update as? IOSurface { self.surface = update } else if let fresh = call(found, "framebufferSurface") as? IOSurface { self.surface = fresh }
      self.onFrame?()
    }
    if found.responds(to: register), let method = found.method(for: register) {
      typealias Register = @convention(c) (AnyObject, Selector, NSUUID, DispatchQueue, AnyObject, AnyObject, AnyObject) -> Void
      let drawn: @convention(block) () -> Void = { [weak self] in self?.onFrame?() }
      let changed: @convention(block) (AnyObject?) -> Void = { _ in }
      unsafeBitCast(method, to: Register.self)(found, register, token as NSUUID, callbacks, unsafeBitCast(drawn, to: AnyObject.self), unsafeBitCast(swapped, to: AnyObject.self), unsafeBitCast(changed, to: AnyObject.self))
      pushes = true
      return
    }
    let older: @convention(block) (AnyObject?) -> Void = { update in swapped(update, nil) }
    _ = call(found, "registerCallbackWithUUID:ioSurfacesChangeCallback:", token, unsafeBitCast(older, to: AnyObject.self))
  }
  var pixels: CGSize { surface.map { CGSize(width: $0.width, height: $0.height) } ?? .zero }
  var points: CGSize { CGSize(width: pixels.width / scale, height: pixels.height / scale) }
  var seed: UInt32 { surface.map { IOSurfaceGetSeed($0) } ?? 0 }
  // A JPEG (or PNG) of the screen, no wider than maxWidth pixels; 0 means the device's size in points.
  func image(maxWidth: CGFloat, png: Bool = false, quality: CGFloat = 0.72) throws -> (Data, CGSize) {
    try attach()
    guard let surface else { throw Failure("The screen isn’t available.") }
    var picture = CIImage(ioSurface: surface)
    let width = maxWidth > 0 ? min(maxWidth, picture.extent.width) : points.width
    let factor = width / picture.extent.width
    if factor < 0.999 { picture = picture.transformed(by: CGAffineTransform(scaleX: factor, y: factor)) }
    let size = CGSize(width: round(picture.extent.width), height: round(picture.extent.height))
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let data = png ? context.pngRepresentation(of: picture, format: .RGBA8, colorSpace: space) : context.jpegRepresentation(of: picture, colorSpace: space, options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality])
    guard let data else { throw Failure("Couldn’t take a picture of the screen.") }
    return (data, size)
  }
}
// A property that isn't an object, read through the proxies CoreSimulator hands out.
let messageSend = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend")!
func number32(_ target: NSObject, _ name: String) -> Int32 {
  let selector = NSSelectorFromString(name)
  guard target.responds(to: selector) else { return Int32.max }
  return unsafeBitCast(messageSend, to: (@convention(c) (AnyObject, Selector) -> Int32).self)(target, selector)
}
struct Failure: Error { let message: String; init(_ message: String) { self.message = message } }
let screen = Screen()

// The device's HID service (dtuhidd), which Xcode 27 simulators take input from. Its digitizer service is looked up in
// the device's own namespace and reached over XPC; each event is a small dictionary, as Meta's idb sends them: a touch's
// first contact starts it, later ones move it, lifting ends it, all at a share of the screen from its top left; buttons
// are consumer usages and keys their USB HID usages. Every send waits for XPC to have sent it, so events stay in order.
final class DeviceHID {
  static let service = "com.apple.coredevice.feature.remote.hid.digitizer"
  let queue = DispatchQueue(label: "dtuhid")
  var connection: xpc_connection_t?
  var touching = false
  // Connects and checks dtuhidd answers; nil when this Xcode or device has no such service, so the older client is used.
  func connect() throws -> xpc_connection_t? {
    if let connection { return connection }
    let lookup = NSSelectorFromString("lookup:error:")
    guard device.responds(to: lookup), let method = device.method(for: lookup), let handle = dlopen(nil, RTLD_NOW) else { return nil }
    typealias Lookup = @convention(c) (AnyObject, Selector, NSString, UnsafeMutablePointer<NSError?>?) -> UInt32
    typealias EndpointFromPort = @convention(c) (mach_port_t, UInt64, UInt64) -> Unmanaged<AnyObject>?
    typealias ConnectionFromEndpoint = @convention(c) (xpc_object_t) -> Unmanaged<AnyObject>?
    typealias EnableSimToHost = @convention(c) (xpc_connection_t) -> Void
    guard let fromPort = dlsym(handle, "xpc_endpoint_create_mach_port_4sim"), let fromEndpoint = dlsym(handle, "xpc_connection_create_from_endpoint"), let enable = dlsym(handle, "xpc_connection_enable_sim2host_4sim") else { return nil }
    var failure: NSError?
    let port = unsafeBitCast(method, to: Lookup.self)(device, lookup, DeviceHID.service as NSString, &failure)
    guard port != 0, let endpoint = unsafeBitCast(fromPort, to: EndpointFromPort.self)(port, 0, 0)?.takeRetainedValue() as? xpc_object_t,
          let made = unsafeBitCast(fromEndpoint, to: ConnectionFromEndpoint.self)(endpoint)?.takeRetainedValue() as? xpc_connection_t else { return nil }
    // Without this the service sees the connection but never a message.
    unsafeBitCast(enable, to: EnableSimToHost.self)(made)
    xpc_connection_set_target_queue(made, queue)
    xpc_connection_set_event_handler(made) { [weak self] event in
      // A dropped connection ends any touch in progress; the next event connects again.
      if xpc_get_type(event) == XPC_TYPE_ERROR { self?.queue.async { if self?.connection === made { self?.connection = nil; self?.touching = false } } }
    }
    xpc_connection_resume(made)
    // dtuhidd starts on demand; a barrier message it answers says it's there.
    let answered = DispatchSemaphore(value: 0)
    var alive = false
    xpc_connection_send_message_with_reply(made, message("IndigoKeyboardButtonEvent", ["usageCode": 0, "state": 2], barrier: true), queue) { reply in alive = xpc_get_type(reply) == XPC_TYPE_DICTIONARY; answered.signal() }
    guard answered.wait(timeout: .now() + 4) == .success, alive else { xpc_connection_cancel(made); throw Failure("The device’s input service isn’t answering. Wait for it to finish starting up, then try again.") }
    connection = made
    return made
  }
  func message(_ type: String, _ payload: [String: Any], barrier: Bool = false) -> xpc_object_t {
    let message = xpc_dictionary_create(nil, nil, 0)
    xpc_dictionary_set_string(message, "messageType", type)
    xpc_dictionary_set_bool(message, "isBarrier", barrier)
    xpc_dictionary_set_string(message, "featureIdentifier", DeviceHID.service)
    xpc_dictionary_set_value(message, "payload", dictionary(payload))
    return message
  }
  func dictionary(_ values: [String: Any]) -> xpc_object_t {
    let made = xpc_dictionary_create(nil, nil, 0)
    for (key, value) in values {
      switch value {
      case let number as Double: xpc_dictionary_set_double(made, key, number)
      case let number as Int: xpc_dictionary_set_uint64(made, key, UInt64(number))
      case let number as UInt32: xpc_dictionary_set_uint64(made, key, UInt64(number))
      case let nested as [String: Any]: xpc_dictionary_set_value(made, key, dictionary(nested))
      default: break
      }
    }
    return made
  }
  func send(_ type: String, _ payload: [String: Any]) throws {
    guard let connection = try connect() else { throw Failure("This device has no input service.") }
    xpc_connection_send_message(connection, message(type, payload))
    let sent = DispatchSemaphore(value: 0)
    xpc_connection_send_barrier(connection) { sent.signal() }
    if sent.wait(timeout: .now() + 5) == .timedOut { throw Failure("The device didn’t take the input.") }
  }
  // A touch at a share of the screen: down starts a contact (or moves one already down), move moves it, up ends it.
  func touch(_ phase: String, x: Double, y: Double) throws {
    let type: Int
    switch phase {
    case "down": type = touching ? 1 : 0; touching = true
    case "up": type = 2; touching = false
    default: if !touching { type = 0; touching = true } else { type = 1 }
    }
    try send("IndigoDigitizerEvent", ["pointOne": ["x": x, "y": y], "eventType": type, "edge": 0, "target": 0])
  }
  func key(_ code: UInt32, down: Bool) throws { try send("IndigoKeyboardButtonEvent", ["usageCode": code, "state": down ? 1 : 2]) }
  func button(usage: Int, down: Bool) throws { try send("IndigoButtonEvent", ["usagePage": 0x0C, "usageCode": usage, "state": down ? 1 : 2]) }
}
let deviceHID = DeviceHID()

// Input: through dtuhidd where the device has it, otherwise through the same HID client older Simulator apps use.
final class Input {
  var client: NSObject?
  let queue = DispatchQueue(label: "hid")
  func connect() throws -> NSObject {
    if let client { return client }
    guard let hidClass, let made = (hidClass as? NSObject.Type)?.perform(NSSelectorFromString("alloc"))?.takeUnretainedValue() else { throw Failure("This Xcode’s SimulatorKit has no HID client.") }
    typealias Initialise = @convention(c) (AnyObject, Selector, AnyObject, UnsafeMutableRawPointer?) -> Unmanaged<NSObject>?
    let selector = NSSelectorFromString("initWithDevice:error:")
    guard let method = class_getInstanceMethod(hidClass, selector) else { throw Failure("This Xcode’s HID client can’t be started.") }
    guard let ready = unsafeBitCast(method_getImplementation(method), to: Initialise.self)(made, selector, device, nil)?.takeRetainedValue() else { throw Failure("Couldn’t connect to the device’s touch screen. Is it booted?") }
    client = ready
    return ready
  }
  // Sends one message and waits for the device to take it.
  func deliver(_ message: UnsafeMutableRawPointer?) throws {
    guard let message else { return }
    let hid = try connect()
    typealias Send = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer, ObjCBool, DispatchQueue, @escaping @convention(block) (NSError?) -> Void) -> Void
    let selector = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
    guard let method = class_getInstanceMethod(object_getClass(hid), selector) else { throw Failure("This Xcode’s HID client can’t send.") }
    let done = DispatchSemaphore(value: 0)
    final class Outcome { var error: NSError? }
    let outcome = Outcome()
    let finished: @convention(block) (NSError?) -> Void = { error in outcome.error = error; done.signal() }
    unsafeBitCast(method_getImplementation(method), to: Send.self)(hid, selector, message, true, queue, finished)
    if done.wait(timeout: .now() + 5) == .timedOut { throw Failure("The device didn’t take the input.") }
    if let failure = outcome.error { throw Failure(failure.localizedDescription) }
  }
  // NSEvent types: left mouse down 1, up 2, dragged 6. Touches are given in points, as a share of the screen.
  func touch(_ phase: String, _ point: CGPoint) throws {
    try screen.attach()
    let size = screen.points
    guard point.x >= 0, point.y >= 0, point.x <= size.width, point.y <= size.height else { throw Failure("(\(Int(point.x)), \(Int(point.y))) is off the screen, which is \(Int(size.width)) × \(Int(size.height)) points.") }
    if try deviceHID.connect() != nil { try deviceHID.touch(phase, x: Double(point.x / size.width), y: Double(point.y / size.height)); return }
    guard let mouseMessage else { throw Failure("This Xcode can’t send touches.") }
    var at = point
    let type: UInt = phase == "down" ? 1 : phase == "up" ? 2 : 6
    // The Simulator app aims touches at the screen they're on: its ID with the top bit set. Xcodes before displays had
    // IDs used 0x32 for the one touch screen.
    let target: UInt32 = screen.screenID == .max ? 0x32 : 0x4000_0000 | UInt32(truncatingIfNeeded: screen.screenID)
    try deliver(mouseMessage(&at, nil, target, type, size, 0))
  }
  func tap(_ point: CGPoint, hold: Double) throws {
    try touch("down", point); Thread.sleep(forTimeInterval: max(0.05, hold)); try touch("up", point)
  }
  func swipe(from: CGPoint, to: CGPoint, duration: Double) throws {
    let steps = max(4, Int(duration / 0.02))
    try touch("down", from)
    for step in 1...steps {
      Thread.sleep(forTimeInterval: duration / Double(steps))
      let t = CGFloat(step) / CGFloat(steps)
      try touch("move", CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
    }
    try touch("up", to)
  }
  func key(_ code: UInt32, down: Bool) throws {
    if try deviceHID.connect() != nil { try deviceHID.key(code, down: down); return }
    guard let keyMessage else { throw Failure("This Xcode can’t send keys.") }
    try deliver(keyMessage(code, down ? 1 : 2))
  }
  func chord(_ codes: [UInt32], modifiers: [UInt32]) throws {
    for code in modifiers { try key(code, down: true) }
    for code in codes { try key(code, down: true); Thread.sleep(forTimeInterval: 0.01); try key(code, down: false) }
    for code in modifiers.reversed() { try key(code, down: false) }
  }
  func type(_ text: String) throws {
    for character in text {
      guard let (code, shifted) = usage(for: character) else { throw Failure("“\(character)” can’t be typed as a key.") }
      try chord([code], modifiers: shifted ? [225] : [])
    }
  }
  // Hardware buttons: down then up, held for a moment for a long press.
  func button(_ name: String, hold: Double) throws {
    if try deviceHID.connect() != nil {
      // Consumer usages: Menu for Home, Power for the side button, Voice Command for Siri. Apple Pay is the side button
      // pressed twice.
      let usages = ["home": 0x40, "lock": 0x30, "side_button": 0x30, "siri": 0xCF, "apple_pay": 0x30]
      guard let usage = usages[name.lowercased()] else { throw Failure("Use one of these buttons: \(usages.keys.sorted().joined(separator: ", ")).") }
      for press in 0..<(name.lowercased() == "apple_pay" ? 2 : 1) {
        if press > 0 { Thread.sleep(forTimeInterval: 0.15) }
        try deviceHID.button(usage: usage, down: true); Thread.sleep(forTimeInterval: max(0.05, hold)); try deviceHID.button(usage: usage, down: false)
      }
      return
    }
    guard let buttonMessage else { throw Failure("This Xcode can’t press buttons.") }
    let codes: [String: UInt32] = ["home": 0x0, "lock": 0x1, "side_button": 0xbb8, "siri": 0x400002, "apple_pay": 0x1f4]
    guard let code = codes[name.lowercased()] else { throw Failure("Use one of these buttons: \(codes.keys.sorted().joined(separator: ", ")).") }
    try deliver(buttonMessage(code, 1, 0x33)); Thread.sleep(forTimeInterval: max(0.05, hold)); try deliver(buttonMessage(code, 2, 0x33))
  }
}
let input = Input()

// A US keyboard's HID usage for a character, and whether it needs Shift.
func usage(for character: Character) -> (UInt32, Bool)? {
  let plain = Array("abcdefghijklmnopqrstuvwxyz"), digits = Array("1234567890")
  if let index = plain.firstIndex(of: character) { return (UInt32(4 + index), false) }
  if let index = plain.firstIndex(of: Character(character.lowercased())), character.isUppercase { return (UInt32(4 + index), true) }
  if let index = digits.firstIndex(of: character) { return (UInt32(30 + index), false) }
  if let index = Array("!@#$%^&*()").firstIndex(of: character) { return (UInt32(30 + index), true) }
  let others: [Character: (UInt32, Bool)] = ["\n": (40, false), "\t": (43, false), " ": (44, false), "-": (45, false), "_": (45, true), "=": (46, false), "+": (46, true), "[": (47, false), "{": (47, true), "]": (48, false), "}": (48, true), "\\": (49, false), "|": (49, true), ";": (51, false), ":": (51, true), "'": (52, false), "\"": (52, true), "`": (53, false), "~": (53, true), ",": (54, false), "<": (54, true), ".": (55, false), ">": (55, true), "/": (56, false), "?": (56, true)]
  return others[character]
}

// Frames for the panel, only while it asks for them, and only when the screen has changed. A frame goes out as soon as
// the device draws one, at most fps a second; one drawn sooner waits for the gap, so the last frame of an animation
// always arrives. A slow poll catches a change the callbacks missed, and is all there is on Xcodes without them.
final class Frames {
  let queue = DispatchQueue(label: "frames")
  var timer: DispatchSourceTimer?
  var last: UInt32 = .max
  var on = false, waiting = false, sentAt = DispatchTime(uptimeNanoseconds: 0)
  var gap = 1.0 / 30, maxWidth: CGFloat = 480
  func start(fps: Double, maxWidth: CGFloat) {
    queue.sync {
      stopNow()
      on = true; gap = 1 / min(60, max(1, fps)); self.maxWidth = maxWidth
      screen.onFrame = { [weak self] in self?.queue.async { self?.drawn() } }
      let source = DispatchSource.makeTimerSource(queue: queue)
      source.schedule(deadline: .now(), repeating: screen.pushes ? 0.25 : gap)
      source.setEventHandler { [weak self] in self?.drawn() }
      timer = source
      source.resume()
    }
  }
  // On the frames queue: send now, or once the gap since the last frame has passed.
  func drawn() {
    guard on, !waiting else { return }
    let due = sentAt + gap
    if DispatchTime.now() >= due { emit() } else { waiting = true; queue.asyncAfter(deadline: due) { [weak self] in self?.waiting = false; self?.emit() } }
  }
  func emit() {
    guard on else { return }
    do {
      try screen.attach()
      let seed = screen.seed
      if seed == last { return }
      last = seed
      sentAt = .now()
      let (data, size) = try screen.image(maxWidth: maxWidth, quality: 0.6)
      send(["frame": data.base64EncodedString(), "width": size.width, "height": size.height, "points": [screen.points.width, screen.points.height]])
    } catch let failure as Failure { send(["frameError": failure.message]) } catch { send(["frameError": "\(error)"]) }
  }
  func stopNow() { timer?.cancel(); timer = nil; on = false; waiting = false; last = .max; screen.onFrame = nil }
  func stop() { queue.sync { stopNow() } }
}
let frames = Frames()

let number = { (value: Any?) -> CGFloat? in (value as? NSNumber).map { CGFloat($0.doubleValue) } }
func handle(_ request: [String: Any]) throws -> [String: Any] {
  let op = request["op"] as? String ?? ""
  let point = { (x: String, y: String) throws -> CGPoint in
    guard let px = number(request[x]), let py = number(request[y]) else { throw Failure("Give \(x) and \(y) in points.") }
    return CGPoint(x: px, y: py)
  }
  switch op {
  case "info":
    var info: [String: Any] = ["name": deviceName, "udid": udid.uuidString, "scale": scale]
    if (try? screen.attach()) != nil { info["points"] = [screen.points.width, screen.points.height]; info["pixels"] = [screen.pixels.width, screen.pixels.height] }
    return info
  case "screenshot":
    let png = (request["format"] as? String) == "png"
    let (data, size) = try screen.image(maxWidth: number(request["maxWidth"]) ?? 0, png: png, quality: 0.8)
    return ["image": data.base64EncodedString(), "mime": png ? "image/png" : "image/jpeg", "width": size.width, "height": size.height, "points": [screen.points.width, screen.points.height]]
  case "frames":
    if (request["on"] as? Bool) == false { frames.stop(); return [:] }
    frames.start(fps: Double(number(request["fps"]) ?? 60), maxWidth: number(request["maxWidth"]) ?? 480)
    // Someone's looking, so a touch may follow: reach the device's input service now rather than on the first touch,
    // which would otherwise wait for it (half a second, or more while it starts).
    work.async { _ = try? deviceHID.connect() }
    return [:]
  case "touch":
    try input.touch(request["phase"] as? String ?? "", try point("x", "y"))
    return [:]
  case "tap":
    try input.tap(try point("x", "y"), hold: Double(number(request["duration"]) ?? 0.08))
    return [:]
  case "swipe":
    try input.swipe(from: try point("x", "y"), to: try point("x2", "y2"), duration: Double(min(5, max(0.1, number(request["duration"]) ?? 0.3))))
    return [:]
  case "keys":
    let codes = (request["codes"] as? [NSNumber] ?? []).map { $0.uint32Value }, modifiers = (request["modifiers"] as? [NSNumber] ?? []).map { $0.uint32Value }
    try input.chord(codes, modifiers: modifiers)
    return [:]
  case "text":
    try input.type(request["text"] as? String ?? "")
    return [:]
  case "button":
    try input.button(request["name"] as? String ?? "", hold: Double(number(request["duration"]) ?? 0.1))
    return [:]
  default:
    throw Failure("Unknown request \(op).")
  }
}

// Requests run one at a time, in order, off the main thread so callbacks can arrive.
let work = DispatchQueue(label: "requests")
DispatchQueue.global().async {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { send(["error": "That request isn’t JSON."]); continue }
    let id = request["id"] ?? NSNull()
    work.sync {
      do { var reply = try handle(request); reply["id"] = id; reply["ok"] = true; send(reply) }
      catch let failure as Failure { send(["id": id, "error": failure.message]) }
      catch { send(["id": id, "error": "\(error)"]) }
    }
  }
  frames.stop()
  output.sync { fflush(stdout) }
  exit(0)
}
dispatchMain()
