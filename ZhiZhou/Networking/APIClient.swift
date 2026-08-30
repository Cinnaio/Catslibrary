import Foundation
import ZhiZhouCore

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

/// 让 Swift Task 的取消能够传递到底层 URLSessionTask。
private final class URLSessionTaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionDataTask?
    private var cancelled = false

    func set(_ task: URLSessionDataTask) {
        lock.lock()
        let shouldCancel = cancelled
        if !shouldCancel { self.task = task }
        lock.unlock()
        if shouldCancel { task.cancel() }
        task.resume()
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let task = self.task
        lock.unlock()
        task?.cancel()
    }
}

/// Tracks the account namespace used by chapter caches. A generation changes
/// at every account boundary so an old request cannot publish data into a new
/// session after logout or account switching.
private actor ChapterCacheScope {
    struct Snapshot: Sendable, Equatable {
        let userID: String
        let generation: UUID
    }

    private var userID: String?
    private var generation = UUID()

    func set(userID: String?) {
        let normalized = userID?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.userID = normalized?.isEmpty == true ? nil : normalized
        generation = UUID()
    }

    func snapshot() -> Snapshot? {
        guard let userID else { return nil }
        return Snapshot(userID: userID, generation: generation)
    }

    func isCurrent(_ snapshot: Snapshot) -> Bool {
        userID == snapshot.userID && generation == snapshot.generation
    }
}

/// 类型化 fetch 封装 —— 语义对齐 web/src/lib/api.ts。
/// - 鉴权：Authorization: Bearer <token>（token 存 Keychain）
/// - 超时：请求 30s
final class APIClient: NSObject, URLSessionTaskDelegate {
    static let shared = APIClient()

    private let decoder = JSONDecoder()
    private static let tokenKey = "zhizhou.token"
    #if DEBUG
    private static let allowInvalidCertKey = "zhizhou.allowInvalidCert"
    #endif

