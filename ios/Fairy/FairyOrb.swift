import Combine
import MetalKit
import SwiftUI

// Fairy's eye as a liquid orb: a glossy blue sphere drawn live on the GPU, its surface flowing in ridges, with her eye's
// rings floating in it in EyeView's colours and proportions. She looks around, follows a finger, ripples where she's
// touched and spins when dragged, and each mood changes how the liquid moves. Compiled on the phone like the Living
// Aurora, so building needs no Metal compiler. Not drawn while covered, in the background or in Low Power Mode, and
// held still with Reduce Motion. Where the phone can't draw it, the smooth eye stands in.
struct FairyOrb: View {
    var mood: EyeMood = .idle
    var size: CGFloat
    var paused = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    @State private var touch = OrbTouch()

    var body: some View {
        Group {
            if FairyOrbLayer.available {
                FairyOrbLayer(mood: mood, touch: touch, moving: !reduceMotion, paused: paused || lowPower || phase != .active)
                    .contentShape(Circle())
                    // Alongside any button she sits in, so a tap still does what it did.
                    .simultaneousGesture(DragGesture(minimumDistance: 0)
                        .onChanged { touch.moved(to: $0.location, in: size) }
                        .onEnded { touch.ended(at: $0.location, in: size) })
            } else {
                EyeView(mood: mood, size: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange).receive(on: DispatchQueue.main)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }
}

// A finger on the orb, in the shader's units (-1 to 1 across, up positive), kept until the next frame reads it.
@MainActor
final class OrbTouch {
    var aim: SIMD2<Float>?
    var ripples: [SIMD3<Float>] = []
    var push: Float = 0
    var poke: () -> Void = {}
    private var last: SIMD2<Float>?

    private func point(_ location: CGPoint, _ size: CGFloat) -> SIMD2<Float> {
        SIMD2(Float(location.x / size * 2 - 1), Float(1 - location.y / size * 2))
    }
    func moved(to location: CGPoint, in size: CGFloat) {
        let at = point(location, size)
        if let last { push += (at.x - last.x) * 7 } else { ripples.append(SIMD3(at.x, at.y, 0.22)) }
        last = at
        aim = at
        poke()
    }
    func ended(at location: CGPoint, in size: CGFloat) {
        let at = point(location, size)
        ripples.append(SIMD3(at.x, at.y, 0.1))
        last = nil
        aim = nil
        poke()
    }
}

struct FairyOrbLayer: UIViewRepresentable {
    var mood: EyeMood
    var touch: OrbTouch
    var moving: Bool
    var paused: Bool

    func makeUIView(context: Context) -> UIView { FairyOrbView.make(touch: touch) ?? UIView() }
    func updateUIView(_ view: UIView, context: Context) { (view as? FairyOrbView)?.update(mood: mood, moving: moving, paused: paused) }
    @MainActor static let available: Bool = FairyOrbView.pipeline != nil
}

final class FairyOrbView: MTKView, MTKViewDelegate {
    private struct Uniforms {
        var res: SIMD2<Float>; var time: Float; var phase: Float; var gaze: SIMD2<Float>; var spin: Float; var dim: Float
        var mood: SIMD4<Float>; var rip: (SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>)
    }
    @MainActor static let pipeline: (MTLDevice, MTLRenderPipelineState)? = {
        guard let device = MTLCreateSystemDefaultDevice(), let library = try? device.makeLibrary(source: shader, options: nil) else { return nil }
        let description = MTLRenderPipelineDescriptor()
        description.vertexFunction = library.makeFunction(name: "orb_vertex")
        description.fragmentFunction = library.makeFunction(name: "orb_fragment")
        description.colorAttachments[0].pixelFormat = .bgra8Unorm
        guard let state = try? device.makeRenderPipelineState(descriptor: description) else { return nil }
        return (device, state)
    }()

    // Per mood: how fast the liquid flows, how tight its ridges, how much she pulses, and how much of her eye shows.
    private static func shape(_ mood: EyeMood) -> SIMD4<Float> {
        switch mood {
        case .idle: SIMD4(0.55, 1, 0, 1)
        case .listening: SIMD4(0.85, 1.1, 0.35, 1)
        case .thinking: SIMD4(1.7, 1.45, 0, 0.3)
        case .speaking: SIMD4(1.05, 1.15, 1, 0.9)
        case .sleeping: SIMD4(0.22, 0.9, 0, 0.12)
        case .happy: SIMD4(0.9, 1.1, 0.6, 1)
        }
    }

    private let state: MTLRenderPipelineState
    private let queue: MTLCommandQueue
    private let touch: OrbTouch
    private var mood = EyeMood.idle, shape = SIMD4<Float>(0.55, 1, 0, 1), dim: Float = 0
    private var phase: Float = 0, spin: Float = 0, spinSpeed: Float = 0, gaze = SIMD2<Float>(0, 0)
    private var ripples = [SIMD4<Float>](repeating: SIMD4(0, 0, -9, 0), count: 4), nextRipple = 0
    private let start = CACurrentMediaTime()
    private var last = CACurrentMediaTime(), lastAuto = 0.0, moving = true, hold = false

    @MainActor static func make(touch: OrbTouch) -> FairyOrbView? {
        guard let (device, state) = pipeline, let queue = device.makeCommandQueue() else { return nil }
        return FairyOrbView(device: device, state: state, queue: queue, touch: touch)
    }
    @MainActor private init(device: MTLDevice, state: MTLRenderPipelineState, queue: MTLCommandQueue, touch: OrbTouch) {
        self.state = state
        self.queue = queue
        self.touch = touch
        super.init(frame: .zero, device: device)
        colorPixelFormat = .bgra8Unorm
        framebufferOnly = true
        isOpaque = false
        backgroundColor = .clear
        clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        preferredFramesPerSecond = 60
        // Two pixels a point keeps her rings crisp; a third would cost more than it shows.
        contentScaleFactor = 2
        isUserInteractionEnabled = false
        delegate = self
        touch.poke = { [weak self] in if self?.hold == true { self?.setNeedsDisplay() } }
    }
    required init(coder: NSCoder) { fatalError("Not used from a storyboard") }

    func update(mood: EyeMood, moving: Bool, paused: Bool) {
        self.mood = mood
        self.moving = moving
        hold = paused || !moving
        refresh()
    }
    // Off the screen, under a cover or a sheet that hides it, nothing is drawn.
    override func didMoveToWindow() {
        super.didMoveToWindow()
        refresh()
    }
    private func refresh() {
        let stop = hold || window == nil
        if isPaused != stop { isPaused = stop; enableSetNeedsDisplay = stop; last = CACurrentMediaTime() }
        // A small orb needs fewer frames to look smooth.
        preferredFramesPerSecond = bounds.width < 100 ? 30 : 60
        if stop && window != nil { setNeedsDisplay() }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        refresh()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
    func draw(in view: MTKView) {
        let now = CACurrentMediaTime(), dt = Float(min(0.05, now - last)), time = Float(now - start)
        last = now
        let target = Self.shape(mood)
        shape += (target - shape) * min(1, dt * 3)
        dim += ((mood == .sleeping ? 1 : 0) - dim) * min(1, dt * 2)
        if moving { phase += dt * shape.x }
        // She looks around by herself, glances up while she thinks, down while she's asleep, and at your finger.
        let t = Double(time)
        let wander: SIMD2<Float> = switch mood {
        case .thinking: SIMD2(Float(0.45 * sin(t * 0.7)), Float(0.4 + 0.1 * sin(t * 1.3)))
        case .sleeping: SIMD2(0, -0.35)
        default: SIMD2(Float(0.25 * sin(t * 0.37)), Float(0.15 * sin(t * 0.51)))
        }
        gaze += ((touch.aim ?? wander) - gaze) * min(1, dt * 6)
        for drop in touch.ripples { ripple(at: SIMD2(drop.x, drop.y), strength: drop.z, time: time) }
        touch.ripples.removeAll()
        spinSpeed += touch.push
        touch.push = 0
        spin += spinSpeed * dt
        spinSpeed *= pow(0.12, dt)
        if mood == .listening, moving, t - lastAuto > 0.55 {
            lastAuto = t
            ripple(at: SIMD2(Float.random(in: -0.3...0.3), Float.random(in: -0.3...0.3)), strength: 0.07, time: time)
        }
        guard let pass = currentRenderPassDescriptor, let drawable = currentDrawable, let buffer = queue.makeCommandBuffer(),
              let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        var uniforms = Uniforms(res: SIMD2(Float(drawableSize.width), Float(drawableSize.height)), time: time, phase: phase, gaze: gaze, spin: spin, dim: dim,
                                mood: shape, rip: (ripples[0], ripples[1], ripples[2], ripples[3]))
        encoder.setRenderPipelineState(state)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
    }
    private func ripple(at point: SIMD2<Float>, strength: Float, time: Float) {
        ripples[nextRipple] = SIMD4(point.x, point.y, time, strength)
        nextRipple = (nextRipple + 1) % 4
    }

    // A sphere lit like chrome in a studio, its normal pushed about by flowing ridges and by ripples from touches.
    // Her eye is drawn by the angle from where she's looking: from the outside in, a deep navy band, a white ring
    // shading to grey, lavender grey, blue, light blue and a blue pupil, with a white light on it.
    private static let shader = """
    #include <metal_stdlib>
    using namespace metal;
    struct Uniforms { float2 res; float time; float phase; float2 gaze; float spin; float dim; float4 mood; float4 rip[4]; };
    struct Out { float4 position [[position]]; };
    vertex Out orb_vertex(uint id [[vertex_id]]) {
        float2 corner = float2((id << 1) & 2, id & 2);
        Out out; out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0); return out;
    }
    float3x3 rotY(float a) { float c = cos(a), s = sin(a); return float3x3(float3(c, 0, -s), float3(0, 1, 0), float3(s, 0, c)); }
    float3x3 rotX(float a) { float c = cos(a), s = sin(a); return float3x3(float3(1, 0, 0), float3(0, c, s), float3(0, -s, c)); }
    float field(float3 p, float t) {
        float3 q = p;
        q += 0.35 * sin(q.yzx * 2.0 + float3(t * 0.6, t * 0.45, t * 0.5));
        q += 0.15 * sin(q.zxy * 3.7 - float3(t * 0.35, t * 0.7, t * 0.3));
        float r = length(q.xy + float2(0.35 * sin(t * 0.27), 0.3 * cos(t * 0.33)));
        float r2 = length(q.yz - float2(0.4 * cos(t * 0.21), 0.2));
        return 0.6 * sin(r * 15.0 - t * 1.2 + q.z * 2.0) + 0.35 * sin(r2 * 11.0 + t * 0.8);
    }
    float3 studio(float3 d) {
        float top = smoothstep(0.35, 0.95, d.y);
        float key = smoothstep(0.8, 0.98, dot(d, normalize(float3(-0.6, 0.5, 0.6))));
        float side = smoothstep(0.75, 0.97, dot(d, normalize(float3(0.8, -0.1, 0.5))));
        float low = smoothstep(0.2, 0.9, -d.y);
        float3 sky = float3(0.72, 0.92, 1.0), dark = float3(0.06, 0.1, 0.4);
        return dark * 0.55 + sky * top * 0.75 + float3(1.0) * key * 1.25 + sky * side * 0.5 + dark * low * 0.25;
    }
    float3 tint(float f) {
        float w1 = 0.5 + 0.5 * cos(6.28318 * f), w2 = 0.5 + 0.5 * cos(6.28318 * (f - 0.333)), w3 = 0.5 + 0.5 * cos(6.28318 * (f - 0.667));
        return (float3(0.1, 0.2, 0.85) * w1 + float3(0.24, 0.36, 0.93) * w2 + float3(0.5, 0.94, 1.0) * w3) / (w1 + w2 + w3);
    }
    fragment float4 orb_fragment(Out in [[stage_in]], constant Uniforms& u [[buffer(0)]]) {
        float2 uv = (float2(in.position.x, u.res.y - in.position.y) * 2.0 - u.res) / u.res.y;
        float ang = atan2(uv.y, uv.x);
        float R = 0.84 + 0.006 * sin(ang * 3.0 + u.phase * 1.3) + 0.004 * sin(ang * 5.0 - u.phase * 0.9) + u.mood.z * 0.014 * sin(u.time * 9.0);
        float r = length(uv) / R;
        float body = 1.0 - smoothstep(0.988, 1.0, r);
        float3 n = float3(uv / R, sqrt(max(0.0, 1.0 - min(r * r, 1.0))));
        float3 p = rotY(u.spin + u.phase * 0.18) * rotX(0.35 * sin(u.phase * 0.21)) * n;
        float rip = 0.0;
        for (int i = 0; i < 4; i++) {
            float4 q = u.rip[i]; float age = u.time - q.z;
            if (age > 0.0 && age < 3.0) { float d = length(uv - q.xy); rip += q.w * sin(d * 24.0 - age * 9.0) * exp(-age * 1.4) * exp(-d * 2.2); }
        }
        float h = field(p * u.mood.y, u.phase) + rip * 4.0;
        float2 g = float2(dfdx(h), -dfdy(h)) * u.res.y * 0.03 * (1.0 - smoothstep(0.9, 1.0, r));
        float3 nn = normalize(n + float3(-g, 0.0));
        float3 V = float3(0.0, 0.0, 1.0);
        float fres = pow(1.0 - max(dot(nn, V), 0.0), 2.0);
        float3 tn = tint(h * 0.22 + fres * 0.8 + nn.y * 0.3 + nn.x * 0.15);
        float3 L = normalize(float3(-0.45, 0.65, 0.65));
        float diff = max(dot(nn, L), 0.0);
        float spec = pow(max(dot(reflect(-L, nn), V), 0.0), 80.0);
        float3 env = studio(reflect(-V, nn));
        float3 col = tn * (0.38 + 0.42 * diff) + env * mix(float3(1.0), tn, 0.4) * 0.55 + fres * 0.3 * float3(0.55, 0.9, 1.0);
        float3 gz = normalize(float3(u.gaze * 0.5, 1.0));
        float c = dot(normalize(n + float3(-g * 0.03, 0.0)), gz);
        float aw = max(0.004, fwidth(c));
        float navy = smoothstep(0.683 - aw, 0.683 + aw, c), white = smoothstep(0.8 - aw, 0.8 + aw, c), lav = smoothstep(0.903 - aw, 0.903 + aw, c);
        float blu = smoothstep(0.944 - aw, 0.944 + aw, c), lblu = smoothstep(0.954 - aw, 0.954 + aw, c), pup = smoothstep(0.963 - aw, 0.963 + aw, c);
        float3 eye = mix(float3(0.086, 0.118, 0.573), float3(0.933, 0.937, 0.973) * (0.93 + 0.07 * nn.y), white);
        eye = mix(eye, float3(0.627, 0.663, 0.894), lav);
        eye = mix(eye, float3(0.227, 0.549, 0.91), blu);
        eye = mix(eye, float3(0.439, 0.714, 0.965), lblu);
        eye = mix(eye, mix(float3(0.13, 0.2, 0.78), tn, 0.3) * (0.8 + 0.4 * diff), pup);
        col = mix(col, eye * (0.78 + 0.3 * diff) + env * 0.1, navy * u.mood.w);
        float rim = smoothstep(0.9, 0.975, r) * (1.0 - smoothstep(0.975, 0.995, r));
        col = mix(col, float3(0.918, 0.941, 1.0), rim * 0.55);
        col += spec * 0.9;
        float glint = dot(n, normalize(gz + float3(0.1, -0.1, 0.0)));
        col = mix(col, float3(1.0), smoothstep(0.9944 - aw * 0.5, 0.9958 + aw * 0.5, glint) * u.mood.w);
        col *= 1.0 - 0.45 * u.dim;
        float halo = (1.0 - body) * exp(-max(r - 1.0, 0.0) * 9.0) * 0.38 * (1.0 - smoothstep(1.05, 1.18, r)) * (1.0 - 0.5 * u.dim);
        return float4(col * body + float3(0.24, 0.42, 1.0) * halo, body + halo);
    }
    """
}
