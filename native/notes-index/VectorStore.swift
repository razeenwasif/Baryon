import Foundation

// Efficiency audit, fix 9: note vectors as binary floats instead of JSON text. The file is a header ("FNV2", then the
// vector dimension as a little-endian UInt32) followed by records: a chunk's 16-byte UUID and its floats, little-endian.
// It's mapped into memory rather than parsed. New vectors are appended, and a later record for the same id wins, so an
// unchanged set of notes writes nothing. The file is rewritten only when more than half of it is records no note uses
// any more, or when its dimension or a torn last record says it must be.
public final class VectorStore {
    static let magic: [UInt8] = [0x46, 0x4E, 0x56, 0x32]  // "FNV2"
    static let headerSize = 8
    public let url: URL
    public let dimension: Int
    private var data = Data()
    private var offsets: [UUID: Int] = [:]
    private var records = 0
    private var needsRewrite = false
    private var legacy: [UUID: [Float]] = [:]
    private let legacyURL: URL?
    var recordSize: Int { 16 + dimension * 4 }

    // legacy: the old JSON file ({uuid: [floats]}), read once if there's no binary file yet, and removed once its
    // vectors are safely in the new one.
    public init(url: URL, dimension: Int, legacy legacyURL: URL? = nil) {
        self.url = url; self.dimension = dimension; self.legacyURL = legacyURL
        map()
        if records == 0, !FileManager.default.fileExists(atPath: url.path), let old = legacyURL,
           let attrs = try? FileManager.default.attributesOfItem(atPath: old.path), let size = attrs[.size] as? Int, size < 128 * 1024 * 1024,
           let json = try? Data(contentsOf: old), let saved = try? JSONDecoder().decode([String: [Float]].self, from: json) {
            for (key, vector) in saved { if let id = UUID(uuidString: key), vector.count == dimension { legacy[id] = vector } }
            needsRewrite = true
        }
    }

    private func map() {
        offsets = [:]; records = 0; data = Data()
        guard dimension > 0 else { return }
        guard let mapped = try? Data(contentsOf: url, options: .alwaysMapped) else { needsRewrite = true; return }
        guard mapped.count >= Self.headerSize, Array(mapped.prefix(4)) == Self.magic,
              mapped.withUnsafeBytes({ UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self)) }) == UInt32(dimension) else {
            needsRewrite = true; return
        }
        data = mapped
        let body = mapped.count - Self.headerSize
        records = body / recordSize
        if body % recordSize != 0 { needsRewrite = true }  // a torn last record: dropped on the next rewrite
        mapped.withUnsafeBytes { raw in
            for index in 0..<records {
                let at = Self.headerSize + index * recordSize
                var bytes = uuid_t(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                withUnsafeMutableBytes(of: &bytes) { $0.copyMemory(from: UnsafeRawBufferPointer(rebasing: raw[at..<at + 16])) }
                offsets[UUID(uuid: bytes)] = at
            }
        }
    }

    public var count: Int { offsets.count + legacy.count }

    public func vector(_ id: UUID) -> [Float]? {
        if let at = offsets[id] {
            return data.withUnsafeBytes { raw in
                (0..<dimension).map { Float(bitPattern: UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: at + 16 + $0 * 4, as: UInt32.self))) }
            }
        }
        return legacy[id]
    }

    private func record(_ id: UUID, _ vector: [Float]) -> Data {
        var out = Data(capacity: recordSize)
        withUnsafeBytes(of: id.uuid) { out.append(contentsOf: $0) }
        for value in vector { withUnsafeBytes(of: value.bitPattern.littleEndian) { out.append(contentsOf: $0) } }
        return out
    }

    // live: every vector the notes use now. Returns what it did, for tests: "none", "append" or "rewrite".
    @discardableResult public func save(_ live: [UUID: [Float]]) -> String {
        guard dimension > 0 else { return "none" }
        let usable = live.filter { $0.value.count == dimension }
        let fresh = usable.filter { offsets[$0.key] == nil }
        if needsRewrite || records + fresh.count > 2 * usable.count + 64 {
            var out = Data(Self.magic)
            withUnsafeBytes(of: UInt32(dimension).littleEndian) { out.append(contentsOf: $0) }
            for (id, vector) in usable.sorted(by: { $0.key.uuidString < $1.key.uuidString }) { out.append(record(id, vector)) }
            do {
                try out.write(to: url, options: .atomic)
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            } catch { return "none" }
            needsRewrite = false; legacy = [:]
            if let old = legacyURL { try? FileManager.default.removeItem(at: old) }
            map(); return "rewrite"
        }
        guard !fresh.isEmpty, let handle = try? FileHandle(forWritingTo: url) else { return "none" }
        defer { try? handle.close() }
        var out = Data()
        for (id, vector) in fresh { out.append(record(id, vector)) }
        do { try handle.seekToEnd(); try handle.write(contentsOf: out) } catch { needsRewrite = true; return "none" }
        map(); return "append"
    }
}
