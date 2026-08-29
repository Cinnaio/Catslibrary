/// App Store 客户端固定使用安全内容模式；成人内容开关只属于服务端内部管理能力。
enum ContentPolicy {
    static let clientMode = "safe"

    /// 给用户侧内容请求统一附加安全模式；管理后台请求不使用此 helper。
    static func safePath(_ path: String) -> String {
        path + (path.contains("?") ? "&" : "?") + "contentMode=\(clientMode)"
    }
}