    /// 阅读器章节数据内存缓存：避免切回已读章节时重复下载（Data 按 URL 缓存）。
    private let chapterDataCache: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.countLimit = 20
        cache.totalCostLimit = 16 * 1024 * 1024
        return cache
    }()
    private let chapterCacheScope = ChapterCacheScope()

    /// 兼容旧调用，仅清理章节内存缓存。
    func clearMemoryCaches() {
        chapterDataCache.removeAllObjects()
    }

    /// 清理章节内存与磁盘缓存，供存储管理页等待完成后刷新占用。
    func clearCaches() async {
        chapterDataCache.removeAllObjects()
        await ChapterDiskCache.shared.removeAll()
    }

    /// Change the account namespace for reader caches and invalidate memory data.
    /// Persistent data for other accounts remains on disk but is unreachable
    /// until that account is explicitly activated again.
    func setChapterCacheScope(userID: String?) async {
        await chapterCacheScope.set(userID: userID)
        chapterDataCache.removeAllObjects()
    }

    /// lazy：URLSession 的 delegate 需要 self 已完全初始化，故延迟到首次使用时创建
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // MARK: - 鉴权

    private let tokenLock = NSLock()

    var token: String? {
        get {
            tokenLock.lock()
            defer { tokenLock.unlock() }
            return Keychain.load(Self.tokenKey)
        }
        set {
            tokenLock.lock()
            defer { tokenLock.unlock() }
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
    var onUnauthorized: ((String) -> Void)?

    // MARK: - TLS

    #if DEBUG
    /// 仅 Debug 构建允许排查自签名证书；Release 构建不包含此能力。
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
    #endif

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
        // 调用方已经分别编码了 query value；使用 percentEncodedQuery 避免把 `%26` 等再次编码。
        comps.percentEncodedQuery = queryPart
        return comps.url ?? pathURL
    }

    func request<T: Decodable>(_ method: String, _ path: String, body: Data? = nil, auth: Bool = false, contentType: String? = nil) async throws -> T {
        try await requestInternal(
            method,
            path,
            body: body,
            auth: auth,
            contentType: contentType
        )
    }

    private func requestInternal<T: Decodable>(
        _ method: String,
        _ path: String,
        body: Data? = nil,
        auth: Bool = false,
        contentType: String? = nil,
        expectedReaderCacheScope: ChapterCacheScope.Snapshot? = nil
    ) async throws -> T {
        let url = try makeURL(path)

        let usesReaderChapterCache = method == "GET" && !auth && isReaderChapterPath(path)
        let cacheScope: ChapterCacheScope.Snapshot?
        if usesReaderChapterCache {
            let currentScope = await chapterCacheScope.snapshot()
            if let expectedReaderCacheScope {
                guard let currentScope, currentScope == expectedReaderCacheScope else {
                    throw CancellationError()
                }
            }
            cacheScope = currentScope
        } else {
            cacheScope = nil
        }
        let cacheKey = cacheScope.map { chapterCacheKey(for: url, scope: $0) }

        // 阅读器章节列表/正文优先走内存缓存：切章和打开目录时不重复下载。
        if let cacheScope,
           let cacheKey,
           let cached = chapterDataCache.object(forKey: cacheKey),
           let decoded = decode(cached as Data, as: T.self) {
            guard await chapterCacheScope.isCurrent(cacheScope) else { throw CancellationError() }
            // 内存缓存可能仍在，但磁盘缓存已因容量淘汰；离线下载需补回持久副本。
            if !(await ChapterDiskCache.shared.contains(url.absoluteString, scope: cacheScope.userID)) {
                await ChapterDiskCache.shared.store(cached as Data, for: url.absoluteString, scope: cacheScope.userID)
            }
            guard await chapterCacheScope.isCurrent(cacheScope) else { throw CancellationError() }
            return decoded
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30
        if let body {
            req.httpBody = body
            // multipart 上传（AI 封面上传等）由调用方指定完整 Content-Type（含 boundary）
            req.setValue(contentType ?? "application/json", forHTTPHeaderField: "Content-Type")
        }
        let requestToken = auth ? token : nil
        if let requestToken {
            req.setValue("Bearer \(requestToken)", forHTTPHeaderField: "Authorization")
        }
        // 与 Web 端一致：不做浏览器 HTTP 缓存，始终拿最新数据（章节正文除外，走上面内存缓存）
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled || Task.isCancelled {
                throw CancellationError()
            }
            if let cacheScope,
               await chapterCacheScope.isCurrent(cacheScope),
               let cached = await ChapterDiskCache.shared.data(for: url.absoluteString, scope: cacheScope.userID),
               let decoded = decode(cached, as: T.self) {
                guard await chapterCacheScope.isCurrent(cacheScope) else { throw CancellationError() }
                return decoded
            }
            throw APIError.network(friendlyDescription(for: error))
        } catch {
            if Task.isCancelled {
                throw CancellationError()
            }
            if let cacheScope,
               await chapterCacheScope.isCurrent(cacheScope),
               let cached = await ChapterDiskCache.shared.data(for: url.absoluteString, scope: cacheScope.userID),
               let decoded = decode(cached, as: T.self) {
                guard await chapterCacheScope.isCurrent(cacheScope) else { throw CancellationError() }
                return decoded
            }
            throw APIError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401, let requestToken {
                handleUnauthorized(requestToken: requestToken)
            }
            let message = (try? decoder.decode(ErrorEnvelope.self, from: data))?.error
            throw APIError.http(status: http.statusCode, message: message)
        }

        if let cacheScope, !(await chapterCacheScope.isCurrent(cacheScope)) {
            throw CancellationError()
        }

        guard let decoded = decode(data, as: T.self) else {
            throw APIError.invalidResponse
        }

        if let cacheScope, let cacheKey {
            chapterDataCache.setObject(
                data as NSData,
                forKey: cacheKey,
                cost: data.count
            )
            await ChapterDiskCache.shared.store(data, for: url.absoluteString, scope: cacheScope.userID)
            guard await chapterCacheScope.isCurrent(cacheScope) else { throw CancellationError() }
        }
        return decoded
    }

    private func isReaderChapterPath(_ path: String) -> Bool {
        // GET /api/chapters（目录）和 /api/chapters/{id}（正文）均可离线回退。
        let base = path.split(separator: "?").first.map(String.init) ?? path
        let parts = base.split(separator: "/").filter { !$0.isEmpty }.map(String.init)
        return (parts.count == 2 || parts.count == 3)
            && parts[0] == "api"
            && parts[1] == "chapters"
    }

    private func decode<T: Decodable>(_ data: Data, as type: T.Type) -> T? {
        if T.self == EmptyResponse.self {
            return EmptyResponse() as? T
        }
        return try? decoder.decode(T.self, from: data)
    }

    private func handleUnauthorized(requestToken: String) {
        // The compare-and-clear inside invalidateSession is atomic with the
        // token lock, so an old response cannot wipe out a newer login.
        invalidateSession(expectedToken: requestToken)
    }

    /// 主动使当前会话失效，例如启动恢复收到 403 时。
    func invalidateSession(expectedToken: String? = nil) {
        tokenLock.lock()
        let currentToken = Keychain.load(Self.tokenKey)
        let shouldInvalidate: Bool
        if let currentToken, !currentToken.isEmpty {
            shouldInvalidate = expectedToken.map { $0 == currentToken } ?? true
        } else {
            shouldInvalidate = false
        }
        if shouldInvalidate {
            Keychain.delete(Self.tokenKey)
        }
        tokenLock.unlock()

        guard shouldInvalidate, let currentToken else { return }
        onUnauthorized?(currentToken)
    }

    func get<T: Decodable>(_ path: String, auth: Bool = false) async throws -> T {
        try await request("GET", path, auth: auth)
    }

    /// 预取下一章：已有磁盘缓存时不触网，在线时复用正常章节缓存路径。
    func prefetchChapter(id: String) async {
        let path = ContentPolicy.safePath("/api/chapters/\(id)")
        guard let url = try? makeURL(path) else { return }
        guard let cacheScope = await chapterCacheScope.snapshot() else { return }
        if await ChapterDiskCache.shared.contains(url.absoluteString, scope: cacheScope.userID) { return }
        do {
            let _: ChapterResponse = try await requestInternal(
                "GET",
                path,
                expectedReaderCacheScope: cacheScope
            )
        } catch {
            // 预取是体验优化，失败不打扰当前章节阅读。
        }
    }

    func hasCachedChapter(id: String, userID: String? = nil) async -> Bool {
        let path = ContentPolicy.safePath("/api/chapters/\(id)")
        guard let url = try? makeURL(path) else { return false }
        guard let cacheScope = await chapterCacheScope.snapshot(),
              userID == nil || userID == cacheScope.userID else { return false }
        let exists = await ChapterDiskCache.shared.contains(url.absoluteString, scope: cacheScope.userID)
        guard await chapterCacheScope.isCurrent(cacheScope) else { return false }
        return exists
    }

    func removeCachedChapter(id: String, userID: String? = nil) async {
        let path = ContentPolicy.safePath("/api/chapters/\(id)")
        guard let url = try? makeURL(path) else { return }
        guard let cacheScope = await chapterCacheScope.snapshot(),
              userID == nil || userID == cacheScope.userID else { return }
        chapterDataCache.removeObject(forKey: chapterCacheKey(for: url, scope: cacheScope))
        await ChapterDiskCache.shared.remove(url.absoluteString, scope: cacheScope.userID)
    }

    private func chapterCacheKey(for url: URL, scope: ChapterCacheScope.Snapshot) -> NSString {
        "\(scope.userID)|\(url.absoluteString)" as NSString
    }

    /// 读取服务端 SSE 文本行。用于可恢复任务的前台实时展示；连接中断不影响服务端任务本身。
    func streamLines(_ path: String, auth: Bool = false) -> AsyncThrowingStream<String, Error> {
        let requestToken = auth ? token : nil
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let url = try makeURL(path)
                    var req = URLRequest(url: url)
                    req.httpMethod = "GET"
                    req.timeoutInterval = 120
                    if let requestToken {
                        req.setValue("Bearer \(requestToken)", forHTTPHeaderField: "Authorization")
                    }
                    req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")

                    let (bytes, response) = try await session.bytes(for: req)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.invalidResponse
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        if http.statusCode == 401, let requestToken {
                            handleUnauthorized(requestToken: requestToken)
                        }
                        throw APIError.http(status: http.statusCode, message: nil)
                    }

                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        continuation.yield(line)
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch let error as APIError {
                    continuation.finish(throwing: error)
                } catch let error as URLError {
                    continuation.finish(throwing: APIError.network(friendlyDescription(for: error)))
                } catch {
                    continuation.finish(throwing: APIError.network(error.localizedDescription))
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
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
        let taskBox = URLSessionTaskBox()
        return try await withTaskCancellationHandler(operation: {
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
                taskBox.set(task)
            }
        }, onCancel: {
            taskBox.cancel()
        })
    }

    /// TLS/证书类错误的友好提示，引导用户开启开发用证书放行开关
    private func friendlyDescription(for error: URLError) -> String {
        switch error.code {
        case .serverCertificateUntrusted,
             .serverCertificateHasBadDate,
             .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid,
             .secureConnectionFailed:
            #if DEBUG
            return "TLS/证书错误（code \(error.code.rawValue)）：服务器证书不受信任。可在「我的 → 高级」中开启“信任无效证书（开发用）”后重试。"
            #else
            return "TLS/证书错误（code \(error.code.rawValue)）：服务器证书不受信任，请联系服务端配置受信任的 HTTPS 证书。"
            #endif
        default:
            return "网络错误（code \(error.code.rawValue)）：\(error.localizedDescription)"
        }
    }
}
