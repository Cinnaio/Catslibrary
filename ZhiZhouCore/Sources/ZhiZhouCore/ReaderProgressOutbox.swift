import Foundation

public typealias ProgressUploader = (SaveProgressBody) async throws -> Void

/// 阅读进度 outbox：最新进度按小说保留，回到前台或下次登录时继续发送。
@MainActor
public final class ReaderProgressOutbox {
    private let localStore: ReaderLocalStore
    private let uploader: ProgressUploader
    public private(set) var activeUserID: String?
    private var pending: [String: SaveProgressBody] = [:]
    public private(set) var lastSyncError: String?
    private var isFlushing = false
    private var flushRequested = false

    public init(
        localStore: ReaderLocalStore = ReaderLocalStore(),
        uploader: @escaping ProgressUploader
    ) {
        self.localStore = localStore
        self.uploader = uploader
    }

    public var pendingCount: Int { pending.count }

    public func pendingBody(for novelID: String) -> SaveProgressBody? {
        pending[novelID]
    }

    public func activate(userID: String) {
        let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            deactivate()
            return
        }
        guard activeUserID != trimmed else { return }

        persistCurrent()
        activeUserID = trimmed
        pending = localStore.loadProgress(userID: trimmed)
        lastSyncError = nil
    }

    public func deactivate() {
        persistCurrent()
        activeUserID = nil
        pending = [:]
        lastSyncError = nil
        flushRequested = false
    }

    public func enqueue(_ body: SaveProgressBody) {
        guard let activeUserID, !body.novelId.isEmpty else { return }
        if let current = pending[body.novelId], current.clientUpdatedAt > body.clientUpdatedAt {
            return
        }
        pending[body.novelId] = body
        localStore.saveProgress(pending, userID: activeUserID)
    }

    public func flush() async {
        if isFlushing {
            flushRequested = true
            return
        }
        isFlushing = true
        defer { isFlushing = false }

        repeat {
            flushRequested = false
            await flushPending()
        } while flushRequested && activeUserID != nil
    }

    private func flushPending() async {
        guard let userID = activeUserID else { return }
        let snapshot = pending.values.sorted { $0.clientUpdatedAt < $1.clientUpdatedAt }

        for body in snapshot {
            do {
                try await uploader(body)
                guard activeUserID == userID else { return }
                if pending[body.novelId] == body {
                    pending.removeValue(forKey: body.novelId)
                    localStore.saveProgress(pending, userID: userID)
                }
                lastSyncError = nil
            } catch {
                guard activeUserID == userID else { return }
                lastSyncError = error.localizedDescription
                localStore.saveProgress(pending, userID: userID)
                return
            }
        }
    }

    private func persistCurrent() {
        guard let activeUserID else { return }
        localStore.saveProgress(pending, userID: activeUserID)
    }
}
