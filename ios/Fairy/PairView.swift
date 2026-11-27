import AVFoundation
import SwiftUI
import UIKit
import VisionKit

struct PairView: View {
    @Environment(LinkClient.self) private var link
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                EyeView(mood: working ? .thinking : .idle, size: 120)
                Text("Find me on your Mac").font(.system(size: 30, weight: .light)).foregroundStyle(Color.ink).padding(.top, 8)
                Text("I stay on your Mac. This app lets you reach me from anywhere, through Tailscale.").font(.subheadline).foregroundStyle(Color.dim).multilineTextAlignment(.center).padding(.top, 8)
                CodeScanner { take($0) }
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.hairline, lineWidth: 1))
                    .padding(.top, 20)
                if let problem { Text(problem).font(.footnote).foregroundStyle(Color.removed).multilineTextAlignment(.center).padding(.top, 10) }
                VStack(alignment: .leading, spacing: 10) {
                    PairStep(number: 1, words: "Turn on Tailscale on this iPhone and your Mac, on the same account.")
                    PairStep(number: 2, words: "On your Mac, open Baryon’s Settings and find Phone.")
                    PairStep(number: 3, words: "Choose Pair an iPhone, then point this camera at the code.")
                }
                .padding(.top, 16)
                Button("Paste the link instead") {
                    if let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines), let url = URL(string: text) { take(url) }
                    else { problem = "Copy the fairy:// link first, then try again." }
                }
                .font(.subheadline)
                .foregroundStyle(Color.dim)
                .frame(minHeight: 44)
                .padding(.top, 4)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .onOpenURL { take($0) }
    }

    private func take(_ url: URL) {
        guard !working else { return }
        working = true
        problem = nil
        Task {
            defer { working = false }
            do { try await link.pair(with: url) }
            catch is CancellationError {}
            catch let error as URLError where error.code == .cannotConnectToHost || error.code == .cannotFindHost || error.code == .timedOut || error.code == .notConnectedToInternet {
                problem = "Couldn’t reach your Mac. Check Tailscale is on, on both."
            } catch { problem = error.localizedDescription }
        }
    }
}

private struct PairStep: View {
    let number: Int
    let words: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(number)").font(.footnote).foregroundStyle(Color.ink).frame(width: 24, height: 24).background(Color.raised, in: Circle())
            Text(words).font(.subheadline).foregroundStyle(Color.soft).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

// The camera, reading only QR codes. The Simulator has none, and neither does a phone that hasn't allowed it,
// but the iPhone's own Camera app can still scan the code and open Fairy.
struct CodeScanner: View {
    let found: (URL) -> Void
    @State private var available = false

    var body: some View {
        ZStack {
            Color.black
            if available { ScannerRepresentable(found: found) }
            RoundedRectangle(cornerRadius: 14).strokeBorder(Color.ink, lineWidth: 3).frame(width: 188, height: 188).accessibilityHidden(true)
            if !available { Text("Use your iPhone’s Camera app to scan the code.").font(.footnote).foregroundStyle(Color.muted).multilineTextAlignment(.center).frame(width: 160) }
        }
        // Asked first, as the scanner reports itself unavailable until the camera is allowed.
        .task {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            available = DataScannerViewController.isSupported && DataScannerViewController.isAvailable
        }
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let found: (URL) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .accurate, recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: false)
        scanner.delegate = context.coordinator
        return scanner
    }
    // Scanning can only start once the view is on screen, which isn't yet true when it's made.
    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        guard !controller.isScanning else { return }
        Task { @MainActor in try? controller.startScanning() }
    }
    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (URL) -> Void
        private var last: (text: String, at: Date)?
        init(found: @escaping (URL) -> Void) { self.found = found }

        // A code can be seen before it's been read, so its contents may only arrive with a later update.
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) { read(items) }
        func dataScanner(_ scanner: DataScannerViewController, didUpdate items: [RecognizedItem], allItems: [RecognizedItem]) { read(items) }

        private func read(_ items: [RecognizedItem]) {
            for case .barcode(let code) in items {
                guard let text = code.payloadStringValue, text.hasPrefix("fairy://pair"), let url = URL(string: text) else { continue }
                // The same code stays in view, and each failed try uses up one of the Mac's few chances.
                if let last, last.text == text, Date.now.timeIntervalSince(last.at) < 5 { return }
                last = (text, .now)
                found(url)
                return
            }
        }
    }
}
