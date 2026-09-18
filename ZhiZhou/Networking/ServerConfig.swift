import Foundation

/// 服务器地址：固定指向官方知舟实例（内置硬编码，无需用户配置）。
final class ServerConfig {
    static let shared = ServerConfig()

    /// 固定服务器地址（应用内置，不可更改）
    static let serverURL = "https://story.mscraft.uk"

    private init() {}

    /// 规范化后的 base URL（去掉尾部斜杠）
    var baseURL: URL? {
        var value = ServerConfig.serverURL
        while value.hasSuffix("/") { value.removeLast() }
        return URL(string: value)
    }
}
