import Foundation

/// 只负责用户范围内的本地持久化；网络同步由上层 module 控制。
public struct ReaderLocalStore {
    public let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func loadSettings(userID: String) -> ReaderSettingsSnapshot? {
        guard let data = defaults.data(forKey: settingsKey(userID: userID)) else { return nil }
        return try? JSONDecoder().decode(ReaderSettingsSnapshot.self, from: data)
    }

    public func saveSettings(_ snapshot: ReaderSettingsSnapshot, userID: String) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: settingsKey(userID: userID))
    }

    public func loadProgress(userID: String) -> [String: SaveProgressBody] {
        guard let data = defaults.data(forKey: progressKey(userID: userID)) else { return [:] }
        return (try? JSONDecoder().decode([String: SaveProgressBody].self, from: data)) ?? [:]
    }

    public func saveProgress(_ progress: [String: SaveProgressBody], userID: String) {
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
