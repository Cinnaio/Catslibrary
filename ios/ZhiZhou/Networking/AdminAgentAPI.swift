import Foundation
import ZhiZhouCore

/// Every request is bound to the account that opened this workspace.
struct AdminAgentAPI {
    let token: String
    static let root = "/api/ai/agent/sessions"
    static func path(_ id: String) -> String { root + "/" + ReaderMediaAPI.pathSegment(id) }

    func sessions(novelID: String = "", offset: Int = 0) async throws -> AIAgentSessions {
        var query = ["offset": String(offset)]
        if !novelID.isEmpty { query["novelId"] = novelID }
        return try await AdminAPI.parityRequest("GET", Self.root + "?" + HomeView.query(query), token: token)
    }

    func remove(_ id: String) async throws {
        let _: EmptyResponse = try await AdminAPI.parityRequest("DELETE", Self.path(id), token: token)
    }

    func create(novelID: String, afterChapterID: String) async throws -> AIAgentSession {
        let value: AIAgentSessionResponse = try await AdminAPI.parityRequest("POST", Self.root,
            body: ["novelId": novelID, "afterChapterId": afterChapterID], token: token)
        return value.session
    }

    func discoverBook(title: String, author: String) async throws -> AgentBookDiscoveryResult {
        try await AdminAPI.parityRequest("POST", "/api/book-import/discover",
            body: ["title": title, "author": author], token: token, timeout: 65)
    }

    func startBookConversation(_ novelID: String) async throws -> AIAgentSession {
        struct Directory: Decodable { let chapters: [ChapterMeta] }
        let directory: Directory = try await AdminAPI.parityRequest("GET",
            "/api/chapters?" + HomeView.query(["novelId": novelID]), token: token)
        guard !directory.chapters.isEmpty else { throw AgentBookNotReady() }
        return try await create(novelID: novelID, afterChapterID: "")
    }

    func detail(_ id: String, requestID: String? = nil) async throws -> AIAgentDetail {
        let query = requestID.map { "?" + HomeView.query(["requestId": $0]) } ?? ""
        return try await AdminAPI.parityRequest("GET", Self.path(id) + query, token: token)
    }

    func events(_ id: String, before: Int64) async throws -> AIAgentEvents {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/events?before=\(before)", token: token)
    }

    func message(_ id: String, pending: AIAgentPendingMessage) async throws -> AIAgentTurn {
        var body: [String: Any] = [
            "content": pending.content, "requestId": pending.requestId, "providerPresetId": pending.providerPresetId,
        ]
        switch pending.chapterPlanIntent {
        case .planning?: body["planningOnly"] = true
        case .writing(let revision)?: body["chapterPlanRevision"] = revision
        case nil: break
        }
        return try await AdminAPI.parityRequest("POST", Self.path(id) + "/messages", body: body, token: token)
    }

