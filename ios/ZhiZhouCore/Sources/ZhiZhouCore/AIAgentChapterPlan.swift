import Foundation

public struct AIAgentChapterPlanInput: Codable, Equatable, Sendable {
    public var title = ""
    public var goal = ""
    public var beats = ""
    public var characters = ""
    public var ending = ""
    public var constraints = ""
    public var targetWords = 2000

    public init() {}
}

public struct AIAgentChapterPlan: Decodable, Sendable {
    public struct SourceBranch: Decodable, Sendable {
        public let name: String
    }

    public let input: AIAgentChapterPlanInput
    public let revision: Int
    public let sourceBranch: SourceBranch?

    private enum CodingKeys: String, CodingKey { case revision, sourceBranch }

    public init(from decoder: Decoder) throws {
        input = try AIAgentChapterPlanInput(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        revision = try values.decode(Int.self, forKey: .revision)
        sourceBranch = try values.decodeIfPresent(SourceBranch.self, forKey: .sourceBranch)
    }
}

public struct AIAgentPlanBranch: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let plan: AIAgentChapterPlan
    public let source: String
}

public struct AIAgentPlanBranches: Decodable, Sendable {
    public let plan: AIAgentChapterPlan?
    public let branches: [AIAgentPlanBranch]
}
