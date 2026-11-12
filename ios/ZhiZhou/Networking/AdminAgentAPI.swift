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

    func detail(_ id: String, requestID: String? = nil) async throws -> AIAgentDetail {
        let query = requestID.map { "?" + HomeView.query(["requestId": $0]) } ?? ""
        return try await AdminAPI.parityRequest("GET", Self.path(id) + query, token: token)
    }

    func events(_ id: String, before: Int64) async throws -> AIAgentEvents {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/events?before=\(before)", token: token)
    }

    func message(_ id: String, pending: AIAgentPendingMessage) async throws -> AIAgentTurn {
        try await AdminAPI.parityRequest("POST", Self.path(id) + "/messages", body: [
            "content": pending.content, "requestId": pending.requestId, "providerPresetId": pending.providerPresetId,
        ], token: token)
    }

    func resume(_ id: String, taskID: String) async throws -> AIAgentTurn {
        try await AdminAPI.parityRequest("POST", Self.path(id) + "/tasks/" + ReaderMediaAPI.pathSegment(taskID) + "/resume",
                                        body: ["confirmModelCall": true], token: token)
    }

    func save(_ id: String, brief: String, preferences: AIAgentPreferences, updatedAt: Int64) async throws -> AIAgentSession {
        let encoded = try JSONEncoder().encode(preferences.normalized)
        let fields = try JSONSerialization.jsonObject(with: encoded)
        let value: AIAgentSessionResponse = try await AdminAPI.parityRequest("PATCH", Self.path(id), body: [
            "brief": brief, "contentPreferences": fields, "expectedUpdatedAt": updatedAt,
        ], token: token)
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
