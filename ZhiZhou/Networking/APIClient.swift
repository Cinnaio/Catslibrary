import Foundation

enum APIError: LocalizedError, Equatable {
    case notConfigured
    case invalidResponse
    case unauthorized
    case http(status: Int, message: String?)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "尚未配置服务器地址"
        case .invalidResponse: return "服务器响应格式不正确"
        case .unauthorized: return "登录已过期，请重新登录"
        case .http(let status, let message): return message ?? "请求失败（HTTP \(status)）"
        case .network(let detail): return "网络错误：\(detail)"
        }
    }
}

struct ErrorEnvelope: Decodable { let error: String? }

/// 忽略响应体的空类型：任何合法 JSON 都能解码成功。
struct EmptyResponse: Decodable {}

/// 类型化 fetch 封装 —— 语义对齐 web/src/lib/api.ts。
/// - 鉴权：Authorization: Bearer <token>（token 存 Keychain）
/// - 超时：请求 30s
final class APIClient: NSObject, URLSessionTaskDelegate {
    static let shared = APIClient()

    private let decoder = JSONDecoder()
    private static let tokenKey = "zhizhou.token"
    private static let allowInvalidCertKey = "zhizhou.allowInvalidCert"

    /// 章节正文内存缓存：避免切回已读章节时重复下载（Data 按 URL 缓存）。
    private let chapterDataCache = NSCache<NSString, NSData>()

    /// lazy：URLSession 的 delegate 需要 self 已完全初始化，故延迟到首次使用时创建
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // MARK: - 鉴权

    var token: String? {
        get { Keychain.load(Self.tokenKey) }
        set {
            if let newValue, !newValue.isEmpty {
                _ = Keychain.save(newValue, forKey: Self.tokenKey)
            } else {
                Keychain.delete(Self.tokenKey)
            }
        }
    }

    var isAuthenticated: Bool {
        guard let token, !token.isEmpty else { return false }
        return true
    }

    /// 401 会话失效统一处理：清 token 并广播，让 AppState 跳转登录。
    /// 供 AppState 注册，避免 APIClient 直接依赖视图层。
    var onUnauthorized: (() -> Void)?

    // MARK: - TLS

    /// 是否信任无效证书（自签名/过期/域名不匹配）。默认关闭：固定连接公网 HTTPS 实例。
    var allowsInvalidCertificates: Bool {
        get { UserDefaults.standard.object(forKey: Self.allowInvalidCertKey) as? Bool ?? false }
        set { UserDefaults.standard.set(newValue, forKey: Self.allowInvalidCertKey) }
    }

    /// ⚠️ TLS 服务器证书（serverTrust）challenge 只走 **task 级** delegate：
    /// `urlSession(_:task:didReceive:completionHandler:)`。
    /// session 级方法只处理代理认证等，接不到证书 challenge，必须实现 task 级版本。
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard allowsInvalidCertificates,
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    // MARK: - 资源 URL

    func coverURL(novelId: String, updatedAt: Int64) -> URL? {
        guard let base = ServerConfig.shared.baseURL else { return nil }
        let path = base.appending(path: "api/cover/\(novelId)")
        var comps = URLComponents()
        comps.queryItems = [
            URLQueryItem(name: "v", value: String(updatedAt)),
            URLQueryItem(name: "cover", value: "2"),
        ]
        guard let query = comps.url?.query() else { return path }
        return URL(string: path.absoluteString + "?" + query)
    }

    func avatarURL(userId: String) -> URL? {
        guard let base = ServerConfig.shared.baseURL else { return nil }
        return base.appending(path: "api/avatar/\(userId)")
    }

    // MARK: - 请求

