import Foundation
import NaturalLanguage
import Darwin

// Private, local NDJSON worker. No tools, network, shell execution or note writes.
// The parent supplies only vetted Markdown chunks and handles source authorization.
struct Request: Decodable {
    let id: Int
    let op: String
    let items: [QAItem]?
    let query: String?
}
struct Hit: Encodable {
    let id: String
    let score: Double
    let semantic: Double
    let keyword: Double
}
struct Response: Encodable {
    let id: Int
    var count: Int? = nil
    var semanticAvailable: Bool? = nil
    var hits: [Hit]? = nil
    var error: String? = nil
}
@main struct NotesSearch {
static func main() {
setpriority(PRIO_PROCESS, 0, 10)
let engine = HybridSearchEngine()
let embedding = NLEmbedding.sentenceEmbedding(for: .english)
// Efficiency audit, fix 9: the vectors live in a binary file mapped into memory (VectorStore), the first argument. The
// second, if given, is the old JSON cache, read once to fill the new file and then removed.
let dimension = embedding?.dimension ?? 0
let store = CommandLine.arguments.count > 1
    ? VectorStore(url: URL(fileURLWithPath: CommandLine.arguments[1]), dimension: dimension,
                  legacy: CommandLine.arguments.count > 2 ? URL(fileURLWithPath: CommandLine.arguments[2]) : nil)
    : nil
func emit(_ value: Response) {
    if let data = try? JSONEncoder().encode(value) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
while let line = readLine() {
    autoreleasepool {
        guard line.utf8.count <= 32 * 1024 * 1024,
              let data = line.data(using: .utf8),
              let req = try? JSONDecoder().decode(Request.self, from: data) else { return }
        if req.op == "load", var items = req.items, items.count <= 12000 {
            var next: [UUID: [Float]] = [:]
            for i in items.indices {
                autoreleasepool {
                let key = items[i].id
                // IDs are content hashes, so edited chunks cannot reuse stale vectors.
                if let cached = store?.vector(key), cached.count == dimension, cached.allSatisfy({ $0.isFinite }) {
                    items[i].vector = cached
                } else if let raw = embedding?.vector(for: String((items[i].question + " " + items[i].answer).prefix(700))) {
                    let norm = sqrt(raw.reduce(0) { $0 + $1 * $1 })
                    if norm > 0 { items[i].vector = raw.map { Float($0 / norm) } }
                }
                if let vec = items[i].vector { next[key] = vec }
                }
            }
            engine.rebuildIndex(items: items)
            // Only new vectors are written: nothing at all when the notes haven't changed.
            store?.save(next)
            emit(Response(id: req.id, count: items.count, semanticAvailable: engine.hasEmbeddings))
        } else if req.op == "search", let query = req.query, query.count <= 4000 {
            let hits = engine.search(query: query, topK: 12).map {
                Hit(id: $0.item.id.uuidString.lowercased(), score: $0.confidence, semantic: $0.semanticScore, keyword: $0.keywordScore)
            }
            emit(Response(id: req.id, hits: hits))
        } else { emit(Response(id: req.id, error: "Invalid notes operation")) }
    }
}

}
}
