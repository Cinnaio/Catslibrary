import Foundation

/// 账号模式须由服务端确认，登录有效且站点开放时可恢复阅读。
public enum ContentPolicy {
    public static let clientMode = "safe"

    public static func canRestoreAdultMode(accountMode: String, sessionAuthorized: Bool, adultContentEnabled: Bool, configured: Bool, expiresIn: Double) -> Bool {
        accountMode == "adult" && sessionAuthorized && adultContentEnabled && expiresIn.isFinite && expiresIn > 0
    }

    /// 给用户侧内容请求统一附加安全模式；管理后台请求不使用此 helper。
    public static func safePath(_ path: String) -> String {
        readerPath(path, mode: "safe")
    }

    public static func readerPath(_ path: String, mode: String) -> String {
        guard var components = URLComponents(string: path) else { return path }
        // 保留已有 query 的编码：重新写 queryItems 会将 %2B 变成 +，
        // 服务端表单查询解析器会把搜索词中的加号误读为空格。
        var items = (components.percentEncodedQuery ?? "").split(separator: "&").map(String.init)
        items.removeAll { item in
            let key = item.split(separator: "=", maxSplits: 1).first.map(String.init)
            return key?.removingPercentEncoding == "contentMode"
        }
        items.append("contentMode=\(mode == "adult" ? "adult" : "safe")")
        components.percentEncodedQuery = items.joined(separator: "&")
        return components.string ?? path
    }

    /// 阅读缓存与主动离线下载分开；成人缓存仍须登录且按账号/模式隔离。
    public static func canCacheChapter(path: String, authenticated: Bool) -> Bool {
        let modes = URLComponents(string: path)?.queryItems?.filter { $0.name == "contentMode" } ?? []
        guard modes.count == 1 else { return false }
        return modes[0].value == "safe" || (modes[0].value == "adult" && authenticated)
    }
}

/// Only challenge subframes can use Cloudflare's bootstrap documents.
/// Top-level pages and message bridges remain restricted to the exact native page.
public enum AdultChallengeNavigationPolicy {
    public static func isChallenge(_ url: URL?, expected: URL?) -> Bool {
        guard let url, let expected else { return false }
        return url.scheme == expected.scheme && url.host == expected.host && url.port == expected.port && url.path == expected.path
    }

    public static func allows(_ url: URL?, expected: URL?, isMainFrame: Bool, hasTargetFrame: Bool) -> Bool {
        guard hasTargetFrame, let url else { return false }
        if isMainFrame { return isChallenge(url, expected: expected) }
        return isChallenge(url, expected: expected)
            || (url.scheme == "https" && url.host == "challenges.cloudflare.com")
            || url.absoluteString == "about:blank"
            || url.absoluteString == "about:srcdoc"
    }
}
