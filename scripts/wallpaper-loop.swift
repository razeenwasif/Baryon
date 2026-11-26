import AVFoundation
import CoreVideo
// Makes a long moving wallpaper from a short clean stretch at the start of a video, with macOS's own AVFoundation,
// so ffmpeg isn't needed. Only the video is written, without sound, as H.264 at 30 fps.
//
// A couple of seconds of footage can't simply repeat: cutting back to the start jumps, and playing it forward and
// back reads as a metronome. So over one PERIOD the playhead wanders through the clean stretch along a mix of three
// slow waves, turning at different points and speeds, and three soft ripples travel one way across the picture the
// whole time, so the motion never visibly reverses. Every wave completes a whole number of cycles per period, so the
// last frame runs straight into the first.
//
//   swiftc -O scripts/wallpaper-loop.swift -o /tmp/wallpaper-loop
//   /tmp/wallpaper-loop input.mp4 src/wallpapers/aurora-loop.mp4 2.0 24 2500000
//
// SECONDS 2.0, PERIOD 24 and BITRATE 2500000 made Aurora's from the first two seconds of Gemini's animation.
let args = CommandLine.arguments
guard args.count == 6, let seconds = Double(args[3]), let period = Double(args[4]), let bitrate = Int(args[5]) else {
  print("usage: wallpaper-loop input.mp4 output.mp4 SECONDS PERIOD BITRATE"); exit(1)
}
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2]), fps = 30.0
try? FileManager.default.removeItem(at: output)

// The playhead, from 0 (first clean frame) to 1 (last), over one period.
let playheadWaves: [(cycles: Double, size: Double, phase: Double)] = [(1, 1, 0), (2, 0.55, 1.3), (3, 0.3, 2.4)]
func rawPlayhead(_ t: Double) -> Double { playheadWaves.reduce(0) { $0 + $1.size * sin(2 * .pi * $1.cycles * t / period + $1.phase) } }
let samples = (0..<4000).map { rawPlayhead(Double($0) / 4000 * period) }
let low = samples.min()!, high = samples.max()!
// The loop starts where the playhead is on the first clean frame, so it opens on the picture it fades in over.
let start = Double(samples.firstIndex(of: low)!) / 4000 * period
func playhead(_ t: Double) -> Double { (rawPlayhead(t) - low) / (high - low) }

// Ripples across the picture: direction (degrees), wavelength and size as fractions of the width, cycles per period.
// Each pushes the picture sideways to its own direction of travel, like silk lifting as a wave passes under it.
let ripples: [(angle: Double, length: Double, size: Double, cycles: Double)] = [(35, 0.7, 0.0055, 2), (-20, 1.1, 0.007, 1), (80, 0.48, 0.0035, 3)]

let sem = DispatchSemaphore(value: 0)
Task {
  do {
    let asset = AVURLAsset(url: input)
    let track = try await asset.loadTracks(withMediaType: .video)[0]
    let size = try await track.load(.naturalSize), w = Int(size.width), h = Int(size.height)
    let sourceFps = Double(try await track.load(.nominalFrameRate))
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: seconds, preferredTimescale: 600))
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(out); reader.startReading()
    var frames: [[UInt8]] = []
    while let sample = out.copyNextSampleBuffer(), let buffer = CMSampleBufferGetImageBuffer(sample) {
      CVPixelBufferLockBaseAddress(buffer, .readOnly)
      let row = CVPixelBufferGetBytesPerRow(buffer), base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
      var data = [UInt8](repeating: 0, count: w * h * 4)
      for y in 0..<h { for x in 0..<(w * 4) { data[y * w * 4 + x] = base[y * row + x] } }
      CVPixelBufferUnlockBaseAddress(buffer, .readOnly)
      frames.append(data)
    }
    let last = Double(frames.count - 1)
    var fastest = 0.0
    for n in 1...Int(period * fps) { fastest = max(fastest, abs(playhead(Double(n) / fps) - playhead(Double(n - 1) / fps)) * last / sourceFps * fps) }
    print("read \(frames.count) frames at \(sourceFps) fps, \(w)x\(h); the playhead moves at most \(String(format: "%.2f", fastest))× the original speed")

    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitrate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60, AVVideoAllowFrameReorderingKey: false],
      AVVideoColorPropertiesKey: [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2, AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2, AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2]]
    let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    writerInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: writerInput, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
    writer.add(writerInput); writer.startWriting(); writer.startSession(atSourceTime: .zero)

    let count = Int((period * fps).rounded()), W = Double(w)
    let waves = ripples.map { r -> (kx: Double, ky: Double, px: Double, py: Double, size: Double, cycles: Double) in
      let a = r.angle * .pi / 180, k = 2 * .pi / (r.length * W)
      return (k * cos(a), k * sin(a), -sin(a), cos(a), r.size * W, r.cycles)
    }
    for n in 0..<count {
      let t = Double(n) / fps + start, position = playhead(t) * last
      let i = min(Int(position), frames.count - 1), j = min(i + 1, frames.count - 1), mix = Float(position - Double(i))
      let phases = waves.map { 2 * .pi * $0.cycles * t / period }
      while !writerInput.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
      var pixel: CVPixelBuffer?
      CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pixel)
      let buffer = pixel!
      CVPixelBufferLockBaseAddress(buffer, [])
      let row = CVPixelBufferGetBytesPerRow(buffer), base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
      let destination = UnsafeMutablePointer<UInt8>(base)
      frames[i].withUnsafeBufferPointer { p in frames[j].withUnsafeBufferPointer { q in
        DispatchQueue.concurrentPerform(iterations: h) { y in
          for x in 0..<w {
            // Where this pixel comes from once the ripples have pushed the picture about, sampled from both nearby frames.
            var sx = Double(x), sy = Double(y)
            for (k, wave) in waves.enumerated() {
              let push = wave.size * sin(wave.kx * Double(x) + wave.ky * Double(y) - phases[k])
              sx += push * wave.px; sy += push * wave.py
            }
            sx = min(max(sx, 0), W - 1.001); sy = min(max(sy, 0), Double(h) - 1.001)
            let x0 = Int(sx), y0 = Int(sy), fx = Float(sx - Double(x0)), fy = Float(sy - Double(y0))
            let a = (y0 * w + x0) * 4, b = a + 4, c = a + w * 4, d = c + 4
            for ch in 0..<4 {
              func at(_ f: UnsafeBufferPointer<UInt8>) -> Float {
                let top = Float(f[a + ch]) * (1 - fx) + Float(f[b + ch]) * fx, bottom = Float(f[c + ch]) * (1 - fx) + Float(f[d + ch]) * fx
                return top * (1 - fy) + bottom * fy
              }
              let value = mix < 0.002 ? at(p) : at(p) * (1 - mix) + at(q) * mix
              destination[y * row + x * 4 + ch] = UInt8(min(255, max(0, value.rounded())))
            }
          }
        }
      } }
      CVPixelBufferUnlockBaseAddress(buffer, [])
      adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: CMTimeScale(fps)))
    }
    writerInput.markAsFinished()
    await writer.finishWriting()
    print("wrote \(count) frames, \(period)s, status \(writer.status.rawValue) \(writer.error?.localizedDescription ?? "")")
  } catch { print("error:", error) }
  sem.signal()
}
sem.wait()
