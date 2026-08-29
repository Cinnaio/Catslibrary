import Foundation
import Observation
import SwiftUI
import UIKit

/// 阅读设置：本地立即生效 + 与服务器 LWW 合并同步。
/// 键值表与 api/src/services/reader-settings.ts 完全一致。
@Observable
@MainActor
final class ReaderSettingsStore {
    static let shared = ReaderSettingsStore()
    private static let defaultValues: [String: String] = [
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

    private let localStore: ReaderLocalStore
    private(set) var activeUserID: String?
    var values: [String: String] = [:]
    var updatedAt: [String: Int64] = [:]
    private var dirtyKeys: Set<String> = []
    private(set) var lastSyncError: String?

    private var syncTask: Task<Void, Never>?
    private let knownKeys: Set<String> = [
        "fontSize", "fontFamily", "readerPageMode", "readerTheme", "readerLineHeight",
        "readerParagraphSpacing", "readerWakeLock", "readerPageWidth",
        "readerAutoScrollSpeed", "readerClickPaging", "contentMode",
    ]

    init(localStore: ReaderLocalStore = ReaderLocalStore()) {
        self.localStore = localStore
        values = Self.defaultValues
    }

    /// 切换当前账号时加载该账号自己的阅读设置；不再复用上一个账号的内存状态。
    func activate(userID: String) {
        let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            deactivate()
            return
        }
        guard activeUserID != trimmed else { return }

        syncTask?.cancel()
        persistCurrent()
        activeUserID = trimmed

        let snapshot = localStore.loadSettings(userID: trimmed)
            ?? ReaderSettingsSnapshot(values: Self.defaultValues, updatedAt: [:])
        apply(snapshot)
        lastSyncError = nil
    }

    /// 退出登录或会话失效时只保留该账号的本地快照，清空当前内存中的用户数据。
    func deactivate() {
        syncTask?.cancel()
        persistCurrent()
        activeUserID = nil
        apply(ReaderSettingsSnapshot(values: Self.defaultValues, updatedAt: [:]))
        lastSyncError = nil
    }

    var hasPendingSync: Bool { !dirtyKeys.isEmpty }

    // MARK: - 读取（带默认值）

    /// 字号档位（pt），与 Web 端 FONT_LABELS 对齐；下标 2 为默认 20pt。
    private let fontLevels: [CGFloat] = [15, 18, 20, 23, 27, 32]

    var fontSizeIndex: Int {
        let v = Int(values["fontSize"] ?? "2") ?? 2
        return max(0, min(v, fontLevels.count - 1))
    }

    var bodyFontSizeUnscaled: CGFloat { fontLevels[fontSizeIndex] }
    var fontLevelCount: Int { fontLevels.count }

    /// 服务端协议使用 `page`；兼容早期本地试验值 `paged`，但永远向外暴露协议值。
    var pageMode: String {
        values["readerPageMode"] == "page" || values["readerPageMode"] == "paged" ? "page" : "scroll"
    }
    var bodyFontSize: CGFloat {
        UIFontMetrics(forTextStyle: .body).scaledValue(for: bodyFontSizeUnscaled)
    }
    var lineHeight: CGFloat { CGFloat(Double(values["readerLineHeight"] ?? "1.95") ?? 1.95) }
    var themeName: String { values["readerTheme"] ?? "default" }
    var useSerif: Bool { (values["fontFamily"] ?? "serif") == "serif" }
    /// App Store 客户端始终使用安全内容模式，不接受本地或服务端返回的成人模式。
    var contentMode: String { ContentPolicy.clientMode }
    var clickPagingEnabled: Bool {
        let raw = values["readerClickPaging"] ?? "on"
        return raw == "on" || raw == "true" || raw == "1"
    }
    var wakeLockEnabled: Bool {
        let raw = values["readerWakeLock"] ?? "off"
        return raw == "on" || raw == "true" || raw == "1"
    }

    /// 将历史值归一为 Web 端协议值；默认纸面仍跟随系统昼夜。
    var normalizedTheme: String {
        switch themeName {
        case "night", "ink", "black", "dark": return "dark"
        case "default", "system": return "default"
        default: return themeName
        }
    }

    /// 当前纸面是否深色。system/default 跟随系统外观。
    func isDarkPaper(systemDark: Bool) -> Bool {
        switch normalizedTheme {
        case "dark": return true
        case "default": return systemDark
        case "eye", "paper": return false
        default: return false
        }
    }

    /// 阅读器整体配色方案：深色纸面强制 dark，浅色纸面强制 light，
    /// system/default 不强制，直接跟随系统（实现实时昼夜切换）。
    func colorSchemeOverride(systemDark: Bool) -> ColorScheme? {
        switch normalizedTheme {
        case "dark": return .dark
        case "default": return nil
        case "eye", "paper": return .light
        default: return nil
        }
    }

    func backgroundColor(systemDark: Bool) -> Color {
        if isDarkPaper(systemDark: systemDark) {
            return Color(hex: "1C1916")
        }
        switch normalizedTheme {
        case "eye": return Color(hex: "E7EBD9")
        case "paper": return Color(hex: "F2E3C6")
        default: return Color(.systemBackground)
        }
    }

    func textColor(systemDark: Bool) -> Color {
        isDarkPaper(systemDark: systemDark)
            ? Color(hex: "EDE4D8")
            : Color(.label)
    }

