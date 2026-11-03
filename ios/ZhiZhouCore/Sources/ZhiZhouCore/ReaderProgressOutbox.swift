import Foundation

public typealias ProgressUploader = (SaveProgressBody) async throws -> Void
public typealias ProgressDeleter = (String, Int64) async throws -> Void

/// 阅读进度 outbox：最新进度按小说保留，回到前台或下次登录时继续发送。
@MainActor
public final class ReaderProgressOutbox {
    private struct Session: Equatable {
        let userID: String
        let generation: UUID
    }

    private let localStore: ReaderLocalStore
    private let uploader: ProgressUploader
    private let deleter: ProgressDeleter
    public private(set) var activeUserID: String?
    public private(set) var sessionID = UUID()
    private var pending: [String: SaveProgressBody] = [:]
    private var pendingDeletes: [String: Int64] = [:]
    public private(set) var lastSyncError: String?
    private var isFlushing = false
    private var flushRequested = false
    private var idleWaiters: [CheckedContinuation<Void, Never>] = []

    public init(
        localStore: ReaderLocalStore = ReaderLocalStore(),
        uploader: @escaping ProgressUploader,
        deleter: @escaping ProgressDeleter = { _, _ in }
    ) {
        self.localStore = localStore
        self.uploader = uploader
        self.deleter = deleter
    }

    public var pendingCount: Int { pending.count }
    public var pendingDeleteCount: Int { pendingDeletes.count }

    public func pendingBody(for novelID: String) -> SaveProgressBody? {
        pending[novelID]
    }

    public func pendingDelete(for novelID: String) -> Int64? {
        pendingDeletes[novelID]
    }

    public func activate(userID: String) {
        let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            deactivate()
            return
        }
        guard activeUserID != trimmed else { return }

        persistCurrent()
        sessionID = UUID()
        activeUserID = trimmed
        pending = localStore.loadProgress(userID: trimmed)
        pendingDeletes = localStore.loadProgressTombstones(userID: trimmed)
        lastSyncError = nil
    }

    public func deactivate() {
        persistCurrent()
        sessionID = UUID()
        activeUserID = nil
        pending = [:]
        pendingDeletes = [:]
        lastSyncError = nil
        flushRequested = false
    }

    public func enqueue(_ body: SaveProgressBody) {
        guard let activeUserID, !body.novelId.isEmpty else { return }
        if let deletedAt = pendingDeletes[body.novelId], body.clientUpdatedAt <= deletedAt {
            return
        }
        if let current = pending[body.novelId], current.clientUpdatedAt > body.clientUpdatedAt {
            return
        }
        pending[body.novelId] = body
        localStore.saveProgress(pending, userID: activeUserID)
    }

    /// Add a deletion tombstone and discard any older unsent progress for this novel.
    /// The tombstone stays in the outbox until the server acknowledges the delete.
    public func discard(novelID: String, deletedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        guard let activeUserID, !novelID.isEmpty else { return }
        pending.removeValue(forKey: novelID)
        let timestamp = max(1, deletedAt)
        if let current = pendingDeletes[novelID] {
            pendingDeletes[novelID] = max(current, timestamp)
        } else {
            pendingDeletes[novelID] = timestamp
        }
        localStore.saveProgress(pending, userID: activeUserID)
        localStore.saveProgressTombstones(pendingDeletes, userID: activeUserID)
        if isFlushing { flushRequested = true }
    }

    /// Wait until the current flush, including any requested follow-up pass, is done.
    public func waitForIdle() async {
        guard isFlushing else { return }
        await withCheckedContinuation { continuation in
            idleWaiters.append(continuation)
        }
    }

    public func flush() async {
        if isFlushing {
            flushRequested = true
            return
        }
        isFlushing = true
        defer {
            isFlushing = false
            let waiters = idleWaiters
            idleWaiters.removeAll(keepingCapacity: false)
            waiters.forEach { $0.resume() }
        }

        repeat {
            flushRequested = false
            guard let session = currentSession else { break }
            await flushPending(session: session)
        } while flushRequested && activeUserID != nil
    }

    private func flushPending(session: Session) async {
        guard isCurrent(session) else { return }
        let userID = session.userID

        // Deletes always go first. This makes a progress deletion win over an
        // older in-flight progress snapshot and keeps the deletion authoritative
        // when the network is intermittent.
        let deleteSnapshot = pendingDeletes
            .sorted { $0.value < $1.value }
        for (novelID, deletedAt) in deleteSnapshot {
            do {
                try await deleter(novelID, deletedAt)
                guard isCurrent(session) else { return }
                if pendingDeletes[novelID] == deletedAt {
                    pendingDeletes.removeValue(forKey: novelID)
                    localStore.saveProgressTombstones(pendingDeletes, userID: userID)
                }
                lastSyncError = nil
            } catch {
                guard isCurrent(session) else { return }
                lastSyncError = error.localizedDescription
                localStore.saveProgressTombstones(pendingDeletes, userID: userID)
                return
            }
        }

        let snapshot = pending.values.sorted { $0.clientUpdatedAt < $1.clientUpdatedAt }

        for body in snapshot {
            do {
                try await uploader(body)
                guard isCurrent(session) else { return }
                if pending[body.novelId] == body {
                    pending.removeValue(forKey: body.novelId)
                    localStore.saveProgress(pending, userID: userID)
                }
                lastSyncError = nil
            } catch {
                guard isCurrent(session) else { return }
                lastSyncError = error.localizedDescription
                localStore.saveProgress(pending, userID: userID)
                return
            }
        }
    }

    private func persistCurrent() {
        guard let activeUserID else { return }
        localStore.saveProgress(pending, userID: activeUserID)
        localStore.saveProgressTombstones(pendingDeletes, userID: activeUserID)
    }

    private var currentSession: Session? {
        guard let activeUserID else { return nil }
        return Session(userID: activeUserID, generation: sessionID)
    }

    private func isCurrent(_ session: Session) -> Bool {
        activeUserID == session.userID && sessionID == session.generation
    }
}
