import Foundation

/// 最新阅读位置与投递队列分离；确认送达不会删除本机位置。
public struct ReaderProgressSnapshot: Codable, Equatable, Sendable {
    public private(set) var positions: [String: SaveProgressBody] = [:]
    public private(set) var deletedAt: [String: Int64] = [:]

    public init() {}

    @discardableResult
    public mutating func remember(_ body: SaveProgressBody) -> Bool {
        guard !body.novelId.isEmpty, !body.chapterId.isEmpty,
              body.clientUpdatedAt > 0, body.scrollPercent.isFinite,
              (0...1).contains(body.scrollPercent),
              body.clientUpdatedAt > (deletedAt[body.novelId] ?? 0),
              body.clientUpdatedAt >= (positions[body.novelId]?.clientUpdatedAt ?? 0)
        else { return false }
        positions[body.novelId] = body
        return true
    }

    public mutating func discard(novelID: String, at timestamp: Int64) {
        guard !novelID.isEmpty, timestamp > 0 else { return }
        let version = max(deletedAt[novelID] ?? 0, timestamp)
        deletedAt[novelID] = version
        if let body = positions[novelID], body.clientUpdatedAt <= version {
            positions.removeValue(forKey: novelID)
        }
    }
}
