import Foundation

public struct AIAgentMemory: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let novelId: String
    public let sessionId: String
    public let kind: String
    public let title: String
    public let content: String
    public let status: String
    public let sourceEventId: Int64?
    public let supersedesId: String?
    public let revision: Int
    public let createdAt: Int64
    public let updatedAt: Int64

    public var canEdit: Bool { status == "pending" || status == "active" }
    public var statusLabel: String {
        switch status {
        case "pending": "待确认"
        case "active": "已记住"
        case "superseded": "已被替换"
        case "archived": "已移除"
        default: "不可用"
        }
    }
}

public struct AIAgentSummary: Codable, Equatable, Sendable {
    public struct Content: Codable, Equatable, Sendable {
        public let goal: String
        public let decisions: [String]
        public let rejected: [String]
        public let openQuestions: [String]
        public let nextSteps: [String]
        public let references: [String]
    }
    public let throughEventId: Int64
    public let content: Content
    public let revision: Int
    public let updatedAt: Int64
}

public struct AIAgentMemoryPage: Decodable, Sendable {
    public let memories: [AIAgentMemory]
    public let hasMore: Bool
    public let summary: AIAgentSummary?
}
public struct AIAgentMemoryResponse: Decodable, Sendable { public let memory: AIAgentMemory }
public struct AIAgentMemorySource: Decodable, Sendable {
    public let id: Int64
    public let sessionId: String
    public let content: String
}
public struct AIAgentMemorySourceResponse: Decodable, Sendable { public let source: AIAgentMemorySource? }
