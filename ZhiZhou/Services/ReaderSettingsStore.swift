import Foundation
import Observation
import SwiftUI
import UIKit

/// 阅读设置：本地立即生效 + 与服务器 LWW 合并同步。
/// 键值表与 api/src/services/reader-settings.ts 完全一致。
@Observable
final class ReaderSettingsStore {
    static let shared = ReaderSettingsStore()

    var values: [String: String] = [:]
    var updatedAt: [String: Int64] = [:]

    private var syncTask: Task<Void, Never>?
    private let knownKeys: Set<String> = [
        "fontSize", "fontFamily", "readerPageMode", "readerTheme", "readerLineHeight",
        "readerParagraphSpacing", "readerWakeLock", "readerPageWidth",
        "readerAutoScrollSpeed", "readerClickPaging", "contentMode",
    ]

    private init() {
        values = [
            "fontSize": "2",
            "fontFamily": "serif",
            "readerPageMode": "scroll",
            "readerTheme": "system",
            "readerLineHeight": "1.95",
            "readerParagraphSpacing": "1.4",
            "readerWakeLock": "true",
            "contentMode": "safe",
        ]
    }

    // MARK: - 读取（带默认值）

    var fontSizeIndex: Int {
        let levels = ["0", "1", "2", "3", "4", "5"]
        return levels.firstIndex(of: values["fontSize"] ?? "2") ?? 2
    }

    var bodyFontSizeUnscaled: CGFloat { [14, 16, 18, 20, 22, 24][fontSizeIndex] }
    var bodyFontSize: CGFloat {
        UIFontMetrics(forTextStyle: .body).scaledValue(for: bodyFontSizeUnscaled)
    }
    var lineHeight: CGFloat { CGFloat(Double(values["readerLineHeight"] ?? "1.95") ?? 1.95) }
    var themeName: String { values["readerTheme"] ?? "system" }
    var useSerif: Bool { (values["fontFamily"] ?? "serif") == "serif" }
    var contentMode: String { values["contentMode"] ?? "safe" }
    var wakeLockEnabled: Bool {
        let raw = values["readerWakeLock"] ?? "true"
        return raw == "true" || raw == "1"
    }

    /// 将 Web 端可能出现的暗色值归一成 iOS 认识的键。
    /// "default"（旧奶油纸面）归一为跟随系统，满足「默认纸面自动昼夜」。
    var normalizedTheme: String {
        switch themeName {
        case "night", "ink", "black", "dark": return "dark"
        case "default", "system": return "system"
        default: return themeName
        }
    }

    /// 当前纸面是否深色。system/default 跟随系统外观。
    func isDarkPaper(systemDark: Bool) -> Bool {
        switch normalizedTheme {
        case "dark": return true
        case "system": return systemDark
        case "eye", "paper": return false
        default: return false
        }
    }

    /// 阅读器整体配色方案：深色纸面强制 dark，浅色纸面强制 light，
    /// system/default 不强制，直接跟随系统（实现实时昼夜切换）。
    func colorSchemeOverride(systemDark: Bool) -> ColorScheme? {
        switch normalizedTheme {
        case "dark": return .dark
        case "system": return nil
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
            ? Font.system(size: bodyFontSize, design: .serif)
            : .system(size: bodyFontSize)
    }

    var titleFont: Font {
        useSerif
            ? Font.system(size: bodyFontSize + 4, weight: .bold, design: .serif)
            : .system(size: bodyFontSize + 4, weight: .bold)
    }

    var lineSpacing: CGFloat { bodyFontSize * (lineHeight - 1) }

    // MARK: - 写入 + 同步

    func set(_ key: String, _ value: String) {
        guard knownKeys.contains(key) else { return }
        var next = values
        next[key] = value
        values = next
        var stamps = updatedAt
        stamps[key] = Int64(Date().timeIntervalSince1970 * 1000)
        updatedAt = stamps
        scheduleSync()
    }

    /// 进入 App 时拉取服务端设置（LWW：服务端时间戳更新则采纳）
    func syncFromServer() async {
        guard APIClient.shared.isAuthenticated else { return }
        struct Remote: Codable {
            let settings: [String: String]
            let updatedAt: [String: Int64]
        }
        guard let remote: Remote = try? await APIClient.shared.get("/api/auth/reader-settings", auth: true) else { return }
        var nextValues = values
        var nextUpdated = updatedAt
        var changed = false
        for (key, value) in remote.settings {
            let serverTs = remote.updatedAt[key] ?? 0
            if (nextUpdated[key] ?? 0) < serverTs {
                nextValues[key] = value
                nextUpdated[key] = serverTs
                changed = true
            }
        }
        guard changed else { return }
        await MainActor.run {
            values = nextValues
            updatedAt = nextUpdated
        }
    }

    /// 防抖同步：停止改动 800ms 后推送一次 LWW 负载
    private func scheduleSync() {
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled, APIClient.shared.isAuthenticated else { return }
            let payload = ReaderSettingsPayload(settings: values, updatedAt: updatedAt)
            if let body = try? APIClient.shared.jsonBody(payload) {
                try? await APIClient.shared.requestVoid("PUT", "/api/auth/reader-settings", body: body, auth: true)
            }
        }
    }
}
