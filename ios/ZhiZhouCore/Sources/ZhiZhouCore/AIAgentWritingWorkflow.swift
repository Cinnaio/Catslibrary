import Foundation

public struct AIAgentOutlineSource: Decodable, Sendable {
    public let chapterId: String
    public let revision: Int
}
public struct AIAgentOutlineProgress: Codable, Sendable {
    public struct Draft: Codable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let sessionId: String
        public let status: String
        public let chapterId: String?
    }
    public let status: String
    public let drafts: [Draft]
    public let changedSinceWriting: Bool
    public var label: String { status == "published" ? "已发布" : status == "draft" ? "已有草稿" : status == "unavailable" ? "发布位置已变化，需核对" : "待写" }
}
public struct AIAgentStoryThreadPlan: Decodable, Identifiable, Sendable {
    public let id: String
    public let thread: StoryThread
    public let disposition: String
    public let note: String
    public let revision: Int
    public let sourceRevision: String
    public let sourceAnchorId: String
    public let stale: Bool?
    public var label: String {
        switch disposition {
        case "advance": "本章推进"
        case "later": "安排到后面"
        case "hold": "暂时搁置"
        default: "已回收"
        }
    }
}
public struct AIAgentStoryThreadState: Decodable, Sendable {
    public let candidates: [StoryThread]
    public let sourceRevision: String
    public let graphStatus: String
    public let plans: [AIAgentStoryThreadPlan]
}
public struct AIAgentWritingReference: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var title: String
    public var tags: [String]
    public var content: String
    public var usage: String
    public let revision: Int
}
public struct AIAgentWritingReferences: Decodable, Sendable {
    public let references: [AIAgentWritingReference]
    public let hasMore: Bool
}
public struct AIAgentReferenceSelection: Codable, Equatable, Sendable {
    public var ids: [String]
    public var scope: String
    public init(ids: [String], scope: String = "turn") { self.ids = ids; self.scope = scope }
}
public struct AIAgentTextDifference: Codable, Equatable, Sendable {
    public let kind: String
    public let before: String
    public let after: String
}
public struct AIAgentRewriteSelection: Codable, Equatable, Sendable {
    public let version: Int
    public let revision: String
    public let acceptedChanges: [Int]
    public init(revision: String, acceptedChanges: [Int]) {
        version = 1; self.revision = revision; self.acceptedChanges = acceptedChanges.sorted()
    }
}
public enum AIAgentRewriteChoices {
    /// The API owns alignment and indexes. Never split or normalize its blocks on the client.
    public static func merge(_ differences: [AIAgentTextDifference], accepted: Set<Int>) -> String {
        var index = 0
        return differences.map { part in
            guard part.kind != "equal" else { return part.before }
            defer { index += 1 }
            return accepted.contains(index) ? part.after : part.before
        }.joined()
    }
    public static func valid(_ selection: AIAgentRewriteSelection, revision: String, count: Int) -> Bool {
        selection.version == 1 && selection.revision == revision && !selection.acceptedChanges.isEmpty
            && Set(selection.acceptedChanges).count == selection.acceptedChanges.count
            && selection.acceptedChanges.allSatisfy { (0..<count).contains($0) }
    }
}