    var bodyFont: Font {
        useSerif
            ? SongtiFont.font(size: bodyFontSize, weight: .regular)
            : .system(size: bodyFontSize)
    }

    var titleFont: Font {
        useSerif
            ? SongtiFont.font(size: bodyFontSize + 4, weight: .bold)
            : .system(size: bodyFontSize + 4, weight: .bold)
    }

    /// 正文 UIFont（与 SwiftUI Font 同源），供 TextKit 分页测量与段落样式使用。
    var bodyUIFont: UIFont {
        useSerif
            ? SongtiFont.uiFont(size: bodyFontSize, weight: .regular)
            : UIFont.systemFont(ofSize: bodyFontSize)
    }

    var titleUIFont: UIFont {
        useSerif
            ? SongtiFont.uiFont(size: bodyFontSize + 4, weight: .bold)
            : UIFont.systemFont(ofSize: bodyFontSize + 4, weight: .bold)
    }

    /// 段间距系数：正文字号 * (系数)。系数来自 readerParagraphSpacing（与 Web 端一致）。
    var paragraphSpacing: CGFloat {
        let factor = Double(values["readerParagraphSpacing"] ?? "1.4") ?? 1.4
        return max(4, bodyFontSize * CGFloat(factor))
    }

    /// 原生阅读页将行距做成更舒展的视觉档位；协议值仍保持与 Web 端一致。
    var lineSpacing: CGFloat {
        switch lineHeight {
        case ..<1.85:
            return bodyFontSize * 0.95
        case ..<2.05:
            return bodyFontSize * 1.2
        default:
            return bodyFontSize * 1.55
        }
    }

    // MARK: - 写入 + 同步

    func set(_ key: String, _ value: String) {
        guard knownKeys.contains(key) else { return }
        var next = values
        next[key] = key == "contentMode" ? ContentPolicy.clientMode : value
        values = next
        var stamps = updatedAt
        stamps[key] = Int64(Date().timeIntervalSince1970 * 1000)
        updatedAt = stamps
        dirtyKeys.insert(key)
        persistCurrent()
        scheduleSync()
    }

    /// 进入 App 时拉取服务端设置（LWW：服务端时间戳更新则采纳）
    func syncFromServer() async {
        guard let userID = activeUserID, APIClient.shared.isAuthenticated else { return }
        struct Remote: Codable {
            let settings: [String: String]
            let updatedAt: [String: Int64]
        }
        do {
            let remote: Remote = try await APIClient.shared.get("/api/auth/reader-settings", auth: true)
            let result = ReaderSettingsMerge.merge(
                local: currentSnapshot,
                remote: ReaderSettingsSnapshot(values: remote.settings, updatedAt: remote.updatedAt),
                knownKeys: knownKeys
            )
            guard activeUserID == userID else { return }
            apply(result.snapshot)
            persistCurrent()
            lastSyncError = nil
            if result.shouldUpload {
                scheduleSync()
            }
        } catch {
            guard activeUserID == userID else { return }
            lastSyncError = error.localizedDescription
        }
    }

    /// 退出登录前可主动尝试发送一次；失败时 dirtyKeys 会留在本地快照中。
    func flush() async {
        syncTask?.cancel()
        await pushCurrentSnapshot()
    }

    /// 防抖同步：停止改动 800ms 后推送一次 LWW 负载
    private func scheduleSync() {
        syncTask?.cancel()
        let userID = activeUserID
        syncTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled, let self else { return }
            await self.pushCurrentSnapshot(for: userID)
        }
    }

    private var currentSnapshot: ReaderSettingsSnapshot {
        ReaderSettingsSnapshot(values: values, updatedAt: updatedAt, dirtyKeys: dirtyKeys)
    }

    private func apply(_ snapshot: ReaderSettingsSnapshot) {
        var nextValues = Self.defaultValues
        for (key, value) in snapshot.values where knownKeys.contains(key) {
            nextValues[key] = key == "contentMode" ? ContentPolicy.clientMode : value
        }
        values = nextValues
        updatedAt = snapshot.updatedAt.filter { knownKeys.contains($0.key) }
        dirtyKeys = snapshot.dirtyKeys.intersection(knownKeys)
    }

    private func persistCurrent() {
        guard let activeUserID else { return }
        localStore.saveSettings(currentSnapshot, userID: activeUserID)
    }

    private func pushCurrentSnapshot(for expectedUserID: String? = nil) async {
        guard let userID = activeUserID,
              (expectedUserID == nil || expectedUserID == userID),
              APIClient.shared.isAuthenticated,
              !dirtyKeys.isEmpty
        else { return }

        let snapshot = currentSnapshot
        do {
            let payload = ReaderSettingsPayload(settings: snapshot.values, updatedAt: snapshot.updatedAt)
            let body = try APIClient.shared.jsonBody(payload)
            try await APIClient.shared.requestVoid("PUT", "/api/auth/reader-settings", body: body, auth: true)
            guard activeUserID == userID else { return }

            for key in snapshot.dirtyKeys where dirtyKeys.contains(key) {
                if updatedAt[key] == snapshot.updatedAt[key], values[key] == snapshot.values[key] {
                    dirtyKeys.remove(key)
                }
            }
            persistCurrent()
            lastSyncError = nil
        } catch {
            guard activeUserID == userID else { return }
            lastSyncError = error.localizedDescription
            persistCurrent()
        }
    }
}
