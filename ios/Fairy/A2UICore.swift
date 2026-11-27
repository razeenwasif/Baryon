import Foundation

// Wire-compatible A2UI v0.9.1 data model, JSON Pointer (RFC 6901) helpers, expression evaluation,
// media URL sanitiser, and action payload resolver for both inline chat surfaces and Interactive UI pages.

enum A2UILimits {
    static let depth = 24
    static let components = 200
    static let listItems = 100
    static let titleChars = 160
}

private let a2uiUnsafeKeys: Set<String> = ["__proto__", "constructor", "prototype"]

enum A2UIValue: Sendable, Codable, Equatable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([A2UIValue])
    case object([String: A2UIValue])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .number(Double(value))
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([A2UIValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: A2UIValue].self) {
            self = .object(value.filter { !a2uiUnsafeKeys.contains($0.key) })
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported A2UI JSON value")
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            if value.isFinite {
                try container.encode(value)
            } else {
                try container.encodeNil()
            }
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var numberValue: Double? {
        if case .number(let n) = self, n.isFinite { return n }
        return nil
    }

    var coercedNumber: Double? {
        switch self {
        case .number(let n): return n.isFinite ? n : nil
        case .string(let s):
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : Double(trimmed)
        case .bool(let b): return b ? 1 : 0
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var isTruthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array(let a): return !a.isEmpty
        case .object(let o): return !o.isEmpty
        }
    }

    var arrayValue: [A2UIValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var objectValue: [String: A2UIValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    var displayString: String {
        switch self {
        case .null:
            return ""
        case .bool(let b):
            return b ? "true" : "false"
        case .number(let n):
            guard n.isFinite else { return "" }
            if n.rounded() == n, n >= Double(Int.min), n <= Double(Int.max) {
                return String(Int(n))
            }
            return String(n)
        case .string(let s):
            return s
        case .array, .object:
            if let data = try? JSONEncoder().encode(self), let json = String(data: data, encoding: .utf8) {
                return json
            }
            return ""
        }
    }

    var bindingPath: String? {
        guard case .object(let dict) = self, let raw = dict["path"]?.stringValue, a2uiParsePointer(raw) != nil else {
            return nil
        }
        return raw
    }

    func toJSONObject() -> Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n): return n.isFinite ? n : NSNull()
        case .string(let s): return s
        case .array(let arr): return arr.map { $0.toJSONObject() }
        case .object(let dict): return dict.mapValues { $0.toJSONObject() }
        }
    }
}

private struct A2UIDynamicKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = Int(stringValue)
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }

    static func key(_ name: String) -> A2UIDynamicKey {
        A2UIDynamicKey(stringValue: name)!
    }
}

struct A2UIComponent: Sendable, Codable, Identifiable, Equatable, Hashable {
    var id: String
    var component: String
    var props: [String: A2UIValue]

    init(id: String, component: String, props: [String: A2UIValue] = [:]) {
        self.id = id
        self.component = component
        self.props = props
    }

    subscript(key: String) -> A2UIValue? { props[key] }

    var childrenIds: [String] {
        guard let raw = props["children"] else { return [] }
        if let arr = raw.arrayValue {
            return Array(arr.compactMap(\.stringValue).prefix(A2UILimits.listItems))
        }
        if let obj = raw.objectValue, let explicit = obj["explicitList"]?.arrayValue {
            return Array(explicit.compactMap(\.stringValue).prefix(A2UILimits.listItems))
        }
        return []
    }

    var repeatTemplate: (componentId: String, path: String)? {
        guard let obj = props["children"]?.objectValue else { return nil }
        if let tpl = obj["template"]?.objectValue, let cid = tpl["componentId"]?.stringValue, !cid.isEmpty {
            let path = tpl["dataBinding"]?.stringValue ?? tpl["path"]?.stringValue ?? "/items"
            return (cid, path)
        }
        if let cid = obj["componentId"]?.stringValue, !cid.isEmpty {
            let path = obj["path"]?.stringValue ?? "/items"
            return (cid, path)
        }
        return nil
    }

