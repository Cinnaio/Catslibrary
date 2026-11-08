import Foundation

public enum ProgressSyncError: LocalizedError {
    case unconfirmed
    case itemRejected(String)

    public var errorDescription: String? {
        switch self {
        case .unconfirmed: return "阅读进度尚未得到服务端确认"
        case .itemRejected(let message): return message
        }
    }
}

/// A 2xx response alone must never remove an offline progress operation.
public struct ProgressWriteAcknowledgement: Decodable, Sendable {
    private struct Receipt: Decodable, Sendable {
        let userId: String
        let novelId: String
        let clientUpdatedAt: Int64
    }
    private struct Progress: Decodable, Sendable {
        let novelId: String?
        let chapterId: String
        let updatedAt: Int64
    }
    private struct Tombstone: Decodable, Sendable {
        let novelId: String?
        let deletedAt: Int64
    }
    private let success: Bool
    private let acknowledged: Receipt?
    private let progress: Progress?
    private let tombstone: Tombstone?
    private let explicitEmptyState: Bool

    private enum CodingKeys: String, CodingKey { case success, acknowledged, progress, tombstone }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        success = try values.decode(Bool.self, forKey: .success)
        acknowledged = try values.decodeIfPresent(Receipt.self, forKey: .acknowledged)
        progress = try values.decodeIfPresent(Progress.self, forKey: .progress)
        tombstone = try values.decodeIfPresent(Tombstone.self, forKey: .tombstone)
        explicitEmptyState = values.contains(.progress) && values.contains(.tombstone)
            && progress == nil && tombstone == nil
    }

    public func validate(userID: String, novelID: String, clientUpdatedAt: Int64, deleting: Bool = false) throws {
        guard success else { throw ProgressSyncError.unconfirmed }
        if let acknowledged {
            guard acknowledged.userId == userID, acknowledged.novelId == novelID,
                  acknowledged.clientUpdatedAt == clientUpdatedAt else { throw ProgressSyncError.unconfirmed }
            return
        }
        // Older APIs return authoritative state for authenticated writes, but
        // only {success:true} for anonymous writes. Preserve that distinction.
        if let progress, !progress.chapterId.isEmpty, progress.updatedAt > 0,
           progress.novelId == nil || progress.novelId == novelID { return }
        if let tombstone, tombstone.deletedAt > 0,
           tombstone.novelId == nil || tombstone.novelId == novelID { return }
        if deleting && explicitEmptyState { return }
        throw ProgressSyncError.unconfirmed
    }
}
