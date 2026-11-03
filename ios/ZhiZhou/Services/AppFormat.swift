import Foundation

/// 面向用户的通用展示格式化。
enum AppFormat {
    /// 相对时间（如「3 分钟前」「昨天」）；无效时间显示短横线。
    static func relativeTime(_ milliseconds: Int64) -> String {
        guard milliseconds > 0 else { return "—" }
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
        return date.formatted(.relative(presentation: .named))
    }
}
