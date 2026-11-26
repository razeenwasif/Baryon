import Foundation
import AppKit
import ScreenCaptureKit

func quizForegroundWindow(_ windows: [[String: Any]], pid: Int32?, display: CGRect?) -> [String: Any]? {
    // Safari can put a tiny layer-zero tooltip/utility window ahead of its
    // document. Keep front-to-back document order, skipping those surfaces.
    return windows.first { window in
        guard let pid = pid,
              (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              (window[kCGWindowIsOnscreen as String] as? Bool) != false,
              (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              frame.width >= 200, frame.height >= 120 else { return false }
        if let display = display {
            let visible = frame.intersection(display)
            return !visible.isNull && visible.width >= 100 && visible.height >= 80
        }
        return true
    }
}

func failure(_ code: Int, _ message: String) -> NSError {
    NSError(domain: "FairyCapture", code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

// A picture of one display with Fairy excluded, without hiding its window.
@available(macOS 14.0, *)
func takePicture(_ request: [String: Int]) async throws -> CGImage {
    guard let displayID = request["displayID"], let pid = request["excludePID"], pid > 0,
          let width = request["width"], let height = request["height"],
          width > 0, width <= 4096, height > 0, height <= 8192 else {
        throw failure(1, "Invalid screenshot request.")
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { Int($0.displayID) == displayID }) else {
        throw failure(2, "The selected display is no longer available.")
    }
    let excluded = content.applications.filter { Int($0.processID) == pid }
    // ScreenCaptureKit may already omit high-level overlay windows from
    // shareable content. An absent Fairy entry needs no additional exclusion.
    // keepWindow: one of Fairy's own windows to keep in the picture all the same, as when what was circled
    // or selected is on it.
    let kept = content.windows.filter { request["keepWindow"] != nil && Int($0.windowID) == request["keepWindow"] }
    var filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: kept)
    // Quiz fingerprints must see the document, never another app's
    // animated cursor halo, floating companion, or overlapping UI.
    if request["foregroundOnly"] == 1 {
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let front = quizForegroundWindow(windows, pid: NSWorkspace.shared.frontmostApplication?.processIdentifier, display: display.frame)
        if let id = (front?[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
           let window = content.windows.first(where: { $0.windowID == id }),
           Int(window.owningApplication?.processID ?? 0) != pid {
            filter = SCContentFilter(display: display, including: [window])
        }
    }
    let config = SCStreamConfiguration()
    config.width = width; config.height = height; config.showsCursor = false
    // Keep the display origin even for a single included window;
    // SCScreenshotManager otherwise tightens its capture to that window.
    config.sourceRect = CGRect(origin: .zero, size: display.frame.size)
    config.destinationRect = CGRect(x: 0, y: 0, width: width, height: height)
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}

func pngData(_ image: CGImage) throws -> Data {
    guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw failure(4, "Could not encode screenshot.")
    }
    return png
}

// Efficiency audit, fix 7: whether the screen has changed, from every pixel (each row's pixels, not its padding), so
// an unchanged screen costs no PNG and no copy to the app. Same pixels, same PNG, so reusing the last one is exact.
func pixelHash(_ image: CGImage) -> UInt64? {
    guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return nil }
    let rowBytes = image.width * image.bitsPerPixel / 8, stride = image.bytesPerRow, length = CFDataGetLength(data)
    var hash: UInt64 = 0xcbf29ce484222325
    for row in 0..<image.height {
        let start = row * stride
        if start + rowBytes > length { return nil }
        let line = UnsafeRawPointer(bytes + start)
        var i = 0
        while i + 8 <= rowBytes { hash = (hash ^ line.loadUnaligned(fromByteOffset: i, as: UInt64.self)) &* 0x100000001b3; i += 8 }
        while i < rowBytes { hash = (hash ^ UInt64(line.load(fromByteOffset: i, as: UInt8.self))) &* 0x100000001b3; i += 1 }
    }
    return hash ^ UInt64(image.width) << 32 ^ UInt64(image.height)
}

func send(_ header: [String: Any], _ body: Data? = nil) {
    var data = (try? JSONSerialization.data(withJSONObject: header)) ?? Data("{}".utf8)
    data.append(0x0A)
    if let body = body { data.append(body) }
    FileHandle.standardOutput.write(data)
}

@main struct ScreenCapture {
    static func main() async {
        if CommandLine.arguments.contains("--serve") { await serve(); return }
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            // macOS sometimes never answers, and this must not outlive the app that asked.
            DispatchQueue.global().asyncAfter(deadline: .now() + 10) { exit(3) }
            let request = try JSONSerialization.jsonObject(with: input) as? [String: Int] ?? [:]
            if #available(macOS 14.0, *) {
                let image = try await takePicture(request)
                let result: [String: Any] = ["url": "data:image/png;base64," + (try pngData(image)).base64EncodedString(), "width": image.width, "height": image.height]
                FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
            } else {
                throw failure(5, "Visible desktop tasks require macOS 14 or later.")
            }
        } catch {
            FileHandle.standardError.write(Data(error.localizedDescription.utf8)); exit(1)
        }
    }

    // Efficiency audit, fix 7: one process for every capture. Requests come a line at a time, one at a time. Each answer
    // is a line of JSON: the picture's size and its length in bytes, followed by that many bytes of PNG; or, when nothing
    // on screen has changed since the last picture sent, unchanged with that picture's id; or an error. It ends when the
    // app closes its input.
    static func serve() async {
        var last: (id: Int, hash: UInt64)? = nil
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Int],
                  let id = request["id"] else { continue }
            // macOS sometimes never answers; the app starts a new helper when this one has gone.
            let watchdog = DispatchWorkItem { exit(3) }
            DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: watchdog)
            do {
                guard #available(macOS 14.0, *) else { throw failure(5, "Visible desktop tasks require macOS 14 or later.") }
                let image = try await takePicture(request)
                let hash = pixelHash(image)
                if request["force"] != 1, let hash = hash, let previous = last, previous.hash == hash {
                    send(["id": id, "unchanged": true, "sameAs": previous.id, "width": image.width, "height": image.height])
                } else {
                    let png = try pngData(image)
                    send(["id": id, "width": image.width, "height": image.height, "bytes": png.count], png)
                    last = hash.map { (id: id, hash: $0) }
                }
            } catch {
                send(["id": id, "error": error.localizedDescription])
            }
            watchdog.cancel()
        }
    }
}
