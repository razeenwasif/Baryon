// Adapted from ~/Github/Indexer, Sources/Search/HybridSearchEngine.swift.
// Explicit item loading; no singleton, UI, background scan or interview-specific boosts.
import Foundation
import NaturalLanguage
import Accelerate

public final class HybridSearchEngine: @unchecked Sendable {
    
    private struct IndexedQAItem {
        let item: QAItem
        let questionVector: [Double]?
        let keyPointsVector: [Double]?
        let answerVector: [Double]?
        let questionTokens: Set<String>
        let categoryTokens: Set<String>
        let answerTokens: Set<String>
    }
    
    private let embedding: NLEmbedding?
    private var indexedItems: [IndexedQAItem] = []
    private let lock = NSLock()
    
    public init() {
        self.embedding = NLEmbedding.sentenceEmbedding(for: .english)
    }
    public var hasEmbeddings: Bool { embedding != nil }

    /// Pre-computes normalized embeddings and token sets for sub-millisecond retrieval
    public func rebuildIndex(items rawItems: [QAItem]) {
        lock.lock()
        defer { lock.unlock() }
        
        var newIndex: [IndexedQAItem] = []
        newIndex.reserveCapacity(rawItems.count)
        
        for item in rawItems {
            var qVec: [Double]? = nil
            var kpVec: [Double]? = nil
            var ansVec: [Double]? = nil
            
            if let cachedVec = item.vector {
                qVec = cachedVec.map { Double($0) }
            } else if let emb = self.embedding {
                if let rawQ = emb.vector(for: item.question) {
                    qVec = normalize(rawQ)
                }
                // For behavioral interview questions, also embed key points and answer prefix
                if item.sourceType != .onyxVault {
                    if !item.keyPoints.isEmpty {
                        let kpText = item.keyPoints.joined(separator: " ")
                        if let rawKP = emb.vector(for: kpText) {
                            kpVec = normalize(rawKP)
                        }
                    }
                    let ansPrefix = String(item.answer.prefix(300))
                    if let rawAns = emb.vector(for: ansPrefix) {
                        ansVec = normalize(rawAns)
                    }
                }
            }
            
            let qTokens = tokenize(item.question)
            let catTokens = tokenize(item.category)
            let ansTokens = tokenize(item.answer)
            
            newIndex.append(IndexedQAItem(
                item: item,
                questionVector: qVec,
                keyPointsVector: kpVec,
                answerVector: ansVec,
                questionTokens: qTokens,
                categoryTokens: catTokens,
                answerTokens: ansTokens
            ))
        }
        
        self.indexedItems = newIndex

    }
    
    /// Ultra-fast search: <5ms execution via pre-computed normalized dot products
    public func search(query: String, topK: Int = 3) -> [MatchResult] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return [] }
        
        lock.lock()
        let items = self.indexedItems
        lock.unlock()
        
        guard !items.isEmpty else { return [] }
        
        // 1. Compute query vector ONCE
        var queryVector: [Double]? = nil
        if let emb = self.embedding, let rawVec = emb.vector(for: trimmedQuery) {
            queryVector = normalize(rawVec)
        }
        
        let queryTokens = tokenize(trimmedQuery)
        var results: [MatchResult] = []
        results.reserveCapacity(items.count)
        
        for indexed in items {
            // 2. Dense Semantic Cosine Similarity (Fast Dot Products)
            var semanticScore = 0.0
            if let qVec = queryVector {
                var bestDot = -1.0
                
                if let tQ = indexed.questionVector {
                    let dot = dotProduct(qVec, tQ)
                    if dot > bestDot { bestDot = dot }
                }
                if let tKP = indexed.keyPointsVector {
                    let dot = dotProduct(qVec, tKP)
                    if dot > bestDot { bestDot = dot }
                }
                if let tAns = indexed.answerVector {
                    let dot = dotProduct(qVec, tAns)
                    if dot > bestDot { bestDot = dot }
                }
                
                // Cosine similarity ranges from ~0.2 (unrelated) to ~0.7+ (highly related)
                // Normalize to 0.0 - 1.0
                semanticScore = max(0.0, min(1.0, (bestDot - 0.25) / 0.50))
            }
            
            // 3. Pre-computed Keyword & Token Overlap
            var matchedKeywordsCount = 0
            for token in queryTokens {
                if indexed.questionTokens.contains(token) {
                    matchedKeywordsCount += 3
                } else if indexed.categoryTokens.contains(token) {
                    matchedKeywordsCount += 2
                } else if indexed.answerTokens.contains(token) {
                    matchedKeywordsCount += 1
                }
            }
            
            let maxPossibleTokens = max(1, queryTokens.count * 3)
            let keywordScore = min(1.0, Double(matchedKeywordsCount) / Double(maxPossibleTokens))
            
            // 4. Combined Hybrid Score
            let hybridScore: Double
            if queryVector != nil {
                hybridScore = (semanticScore * 0.50) + (keywordScore * 0.50)
            } else {
                hybridScore = keywordScore
            }
            
            let result = MatchResult(
                item: indexed.item,
                confidence: hybridScore,
                semanticScore: semanticScore,
                keywordScore: keywordScore,
                matchedQuery: trimmedQuery
            )
            results.append(result)
        }
        
        // Sort descending by confidence
        results.sort { $0.confidence > $1.confidence }
        
        return Array(results.prefix(topK))
    }
    
    // MARK: - Fast Vector Math
    
    private func normalize(_ vec: [Double]) -> [Double] {
        var magSq: Double = 0.0
        for v in vec { magSq += v * v }
        let mag = sqrt(magSq)
        guard mag > 0 else { return vec }
        return vec.map { $0 / mag }
    }
    
    private func dotProduct(_ a: [Double], _ b: [Double]) -> Double {
        let count = min(a.count, b.count)
        var sum: Double = 0.0
        vDSP_dotprD(a, 1, b, 1, &sum, vDSP_Length(count))
        return sum
    }
    
    private func tokenize(_ text: String) -> Set<String> {
        let stopWords: Set<String> = [
            "a", "an", "the", "and", "or", "but", "if", "then", "so", "as", "at",
            "by", "for", "from", "in", "into", "of", "off", "on", "onto", "out",
            "over", "to", "up", "with", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "can", "could",
            "will", "would", "shall", "should", "may", "might", "must", "i",
            "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
            "them", "my", "your", "his", "their", "our", "what", "which", "who",
            "whom", "this", "that", "these", "those", "am", "about", "tell"
        ]
        
        let cleaned = text.lowercased().map { char -> Character in
            if char.isLetter || char.isNumber { return char }
            return " "
        }
        
        let rawTokens = String(cleaned)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { $0.count > 1 }
        
        var meaningfulTokens = Set<String>()
        for token in rawTokens {
            if !stopWords.contains(token) {
                meaningfulTokens.insert(token)
            }
        }
        
        return meaningfulTokens.isEmpty ? Set(rawTokens) : meaningfulTokens
    }
}
