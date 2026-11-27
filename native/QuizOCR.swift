import Foundation
import AppKit
import Vision
import ImageIO
import CryptoKit
import Darwin

func output(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(data + Data([10])) }
}
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
func recognize(_ input: Data) throws -> [String: Any] {
    guard input.count <= 32 * 1024 * 1024,
          let payload = try JSONSerialization.jsonObject(with: input) as? [String: Any] else {
        throw NSError(domain: "QuizOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid quiz snapshot"])
    }
    return try recognizePayload(payload, rawBytes: nil, decodedImage: nil, saveFrame: nil)
}

final class FrameCache {
    var token: String?
    var image: CGImage?
    var seq: UInt64 = 0
    func store(_ img: CGImage) -> String {
        seq &+= 1
        let t = "f\(seq)"
        token = t
        image = img
        return t
    }
    func get(_ wanted: String?) -> CGImage? {
        guard let wanted, wanted == token else { return nil }
        return image
    }
    func clear() {
        token = nil
        image = nil
    }
}

func decodeCGImage(from data: Data) throws -> CGImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary),
          image.width <= 16384, image.height <= 16384 else {
        throw NSError(domain: "QuizOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid quiz snapshot"])
    }
    CGImageSourceRemoveCacheAtIndex(source, 0)
    return image
}

func encodePNG(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    if let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) {
        CGImageDestinationAddImage(dest, image, nil)
        if CGImageDestinationFinalize(dest) { return data as Data }
    }
    if let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
        return png
    }
    throw NSError(domain: "QuizOCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not encode cropped quiz image"])
}

