import Foundation

/// 管理后台共用的展示格式化（对齐 web/src/lib/admin.ts 的文案规则）。
enum AdminFormat {
    /// 相对时间（如「3 分钟前」「昨天」）；0 或无值显示「—」。
    static func relativeTime(_ ms: Int64) -> String {
        guard ms > 0 else { return "—" }
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        return date.formatted(.relative(presentation: .named))
    }

    /// 完整日期时间（如「2025 年 1 月 5 日下午 3:30」）；0 或无值显示「—」。
    static func dateTime(_ ms: Int64) -> String {
        guard ms > 0 else { return "—" }
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// 字节数 → 人类可读（B/KB/MB/GB/TB）。
    static func byteSize(_ bytes: Int?) -> String {
        guard let bytes, bytes > 0 else { return "—" }
        let units = ["B", "KB", "MB", "GB", "TB"]
        var value = Double(bytes)
        var index = 0
        while value >= 1024, index < units.count - 1 {
            value /= 1024
            index += 1
        }
        return index == 0
            ? "\(Int(value)) \(units[index])"
            : String(format: "%.1f %@", value, units[index])
    }

    // MARK: 任务状态

    /// 任务状态中文文案（对齐 web/src/lib/admin.ts JOB_STATUS_LABELS）。
    static func jobStatus(_ status: String) -> String {
        switch status {
        case "starting": return "启动中"
        case "fetching_list": return "获取目录"
        case "extracting_links": return "解析链接"
        case "preflight": return "抓取前检查"
        case "saving": return "保存中"
        case "scraping_chapters": return "抓取中"
        case "partial": return "部分完成"
        case "completed": return "已完成"
        case "failed": return "失败"
        case "cancelled": return "已终止"
        case "queued": return "排队中"
        default: return status.isEmpty ? "未知" : status
        }
    }

    static func isJobRunning(_ status: String) -> Bool {
        ["starting", "fetching_list", "extracting_links", "preflight", "scraping_chapters", "saving"].contains(status)
    }

    // MARK: 举报理由

    /// 举报理由中文文案（对齐 web/src/pages/admin/ModerationTab.tsx MODERATION_REASON_LABELS）。
    static func reportReason(_ reason: String) -> String {
        switch reason {
        case "spam": return "垃圾信息"
        case "offensive": return "攻击辱骂"
        case "spoiler": return "剧透"
        case "other": return "其他"
        default: return reason.isEmpty ? "其他" : reason
        }
    }

    // MARK: 注册模式

    static func registerModeLabel(_ mode: String) -> String {
        switch mode {
        case "open": return "开放注册"
        case "invite": return "邀请制"
        case "closed": return "关闭注册"
        default: return mode
        }
    }
}