    var childId: String? {
        if let direct = props["child"]?.stringValue, !direct.isEmpty { return direct }
        return nil
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: A2UIDynamicKey.self)
        var parsedProps: [String: A2UIValue] = [:]
        var resolvedId = ""
        var resolvedComponent = ""

        for key in container.allKeys {
            if a2uiUnsafeKeys.contains(key.stringValue) { continue }
            if key.stringValue == "id" {
                resolvedId = (try? container.decode(String.self, forKey: key)) ?? ""
            } else if key.stringValue == "component" {
                if let name = try? container.decode(String.self, forKey: key) {
                    resolvedComponent = name
                } else if let wrapper = try? container.decode([String: A2UIValue].self, forKey: key), let first = wrapper.first {
                    resolvedComponent = first.key
                    if let nested = first.value.objectValue {
                        for (nk, nv) in nested where !a2uiUnsafeKeys.contains(nk) {
                            parsedProps[nk] = nv
                        }
                    }
                }
            } else if key.stringValue == "type", resolvedComponent.isEmpty {
                resolvedComponent = (try? container.decode(String.self, forKey: key)) ?? ""
            } else if let value = try? container.decode(A2UIValue.self, forKey: key) {
                parsedProps[key.stringValue] = value
            }
        }

        self.id = resolvedId.isEmpty ? "component" : resolvedId
        self.component = resolvedComponent.isEmpty ? "Text" : resolvedComponent
        self.props = parsedProps
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: A2UIDynamicKey.self)
        try container.encode(id, forKey: .key("id"))
        try container.encode(component, forKey: .key("component"))
        for (key, value) in props where key != "id" && key != "component" && !a2uiUnsafeKeys.contains(key) {
            try container.encode(value, forKey: .key(key))
        }
    }
}

struct A2UISurface: Sendable, Codable, Identifiable, Equatable, Hashable {
    var surfaceId: String
    var catalogId: String?
    var title: String?
    var root: String
    var components: [A2UIComponent]
    var dataModel: [String: A2UIValue]

    var id: String { surfaceId }

    init(
        surfaceId: String = "surface-1",
        catalogId: String? = nil,
        title: String? = nil,
        root: String = "root",
        components: [A2UIComponent] = [],
        dataModel: [String: A2UIValue] = [:]
    ) {
        self.surfaceId = surfaceId
        self.catalogId = catalogId
        self.title = title
        self.root = root
        self.components = components
        self.dataModel = dataModel
    }

    enum CodingKeys: String, CodingKey {
        case surfaceId, id, catalogId, title, root, rootId, components, dataModel, data
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sid = (try? container.decodeIfPresent(String.self, forKey: .surfaceId))
            ?? (try? container.decodeIfPresent(String.self, forKey: .id))
            ?? "surface-1"
        self.surfaceId = sid.isEmpty ? "surface-1" : sid
        self.catalogId = try? container.decodeIfPresent(String.self, forKey: .catalogId)
        self.title = try? container.decodeIfPresent(String.self, forKey: .title)

        let rawComponents = (try? container.decodeIfPresent([A2UIComponent].self, forKey: .components)) ?? []
        self.components = Array(rawComponents.prefix(A2UILimits.components))

        let requestedRoot = (try? container.decodeIfPresent(String.self, forKey: .root))
            ?? (try? container.decodeIfPresent(String.self, forKey: .rootId))
            ?? ""
        let ids = Set(self.components.map(\.id))
        if !requestedRoot.isEmpty, ids.contains(requestedRoot) {
            self.root = requestedRoot
        } else if ids.contains("root") {
            self.root = "root"
        } else {
            self.root = self.components.first?.id ?? "root"
        }

        let model = (try? container.decodeIfPresent([String: A2UIValue].self, forKey: .dataModel))
            ?? (try? container.decodeIfPresent([String: A2UIValue].self, forKey: .data))
            ?? [:]
        self.dataModel = model.filter { !a2uiUnsafeKeys.contains($0.key) }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(surfaceId, forKey: .surfaceId)
        try container.encodeIfPresent(catalogId, forKey: .catalogId)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(root, forKey: .root)
        try container.encode(components, forKey: .components)
        try container.encode(dataModel, forKey: .dataModel)
    }
}