func recognizePayload(_ payload: [String: Any], rawBytes: Data?, decodedImage: CGImage?, saveFrame: FrameCache?) throws -> [String: Any] {
    let started=Date()
    let image: CGImage
    let rawDataForFallback: Data
    if let pre = decodedImage {
        image = pre
        rawDataForFallback = rawBytes ?? Data()
    } else if let rawBytes {
        image = try decodeCGImage(from: rawBytes)
        rawDataForFallback = rawBytes
    } else if let encoded = payload["image"] as? String, let data = Data(base64Encoded: encoded) {
        image = try decodeCGImage(from: data)
        rawDataForFallback = data
    } else {
        throw NSError(domain: "QuizOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid quiz snapshot"])
    }
    let decodedAt=Date()
    let app = NSWorkspace.shared.frontmostApplication
    // Stage Manager thumbnails and other apps must not change this question's key.
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let displayValues = payload["display"] as? [String: Double]
    let displayFrame = displayValues.flatMap { d -> CGRect? in
        guard let w = d["width"], let h = d["height"], w > 0, h > 0 else { return nil }
        return CGRect(x: d["x"] ?? 0, y: d["y"] ?? 0, width: w, height: h)
    }
    // Screen ink asks Fairy's windows to be skipped: then the front window is the topmost ordinary window of any
    // other app, so the window being read is found even while Fairy's floating box has the focus.
    let skip = (payload["skipPID"] as? NSNumber)?.int32Value
    let front = skip == nil ? quizForegroundWindow(windows, pid: app?.processIdentifier, display: displayFrame) : windows.first { window in
        guard let owner = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, owner != skip,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              frame.width >= 200, frame.height >= 120 else { return false }
        guard let display = displayFrame else { return true }
        let visible = frame.intersection(display)
        return !visible.isNull && visible.width >= 100 && visible.height >= 80
    }
    var region = CGRect(x: 0, y: 0, width: 1, height: 1)
    if front == nil { region = .zero }
    if let display = payload["display"] as? [String: Double],
       let width = display["width"], let height = display["height"], width > 0, height > 0,
       let front = front,
       let bounds = front[kCGWindowBounds as String] as? [String: Any],
       let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary) {
        region = CGRect(x: (Double(frame.minX) - (display["x"] ?? 0)) / width, y: (Double(frame.minY) - (display["y"] ?? 0)) / height, width: Double(frame.width) / width, height: Double(frame.height) / height).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
    let excluded = payload["exclude"] as? [[String: Double]] ?? []
    // Compare exact pixels inside the current foreground window before running
    // Vision. Source identity is included, so identical-looking windows cannot
    // reuse each other's OCR. Cursor-free capture already excludes Fairy.
    let crop = region.isNull ? ["x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0] : ["x": Double(region.minX), "y": Double(region.minY), "width": Double(region.width), "height": Double(region.height)]
    let scope: [String: Any] = ["app": app?.bundleIdentifier ?? "", "pid": app?.processIdentifier ?? 0,
        "windowId": (front?[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0,
        "windowTitle": String((front?[kCGWindowName as String] as? String ?? "").prefix(300)),
        "region": crop, "excluded": excluded, "width": image.width, "height": image.height]
    var digest = SHA256()
    digest.update(data: try JSONSerialization.data(withJSONObject:scope,options:.sortedKeys))
    if !region.isNull && !region.isEmpty,
       let pixels = image.cropping(to:CGRect(x:region.minX*CGFloat(image.width),y:region.minY*CGFloat(image.height),width:region.width*CGFloat(image.width),height:region.height*CGFloat(image.height))),
       pixels.width*pixels.height <= 20_000_000,
       let bitmap = CGContext(data:nil,width:pixels.width,height:pixels.height,bitsPerComponent:8,bytesPerRow:pixels.width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue),
       let bytes = bitmap.data {
        bitmap.draw(pixels,in:CGRect(x:0,y:0,width:pixels.width,height:pixels.height))
        // Match the existing OCR exclusion rectangles, including Fairy's overlay.
        // Source geometry/exclusions are part of the digest, so moving a mask
        // still forces fresh recognition of newly revealed content.
        let masks=excluded + [["x":0,"y":0,"width":1,"height":0.04],["x":0,"y":0.94,"width":0.22,"height":0.06]]
        for mask in masks {
            let rect=CGRect(x:mask["x"] ?? 2,y:mask["y"] ?? 2,width:mask["width"] ?? 0,height:mask["height"] ?? 0).intersection(region)
            if rect.isNull || rect.isEmpty { continue }
            let x0=max(0,Int(floor((rect.minX-region.minX)*CGFloat(image.width)))),x1=min(pixels.width,Int(ceil((rect.maxX-region.minX)*CGFloat(image.width))))
            let y0=max(0,Int(floor((rect.minY-region.minY)*CGFloat(image.height)))),y1=min(pixels.height,Int(ceil((rect.maxY-region.minY)*CGFloat(image.height))))
            if x1>x0 && y1>y0 { for row in y0..<y1 { memset(bytes.advanced(by:(row*pixels.width+x0)*4),0,(x1-x0)*4) } }
        }
        digest.update(data:Data(bytesNoCopy:bytes,count:pixels.width*pixels.height*4,deallocator:.none))
    } else { digest.update(data:rawDataForFallback) }
    let visualKey = digest.finalize().map { String(format:"%02x",$0) }.joined()
    let frameToken = saveFrame?.store(image)
    if payload["previousVisualKey"] as? String == visualKey {
        var res: [String: Any] = ["unchanged":true,"visualKey":visualKey,"timings":["visionMs":0,"probeMs":Date().timeIntervalSince(started)*1000]]
        if let frameToken { res["frameToken"] = frameToken }
        return res
    }
    let contextAt=Date()
    let fast = payload["fast"] as? Bool ?? false
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = !fast
    if fast { request.usesCPUOnly = true }
    // Vision coordinates are bottom-up. Limit recognition itself, not only its results.
    // Vision reports boxes relative to this region; map them back before filtering.
    if !region.isNull && !region.isEmpty {
        request.regionOfInterest = CGRect(x: region.minX, y: 1-region.maxY, width: region.width, height: region.height)
    }
    if !region.isNull && !region.isEmpty { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) }
    let recognizedAt=Date()
    let lines: [[String: Any]] = (request.results ?? []).prefix(600).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.35 else { return nil }
        let local = observation.boundingBox
        let b = CGRect(x: region.minX + local.minX * region.width,
                       y: 1 - region.maxY + local.minY * region.height,
                       width: local.width * region.width, height: local.height * region.height)
        let x = b.midX, y = 1 - b.midY
        if !region.contains(CGPoint(x: x, y: y)) { return nil }
        // Ignore app chrome and the hint itself, plus Fairy's own window.
        if y < 0.04 || (x < 0.22 && y > 0.94) { return nil }
        if excluded.contains(where: { x >= ($0["x"] ?? 2) && x <= ($0["x"] ?? 2) + ($0["width"] ?? 0) && y >= ($0["y"] ?? 2) && y <= ($0["y"] ?? 2) + ($0["height"] ?? 0) }) { return nil }
        return ["text": String(candidate.string.prefix(1200)), "x": Double(b.minX), "y": Double(1 - b.maxY), "width": Double(b.width), "height": Double(b.height)]
    }
    let sorted = lines.sorted { ($0["y"] as! Double) == ($1["y"] as! Double) ? ($0["x"] as! Double) < ($1["x"] as! Double) : ($0["y"] as! Double) < ($1["y"] as! Double) }
    var textBudget = 24000
    let bounded = sorted.prefix(400).filter { line in
        let count = (line["text"] as? String ?? "").count + 1
        guard count <= textBudget else { return false }
        textBudget -= count; return true
    }

    var out: [String: Any] = ["visualKey":visualKey,"timings": ["decodeMs": decodedAt.timeIntervalSince(started)*1000,"contextMs":contextAt.timeIntervalSince(decodedAt)*1000,"visionMs":recognizedAt.timeIntervalSince(contextAt)*1000], "text": String(bounded.compactMap { $0["text"] as? String }.joined(separator: "\n").prefix(24000)), "app": app?.bundleIdentifier ?? "", "pid": app?.processIdentifier ?? 0, "windowId": (front?[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0, "windowTitle": String((front?[kCGWindowName as String] as? String ?? "").prefix(300)), "owner": String((front?[kCGWindowOwnerName as String] as? String ?? "").prefix(80)), "lines": bounded, "region": crop]
    if let frameToken { out["frameToken"] = frameToken }
    return out
}

// Efficiency audit, fix 8B: run scrollEvidence, questionPixels and blankMarginBounds on one native BGRA bitmap
// and encode the single final PNG crop right here instead of copying 100+ MB of bitmaps into Electron's JS heap.
func hexString<D: Sequence>(_ bytes: D) -> String where D.Element == UInt8 {
    let digits: [UInt8] = Array("0123456789abcdef".utf8)
    var out = [UInt8]()
    out.reserveCapacity(64)
    for b in bytes {
        out.append(digits[Int(b >> 4)])
        out.append(digits[Int(b & 0x0F)])
    }
    return String(bytes: out, encoding: .utf8)!
}

func swiftScrollEvidence(_ ptr: UnsafePointer<UInt8>, width: Int, height: Int, top: Int, screenHeight: Int, ignore: [(from: Int, to: Int)]) -> [String: Any]? {
    guard width >= 80, height >= 1 else { return nil }
    let interiorBytes = (width - 64) * 4
    var rows = [String]()
    rows.reserveCapacity(height)
    var ignored = [Bool]()
    ignored.reserveCapacity(height)
    for y in 0..<height {
        let rowPtr = ptr.advanced(by: (y * width + 32) * 4)
        let b0 = rowPtr[0], b1 = rowPtr[1], b2 = rowPtr[2], b3 = rowPtr[3]
        var uniform = true
        var i = 4
        while i < interiorBytes {
            if rowPtr[i] != b0 || rowPtr[i + 1] != b1 || rowPtr[i + 2] != b2 || rowPtr[i + 3] != b3 {
                uniform = false
                break
            }
            i += 4
        }
        if uniform {
            rows.append("")
        } else {
            let digest = SHA256.hash(data: Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: rowPtr), count: interiorBytes, deallocator: .none))
            rows.append(String(hexString(digest).prefix(32)))
        }
        ignored.append(ignore.contains(where: { y >= $0.from && y < $0.to }))
    }
    return ["rows": rows, "width": width, "top": top, "screenHeight": screenHeight, "ignored": ignored]
}

func swiftQuestionPixels(_ ptr: UnsafePointer<UInt8>, width: Int, height: Int, rect: (x: Int, y: Int, width: Int, height: Int), blanks: [(x0: Int, x1: Int, y0: Int, y1: Int)]) -> String? {
    guard rect.x >= 0, rect.y >= 0, rect.width > 0, rect.height >= 20, rect.x + rect.width <= width, rect.y + rect.height <= height else { return nil }
    let edge = rect.x, cx = rect.x, cy = rect.y, cw = rect.width, ch = rect.height
    var digest = SHA256()
    digest.update(data: Data("{\"x\":\(cx),\"y\":\(cy),\"width\":\(cw),\"height\":\(ch)}".utf8))
    let rowBytes = cw * 4
    var scratch = [UInt8](repeating: 0, count: rowBytes)
    for row in cy..<(cy + ch) {
        let src = ptr.advanced(by: (row * width + edge) * 4)
        let crossing = blanks.filter { row >= $0.y0 && row < $0.y1 }
        if crossing.isEmpty {
            digest.update(bufferPointer: UnsafeRawBufferPointer(start: src, count: rowBytes))
        } else {
            scratch.withUnsafeMutableBytes { dst in
                memcpy(dst.baseAddress!, src, rowBytes)
                for b in crossing {
                    let from = max(b.x0, edge) - edge
                    let to = min(b.x1, width - edge) - edge
                    if to > from { memset(dst.baseAddress!.advanced(by: from * 4), 0, (to - from) * 4) }
                }
            }
            scratch.withUnsafeBytes { digest.update(bufferPointer: $0) }
        }
    }
    return hexString(digest.finalize())
}

func swiftBlankMarginBounds(_ ptr: UnsafePointer<UInt8>, stride: Int, offsetX: Int, offsetY: Int, width: Int, height: Int, padding: Int = 12) -> (x: Int, y: Int, width: Int, height: Int)? {
    guard width >= 1, height >= 1 else { return nil }
    let first = (offsetY * stride + offsetX) * 4
    let b0 = ptr[first], b1 = ptr[first + 1], b2 = ptr[first + 2], b3 = ptr[first + 3]
    if b3 != 255 || min(b0, min(b1, b2)) < 240 { return nil }
    @inline(__always) func isBlank(_ x: Int, _ y: Int) -> Bool {
        let idx = ((offsetY + y) * stride + offsetX + x) * 4
        return ptr[idx] == b0 && ptr[idx + 1] == b1 && ptr[idx + 2] == b2 && ptr[idx + 3] == b3
    }
    func isBlankRow(_ y: Int) -> Bool {
        for x in 0..<width where !isBlank(x, y) { return false }
        return true
    }
    var top = 0
    while top < height && isBlankRow(top) { top += 1 }
    if top == height { return nil }
    var bottom = height - 1
    while bottom > top && isBlankRow(bottom) { bottom -= 1 }
    func isBlankCol(_ x: Int) -> Bool {
        for y in top...bottom where !isBlank(x, y) { return false }
        return true
    }
    var left = 0
    while left < width - 1 && isBlankCol(left) { left += 1 }
    var right = width - 1
    while right > left && isBlankCol(right) { right -= 1 }
    let x = max(0, left - padding), y = max(0, top - padding)
    let w = min(width, right + padding + 1) - x, h = min(height, bottom + padding + 1) - y
    return Double(w * h) < Double(width * height) * 0.95 ? (x, y, w, h) : nil
}

func handleCrop(_ payload: [String: Any], rawBytes: Data?, frameCache: FrameCache) throws -> ([String: Any], Data?) {
    let image: CGImage
    if let cached = frameCache.get(payload["frameToken"] as? String) {
        image = cached
    } else if let rawBytes {
        image = try decodeCGImage(from: rawBytes)
        _ = frameCache.store(image)
    } else if let encoded = payload["image"] as? String, let data = Data(base64Encoded: encoded) {
        image = try decodeCGImage(from: data)
        _ = frameCache.store(image)
    } else {
        return (["miss": true], nil)
    }
    guard let reg = payload["region"] as? [String: Any],
          let rx = (reg["x"] as? NSNumber)?.intValue,
          let ry = (reg["y"] as? NSNumber)?.intValue,
          let rw = (reg["width"] as? NSNumber)?.intValue,
          let rh = (reg["height"] as? NSNumber)?.intValue,
          rx >= 0, ry >= 0, rw > 0, rh > 0,
          rx + rw <= image.width, ry + rh <= image.height,
          rw * rh <= 20_000_000 else {
        throw NSError(domain: "QuizOCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid crop region"])
    }
    guard let area = image.cropping(to: CGRect(x: rx, y: ry, width: rw, height: rh)),
          let colorSpace = (image.colorSpace?.model == .rgb ? image.colorSpace : nil) ?? CGColorSpaceCreateDeviceRGB() as CGColorSpace?,
          let bitmap = CGContext(data: nil, width: rw, height: rh, bitsPerComponent: 8, bytesPerRow: rw * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
          let rawBase = bitmap.data else {
        throw NSError(domain: "QuizOCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not allocate crop bitmap"])
    }
    bitmap.interpolationQuality = .none
    bitmap.setBlendMode(.copy)
    bitmap.draw(area, in: CGRect(x: 0, y: 0, width: rw, height: rh))
    let ptr = rawBase.assumingMemoryBound(to: UInt8.self)

    let screenHeight = (payload["screenHeight"] as? NSNumber)?.intValue ?? image.height
    let scrollIgnoreRaw = payload["scrollIgnore"] as? [[String: Any]] ?? []
    let scrollIgnore: [(from: Int, to: Int)] = scrollIgnoreRaw.compactMap {
        guard let from = ($0["from"] as? NSNumber)?.intValue, let to = ($0["to"] as? NSNumber)?.intValue else { return nil }
        return (from, to)
    }
    let scroll = swiftScrollEvidence(ptr, width: rw, height: rh, top: ry, screenHeight: screenHeight, ignore: scrollIgnore)

    var contentRect: (x: Int, y: Int, width: Int, height: Int)? = nil
    if let cr = payload["contentRect"] as? [String: Any],
       let cx = (cr["x"] as? NSNumber)?.intValue,
       let cy = (cr["y"] as? NSNumber)?.intValue,
       let cw = (cr["width"] as? NSNumber)?.intValue,
       let ch = (cr["height"] as? NSNumber)?.intValue {
        contentRect = (cx, cy, cw, ch)
    }
    let excludeRaw = payload["exclude"] as? [[String: Any]] ?? []
    let blanks: [(x0: Int, x1: Int, y0: Int, y1: Int)] = excludeRaw.compactMap {
        guard let x0 = ($0["x0"] as? NSNumber)?.intValue, let x1 = ($0["x1"] as? NSNumber)?.intValue,
              let y0 = ($0["y0"] as? NSNumber)?.intValue, let y1 = ($0["y1"] as? NSNumber)?.intValue else { return nil }
        return (x0, x1, y0, y1)
    }
    let visualKey = contentRect.flatMap { swiftQuestionPixels(ptr, width: rw, height: rh, rect: $0, blanks: blanks) }
    let inner = (visualKey != nil ? contentRect : nil) ?? (x: 0, y: 0, width: rw, height: rh)
    let padding = (payload["padding"] as? NSNumber)?.intValue ?? 12
    let margins = swiftBlankMarginBounds(ptr, stride: rw, offsetX: inner.x, offsetY: inner.y, width: inner.width, height: inner.height, padding: padding)
    let trim = margins ?? (x: 0, y: 0, width: inner.width, height: inner.height)
    let finalCrop: [String: Int] = ["x": rx + inner.x + trim.x, "y": ry + inner.y + trim.y, "width": trim.width, "height": trim.height]
    guard let cropped = image.cropping(to: CGRect(x: finalCrop["x"]!, y: finalCrop["y"]!, width: finalCrop["width"]!, height: finalCrop["height"]!)) else {
        throw NSError(domain: "QuizOCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not crop quiz image"])
    }
    let png = try encodePNG(cropped)
    var header: [String: Any] = ["crop": finalCrop, "width": cropped.width, "height": cropped.height, "bytes": png.count]
    if let visualKey { header["visualKey"] = visualKey }
    header["scrollEvidence"] = scroll ?? NSNull()
    return (header, png)
}

