import Foundation
import ZhiZhouCore

extension AdminAgentAPI {
    func writingStudio(_ id: String) async throws -> AIAgentWritingStudio {
        try await AdminAPI.parityRequest("GET", Self.path(id) + "/writing-studio", token: token)
    }
    func saveWritingCard(_ sessionID: String, card: AIAgentWritingCard) async throws -> AIAgentWritingCard {
        struct Response: Decodable { let card: AIAgentWritingCard }
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(card))
        let existing = !card.id.isEmpty
        var body: [String: Any] = ["card": encoded]
        if existing { body["expectedRevision"] = card.revision }
        let response: Response = try await AdminAPI.parityRequest(existing ? "PATCH" : "POST",
            Self.path(sessionID) + "/writing-studio/cards" + (existing ? "/" + ReaderMediaAPI.pathSegment(card.id) : ""), body: body, token: token)
        return response.card
    }
    func changeWritingCard(_ sessionID: String, card: AIAgentWritingCard, operation: String, version: Int? = nil) async throws -> AIAgentWritingCard {
        struct Response: Decodable { let card: AIAgentWritingCard }
        var body: [String: Any] = ["operation": operation, "expectedRevision": card.revision]
        if let version { body["version"] = version }
        let response: Response = try await AdminAPI.parityRequest("POST", Self.path(sessionID) + "/writing-studio/cards/" + ReaderMediaAPI.pathSegment(card.id) + "/change", body: body, token: token)
        return response.card
    }
    func writingCardVersions(_ sessionID: String, cardID: String) async throws -> [AIAgentWritingVersion] {
        struct Response: Decodable { let versions: [AIAgentWritingVersion] }
        let response: Response = try await AdminAPI.parityRequest("GET", Self.path(sessionID) + "/writing-studio/cards/" + ReaderMediaAPI.pathSegment(cardID) + "/versions", token: token)
        return response.versions
    }
    func assembleWritingScenes(_ sessionID: String, title: String, scenes: [AIAgentWritingCard]) async throws {
        struct Response: Decodable { let draftId: String; let taskId: String }
        let _: Response = try await AdminAPI.parityRequest("POST", Self.path(sessionID) + "/writing-studio/assemble",
            body: ["title": title, "scenes": scenes.map { ["id": $0.id, "revision": $0.revision] as [String: Any] }], token: token)
    }
}
