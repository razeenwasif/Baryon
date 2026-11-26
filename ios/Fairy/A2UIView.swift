@preconcurrency import AVKit
import SwiftUI
import UIKit

@MainActor
@Observable
final class A2UIAudioController {
    private var player: AVPlayer?
    private var endObserver: Any?
    var playing = false
    private var loadedURL: URL?

    func toggle(url: URL) {
        if playing {
            player?.pause()
            playing = false
            return
        }
        if loadedURL != url || player == nil {
            if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
            let item = AVPlayerItem(url: url)
            let p = AVPlayer(playerItem: item)
            player = p
            loadedURL = url
            endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.playing = false
                    self?.player?.seek(to: .zero)
                }
            }
        }
        player?.play()
        playing = true
    }

    func stop() {
        player?.pause()
        playing = false
    }
}

@MainActor
@Observable
final class A2UISurfaceState {
    var surface: A2UISurface
    var baseDataModel: [String: A2UIValue]
    var activeTabs: [String: Int] = [:]
    var openModalId: String? = nil
    var busyAction: String? = nil
    var errorText: String? = nil

    private var onDataChange: ((String, String, A2UIValue) -> Void)?
    private var onAction: ((String, String, String, [String: A2UIValue]) async -> Void)?

    init(
        surface: A2UISurface,
        onDataChange: ((String, String, A2UIValue) -> Void)? = nil,
        onAction: ((String, String, String, [String: A2UIValue]) async -> Void)? = nil
    ) {
        self.surface = surface
        self.baseDataModel = surface.dataModel
        self.onDataChange = onDataChange
        self.onAction = onAction
    }

    func sync(surface next: A2UISurface) {
        if next != surface {
            surface = next
        }
    }

    func updateHandlers(
        onDataChange: ((String, String, A2UIValue) -> Void)?,
        onAction: ((String, String, String, [String: A2UIValue]) async -> Void)?
    ) {
        self.onDataChange = onDataChange
        self.onAction = onAction
    }

    func read(_ value: A2UIValue?, scopeData: A2UIValue? = nil) -> A2UIValue? {
        a2uiResolveDynamic(value, dataModel: surface.dataModel, scopeData: scopeData)
    }

    func mutate(path propPath: String, value: A2UIValue, scopePath: String) {
        let full = a2uiResolvedPath(propPath, scopePath: scopePath)
        guard !full.isEmpty else { return }
        surface.dataModel = a2uiPointerSet(surface.dataModel, full, value)
        onDataChange?(surface.surfaceId, full, value)
    }

    func reset() {
        surface.dataModel = baseDataModel
        errorText = nil
        onDataChange?(surface.surfaceId, "/", .object(surface.dataModel))
    }

    func trigger(component: A2UIComponent, scopeData: A2UIValue? = nil) {
        let resolved = a2uiResolveActionContext(component, dataModel: surface.dataModel, scopeData: scopeData)
        if component["closeModal"]?.isTruthy == true {
            openModalId = nil
        }
        guard let onAction else { return }
        busyAction = component.id
        errorText = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            await onAction(surface.surfaceId, resolved.actionName, resolved.sourceComponentId, resolved.context)
            self.busyAction = nil
        }
    }

    func componentMap() -> [String: A2UIComponent] {
        var map: [String: A2UIComponent] = [:]
        map.reserveCapacity(surface.components.count)
        for comp in surface.components { map[comp.id] = comp }
        return map
    }
}

struct A2UISurfaceView: View {
    let surface: A2UISurface
    var embedded = false
    var onDataChange: ((String, String, A2UIValue) -> Void)? = nil
    var onAction: ((String, String, String, [String: A2UIValue]) async -> Void)? = nil

    @State private var state: A2UISurfaceState

    init(
        surface: A2UISurface,
        embedded: Bool = false,
        onDataChange: ((String, String, A2UIValue) -> Void)? = nil,
        onAction: ((String, String, String, [String: A2UIValue]) async -> Void)? = nil
    ) {
        self.surface = surface
        self.embedded = embedded
        self.onDataChange = onDataChange
        self.onAction = onAction
        _state = State(initialValue: A2UISurfaceState(surface: surface, onDataChange: onDataChange, onAction: onAction))
    }