    private func makeURL(_ path: String) throws -> URL {
        if path.lowercased().hasPrefix("http://") || path.lowercased().hasPrefix("https://") {
            guard let url = URL(string: path) else { throw APIError.invalidResponse }
            return url
        }
        guard let base = ServerConfig.shared.baseURL else { throw APIError.notConfigured }
        var trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        if trimmed.hasSuffix("/") { trimmed = String(trimmed.dropLast()) }

        // 拆分 path 与 query：appendingPathComponent 会把 ?、&、= 百分号编码导致 404，
        // 因此 query 部分必须单独用 URLComponents 拼接。
        guard let queryIndex = trimmed.firstIndex(of: "?") else {
            return base.appendingPathComponent(trimmed)
        }
        let pathPart = String(trimmed[..<queryIndex])
        let queryPart = String(trimmed[trimmed.index(after: queryIndex)...])
        let pathURL = base.appendingPathComponent(pathPart)
        guard var comps = URLComponents(url: pathURL, resolvingAgainstBaseURL: false) else {
            return pathURL
        }
        comps.query = queryPart
        return comps.url ?? pathURL
    }

    func request<T: Decodable>(_ method: String, _ path: String, body: Data? = nil, auth: Bool = false) async throws -> T {
        let url = try makeURL(path)

        // 章节正文 GET 走内存缓存：离线/重访不重复下载
        if method == "GET", !auth, isChapterPath(path), let cached = chapterDataCache.object(forKey: url.absoluteString as NSString) {
            if T.self == EmptyResponse.self {
                return EmptyResponse() as! T
            }
            if let decoded = try? decoder.decode(T.self, from: cached as Data) {
                return decoded
            }
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if auth, let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        // 与 Web 端一致：不做浏览器 HTTP 缓存，始终拿最新数据（章节正文除外，走上面内存缓存）
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req)
        } catch let error as URLError {
            throw APIError.network(friendlyDescription(for: error))
        } catch {
            throw APIError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                handleUnauthorized()
            }
            let message = (try? decoder.decode(ErrorEnvelope.self, from: data))?.error
            throw APIError.http(status: http.statusCode, message: message)
        }

        if method == "GET", !auth, isChapterPath(path) {
            chapterDataCache.setObject(data as NSData, forKey: url.absoluteString as NSString)
        }

        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    private func isChapterPath(_ path: String) -> Bool {
        // GET /api/chapters/{id} 正文（带不带 query 都算）
        let base = path.split(separator: "?").first.map(String.init) ?? path
        let parts = base.split(separator: "/").filter { !$0.isEmpty }.map(String.init)
        return parts.count == 3 && parts[0] == "api" && parts[1] == "chapters"
    }

    private func handleUnauthorized() {
        guard let token, !token.isEmpty else { return }
        self.token = nil
        onUnauthorized?()
    }

    func get<T: Decodable>(_ path: String, auth: Bool = false) async throws -> T {
        try await request("GET", path, auth: auth)
    }

    func post<T: Decodable>(_ path: String, body: Data? = nil, auth: Bool = false) async throws -> T {
        try await request("POST", path, body: body, auth: auth)
    }

    func delete<T: Decodable>(_ path: String, auth: Bool = false) async throws -> T {
        try await request("DELETE", path, auth: auth)
    }

    /// 只关心状态码的请求（登录/登出/加书架等）
    func requestVoid(_ method: String, _ path: String, body: Data? = nil, auth: Bool = false) async throws {
        let _: EmptyResponse = try await request(method, path, body: body, auth: auth)
    }

    func jsonBody(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }

    /// 走传统 dataTask(completionHandler) 路径，而非 async `data(for:)`：
    /// async 包装在部分 iOS 版本上存在 task 级 serverTrust challenge 不回调的问题，
    /// 传统路径的 URLSessionTaskDelegate 证书放行是可靠触发的。
    private func perform(_ req: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.dataTask(with: req) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, let response {
                    continuation.resume(returning: (data, response))
                } else {
                    continuation.resume(throwing: APIError.invalidResponse)
                }
            }
            task.resume()
        }
    }

    /// TLS/证书类错误的友好提示，引导用户开启开发用证书放行开关
    private func friendlyDescription(for error: URLError) -> String {
        switch error.code {
        case .serverCertificateUntrusted,
             .serverCertificateHasBadDate,
             .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid,
             .secureConnectionFailed:
            return "TLS/证书错误（code \(error.code.rawValue)）：服务器证书不受信任。可在「我的 → 高级」中开启“信任无效证书（开发用）”后重试。"
        default:
            return "网络错误（code \(error.code.rawValue)）：\(error.localizedDescription)"
        }
    }
}
