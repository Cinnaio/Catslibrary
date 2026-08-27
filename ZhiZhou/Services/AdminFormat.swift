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

    // MARK: 分类输入

    /// 统一分类输入：支持中英文逗号 / 顿号 / 分号分隔，去重（忽略大小写）。
    static func parseCategories(_ input: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in input.split(whereSeparator: { $0 == "," || $0 == "，" || $0 == "、" || $0 == ";" || $0 == "；" }) {
            let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty, seen.insert(s.lowercased()).inserted {
                out.append(s)
            }
        }
        return out
    }

    // MARK: AI 服务

    /// AI 任务类型中文文案（对齐 web/src/pages/admin/ai 各面板）。
    static func aiTaskKind(_ kind: String) -> String {
        switch kind {
        case "summary": return "前情提要"
        case "catchup": return "回顾总结"
        case "continue": return "续写"
        case "write_outline": return "大纲"
        case "write_chapter": return "章节创作"
        case "writing_title": return "标题生成"
        case "cover": return "封面"
        case "cover_prompt": return "封面描述词"
        case "test": return "连通性测试"
        default: return kind.isEmpty ? "未知" : kind
        }
    }

    /// AI 任务状态中文文案。
    static func aiTaskStatus(_ status: String) -> String {
        switch status {
        case "queued": return "排队中"
        case "running": return "运行中"
        case "completed": return "已完成"
        case "failed": return "失败"
        case "cancelled": return "已取消"
        default: return status.isEmpty ? "未知" : status
        }
    }

    /// 成本（毫分 → 元，对齐 web formatCost：millicents / 100_000）。
    static func aiCost(_ millicents: Int?) -> String {
        guard let millicents, millicents > 0 else { return "—" }
        return String(format: "¥%.4f", Double(millicents) / 100_000)
    }
}