func a2uiParsePointer(_ pointer: String) -> (absolute: Bool, segments: [String])? {
    let absolute = pointer.hasPrefix("/")
    let trimmed = absolute ? String(pointer.dropFirst()) : pointer
    if trimmed.isEmpty { return (absolute, []) }
    let segments = trimmed.split(separator: "/", omittingEmptySubsequences: false).map { seg in
        seg.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~")
    }
    if segments.contains(where: { a2uiUnsafeKeys.contains($0) }) { return nil }
    return (absolute, segments)
}

func a2uiResolvedPath(_ propPath: String, scopePath: String) -> String {
    guard !propPath.isEmpty else { return "" }
    if propPath.hasPrefix("/") { return propPath }
    if !scopePath.isEmpty {
        let base = scopePath.hasSuffix("/") ? String(scopePath.dropLast()) : scopePath
        return "\(base)/\(propPath)"
    }
    return "/\(propPath)"
}

private func readSegments(_ root: A2UIValue, _ segments: [String]) -> A2UIValue? {
    var cursor: A2UIValue = root
    for seg in segments {
        switch cursor {
        case .array(let arr):
            guard let idx = Int(seg), idx >= 0, idx < arr.count else { return nil }
            cursor = arr[idx]
        case .object(let obj):
            guard let next = obj[seg] else { return nil }
            cursor = next
        default:
            return nil
        }
    }
    return cursor
}

func a2uiPointerGet(_ dataModel: [String: A2UIValue], _ pointer: String, scopeData: A2UIValue? = nil) -> A2UIValue? {
    guard let parsed = a2uiParsePointer(pointer) else { return nil }
    let rootValue = A2UIValue.object(dataModel)
    if parsed.segments.isEmpty {
        return parsed.absolute ? rootValue : (scopeData ?? rootValue)
    }
    if !parsed.absolute, let scopeData, let scoped = readSegments(scopeData, parsed.segments) {
        return scoped
    }
    return readSegments(rootValue, parsed.segments)
}

private func writeSegments(_ container: A2UIValue, _ segments: [String], _ index: Int, _ value: A2UIValue) -> A2UIValue {
    let seg = segments[index]
    if a2uiUnsafeKeys.contains(seg) { return container }
    let isLeaf = index == segments.count - 1

    switch container {
    case .array(var arr):
        guard let idx = Int(seg), idx >= 0, idx < A2UILimits.listItems else { return container }
        while arr.count <= idx { arr.append(.null) }
        if isLeaf {
            arr[idx] = value
        } else {
            let nextSeg = segments[index + 1]
            let fallback: A2UIValue = Int(nextSeg) != nil ? .array([]) : .object([:])
            let child = (arr[idx] == .null) ? fallback : arr[idx]
            arr[idx] = writeSegments(child, segments, index + 1, value)
        }
        return .array(arr)
    case .object(var dict):
        if isLeaf {
            dict[seg] = value
        } else {
            let nextSeg = segments[index + 1]
            let fallback: A2UIValue = Int(nextSeg) != nil ? .array([]) : .object([:])
            let child: A2UIValue
            if let existing = dict[seg], existing.objectValue != nil || existing.arrayValue != nil {
                child = existing
            } else {
                child = fallback
            }
            dict[seg] = writeSegments(child, segments, index + 1, value)
        }
        return .object(dict)
    default:
        let nextContainer: A2UIValue = Int(seg) != nil ? .array([]) : .object([:])
        return writeSegments(nextContainer, segments, index, value)
    }
}

func a2uiPointerSet(_ dataModel: [String: A2UIValue], _ pointer: String, _ value: A2UIValue) -> [String: A2UIValue] {
    guard let parsed = a2uiParsePointer(pointer) else { return dataModel }
    if parsed.segments.isEmpty {
        return value.objectValue ?? dataModel
    }
    let updated = writeSegments(.object(dataModel), parsed.segments, 0, value)
    return updated.objectValue ?? dataModel
}

