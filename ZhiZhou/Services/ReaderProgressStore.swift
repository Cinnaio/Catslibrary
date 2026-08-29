import ZhiZhouCore

/// App 层的进度上传适配器；持久化与 outbox 状态机由 Core module 负责。
@MainActor
final class ReaderProgressStore {
    static let shared = ReaderProgressStore()

    private let outbox: ReaderProgressOutbox

    init(localStore: ReaderLocalStore = ReaderLocalStore()) {
        outbox = ReaderProgressOutbox(localStore: localStore) { body in
            let encoded = try APIClient.shared.jsonBody(body)
            try await APIClient.shared.requestVoid(
                "POST",
                "/api/progress",
                body: encoded,
                auth: true
            )
        }
    }

    var activeUserID: String? { outbox.activeUserID }
    var pendingCount: Int { outbox.pendingCount }
    var lastSyncError: String? { outbox.lastSyncError }

    func pendingBody(for novelID: String) -> SaveProgressBody? {
        outbox.pendingBody(for: novelID)
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
