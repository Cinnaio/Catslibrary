import Foundation

extension AdminAPI {
    /// Bind every new admin request to its starting session, including mutations.
    static func parityRequest<T: Decodable>(
        _ method: String = "GET", _ path: String, body: [String: Any]? = nil,
        token: String? = nil, idempotencyKey: String? = nil, timeout: TimeInterval = 60
    ) async throws -> T {
        guard let session = token ?? APIClient.shared.token else { throw CancellationError() }
        return try await APIClient.shared.request(
            method, path, body: try body.map { try JSONSerialization.data(withJSONObject: $0) },
            auth: true, idempotencyKey: idempotencyKey, expectedToken: session, timeout: timeout
        )
    }

    static func followup(novelID: String, token: String) async throws -> NovelFollowup {
        try await parityRequest("GET", "/api/scrape?" + HomeView.query(["action": "followup", "novelId": novelID]), token: token)
    }

    static func saveFollowup(novelID: String, enabled: Bool, hours: Int, token: String) async throws -> NovelFollowup {
        try await parityRequest("POST", "/api/scrape", body: [
            "action": "followup-save", "novelId": novelID, "enabled": enabled, "intervalHours": hours,
        ], token: token)
    }

    static func importPreview(url: String, token: String) async throws -> BookImportPreview {
        try await parityRequest("POST", "/api/book-import/preview", body: ["sourceUrl": url], token: token, timeout: 180)
    }

    static func importTarget(runID: String, novelID: String?, token: String) async throws -> BookImportPreview {
        try await parityRequest("POST", "/api/book-import/\(ReaderMediaAPI.pathSegment(runID))/target",
                                body: ["targetNovelId": novelID.map { $0 as Any } ?? NSNull()], token: token)
    }

    static func commitImport(runID: String, chapters: Set<String>, metadata: Set<String>, token: String, key: String) async throws -> BookImportResult {
        try await parityRequest("POST", "/api/book-import/\(ReaderMediaAPI.pathSegment(runID))/commit", body: [
            "selectedChapterIds": chapters.sorted(), "metadataFields": metadata.sorted(), "metadataMode": "replace",
        ], token: token, idempotencyKey: key, timeout: 180)
    }
}
