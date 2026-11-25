import Foundation
import ZhiZhouCore

extension AdminAgentAPI {
    func storyThreads(_ id: String) async throws -> AIAgentStoryThreadState {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/story-threads", token: token)
    }
    func saveStoryThread(_ id: String, body: [String: Any]) async throws -> AIAgentStoryThreadState {
        try await AdminAPI.parityRequest("POST", Self.path(id) + "/story-threads", body: body, token: token)
    }
    func removeStoryThread(_ id: String, plan: AIAgentStoryThreadPlan) async throws {
        let _: EmptyResponse = try await AdminAPI.parityRequest("DELETE", Self.path(id) + "/story-threads/" + ReaderMediaAPI.pathSegment(plan.id),
            body: ["expectedRevision": plan.revision], token: token)
    }
    func applyStoryThreads(_ id: String, plans: [AIAgentStoryThreadPlan], planRevision: Int) async throws -> AIAgentChapterPlan {
        struct Response: Decodable { let plan: AIAgentChapterPlan }
        let response: Response = try await AdminAPI.parityRequest("POST", Self.path(id) + "/story-threads/apply",
            body: ["ids": plans.map(\.id), "revisions": plans.map(\.revision), "expectedPlanRevision": planRevision], token: token)
        return response.plan
    }
    func writingReferences(query: String = "", offset: Int = 0) async throws -> AIAgentWritingReferences {
        try await AdminAPI.parityRequest("GET", "/api/ai/agent/writing-references?" + HomeView.query(["q": query, "offset": String(offset)]), token: token)
    }
    func saveWritingReference(id: String?, title: String, tags: [String], content: String, usage: String, revision: Int?) async throws -> AIAgentWritingReference {
        struct Response: Decodable { let reference: AIAgentWritingReference }
        var body: [String: Any] = ["title": title, "tags": tags, "content": content, "usage": usage]
        if let revision { body["expectedRevision"] = revision }
        let path = "/api/ai/agent/writing-references" + (id.map { "/" + ReaderMediaAPI.pathSegment($0) } ?? "")
        let response: Response = try await AdminAPI.parityRequest(id == nil ? "POST" : "PATCH", path, body: body, token: token)
        return response.reference
    }
    func removeWritingReference(_ reference: AIAgentWritingReference) async throws {
        let _: EmptyResponse = try await AdminAPI.parityRequest("DELETE", "/api/ai/agent/writing-references/" + ReaderMediaAPI.pathSegment(reference.id),
            body: ["expectedRevision": reference.revision], token: token)
    }
}
