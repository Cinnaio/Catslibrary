import Foundation
import Combine

struct SourceThought: Decodable, Identifiable {
    let id: String
    let displayName: String
    let avatarUrl: String
    let text: String
    let createdAt: Double
    let likeCount: Int
    let replyCount: Int
    let images: [String]
    let replyToName: String?
}
struct SourceThoughtSync: Decodable {
    let state: String
    let savedCount: Int
    let updatedAt: Double
    let complete: Bool
    var updatedText: String? {
        guard updatedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: updatedAt / 1000).formatted(.dateTime.month().day().hour().minute())
    }
    var summary: String {
        let saved = "已保存 \(savedCount) 条"
        switch state {
        case "queued": return "\(saved) · 等待同步"
        case "syncing": return "\(saved) · 正在同步"
        case "partial": return "\(saved) · 同步暂缓，稍后重试"
        case "unavailable": return "\(saved) · 来源暂不可用"
        default: return "\(saved) · 已同步"
        }
    }
}
struct SourceThoughtPage: Decodable {
    let sync: SourceThoughtSync?
    var items: [SourceThought]
    let total: Int
    let cursor: String
    let hasMore: Bool
}
struct SourceThoughtCounts: Decodable {
    let sync: SourceThoughtSync?
    struct Source: Decodable { let id: String; let label: String }
    struct Paragraph: Decodable { let paragraphIndex: Int; let paragraphHash: String; let count: Int }
    let available: Bool
    let source: Source?
    let paragraphs: [Paragraph]
    let unmatchedCount: Int
}
struct SourceThoughtAnchor: Hashable {
    let chapterID: String
    let paragraphIndex: Int
    let paragraphHash: String
}
enum SourceThoughtsAPI {
    static func query(_ values: [String: String]) -> String {
        var c = URLComponents()
        c.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return "/api/source-thoughts?" + (c.percentEncodedQuery ?? "")
    }
    static func counts(chapterID: String, refresh: Bool = false) async throws -> SourceThoughtCounts {
        try await APIClient.shared.getReader(query(["chapterId": chapterID, "refresh": refresh ? "1" : "0"]), refresh: true)
    }
    static func page(anchor: SourceThoughtAnchor, cursor: String, commentID: String? = nil, refresh: Bool = false) async throws -> SourceThoughtPage {
        var values = ["chapterId": anchor.chapterID, "paragraphIndex": String(anchor.paragraphIndex),
                      "paragraphHash": anchor.paragraphHash, "cursor": cursor, "action": commentID == nil ? "comments" : "replies"]
        values["commentId"] = commentID
        if refresh { values["refresh"] = "1" }
        return try await APIClient.shared.getReader(query(values), refresh: true)
    }
}
@MainActor final class SourceThoughtsStore: ObservableObject {
    @Published private(set) var key = ""
    @Published private(set) var counts: SourceThoughtCounts?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    private var generation = UUID()
    func load(chapterID: String, key: String, enabled: Bool, refresh: Bool = false) async {
        let generation = UUID()
        self.generation = generation
        self.key = key; counts = nil; error = nil; loading = enabled
        guard enabled else { return }
        do {
            let response = try await SourceThoughtsAPI.counts(chapterID: chapterID, refresh: refresh)
            guard !Task.isCancelled, self.generation == generation else { return }
            counts = response
        } catch {
            guard !Task.isCancelled, self.generation == generation else { return }
            self.error = "来源想法暂时无法加载，本站想法仍可使用。"
        }
        if self.generation == generation { loading = false }
    }
}
struct SourceThoughtPanelContext {
    let counts: SourceThoughtCounts?
    let anchor: SourceThoughtAnchor?
    let loading: Bool
    let error: String?
    let retry: () -> Void
    var label: String { counts?.source?.label ?? "书源" }
    var visible: Bool { counts?.available == true || loading || error != nil }
}