func outputBinary(_ value: [String: Any], _ body: Data? = nil) {
    if var data = try? JSONSerialization.data(withJSONObject: value) {
        data.append(10)
        if let body { data.append(body) }
        FileHandle.standardOutput.write(data)
    }
}

// Bounded newline / length-prefixed binary protocol. Each request gets a fresh autorelease pool so Vision
// objects and decoded screenshots are released before the next frame arrives.
func residentBytes() -> UInt64 {
    var info=mach_task_basic_info(), count=mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let status=withUnsafeMutablePointer(to:&info) { pointer in
        pointer.withMemoryRebound(to:integer_t.self,capacity:Int(count)) { task_info(mach_task_self_,task_flavor_t(MACH_TASK_BASIC_INFO),$0,&count) }
    }
    return status == KERN_SUCCESS ? UInt64(info.resident_size) : 0
}
func respond(_ headerData: Data, rawBytes: Data? = nil, frameCache: FrameCache? = nil) {
    autoreleasepool {
        let payload = (try? JSONSerialization.jsonObject(with: headerData)) as? [String: Any]
        let id = payload?["id"]
        do {
            guard let payload else { throw NSError(domain: "QuizOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid quiz request"]) }
            let op = payload["op"] as? String
            if op == "crop", let frameCache {
                var (result, body) = try handleCrop(payload, rawBytes: rawBytes, frameCache: frameCache)
                result["id"] = id ?? NSNull()
                result["workerRSSBytes"] = residentBytes()
                outputBinary(result, body)
                return
            }
            if op == "clear", let frameCache {
                frameCache.clear()
                output(["ok": true, "id": id ?? NSNull(), "workerRSSBytes": residentBytes()])
                return
            }
            var result = try recognizePayload(payload, rawBytes: rawBytes, decodedImage: nil, saveFrame: frameCache)
            result["id"] = id ?? NSNull()
            result["workerRSSBytes"] = residentBytes()
            output(result)
        } catch {
            output(["error": "Local quiz text recognition failed.", "id": id ?? NSNull()])
        }
    }
}
if CommandLine.arguments.contains("--server") {
    var pending = Data()
    var frames = 0, reclaimedAt = 0
    var expectedBytes = 0
    var currentHeader: Data? = nil
    let frameCache = FrameCache()
    while autoreleasepool(invoking: { () -> Bool in
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { return false }
        pending.append(chunk)
        if pending.count > 48 * 1024 * 1024 { exit(1) }
        while true {
            if let header = currentHeader {
                if pending.count < expectedBytes { break }
                let body = Data(pending.prefix(expectedBytes))
                pending.removeFirst(expectedBytes)
                currentHeader = nil
                expectedBytes = 0
                respond(header, rawBytes: body, frameCache: frameCache)
                frames += 1
            } else if let end = pending.firstIndex(of: 10) {
                let line = Data(pending[..<end])
                pending.removeSubrange(...end)
                if line.isEmpty { continue }
                if let obj = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                   let n = obj["bytes"] as? Int, n > 0 {
                    if n > 32 * 1024 * 1024 { exit(1) }
                    currentHeader = line
                    expectedBytes = n
                } else {
                    respond(line, rawBytes: nil, frameCache: frameCache)
                    frames += 1
                }
            } else {
                break
            }
        }
        return true
    }) {
        // Return freed image/JSON pages to macOS instead of retaining a large
        // allocator high-water mark for the lifetime of continuous quiz mode.
        if frames - reclaimedAt >= 10 { malloc_zone_pressure_relief(nil, 0); reclaimedAt = frames }
    }
} else { respond(FileHandle.standardInput.readDataToEndOfFile()) }
