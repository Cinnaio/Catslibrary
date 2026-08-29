import Foundation

/// 用户范围内的阅读设置快照。dirtyKeys 用于保证离线修改在进程重启后仍会上传。
public struct ReaderSettingsSnapshot: Codable, Equatable, Sendable {
    public var values: [String: String]
    public var updatedAt: [String: Int64]
    public var dirtyKeys: Set<String>

    public init(
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

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        values = try container.decode([String: String].self, forKey: .values)
        updatedAt = try container.decode([String: Int64].self, forKey: .updatedAt)
        dirtyKeys = try container.decodeIfPresent(Set<String>.self, forKey: .dirtyKeys) ?? []
    }
}

public struct ReaderSettingsMergeResult: Equatable, Sendable {
    public let snapshot: ReaderSettingsSnapshot
    public let shouldUpload: Bool

    public init(snapshot: ReaderSettingsSnapshot, shouldUpload: Bool) {
        self.snapshot = snapshot
        self.shouldUpload = shouldUpload
    }
}

/// 阅读设置的 LWW 合并规则集中在 Core module，避免在登录和页面中各写一份。
public enum ReaderSettingsMerge {
    public static func merge(
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

/// 不依赖 SwiftUI/UIKit 的阅读设置状态机；App 层只负责渲染和网络同步。
public struct ReaderSettingsState: Equatable, Sendable {
    public static let defaultValues: [String: String] = [
        "fontSize": "2",
        "fontFamily": "serif",
        "readerPageMode": "scroll",
        "readerClickPaging": "on",
        "readerTheme": "default",
        "readerLineHeight": "1.95",
        "readerParagraphSpacing": "1.4",
        "readerWakeLock": "off",
        "contentMode": "safe",
    ]

    public static let knownKeys: Set<String> = [
        "fontSize", "fontFamily", "readerPageMode", "readerTheme", "readerLineHeight",
        "readerParagraphSpacing", "readerWakeLock", "readerPageWidth",
        "readerAutoScrollSpeed", "readerClickPaging", "contentMode",
    ]

    public private(set) var values: [String: String]
    public private(set) var updatedAt: [String: Int64]
    public private(set) var dirtyKeys: Set<String>

    public init(snapshot: ReaderSettingsSnapshot? = nil) {
        values = Self.defaultValues
        updatedAt = [:]
        dirtyKeys = []
        if let snapshot {
            apply(snapshot)
        }
    }

    public var snapshot: ReaderSettingsSnapshot {
        ReaderSettingsSnapshot(values: values, updatedAt: updatedAt, dirtyKeys: dirtyKeys)
    }

    public var hasPendingSync: Bool { !dirtyKeys.isEmpty }

    public var fontSizeIndex: Int {
        let value = Int(values["fontSize"] ?? "2") ?? 2
        return max(0, min(value, 5))
    }

    public var contentMode: String { ContentPolicy.clientMode }

    public mutating func set(_ key: String, _ value: String, timestamp: Int64? = nil) {
        guard Self.knownKeys.contains(key) else { return }
        values[key] = key == "contentMode" ? ContentPolicy.clientMode : value
        updatedAt[key] = timestamp ?? Int64(Date().timeIntervalSince1970 * 1000)
        dirtyKeys.insert(key)
    }

    public mutating func apply(_ snapshot: ReaderSettingsSnapshot) {
        var nextValues = Self.defaultValues
        for (key, value) in snapshot.values where Self.knownKeys.contains(key) {
            nextValues[key] = key == "contentMode" ? ContentPolicy.clientMode : value
        }
        values = nextValues
        updatedAt = snapshot.updatedAt.filter { Self.knownKeys.contains($0.key) }
        dirtyKeys = snapshot.dirtyKeys.intersection(Self.knownKeys)
    }

    public mutating func markUploaded(_ snapshot: ReaderSettingsSnapshot) {
        for key in snapshot.dirtyKeys where dirtyKeys.contains(key) {
            if updatedAt[key] == snapshot.updatedAt[key], values[key] == snapshot.values[key] {
                dirtyKeys.remove(key)
            }
        }
    }
}