    private var modalBinding: Binding<Bool> {
        Binding(
            get: { state.openModalId != nil },
            set: { shown in if !shown { state.openModalId = nil } }
        )
    }

    var body: some View {
        let components = state.componentMap()
        VStack(alignment: .leading, spacing: 12) {
            if !embedded {
                HStack(spacing: 8) {
                    Text(state.surface.title?.isEmpty == false ? state.surface.title! : "Interactive UI")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.ink)
                        .lineLimit(1)
                    Text("A2UI")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.working)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.accent.opacity(0.22), in: Capsule())
                    Spacer(minLength: 8)
                    Button {
                        state.reset()
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Color.muted)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.06), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Divider().overlay(Color.hairline)
            }

            A2UINodeView(
                id: state.surface.root,
                state: state,
                components: components,
                scopeData: nil,
                scopePath: "",
                depth: 0
            )

            if let errorText = state.errorText {
                Text(errorText).font(.caption).foregroundStyle(Color.removed)
            }
        }
        .padding(embedded ? 0 : 14)
        .background {
            if !embedded {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.card)
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            }
        }
        .onChange(of: surface) { _, next in
            state.sync(surface: next)
        }
        .onAppear {
            state.updateHandlers(onDataChange: onDataChange, onAction: onAction)
        }
        .sheet(isPresented: modalBinding) {
            if let modalId = state.openModalId {
                NavigationStack {
                    ScrollView {
                        A2UINodeView(
                            id: modalId,
                            state: state,
                            components: state.componentMap(),
                            scopeData: nil,
                            scopePath: "",
                            depth: 0
                        )
                        .padding(16)
                    }
                    .onWallpaper(0.55)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Close") { state.openModalId = nil }.foregroundStyle(Color.ink)
                        }
                    }
                }
                .preferredColorScheme(.dark)
            }
        }
    }
}

private struct A2UINodeView: View {
    let id: String
    let state: A2UISurfaceState
    let components: [String: A2UIComponent]
    let scopeData: A2UIValue?
    let scopePath: String
    let depth: Int

    var body: some View {
        if depth > A2UILimits.depth || id.isEmpty {
            EmptyView()
        } else if let comp = components[id] {
            render(comp)
        } else {
            EmptyView()
        }
    }

