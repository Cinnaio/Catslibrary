import Foundation

/// 阅读页段评 API：公开读取，发布和删除需要登录。
enum ThoughtsAPI {
    static func list(chapterID: String) async throws -> PublicThoughtsResponse {
        try await APIClient.shared.get(
            "/api/thoughts?chapterId=\(encodeQueryValue(chapterID))"
        )
    }

    static func create(payload: ThoughtCreatePayload) async throws -> Thought {
        let response: ThoughtResponse = try await APIClient.shared.post(
            "/api/thoughts",
            body: try APIClient.shared.jsonBody(payload),
            auth: true
        )
        return response.thought
    }

    static func remove(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete(
            "/api/thoughts?id=\(encodeQueryValue(id))",
            auth: true
        )
    }

    private static func encodeQueryValue(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+#?")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
