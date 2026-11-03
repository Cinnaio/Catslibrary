import ZhiZhouCore

/// App 层的进度上传适配器；持久化与 outbox 状态机由 Core module 负责。
@MainActor
final class ReaderProgressStore {
    static let shared = ReaderProgressStore()

    private let outbox: ReaderProgressOutbox

    init(localStore: ReaderLocalStore = ReaderLocalStore()) {
        outbox = ReaderProgressOutbox(
            localStore: localStore,
            uploader: { body in
                let encoded = try APIClient.shared.jsonBody(body)
                try await APIClient.shared.requestVoid(
                    "POST",
                    "/api/progress",
                    body: encoded,
                    auth: true
                )
            },
            deleter: { novelID, clientUpdatedAt in
                let query = ReaderQuery.encode([
                    "novelId": novelID,
                    "clientUpdatedAt": String(clientUpdatedAt),
                ])
                try await APIClient.shared.requestVoid(
                    "DELETE",
                    "/api/progress?\(query)",
                    auth: true
                )
            }
        )
    }

    var activeUserID: String? { outbox.activeUserID }
    var pendingCount: Int { outbox.pendingCount }
    var pendingDeleteCount: Int { outbox.pendingDeleteCount }
    var lastSyncError: String? { outbox.lastSyncError }

    func pendingBody(for novelID: String) -> SaveProgressBody? {
        outbox.pendingBody(for: novelID)
    }

    /// 删除服务端阅读记录，并将删除操作放入同一个 outbox，避免旧进度在
    /// 网络恢复后把已删除记录重新创建。
    func delete(novelID: String) async -> Bool {
        guard !novelID.isEmpty, let userID = activeUserID else { return false }
        let sessionID = outbox.sessionID
        outbox.discard(novelID: novelID)
        await flush()
        await outbox.waitForIdle()
        guard activeUserID == userID, outbox.sessionID == sessionID else { return false }
        return outbox.pendingDelete(for: novelID) == nil
    }

    func activate(userID: String) {
        outbox.activate(userID: userID)
    }

    func deactivate() {
        outbox.deactivate()
    }

    func enqueue(_ body: SaveProgressBody) {
        outbox.enqueue(body)
    }

    func flush() async {
        guard APIClient.shared.isAuthenticated else { return }
        await outbox.flush()
    }
}
