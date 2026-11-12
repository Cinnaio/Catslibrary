import Foundation

public struct AIAgentPreferences: Codable, Equatable, Sendable {
    public var version = 1
    public var adultContentMode = "off"
    public var intimacyWeight = "none"
    public var adultCharactersConfirmed = false
    public var consentRuleTier: String? = "default"
    public init() {}

    public var normalized: Self {
        guard adultContentMode == "explicit" else { return Self() }
        var value = self
        value.version = 1
        value.adultCharactersConfirmed = true
        if value.intimacyWeight == "none" { value.intimacyWeight = "medium" }
        return value
    }
}

public struct AIAgentSession: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let novelId: String
    public let novelTitle: String
    public let title: String
    public let afterChapterId: String
    public let anchorTitle: String
    public let brief: String
    public let contentPreferences: AIAgentPreferences
    public let activeTaskId: String
    public let createdAt: Int64
    public let updatedAt: Int64
}

public struct AIAgentTask: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let status: String
    public let step: String
    public let current: Int
    public let total: Int
    public let error: String
    public var result: String?
    public var isRunning: Bool { status == "queued" || status == "running" }
    public var progress: AIAgentTextProgress? { AIAgentTextProgress.parse(result) }

    public func preservingNewerPreview(from previous: Self?) -> Self {
        guard status != "completed", let before = previous?.progress, let after = progress,
              before.startedAt == after.startedAt, before.round == after.round,
              before.generatedCharacters > after.generatedCharacters || before.reasoningCharacters > after.reasoningCharacters
        else { return self }
        var next = self
        next.result = previous?.result
        return next
    }
}

public struct AIAgentTextProgress: Codable, Equatable, Sendable {
    public let kind: String
    public let phase: String
    public let preview: String
    public let generatedCharacters: Int
    public let reasoningCharacters: Int
    public let startedAt: Int64
    public let updatedAt: Int64
    public let round: Int?

    public static func parse(_ raw: String?) -> Self? {
        guard let raw, raw.utf16.count <= 160_000, let data = raw.data(using: .utf8),
              let value = try? JSONDecoder().decode(Self.self, from: data), value.kind == "text-progress",
              ["thinking", "writing"].contains(value.phase), value.preview.utf16.count <= 24_000,
              value.generatedCharacters >= 0, value.reasoningCharacters >= 0,
              value.startedAt >= 0, value.updatedAt >= 0,
              value.round.map({ (0...8).contains($0) }) ?? true
        else { return nil }
        return value
    }
}

/// Material saved when an Agent tool read a chapter, report, or historical archive.
public struct AIAgentEvidence: Codable, Identifiable, Equatable, Sendable {
    public struct Chapter: Codable, Equatable, Sendable {
        public let title: String
    }

    public let id: String
    public let kind: String
    public let novelId: String
    public let title: String
    public let chapterId: String?
    public let reportId: String?
    public let reportRevision: Int?
    public let origin: String
    public let excerpt: String
    public let truncated: Bool
    public let fromChapter: Chapter?
    public let throughChapter: Chapter?
}

public struct AIAgentEvent: Codable, Identifiable, Equatable, Sendable {
    public struct Metadata: Codable, Equatable, Sendable {
        public let tool: String?
        public let artifactTaskId: String?
        public let actionId: String?
        public let memoryId: String?
        public let sources: [AIAgentEvidence]?
        public let error: Bool?
        public let providerPresetId: String?
        public let model: String?
        public let round: Int?
    }
    public let id: Int64
    public let role: String
    public let content: String
    public let taskId: String
    public let requestId: String?
    public let metadata: Metadata
    public let createdAt: Int64

    public static func merged(_ old: [Self], _ incoming: [Self]) -> [Self] {
        var items = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        incoming.forEach { items[$0.id] = $0 }
        return items.values.sorted { $0.id < $1.id }
    }

    public static func containsPreview(_ events: [Self], task: AIAgentTask) -> Bool {
        guard let progress = task.progress else { return false }
        return events.contains { $0.role == "assistant" && $0.taskId == task.id && $0.metadata.round == progress.round }
    }
}

public enum AIAgentActionKind: String, Codable, Sendable {
    case applyRewrite = "apply_rewrite"
    case publishDraft = "publish_draft"
    case adoptCover = "adopt_cover"
    case restoreDraft = "restore_draft"
}

public struct AIAgentAction: Codable, Identifiable, Equatable, Sendable {
    public struct Preview: Codable, Equatable, Sendable {
        public let description: String
        public let before: String?
        public let after: String?
        public let candidateId: String?
        public let draftId: String?
    }
    public let id: String
    public let kind: AIAgentActionKind
    public let title: String
    public let status: String
    public let preview: Preview
    public let error: String
    public let createdAt: Int64
    public let canResume: Bool?
    public var canConfirm: Bool { status == "pending" || (status == "executing" && canResume == true) }
}