    func saveChapterPlan(_ id: String, input: AIAgentChapterPlanInput, expectedRevision: Int) async throws -> AIAgentChapterPlan {
        struct Response: Decodable { let plan: AIAgentChapterPlan }
        let fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input))
        let value: Response = try await AdminAPI.parityRequest("PATCH", Self.path(id) + "/chapter-plan",
            body: ["plan": fields, "expectedRevision": expectedRevision], token: token)
        return value.plan
    }

    func planBranches(_ id: String) async throws -> AIAgentPlanBranches {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/chapter-plan/branches", token: token)
    }

    enum PlanBranchChange {
        case save(name: String, revision: Int, operationID: String)
        case select(branchID: String, revision: Int, operationID: String)
        case remove(branchID: String)
    }

    func changePlanBranch(_ id: String, change: PlanBranchChange) async throws -> AIAgentPlanBranches {
        let path = Self.path(id) + "/chapter-plan/branches"
        switch change {
        case let .save(name, revision, operationID):
            return try await AdminAPI.parityRequest("POST", path,
                body: ["name": name, "expectedRevision": revision, "operationId": operationID], token: token)
        case let .select(branchID, revision, operationID):
            return try await AdminAPI.parityRequest("POST", path + "/" + ReaderMediaAPI.pathSegment(branchID) + "/select",
                body: ["expectedRevision": revision, "operationId": operationID], token: token)
        case .remove(let branchID):
            return try await AdminAPI.parityRequest("DELETE", path + "/" + ReaderMediaAPI.pathSegment(branchID), token: token)
        }
    }

    func resume(_ id: String, taskID: String) async throws -> AIAgentTurn {
        try await AdminAPI.parityRequest("POST", Self.path(id) + "/tasks/" + ReaderMediaAPI.pathSegment(taskID) + "/resume",
                                        body: ["confirmModelCall": true], token: token)
    }

    func save(_ id: String, brief: String, preferences: AIAgentPreferences, updatedAt: Int64, bookSettingsRevision: Int?) async throws -> AIAgentSession {
        let encoded = try JSONEncoder().encode(preferences.normalized)
        let fields = try JSONSerialization.jsonObject(with: encoded)
        var body: [String: Any] = [
            "brief": brief, "contentPreferences": fields, "expectedUpdatedAt": updatedAt,
        ]
        if let bookSettingsRevision { body["expectedBookSettingsRevision"] = bookSettingsRevision }
        let value: AIAgentSessionResponse = try await AdminAPI.parityRequest("PATCH", Self.path(id), body: body, token: token)
        return value.session
    }

    func memories(_ id: String, offset: Int = 0) async throws -> AIAgentMemoryPage {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/memories?offset=\(offset)", token: token)
    }

    func createMemory(_ id: String, title: String, content: String) async throws -> AIAgentMemory {
        let value: AIAgentMemoryResponse = try await AdminAPI.parityRequest("POST", Self.path(id) + "/memories",
            body: ["title": title, "content": content], token: token)
        return value.memory
    }

    func changeMemory(_ id: String, memory: AIAgentMemory, operation: String, title: String? = nil, content: String? = nil) async throws -> AIAgentMemory {
        var body: [String: Any] = ["operation": operation, "expectedRevision": memory.revision]
        if let title { body["title"] = title }
        if let content { body["content"] = content }
        let value: AIAgentMemoryResponse = try await AdminAPI.parityRequest("PATCH",
            Self.path(id) + "/memories/" + ReaderMediaAPI.pathSegment(memory.id), body: body, token: token)
        return value.memory
    }

    func memorySource(_ id: String, memoryID: String) async throws -> AIAgentMemorySource? {
        let value: AIAgentMemorySourceResponse = try await AdminAPI.parityRequest("GET",
            Self.path(id) + "/memories/" + ReaderMediaAPI.pathSegment(memoryID) + "/source", token: token)
        return value.source
    }

    func stop(_ id: String, taskID: String) async throws {
        let _: EmptyResponse = try await AdminAPI.parityRequest("POST", Self.path(id) + "/stop",
            body: ["taskId": taskID], token: token)
    }

    func artifact(_ id: String, taskID: String) async throws -> AIAgentArtifact {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/artifacts/" + ReaderMediaAPI.pathSegment(taskID), token: token)
    }

    func draftReview(_ draft: AIAgentArtifact.Draft, run: Bool = false) async throws -> AgentDraftReview? {
        let path = "/api/ai/writing/drafts/" + ReaderMediaAPI.pathSegment(draft.id) + "/review"
        let value: AgentDraftReviewResponse = try await AdminAPI.parityRequest(
            run ? "POST" : "GET", path, body: run ? ["expectedRevision": draft.revision] : nil,
            token: token, timeout: run ? 150 : 30)
        return value.report
    }

    func prepare(_ id: String, kind: AIAgentActionKind, targetID: String, title: String = "") async throws -> AIAgentAction {
        let value: AIAgentActionResponse = try await AdminAPI.parityRequest("POST", Self.path(id) + "/actions",
            body: ["kind": kind.rawValue, "targetId": targetID, "title": title], token: token)
        return value.action
    }

    func action(_ id: String, actionID: String) async throws -> AIAgentAction {
        let value: AIAgentActionResponse = try await AdminAPI.parityRequest("GET",
            Self.path(id) + "/actions/" + ReaderMediaAPI.pathSegment(actionID), token: token)
        return value.action
    }

    func chapterImpact(_ id: String, actionID: String, chapterCount: Int) async throws -> AIAgentChapterImpactReport {
        struct Response: Decodable { let report: AIAgentChapterImpactReport }
        let path = Self.path(id) + "/actions/" + ReaderMediaAPI.pathSegment(actionID) + "/impact"
        let value: Response = try await AdminAPI.parityRequest("POST", path, body: ["chapterCount": chapterCount],
                                                               token: token, timeout: 150)
        return value.report
    }

    func confirm(_ id: String, actionID: String) async throws -> AIAgentAction {
        let value: AIAgentActionResponse = try await AdminAPI.parityRequest("POST",
            Self.path(id) + "/actions/" + ReaderMediaAPI.pathSegment(actionID) + "/confirm", body: [:], token: token, timeout: 120)
        return value.action
    }

    func reject(_ id: String, actionID: String) async throws {
        let _: EmptyResponse = try await AdminAPI.parityRequest("POST",
            Self.path(id) + "/actions/" + ReaderMediaAPI.pathSegment(actionID) + "/reject", body: [:], token: token)
    }

    func presets() async throws -> [AIAgentPreset] {
        let value: AIAgentPresets = try await AdminAPI.parityRequest("GET", "/api/ai/provider-presets", token: token)
        return value.presets.filter { $0.scope == "text" }
    }

    func task(_ id: String) async throws -> AIAgentTask {
        let value: AIAgentTaskResponse = try await AdminAPI.parityRequest("GET",
            "/api/ai/tasks/" + ReaderMediaAPI.pathSegment(id), token: token)
        return value.task
    }

    func taskStream(_ id: String) -> AsyncThrowingStream<AIAgentTask, Error> {
        let lines = APIClient.shared.streamLines("/api/ai/tasks/" + ReaderMediaAPI.pathSegment(id) + "/stream",
                                                 auth: true, expectedToken: token)
        return AsyncThrowingStream { continuation in
            let reader = Task {
                do {
                    // This server emits one compact JSON object per data line; AsyncLineSequence may omit blank lines.
                    for try await line in lines {
                        try Task.checkCancellation()
                        guard line.hasPrefix("data:") else { continue }
                        guard line.utf8.count <= 700_000 else { throw APIError.invalidResponse }
                        let data = Data(line.dropFirst(5).trimmingCharacters(in: .whitespaces).utf8)
                        let event = try JSONDecoder().decode(AIAgentTaskEvent.self, from: data)
                        guard event.task.id == id else { throw APIError.invalidResponse }
                        continuation.yield(event.task)
                        if event.type == "done" || !event.task.isRunning { break }
                    }
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in reader.cancel() }
        }
    }

    static func coverURL(sessionID: String, candidateID: String) -> URL? {
        guard let base = ServerConfig.shared.baseURL else { return nil }
        return APIRequestURL.resolve(path(sessionID) + "/covers/" + ReaderMediaAPI.pathSegment(candidateID), relativeTo: base)
    }
}