private func deleteSegments(_ container: A2UIValue, _ segments: [String], _ index: Int) -> A2UIValue {
    let seg = segments[index]
    let isLeaf = index == segments.count - 1
    switch container {
    case .array(var arr):
        guard let idx = Int(seg), idx >= 0, idx < arr.count else { return container }
        if isLeaf {
            arr.remove(at: idx)
        } else {
            arr[idx] = deleteSegments(arr[idx], segments, index + 1)
        }
        return .array(arr)
    case .object(var dict):
        if isLeaf {
            dict.removeValue(forKey: seg)
        } else if let child = dict[seg] {
            dict[seg] = deleteSegments(child, segments, index + 1)
        }
        return .object(dict)
    default:
        return container
    }
}

func a2uiPointerDelete(_ dataModel: [String: A2UIValue], _ pointer: String) -> [String: A2UIValue] {
    guard let parsed = a2uiParsePointer(pointer) else { return dataModel }
    if parsed.segments.isEmpty { return [:] }
    return deleteSegments(.object(dataModel), parsed.segments, 0).objectValue ?? dataModel
}

private func evalCall(_ expr: [String: A2UIValue], _ dataModel: [String: A2UIValue], _ scopeData: A2UIValue?, _ depth: Int) -> A2UIValue? {
    let fn = (expr["call"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let argsValue = expr["args"] ?? expr["arguments"] ?? .object([:])
    let args = argsValue.objectValue ?? [:]
    let argsArray = argsValue.arrayValue

    func r(_ val: A2UIValue?) -> A2UIValue? {
        a2uiResolveDynamic(val, dataModel: dataModel, scopeData: scopeData, depth: depth + 1)
    }

    switch fn {
    case "formatString":
        let tpl = r(args["value"] ?? args["template"] ?? args["pattern"])?.displayString ?? ""
        guard let regex = try? NSRegularExpression(pattern: "\\$\\{([^}]+)\\}") else { return .string(tpl) }
        let ns = tpl as NSString
        let matches = regex.matches(in: tpl, range: NSRange(location: 0, length: ns.length))
        var out = tpl
        for match in matches.reversed() {
            guard match.numberOfRanges > 1 else { continue }
            let token = ns.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespaces)
            var replacement = ""
            if let direct = args[token] {
                replacement = r(direct)?.displayString ?? ""
            } else if token.hasPrefix("/") || token.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "." }) {
                let ptr = token.hasPrefix("/") ? token : "/\(token)"
                replacement = a2uiPointerGet(dataModel, ptr, scopeData: scopeData)?.displayString ?? ""
            }
            if let swiftRange = Range(match.range, in: out) {
                out.replaceSubrange(swiftRange, with: replacement)
            }
        }
        return .string(out)

    case "formatNumber":
        guard let num = r(args["value"] ?? args["number"])?.coercedNumber else { return .string("") }
        if let decRaw = args["decimals"]?.coercedNumber ?? args["fractionDigits"]?.coercedNumber,
           decRaw >= 0, decRaw <= 8, decRaw.rounded() == decRaw {
            return .string(String(format: "%.\(Int(decRaw))f", num))
        }
        return .string(A2UIValue.number(num).displayString)

    case "not":
        let target = r(args["value"] ?? args["condition"] ?? argsArray?.first)
        return .bool(!(target?.isTruthy ?? false))

    case "and":
        let items = args["values"]?.arrayValue ?? argsArray ?? []
        return .bool(items.allSatisfy { r($0)?.isTruthy ?? false })

    case "or":
        let items = args["values"]?.arrayValue ?? argsArray ?? []
        return .bool(items.contains { r($0)?.isTruthy ?? false })

    case "eq":
        let left = r(args["left"] ?? args["a"] ?? argsArray?.first)
        let right = r(args["right"] ?? args["b"] ?? (argsArray?.count ?? 0 > 1 ? argsArray?[1] : nil))
        return .bool(left == right)

    case "neq":
        let left = r(args["left"] ?? args["a"] ?? argsArray?.first)
        let right = r(args["right"] ?? args["b"] ?? (argsArray?.count ?? 0 > 1 ? argsArray?[1] : nil))
        return .bool(left != right)

    case "gt", "gte", "lt", "lte":
        guard let a = r(args["left"] ?? args["a"] ?? argsArray?.first)?.coercedNumber,
              let b = r(args["right"] ?? args["b"] ?? (argsArray?.count ?? 0 > 1 ? argsArray?[1] : nil))?.coercedNumber else {
            return .bool(false)
        }
        switch fn {
        case "gt": return .bool(a > b)
        case "gte": return .bool(a >= b)
        case "lt": return .bool(a < b)
        default: return .bool(a <= b)
        }

    case "coalesce":
        let items = args["values"]?.arrayValue ?? argsArray ?? []
        for item in items {
            if let res = r(item), res != .null, res.displayString != "" {
                return res
            }
        }
        return .string("")

    case "join":
        let list = r(args["values"] ?? args["list"])?.arrayValue ?? []
        let sep = args["separator"]?.displayString ?? ", "
        return .string(list.map(\.displayString).joined(separator: sep))

    case "count":
        let list = r(args["values"] ?? args["list"])?.arrayValue ?? []
        return .number(Double(list.count))

    case "if":
        let cond = r(args["condition"] ?? args["cond"])?.isTruthy ?? false
        return cond ? r(args["true"] ?? args["then"]) : r(args["false"] ?? args["else"])

    default:
        return nil
    }
}