public struct AIAgentArtifact: Codable, Identifiable, Equatable, Sendable {
    public struct Draft: Codable, Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String
        public let content: String
        public let status: String
        public let revision: String
        public let minimumLengthWarning: String?
    }
    public struct Cover: Codable, Identifiable, Equatable, Sendable {
        public let id: String
        public let prompt: String
        public let imageUrl: String
    }
    public struct Rewrite: Codable, Equatable, Sendable {
        public let draftId: String
        public let before: String
        public let after: String
        public let baseRevision: String
        public let minimumLengthWarning: String?
    }
    public struct AnalysisReport: Codable, Equatable, Sendable {
        public let id: String
        public let title: String
        public let url: String
    }
    public let task: AIAgentTask
    public let drafts: [Draft]
    public let covers: [Cover]
    public let rewrite: Rewrite?
    public let analysisReport: AnalysisReport?
    public var id: String { task.id }
}

public struct AIAgentRecovery: Codable, Equatable, Sendable {
    public let taskId: String
    public let phase: String
    public let canResume: Bool
    public let message: String
}

public struct AIAgentDetail: Codable, Sendable {
    public struct MessageReceipt: Codable, Sendable {
        public let requestId: String
        public let taskId: String
    }

    public let session: AIAgentSession
    public let events: [AIAgentEvent]
    public let hasEarlier: Bool
    public let activeTask: AIAgentTask?
    public let artifacts: [AIAgentArtifact]
    public let actions: [AIAgentAction]
    public let memories: [AIAgentMemory]?
    public let summary: AIAgentSummary?
    public let messageReceipt: MessageReceipt?
    public let recovery: AIAgentRecovery?

    public func confirmsDelivery(of requestID: String) -> Bool {
        messageReceipt?.requestId == requestID || events.contains { $0.role == "user" && $0.requestId == requestID }
    }
}

public struct AIAgentSessions: Decodable, Sendable {
    public let sessions: [AIAgentSession]
    public let hasMore: Bool
}
public struct AIAgentSessionResponse: Decodable, Sendable { public let session: AIAgentSession }
public struct AIAgentEvents: Decodable, Sendable { public let events: [AIAgentEvent]; public let hasEarlier: Bool }
public struct AIAgentActionResponse: Decodable, Sendable { public let action: AIAgentAction }
public struct AIAgentTurn: Decodable, Sendable { public let taskId: String; public let created: Bool }
public struct AIAgentTaskEvent: Decodable, Sendable { public let type: String?; public let task: AIAgentTask }
public struct AIAgentTaskResponse: Decodable, Sendable { public let task: AIAgentTask }

public struct AIAgentPreset: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let scope: String
    public let model: String
    public let hasApiKey: Bool
    public let active: Bool
}
public struct AIAgentPresets: Decodable, Sendable { public let presets: [AIAgentPreset] }

/// The pending request survives navigation/relaunch and is resent only by an explicit user action.
public struct AIAgentPendingMessage: Codable, Equatable, Sendable {
    public let requestId: String
    public let content: String
    public let providerPresetId: String
    public init(content: String, providerPresetId: String) {
        requestId = "ios_agent_" + UUID().uuidString
        self.content = content
        self.providerPresetId = providerPresetId
    }
}

public struct AIAgentLocalDraft: Codable, Equatable, Sendable {
    public var input = ""
    public var providerPresetId = ""
    public var pending: AIAgentPendingMessage?
    public init() {}
}

/// A separate namespace prevents chat inputs from appearing as writing-workbench drafts.
public struct AIAgentDraftStore {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    private func key(site: String, userID: String, sessionID: String) -> String {
        let scope = [site, userID, sessionID].map { Data($0.utf8).base64EncodedString() }.joined(separator: ".")
        return "zhizhou.agentDraft.v1." + scope
    }
    public func read(site: String, userID: String, sessionID: String) -> AIAgentLocalDraft {
        guard !userID.isEmpty, !sessionID.isEmpty,
              let data = defaults.data(forKey: key(site: site, userID: userID, sessionID: sessionID)),
              let draft = try? JSONDecoder().decode(AIAgentLocalDraft.self, from: data) else { return .init() }
        return draft
    }
    public func save(_ draft: AIAgentLocalDraft, site: String, userID: String, sessionID: String) {
        guard !userID.isEmpty, !sessionID.isEmpty, let data = try? JSONEncoder().encode(draft) else { return }
        defaults.set(data, forKey: key(site: site, userID: userID, sessionID: sessionID))
    }
    public func remove(site: String, userID: String, sessionID: String) {
        defaults.removeObject(forKey: key(site: site, userID: userID, sessionID: sessionID))
    }
}