private struct AgentBookNotReady: LocalizedError {
    var errorDescription: String? { "这本书还没有可读章节，请稍后重试。" }
}

struct AgentBookDiscoveryResult: Decodable {
    struct Local: Decodable, Identifiable {
        let id: String
        let title: String
        let author: String
        let chapterCount: Int
    }
    struct Source: Decodable, Identifiable {
        let title: String
        let author: String
        let siteName: String
        let url: String
        let matchScore: Int?
        var id: String { url }
    }
    struct Bucket: Decodable {
        let ok: Bool
        let siteName: String?
        let results: [Source]
    }
    let local: [Local]
    let sources: [String: Bucket]
}

private struct AgentDraftReviewResponse: Decodable {
    let report: AgentDraftReview?
}

struct AgentDraftReview: Decodable {
    struct Source: Decodable { let id: String; let title: String }
    struct Finding: Decodable {
        struct Evidence: Decodable { let sourceId: String; let quote: String }
        let category: String
        let description: String
        let draftQuote: String
        let evidence: [Evidence]

        var label: String {
            switch category {
            case "requirement": "作者要求"
            case "foreshadow": "伏笔提醒"
            case "relationship": "关系发展"
            default: "一致性"
            }
        }
    }
    let draftRevision: String
    let stale: Bool?
    let completeness: String?
    let sources: [Source]
    let findings: [Finding]
}