    private func render(_ comp: A2UIComponent) -> AnyView {
        switch comp.component {
        case "Column":
            let align = horizontalAlignment(comp["alignment"]?.stringValue)
            return AnyView(
                VStack(alignment: align, spacing: 10) {
                    ForEach(Array(comp.childrenIds.enumerated()), id: \.offset) { _, cid in
                        A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: Alignment(horizontal: align, vertical: .center))
            )

        case "Row":
            let align = verticalAlignment(comp["alignment"]?.stringValue)
            return AnyView(
                HStack(alignment: align, spacing: 10) {
                    ForEach(Array(comp.childrenIds.enumerated()), id: \.offset) { idx, cid in
                        A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                        if idx < comp.childrenIds.count - 1, comp["distribution"]?.stringValue == "spaceBetween" {
                            Spacer(minLength: 4)
                        }
                    }
                }
            )

        case "Card":
            return AnyView(
                VStack(alignment: .leading, spacing: 10) {
                    if let cid = comp.childId {
                        A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                    } else {
                        ForEach(Array(comp.childrenIds.enumerated()), id: \.offset) { _, cid in
                            A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            )

        case "List":
            let horizontal = comp["direction"]?.stringValue == "horizontal"
            if let tpl = comp.repeatTemplate {
                let rawArr = a2uiPointerGet(state.surface.dataModel, tpl.path, scopeData: scopeData)?.arrayValue ?? []
                let items = Array(rawArr.prefix(A2UILimits.listItems))
                let basePtr = a2uiResolvedPath(tpl.path, scopePath: scopePath)
                if items.isEmpty {
                    let emptyText = comp["emptyText"]?.stringValue ?? "No items"
                    return AnyView(Text(emptyText).font(.footnote).foregroundStyle(Color.muted).padding(.vertical, 4))
                }
                return AnyView(
                    Group {
                        if horizontal {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(alignment: .top, spacing: 10) {
                                    ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                                        A2UINodeView(id: tpl.componentId, state: state, components: components, scopeData: item, scopePath: "\(basePtr)/\(idx)", depth: depth + 1)
                                    }
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                                    A2UINodeView(id: tpl.componentId, state: state, components: components, scopeData: item, scopePath: "\(basePtr)/\(idx)", depth: depth + 1)
                                }
                            }
                        }
                    }
                )
            }
            return AnyView(
                Group {
                    if horizontal {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 10) {
                                ForEach(Array(comp.childrenIds.enumerated()), id: \.offset) { _, cid in
                                    A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                                }
                            }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(comp.childrenIds.enumerated()), id: \.offset) { _, cid in
                                A2UINodeView(id: cid, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                            }
                        }
                    }
                }
            )

        case "Tabs":
            return AnyView(A2UITabsView(comp: comp, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth))

        case "Modal":
            let contentId = comp["contentChild"]?.stringValue
            if let entryId = comp["entryPointChild"]?.stringValue {
                return AnyView(
                    Button {
                        if let contentId { state.openModalId = contentId }
                    } label: {
                        A2UINodeView(id: entryId, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                    }
                    .buttonStyle(.plain)
                )
            }
            return AnyView(
                Button("Open") {
                    if let contentId { state.openModalId = contentId }
                }
                .buttonStyle(PillButton())
            )

        case "Divider":
            return AnyView(Divider().overlay(Color.hairline).padding(.vertical, 2))

        case "Text":
            let textVal = state.read(comp["text"], scopeData: scopeData)?.displayString ?? ""
            let variant = (comp["variant"]?.stringValue ?? comp["usageHint"]?.stringValue ?? "body").lowercased()
            let attributed = (try? AttributedString(markdown: textVal, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(textVal)
            return AnyView(
                Text(attributed)
                    .font(fontForVariant(variant))
                    .foregroundStyle(colorForVariant(variant))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            )

        case "Image":
            let rawUrl = state.read(comp["url"] ?? comp["src"], scopeData: scopeData)?.displayString
            let fit: ContentMode = comp["fit"]?.stringValue == "contain" ? .fit : .fill
            if let imgData = a2uiSafeDataImageData(rawUrl), let uiImage = UIImage(data: imgData) {
                return AnyView(
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: fit)
                        .frame(maxWidth: .infinity, maxHeight: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel(comp["alt"]?.stringValue ?? "")
                )
            }
            if let url = a2uiSafeMediaURL(rawUrl) {
                return AnyView(
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().aspectRatio(contentMode: fit)
                        case .failure:
                            Color.well.overlay(Image(systemName: "photo").foregroundStyle(Color.muted))
                        default:
                            Color.well.overlay(ProgressView().tint(Color.working))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 80, maxHeight: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel(comp["alt"]?.stringValue ?? "")
                )
            }
            return AnyView(EmptyView())

        case "Icon":
            let name = state.read(comp["name"], scopeData: scopeData)?.stringValue ?? "sparkles"
            let size = CGFloat(comp["size"]?.coercedNumber ?? 18)
            return AnyView(
                Image(systemName: sfSymbol(for: name))
                    .font(.system(size: min(max(size, 12), 48), weight: .medium))
                    .foregroundStyle(Color.working)
            )

        case "Video":
            let rawUrl = state.read(comp["url"] ?? comp["src"], scopeData: scopeData)?.displayString
            if let url = a2uiSafeMediaURL(rawUrl), !(url.scheme?.lowercased() == "data") {
                return AnyView(A2UIVideoView(url: url))
            }
            return AnyView(EmptyView())

        case "AudioPlayer":
            let rawUrl = state.read(comp["url"] ?? comp["src"], scopeData: scopeData)?.displayString
            let desc = state.read(comp["description"] ?? comp["label"], scopeData: scopeData)?.displayString ?? "Audio"
            if let url = a2uiSafeMediaURL(rawUrl), !(url.scheme?.lowercased() == "data") {
                return AnyView(A2UIAudioView(url: url, label: desc))
            }
            return AnyView(EmptyView())

        case "Button":
            return AnyView(A2UIButtonView(comp: comp, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth))

        case "TextField":
            return AnyView(A2UITextFieldView(comp: comp, state: state, scopeData: scopeData, scopePath: scopePath))

        case "CheckBox", "Switch":
            return AnyView(A2UIToggleView(comp: comp, isSwitch: comp.component == "Switch", state: state, scopeData: scopeData, scopePath: scopePath))

        case "Slider":
            return AnyView(A2UISliderView(comp: comp, state: state, scopeData: scopeData, scopePath: scopePath))

        case "ChoicePicker":
            return AnyView(A2UIChoicePickerView(comp: comp, state: state, scopeData: scopeData, scopePath: scopePath))

        case "DateTimeInput":
            return AnyView(A2UIDateTimeView(comp: comp, state: state, scopeData: scopeData, scopePath: scopePath))

        case "Markdown":
            let md = state.read(comp["text"], scopeData: scopeData)?.displayString ?? ""
            return AnyView(MarkdownText(text: md, font: .subheadline, color: .soft))

        case "CodeBlock":
            return AnyView(A2UICodeBlockView(comp: comp, state: state, scopeData: scopeData))

        case "Math":
            let tex = state.read(comp["latex"] ?? comp["text"], scopeData: scopeData)?.displayString ?? ""
            return AnyView(
                Text(tex)
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(Color.ink)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: comp["display"]?.boolValue == false ? .leading : .center)
                    .background(Color.well, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
                    .textSelection(.enabled)
            )

        case "MetricTile":
            let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
            let value = state.read(comp["value"], scopeData: scopeData)?.displayString ?? "—"
            let delta = state.read(comp["delta"], scopeData: scopeData)?.displayString ?? ""
            let explicitTone = comp["tone"]?.stringValue
            let deltaColor: Color = {
                switch explicitTone {
                case "ok": return .added
                case "danger": return .removed
                case "warn": return .asking
                case "accent": return .working
                default:
                    if delta.trimmingCharacters(in: .whitespaces).hasPrefix("-") { return .removed }
                    if delta.trimmingCharacters(in: .whitespaces).hasPrefix("+") { return .added }
                    return .muted
                }
            }()
            return AnyView(
                VStack(alignment: .leading, spacing: 4) {
                    if !label.isEmpty {
                        Text(label).font(.caption).foregroundStyle(Color.muted)
                    }
                    Text(value.isEmpty ? "—" : value)
                        .font(.title3.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Color.ink)
                    if !delta.isEmpty {
                        Text(delta).font(.caption.weight(.medium)).foregroundStyle(deltaColor)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            )

        case "Sparkline":
            let vals = (state.read(comp["values"], scopeData: scopeData)?.arrayValue ?? []).compactMap(\.coercedNumber)
            let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
            return AnyView(A2UISparklineView(label: label, values: vals))

        case "Badge":
            let text = state.read(comp["label"] ?? comp["text"], scopeData: scopeData)?.displayString ?? ""
            let tone = comp["tone"]?.stringValue ?? "neutral"
            let (bg, fg): (Color, Color) = switch tone {
            case "accent": (Color.accent.opacity(0.24), Color.working)
            case "ok": (Color.added.opacity(0.18), Color.added)
            case "warn": (Color.asking.opacity(0.18), Color.asking)
            case "danger": (Color.removed.opacity(0.18), Color.removed)
            default: (Color.white.opacity(0.08), Color.dim)
            }
            return AnyView(
                Text(text)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(fg)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(bg, in: Capsule())
            )

        default:
            return AnyView(EmptyView())
        }
    }

    private func horizontalAlignment(_ name: String?) -> HorizontalAlignment {
        switch name?.lowercased() {
        case "center": return .center
        case "end", "trailing": return .trailing
        default: return .leading
        }
    }

    private func verticalAlignment(_ name: String?) -> VerticalAlignment {
        switch name?.lowercased() {
        case "start", "top": return .top
        case "end", "bottom": return .bottom
        default: return .center
        }
    }

    private func fontForVariant(_ variant: String) -> Font {
        switch variant {
        case "h1": return .title2.weight(.bold)
        case "h2": return .title3.weight(.semibold)
        case "h3": return .headline.weight(.semibold)
        case "h4", "h5": return .subheadline.weight(.semibold)
        case "caption": return .caption
        default: return .subheadline
        }
    }

    private func colorForVariant(_ variant: String) -> Color {
        switch variant {
        case "h1", "h2", "h3", "h4", "h5": return .ink
        case "caption": return .muted
        default: return .soft
        }
    }

    private func sfSymbol(for name: String) -> String {
        switch name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "check": return "checkmark"
        case "plus": return "plus"
        case "minus": return "minus"
        case "edit": return "pencil"
        case "trash": return "trash"
        case "search": return "magnifyingglass"
        case "calendar": return "calendar"
        case "mail": return "envelope"
        case "file": return "doc"
        case "folder": return "folder"
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "play": return "play.fill"
        case "pause": return "pause.fill"
        case "alert": return "exclamationmark.triangle"
        case "info": return "info.circle"
        case "star": return "star"
        case "clock": return "clock"
        case "settings": return "gearshape"
        case "arrow-right": return "arrow.right"
        case "refresh": return "arrow.clockwise"
        case "send": return "paperplane"
        case "download": return "arrow.down.circle"
        case "link": return "link"
        default: return "sparkles"
        }
    }
}

private struct A2UITabsView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let components: [String: A2UIComponent]
    let scopeData: A2UIValue?
    let scopePath: String
    let depth: Int

    var body: some View {
        let items = (comp["tabItems"]?.arrayValue ?? comp["tabs"]?.arrayValue ?? []).compactMap(\.objectValue)
        let selected = min(max(0, state.activeTabs[comp.id] ?? Int(comp["selectedIndex"]?.coercedNumber ?? 0)), max(0, items.count - 1))
        VStack(alignment: .leading, spacing: 10) {
            if !items.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                            let label = state.read(item["title"] ?? item["label"], scopeData: scopeData)?.displayString ?? "Tab \(idx + 1)"
                            Button(label) { state.activeTabs[comp.id] = idx }
                                .font(.caption.weight(.medium))
                                .foregroundStyle(selected == idx ? Color.ink : Color.muted)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(selected == idx ? Color.white.opacity(0.14) : .clear, in: Capsule())
                        }
                    }
                    .padding(3)
                    .background(Color.well, in: Capsule())
                }
                if let childId = items[selected]["child"]?.stringValue {
                    A2UINodeView(id: childId, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                }
            }
        }
    }
}

