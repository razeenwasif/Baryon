import Foundation

public enum NoteSourceType: String, Codable {
    case appleNotes = "Apple Notes"
    case textEdit = "TextEdit"
    case onyxVault = "OnyxVault"
    case custom = "Notes"
}

public struct QAItem: Identifiable, Codable {
    public let id: UUID
    public let sourceType: NoteSourceType
    public let sourceTitle: String
    public let question: String
    public let answer: String
    public let keyPoints: [String]
    public let category: String
    public var vector: [Float]?
    
    public init(
        id: UUID = UUID(),
        sourceType: NoteSourceType,
        sourceTitle: String,
        question: String,
        answer: String,
        keyPoints: [String] = [],
        category: String = "General",
        vector: [Float]? = nil
    ) {
        self.id = id
        self.sourceType = sourceType
        self.sourceTitle = sourceTitle
        self.question = question
        self.answer = answer
        self.keyPoints = keyPoints
        self.category = category
        self.vector = vector
    }
}

public struct MatchResult: Identifiable {
    public var id: UUID { item.id }
    public let item: QAItem
    public let confidence: Double // 0.0 to 1.0
    public let semanticScore: Double
    public let keywordScore: Double
    public let matchedQuery: String
    
    public init(
        item: QAItem,
        confidence: Double,
        semanticScore: Double,
        keywordScore: Double,
        matchedQuery: String
    ) {
        self.item = item
        self.confidence = confidence
        self.semanticScore = semanticScore
        self.keywordScore = keywordScore
        self.matchedQuery = matchedQuery
    }
}
