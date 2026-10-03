import Foundation

/// 阅读偏好不能授予成人访问权；在线模式由独立的会话授权状态决定。
public enum ContentPolicy {
    public static let clientMode = "safe"

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

    /// 成人模式始终在线；不写入磁盘、不从普通章节缓存离线回退。
    public static func canCacheChapter(path: String, authenticated: Bool) -> Bool {
        let modes = URLComponents(string: path)?.queryItems?.filter { $0.name == "contentMode" } ?? []
        return !authenticated && modes.count == 1 && modes[0].value == "safe"
    }
}
