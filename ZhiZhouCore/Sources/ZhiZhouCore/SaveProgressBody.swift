import Foundation

/// POST /api/progress 的请求体。
public struct SaveProgressBody: Codable, Equatable, Sendable {
    public let novelId: String
    public let chapterId: String
    public let chapterTitle: String
    public let chapterOrder: Int
    public let scrollPercent: Double
    public let pageMode: String
    public let clientUpdatedAt: Int64

    public init(
        novelId: String,
        chapterId: String,
        chapterTitle: String,
        chapterOrder: Int,
        scrollPercent: Double,
        pageMode: String,
        clientUpdatedAt: Int64
    ) {
        self.novelId = novelId
        self.chapterId = chapterId
        self.chapterTitle = chapterTitle
        self.chapterOrder = chapterOrder
        self.scrollPercent = scrollPercent
        self.pageMode = pageMode
        self.clientUpdatedAt = clientUpdatedAt
    }
}
