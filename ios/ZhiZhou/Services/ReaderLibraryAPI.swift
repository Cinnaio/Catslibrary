import Foundation

struct ReaderBookmark: Codable, Identifiable {
    let id: String
    let novelId: String
    let novelTitle: String
    let chapterId: String
    let chapterTitle: String
    let chapterOrder: Int
    let note: String
    let timestamp: Int64
}

struct ReaderBookmarksResponse: Decodable { let bookmarks: [ReaderBookmark] }
private struct ReaderBookmarkResponse: Decodable { let bookmark: ReaderBookmark }
private struct BookmarkKey: Encodable { let novelId: String; let chapterId: String }
private struct BookmarkWrite: Encodable { let novelId: String; let chapterId: String; let note: String }

/// Atomic writes preserve changes made by the other client. PUT replaces the complete library and must not be used here.
@MainActor
enum ReaderLibraryAPI {
    static func bookmarks() async throws -> [ReaderBookmark] {
        let response: ReaderBookmarksResponse = try await APIClient.shared.getReader("/api/bookmarks", auth: true)
        return response.bookmarks
    }

    static func save(novelID: String, chapterID: String, note: String) async throws -> ReaderBookmark {
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }
        let body = try APIClient.shared.jsonBody(BookmarkWrite(novelId: novelID, chapterId: chapterID, note: note))
        let response: ReaderBookmarkResponse = try await APIClient.shared.request(
            "POST", "/api/bookmarks", body: body, auth: true, expectedToken: token
        )
        return response.bookmark
    }

    static func remove(novelID: String, chapterID: String) async throws {
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }
        let body = try APIClient.shared.jsonBody(BookmarkKey(novelId: novelID, chapterId: chapterID))
        let _: EmptyResponse = try await APIClient.shared.request(
            "DELETE", "/api/bookmarks", body: body, auth: true, expectedToken: token
        )
    }
}
