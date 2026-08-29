/// App Store 客户端固定使用安全内容模式。
public enum ContentPolicy {
    public static let clientMode = "safe"

    /// 给用户侧内容请求统一附加安全模式；管理后台请求不使用此 helper。
    public static func safePath(_ path: String) -> String {
        path + (path.contains("?") ? "&" : "?") + "contentMode=\(clientMode)"
    }
}