func a2uiResolveDynamic(_ value: A2UIValue?, dataModel: [String: A2UIValue], scopeData: A2UIValue? = nil, depth: Int = 0) -> A2UIValue? {
    guard depth <= 16, let value else { return nil }
    switch value {
    case .null, .bool, .number, .string:
        return value
    case .array(let arr):
        return .array(arr.map { a2uiResolveDynamic($0, dataModel: dataModel, scopeData: scopeData, depth: depth + 1) ?? .null })
    case .object(let dict):
        if let path = dict["path"]?.stringValue {
            return a2uiPointerGet(dataModel, path, scopeData: scopeData)
        }
        if let literal = dict["literalString"] { return literal }
        if let literal = dict["literalNumber"] { return literal }
        if let literal = dict["literalBoolean"] { return literal }
        if let literal = dict["literal"] { return literal }
        if dict["call"]?.stringValue != nil {
            return evalCall(dict, dataModel, scopeData, depth)
        }
        return value
    }
}

func a2uiSafeMediaURL(_ raw: String?) -> URL? {
    guard let raw else { return nil }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 8192 else { return nil }
    let lower = trimmed.lowercased()
    if lower.hasPrefix("https://") || lower.hasPrefix("http://") {
        guard let url = URL(string: trimmed), let host = url.host, !host.isEmpty else { return nil }
        return url
    }
    if lower.hasPrefix("data:image/"), !lower.hasPrefix("data:image/svg") {
        return URL(string: trimmed)
    }
    return nil
}

func a2uiSafeDataImageData(_ raw: String?) -> Data? {
    guard let raw else { return nil }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = trimmed.lowercased()
    guard lower.hasPrefix("data:image/"), !lower.hasPrefix("data:image/svg"), let comma = trimmed.firstIndex(of: ",") else {
        return nil
    }
    let meta = lower[..<comma]
    guard meta.contains(";base64") else { return nil }
    let b64 = String(trimmed[trimmed.index(after: comma)...])
    return Data(base64Encoded: b64)
}

func a2uiResolveActionContext(
    _ component: A2UIComponent,
    dataModel: [String: A2UIValue],
    scopeData: A2UIValue? = nil
) -> (actionName: String, sourceComponentId: String, context: [String: A2UIValue]) {
    let rawAction = component["action"]
    let actionDict = rawAction?.objectValue
    let eventDict = actionDict?["event"]?.objectValue ?? actionDict
    let fallbackLabel = component["label"]?.stringValue ?? "submit"
    let rawName = rawAction?.stringValue ?? eventDict?["name"]?.stringValue ?? fallbackLabel
    let cleanName = String(rawName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
    let actionName = cleanName.isEmpty ? "submit" : cleanName

    var context: [String: A2UIValue] = [:]
    if let contextSpec = eventDict?["context"]?.objectValue, !contextSpec.isEmpty {
        for (k, v) in contextSpec where !a2uiUnsafeKeys.contains(k) {
            if let resolved = a2uiResolveDynamic(v, dataModel: dataModel, scopeData: scopeData) {
                context[k] = resolved
            } else {
                context[k] = .null
            }
        }
    } else {
        context = dataModel
    }
    return (actionName, component.id, context)
}