private struct A2UIButtonView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let components: [String: A2UIComponent]
    let scopeData: A2UIValue?
    let scopePath: String
    let depth: Int

    var body: some View {
        let variant = comp["variant"]?.stringValue ?? (comp["primary"]?.boolValue == true ? "primary" : "secondary")
        let labelText = state.read(comp["label"] ?? comp["text"], scopeData: scopeData)?.displayString ?? "Action"
        let disabled = state.read(comp["disabled"], scopeData: scopeData)?.isTruthy ?? false
        let (fill, ink): (Color, Color) = switch variant {
        case "primary": (.accent, .white)
        case "danger": (Color.removed.opacity(0.2), .removed)
        case "quiet": (Color.white.opacity(0.05), .soft)
        default: (.raised, .ink)
        }

        Button {
            state.trigger(component: comp, scopeData: scopeData)
        } label: {
            Group {
                if let childId = comp.childId {
                    A2UINodeView(id: childId, state: state, components: components, scopeData: scopeData, scopePath: scopePath, depth: depth + 1)
                } else {
                    HStack(spacing: 6) {
                        if state.busyAction == comp.id { ProgressView().controlSize(.small).tint(ink) }
                        Text(labelText.isEmpty ? "Action" : labelText)
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .foregroundStyle(ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(fill, in: Capsule())
            .overlay(Capsule().strokeBorder(variant == "primary" ? Color.clear : Color.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(disabled || state.busyAction == comp.id)
        .opacity(disabled ? 0.5 : 1)
    }
}

private struct A2UITextFieldView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    let scopePath: String

    var body: some View {
        let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
        let variant = (comp["variant"]?.stringValue ?? comp["textFieldType"]?.stringValue ?? "shorttext").lowercased()
        let path = (comp["value"] ?? comp["text"])?.bindingPath ?? ""
        let current = state.read(comp["value"] ?? comp["text"], scopeData: scopeData)?.displayString ?? ""
        let placeholder = comp["placeholder"]?.stringValue ?? ""

        let binding = Binding<String>(
            get: { current },
            set: { next in
                guard !path.isEmpty else { return }
                if variant == "number", !next.isEmpty, let num = Double(next) {
                    state.mutate(path: path, value: .number(num), scopePath: scopePath)
                } else {
                    state.mutate(path: path, value: .string(next), scopePath: scopePath)
                }
            }
        )

        VStack(alignment: .leading, spacing: 5) {
            if !label.isEmpty {
                Text(label).font(.caption.weight(.medium)).foregroundStyle(Color.dim)
            }
            Group {
                if variant == "obscured" || variant == "password" {
                    SecureField(placeholder, text: binding)
                } else if variant == "longtext" || variant == "multiline" {
                    TextField(placeholder, text: binding, axis: .vertical).lineLimit(3...6)
                } else {
                    TextField(placeholder, text: binding)
                        .keyboardType(variant == "number" ? .decimalPad : .default)
                }
            }
            .font(.subheadline)
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Color.well, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))

            if let helper = comp["helperText"]?.stringValue, !helper.isEmpty {
                Text(helper).font(.caption2).foregroundStyle(Color.muted)
            }
        }
    }
}

private struct A2UIToggleView: View {
    let comp: A2UIComponent
    let isSwitch: Bool
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    let scopePath: String

    var body: some View {
        let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
        let path = (comp["value"] ?? comp["checked"])?.bindingPath ?? ""
        let checked = state.read(comp["value"] ?? comp["checked"], scopeData: scopeData)?.isTruthy ?? false
        let binding = Binding<Bool>(
            get: { checked },
            set: { next in
                guard !path.isEmpty else { return }
                state.mutate(path: path, value: .bool(next), scopePath: scopePath)
            }
        )

        if isSwitch {
            Toggle(label, isOn: binding)
                .font(.subheadline)
                .foregroundStyle(Color.soft)
                .tint(Color.accent)
        } else {
            Button {
                binding.wrappedValue.toggle()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .font(.body)
                        .foregroundStyle(checked ? Color.accent : Color.muted)
                    Text(label)
                        .font(.subheadline)
                        .foregroundStyle(Color.soft)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

private struct A2UISliderView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    let scopePath: String

    var body: some View {
        let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
        let minVal = comp["min"]?.coercedNumber ?? comp["minValue"]?.coercedNumber ?? 0
        let maxVal = max(minVal + 0.0001, comp["max"]?.coercedNumber ?? comp["maxValue"]?.coercedNumber ?? 100)
        let step = comp["step"]?.coercedNumber
        let path = comp["value"]?.bindingPath ?? ""
        let raw = state.read(comp["value"], scopeData: scopeData)?.coercedNumber ?? minVal
        let current = min(max(raw, minVal), maxVal)

        let binding = Binding<Double>(
            get: { current },
            set: { next in
                guard !path.isEmpty else { return }
                state.mutate(path: path, value: .number(next), scopePath: scopePath)
            }
        )

        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption.weight(.medium)).foregroundStyle(Color.dim)
                Spacer()
                Text(A2UIValue.number(current).displayString)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Color.working)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.accent.opacity(0.18), in: Capsule())
            }
            if let step, step > 0 {
                Slider(value: binding, in: minVal...maxVal, step: step).tint(Color.accent)
            } else {
                Slider(value: binding, in: minVal...maxVal).tint(Color.accent)
            }
        }
    }
}

private struct A2UIChoicePickerView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    let scopePath: String

    private struct OptionItem: Identifiable {
        let id: String
        let label: String
        let value: A2UIValue
    }

    var body: some View {
        let options: [OptionItem] = (comp["options"]?.arrayValue ?? []).enumerated().map { idx, entry in
            if let s = entry.stringValue {
                return OptionItem(id: "\(idx)-\(s)", label: s, value: .string(s))
            }
            if let dict = entry.objectValue {
                let lbl = dict["label"]?.displayString ?? dict["value"]?.displayString ?? ""
                let val = dict["value"] ?? dict["label"] ?? .string(lbl)
                return OptionItem(id: "\(idx)-\(val.displayString)", label: lbl, value: val)
            }
            let txt = entry.displayString
            return OptionItem(id: "\(idx)-\(txt)", label: txt, value: entry)
        }
        let multi = comp["allowMultiple"]?.boolValue == true
            || Int(comp["maxAllowedSelections"]?.coercedNumber ?? 1) > 1
            || comp["selectionMode"]?.stringValue == "multiple"
        let variant = (comp["variant"]?.stringValue ?? (multi ? "chips" : options.count > 5 ? "dropdown" : "chips")).lowercased()
        let path = (comp["value"] ?? comp["selections"])?.bindingPath ?? ""
        let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
        let current = state.read(comp["value"] ?? comp["selections"], scopeData: scopeData)

        VStack(alignment: .leading, spacing: 6) {
            if !label.isEmpty {
                Text(label).font(.caption.weight(.medium)).foregroundStyle(Color.dim)
            }

            if variant == "dropdown", !multi {
                let selectedStr = current?.displayString ?? options.first?.value.displayString ?? ""
                let binding = Binding<String>(
                    get: { selectedStr },
                    set: { chosen in
                        guard !path.isEmpty else { return }
                        let matched = options.first { $0.value.displayString == chosen }?.value ?? .string(chosen)
                        state.mutate(path: path, value: matched, scopePath: scopePath)
                    }
                )
                Picker(label.isEmpty ? "Choose" : label, selection: binding) {
                    ForEach(options) { opt in
                        Text(opt.label).tag(opt.value.displayString)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.ink)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color.well, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
            } else {
                let selectedList = current?.arrayValue ?? []
                let pickedSet = Set(selectedList.map(\.displayString))
                let singleVal = current?.displayString ?? ""

                let pick: (OptionItem) -> Void = { opt in
                    guard !path.isEmpty else { return }
                    if multi {
                        var arr = selectedList
                        if let existingIdx = arr.firstIndex(where: { $0.displayString == opt.value.displayString }) {
                            arr.remove(at: existingIdx)
                        } else {
                            arr.append(opt.value)
                        }
                        state.mutate(path: path, value: .array(arr), scopePath: scopePath)
                    } else {
                        state.mutate(path: path, value: opt.value, scopePath: scopePath)
                    }
                }

                if variant == "radio" {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(options) { opt in
                            let active = multi ? pickedSet.contains(opt.value.displayString) : singleVal == opt.value.displayString
                            Button { pick(opt) } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: active ? "largecircle.fill.circle" : "circle")
                                        .foregroundStyle(active ? Color.accent : Color.muted)
                                    Text(opt.label).font(.subheadline).foregroundStyle(Color.soft)
                                    Spacer(minLength: 0)
                                }
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(options) { opt in
                                let active = multi ? pickedSet.contains(opt.value.displayString) : singleVal == opt.value.displayString
                                Button { pick(opt) } label: {
                                    Text(opt.label)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(active ? .white : Color.soft)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 7)
                                        .background(active ? Color.accent : Color.white.opacity(0.08), in: Capsule())
                                        .overlay(Capsule().strokeBorder(active ? Color.clear : Color.hairline, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct A2UIDateTimeView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    let scopePath: String

    private var enableDate: Bool { comp["enableDate"]?.boolValue != false }
    private var enableTime: Bool { comp["enableTime"]?.boolValue == true }

    private var componentsMask: DatePickerComponents {
        switch (enableDate, enableTime) {
        case (true, true): return [.date, .hourAndMinute]
        case (false, true): return [.hourAndMinute]
        default: return [.date]
        }
    }

    private func parseDate(_ raw: String) -> Date {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        if enableDate, enableTime {
            df.dateFormat = "yyyy-MM-dd'T'HH:mm"
        } else if enableTime {
            df.dateFormat = "HH:mm"
        } else {
            df.dateFormat = "yyyy-MM-dd"
        }
        return df.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) ?? .now
    }

    private func formatDate(_ date: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        if enableDate, enableTime {
            df.dateFormat = "yyyy-MM-dd'T'HH:mm"
        } else if enableTime {
            df.dateFormat = "HH:mm"
        } else {
            df.dateFormat = "yyyy-MM-dd"
        }
        return df.string(from: date)
    }

    var body: some View {
        let label = state.read(comp["label"], scopeData: scopeData)?.displayString ?? ""
        let path = comp["value"]?.bindingPath ?? ""
        let raw = state.read(comp["value"], scopeData: scopeData)?.displayString ?? ""

        let binding = Binding<Date>(
            get: { parseDate(raw) },
            set: { next in
                guard !path.isEmpty else { return }
                state.mutate(path: path, value: .string(formatDate(next)), scopePath: scopePath)
            }
        )

        DatePicker(label.isEmpty ? "Date" : label, selection: binding, displayedComponents: componentsMask)
            .font(.subheadline)
            .foregroundStyle(Color.soft)
            .tint(Color.accent)
    }
}

private struct A2UICodeBlockView: View {
    let comp: A2UIComponent
    let state: A2UISurfaceState
    let scopeData: A2UIValue?
    @State private var copied = false

    var body: some View {
        let lang = comp["language"]?.stringValue ?? "code"
        let source = state.read(comp["code"] ?? comp["text"], scopeData: scopeData)?.displayString ?? ""
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(lang.isEmpty ? "code" : lang).font(.caption.weight(.medium)).foregroundStyle(Color.muted)
                Spacer()
                Button(copied ? "Copied" : "Copy") {
                    UIPasteboard.general.string = source
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.2))
                        copied = false
                    }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.working)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(source)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.soft)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(Color.well, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
    }
}

private struct A2UISparklineView: View {
    let label: String
    let values: [Double]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if !label.isEmpty { Text(label).font(.caption).foregroundStyle(Color.muted) }
                Spacer()
                if let last = values.last {
                    Text(A2UIValue.number(last).displayString)
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Color.ink)
                }
            }
            if values.count >= 2 {
                GeometryReader { geo in
                    let minV = values.min() ?? 0
                    let maxV = values.max() ?? 1
                    let span = (maxV - minV) == 0 ? 1 : (maxV - minV)
                    let w = max(20, geo.size.width)
                    let h = max(12, geo.size.height - 6)
                    let pts: [CGPoint] = values.enumerated().map { idx, val in
                        let x = (CGFloat(idx) / CGFloat(values.count - 1)) * w
                        let y = 3 + h - CGFloat((val - minV) / span) * h
                        return CGPoint(x: x, y: y)
                    }
                    ZStack {
                        Path { p in
                            guard let first = pts.first, let last = pts.last else { return }
                            p.move(to: CGPoint(x: first.x, y: 3 + h))
                            for pt in pts { p.addLine(to: pt) }
                            p.addLine(to: CGPoint(x: last.x, y: 3 + h))
                            p.closeSubpath()
                        }
                        .fill(Color.accent.opacity(0.2))

                        Path { p in
                            guard let first = pts.first else { return }
                            p.move(to: first)
                            for pt in pts.dropFirst() { p.addLine(to: pt) }
                        }
                        .stroke(Color.working, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(height: 46)
            }
        }
        .padding(12)
        .background(Color.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
    }
}

private struct A2UIVideoView: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
                    .frame(height: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .onAppear {
            if player == nil { player = AVPlayer(url: url) }
        }
        .onDisappear {
            player?.pause()
        }
    }
}

private struct A2UIAudioView: View {
    let url: URL
    let label: String
    @State private var controller = A2UIAudioController()

    var body: some View {
        HStack(spacing: 10) {
            Button {
                controller.toggle(url: url)
            } label: {
                Image(systemName: controller.playing ? "pause.fill" : "play.fill")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.accent, in: Circle())
            }
            .buttonStyle(.plain)
            Text(label.isEmpty ? "Audio clip" : label)
                .font(.subheadline)
                .foregroundStyle(Color.soft)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1))
        .onDisappear { controller.stop() }
    }
}
