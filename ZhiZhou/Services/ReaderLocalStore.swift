import Foundation

/// 用户范围内的阅读设置快照。dirtyKeys 用于保证离线修改在进程重启后仍会上传。
struct ReaderSettingsSnapshot: Codable, Equatable, Sendable {
    var values: [String: String]
    var updatedAt: [String: Int64]
    var dirtyKeys: Set<String>

    init(
        values: [String: String],
        updatedAt: [String: Int64],
        dirtyKeys: Set<String> = []
    ) {
        self.values = values
        self.updatedAt = updatedAt
        self.dirtyKeys = dirtyKeys
    }

    private enum CodingKeys: String, CodingKey {
        case values
        case updatedAt
        case dirtyKeys
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        values = try container.decode([String: String].self, forKey: .values)
        updatedAt = try container.decode([String: Int64].self, forKey: .updatedAt)
        dirtyKeys = try container.decodeIfPresent(Set<String>.self, forKey: .dirtyKeys) ?? []
    }
}

struct ReaderSettingsMergeResult: Equatable, Sendable {
    let snapshot: ReaderSettingsSnapshot
    let shouldUpload: Bool
}

/// 阅读设置的 LWW 合并规则集中在一个纯 module，避免在登录和页面中各写一份。
enum ReaderSettingsMerge {
    static func merge(
        local: ReaderSettingsSnapshot,
        remote: ReaderSettingsSnapshot,
        knownKeys: Set<String>
    ) -> ReaderSettingsMergeResult {
        var merged = local
        var shouldUpload = false

        for key in knownKeys {
            let localTimestamp = local.updatedAt[key] ?? 0
            let remoteTimestamp = remote.updatedAt[key] ?? 0

            if let remoteValue = remote.values[key], remoteTimestamp > localTimestamp {
                merged.values[key] = remoteValue
                merged.updatedAt[key] = remoteTimestamp
                merged.dirtyKeys.remove(key)
            } else if merged.dirtyKeys.contains(key) {
                shouldUpload = true
            }
        }

        return ReaderSettingsMergeResult(snapshot: merged, shouldUpload: shouldUpload)
    }
}

/// 只负责用户范围内的本地持久化；网络同步由上层 module 控制，便于测试和替换。
struct ReaderLocalStore {
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func loadSettings(userID: String) -> ReaderSettingsSnapshot? {
        guard let data = defaults.data(forKey: settingsKey(userID: userID)) else { return nil }
        return try? JSONDecoder().decode(ReaderSettingsSnapshot.self, from: data)
    }

    func saveSettings(_ snapshot: ReaderSettingsSnapshot, userID: String) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: settingsKey(userID: userID))
    }

    func loadProgress(userID: String) -> [String: SaveProgressBody] {
        guard let data = defaults.data(forKey: progressKey(userID: userID)) else { return [:] }
        return (try? JSONDecoder().decode([String: SaveProgressBody].self, from: data)) ?? [:]
    }

    func saveProgress(_ progress: [String: SaveProgressBody], userID: String) {
        guard let data = try? JSONEncoder().encode(progress) else { return }
        defaults.set(data, forKey: progressKey(userID: userID))
    }

    private func settingsKey(userID: String) -> String {
        "zhizhou.readerSettings.user.\(encodedUserID(userID))"
    }

    private func progressKey(userID: String) -> String {
        "zhizhou.readerProgress.user.\(encodedUserID(userID))"
    }

    private func encodedUserID(_ userID: String) -> String {
        Data(userID.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
    }
}

/// 阅读进度 outbox：最新进度按小说保留，回到前台或下次登录时继续发送。
@MainActor
final class ReaderProgressStore {
    static let shared = ReaderProgressStore()

    private let localStore: ReaderLocalStore
    private(set) var activeUserID: String?
    private var pending: [String: SaveProgressBody] = [:]
    private(set) var lastSyncError: String?
    private var isFlushing = false
    private var flushRequested = false

    init(localStore: ReaderLocalStore = ReaderLocalStore()) {
        self.localStore = localStore
    }

    var pendingCount: Int { pending.count }

    func pendingBody(for novelID: String) -> SaveProgressBody? {
        pending[novelID]
    }

    func activate(userID: String) {
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

    func deactivate() {
        persistCurrent()
        activeUserID = nil
        pending = [:]
        lastSyncError = nil
        flushRequested = false
    }

    func enqueue(_ body: SaveProgressBody) {
        guard let activeUserID, !body.novelId.isEmpty else { return }
        if let current = pending[body.novelId], current.clientUpdatedAt > body.clientUpdatedAt {
            return
        }
        pending[body.novelId] = body
        localStore.saveProgress(pending, userID: activeUserID)
    }

    func flush() async {
        if isFlushing {
            flushRequested = true
            return
        }
        isFlushing = true
        defer { isFlushing = false }

        repeat {
            flushRequested = false
            await flushPending()
        } while flushRequested && activeUserID != nil && APIClient.shared.isAuthenticated
    }

    private func flushPending() async {
        guard let userID = activeUserID, APIClient.shared.isAuthenticated else { return }
        let snapshot = pending.values.sorted { $0.clientUpdatedAt < $1.clientUpdatedAt }

        for body in snapshot {
            do {
                let encoded = try APIClient.shared.jsonBody(body)
                try await APIClient.shared.requestVoid("POST", "/api/progress", body: encoded, auth: true)
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
