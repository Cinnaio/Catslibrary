import Foundation

/// 管理后台 API：与 Web 端 `web/src/lib/api.ts` 的 adminApi / thoughtsApi 对齐。
/// 全部接口需要管理员身份（Bearer token 由 APIClient 注入），服务端按 `requireAdmin` 校验。
enum AdminAPI {
    // MARK: - 总览

    static func stats() async throws -> AdminStats {
        try await APIClient.shared.get("/api/admin/stats", auth: true)
    }

    /// 紧凑书目索引（搜索书名/作者时最多返回 50 条，否则按 limit 截断）。
    static func novelIndex(q: String = "", limit: Int = 200) async throws -> NovelIndexResponse {
        var path = "/api/admin/novel-index?limit=\(limit)"
        if !q.isEmpty {
            path += "&q=\(encode(q))"
        }
        return try await APIClient.shared.get(path, auth: true)
    }

    // MARK: - 评论审核

    /// status：all | visible | hidden
    static func comments(status: String = "all", search: String = "", limit: Int = 50, offset: Int = 0) async throws -> CommentsResponse {
        let path = queryPath("/api/admin/comments", ["status": status, "search": search, "limit": "\(limit)", "offset": "\(offset)"])
        return try await APIClient.shared.get(path, auth: true)
    }

    static func setCommentStatus(id: String, status: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.request(
            "PUT", "/api/admin/comments", body: try jsonBody(["id": id, "status": status]), auth: true
        )
    }

    static func deleteComment(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/admin/comments?id=\(encode(id))", auth: true)
    }

    // MARK: - 评论举报

    /// status：open | resolved | dismissed | all；reason：spam | offensive | spoiler | other | all
    static func commentReports(status: String = "open", reason: String = "all", limit: Int = 50, offset: Int = 0) async throws -> CommentReportsResponse {
        let path = queryPath("/api/admin/comment-reports", ["status": status, "reason": reason, "limit": "\(limit)", "offset": "\(offset)"])
        return try await APIClient.shared.get(path, auth: true)
    }

    /// 处理举报。status：resolved | dismissed；action：none（仅标记）| hide（隐藏评论）| restore（恢复评论）。
    static func resolveReport(id: String, status: String, action: String = "none") async throws {
        let _: OkEnvelope = try await APIClient.shared.request(
            "PUT", "/api/admin/comment-reports",
            body: try jsonBody(["id": id, "status": status, "action": action]), auth: true
        )
    }

    // MARK: - 想法（段评）审核

    /// status：all | visible | hidden
    static func thoughts(status: String = "all", search: String = "", limit: Int = 50, offset: Int = 0) async throws -> ThoughtsResponse {
        let path = queryPath("/api/thoughts", ["admin": "1", "status": status, "search": search, "limit": "\(limit)", "offset": "\(offset)"])
        return try await APIClient.shared.get(path, auth: true)
    }

    static func setThoughtStatus(id: String, status: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.request(
            "PUT", "/api/thoughts", body: try jsonBody(["id": id, "status": status]), auth: true
        )
    }

    /// hard=true 为管理员硬删除（不可恢复），false 为隐藏（管理员可隐藏任意想法）。
    static func deleteThought(id: String, hard: Bool = true) async throws {
        let suffix = hard ? "&hard=1" : ""
        let _: OkEnvelope = try await APIClient.shared.delete("/api/thoughts?id=\(encode(id))\(suffix)", auth: true)
    }

    // MARK: - 用户 / 邀请码 / 注册设置

    static func usersOverview() async throws -> AdminUsersResponse {
        try await APIClient.shared.get("/api/admin-users", auth: true)
    }

    /// registerMode：open（开放）| invite（邀请制）| closed（关闭）
    static func setRegisterMode(_ mode: String) async throws {
        let _: OkEnvelope = try await postAction(["action": "settings", "registerMode": mode])
    }

    static func createInvites(count: Int) async throws -> InviteCreateResponse {
        try await APIClient.shared.post("/api/admin-users", body: try jsonBody(["action": "invite", "count": count]), auth: true)
    }

    static func disableInvite(code: String) async throws {
        let _: OkEnvelope = try await postAction(["action": "disable-invite", "code": code])
    }

    static func clearInvites() async throws {
        let _: OkEnvelope = try await postAction(["action": "clear-invites"])
    }

    /// status：active | disabled
    static func setUserStatus(id: String, status: String) async throws {
        let _: OkEnvelope = try await postAction(["action": "user-status", "id": id, "status": status])
    }

    /// role：admin | reader
    static func setUserRole(id: String, role: String) async throws {
        let _: OkEnvelope = try await postAction(["action": "user-role", "id": id, "role": role])
    }

    /// 重置密码：返回一次性临时密码，展示给管理员后由对方转交用户。
    static func resetPassword(id: String) async throws -> ResetPasswordResponse {
        try await APIClient.shared.post("/api/admin-users", body: try jsonBody(["action": "reset-password", "id": id]), auth: true)
    }

    /// 删除用户：confirmUsername 必须与目标用户名完全一致。
    static func deleteUser(id: String, confirmUsername: String) async throws {
        let _: OkEnvelope = try await postAction(["action": "delete-user", "id": id, "confirmUsername": confirmUsername])
    }

    // MARK: - 内容安全

    static func contentPolicy() async throws -> Bool {
        let r: ContentPolicyResponse = try await APIClient.shared.get("/api/admin/content-policy", auth: true)
        return r.adultContentEnabled
    }

    static func setContentPolicy(enabled: Bool) async throws {
        let _: ContentPolicyResponse = try await APIClient.shared.request(
            "PUT", "/api/admin/content-policy", body: try jsonBody(["adultContentEnabled": enabled]), auth: true
        )
    }

    // MARK: - 站点公告

    static func announcement() async throws -> String {
        let r: AdminSiteResponse = try await APIClient.shared.get("/api/admin/site", auth: true)
        return r.announcement
    }

    static func setAnnouncement(_ text: String) async throws {
        let _: AdminSiteResponse = try await APIClient.shared.request(
            "PUT", "/api/admin/site", body: try jsonBody(["announcement": text]), auth: true
        )
    }

    // MARK: - 任务管理 / 抓取动作

    /// GET /api/scrape?action=jobs：最近任务列表（含运行中状态与摘要计数）。
    static func scrapeJobs() async throws -> [AdminJobItem] {
        let r: AdminJobsResponse = try await APIClient.shared.get("/api/scrape?action=jobs", auth: true)
        return r.jobs
    }

    /// POST /api/scrape 动作分发：cancel / retry / retry-failed / update / clear-completed。
    static func scrapeAction(_ action: String, jobId: String? = nil, novelId: String? = nil) async throws -> AdminJobActionResponse {
        var body: [String: Any] = ["action": action]
        if let jobId { body["jobId"] = jobId }
        if let novelId { body["novelId"] = novelId }
        return try await APIClient.shared.post("/api/scrape", body: try jsonBody(body), auth: true)
    }

    /// GET /api/download-logs?limit=：最近下载日志。
    static func downloadLogs(limit: Int = 50) async throws -> [AdminDownloadLog] {
        let r: AdminDownloadLogsResponse = try await APIClient.shared.get("/api/download-logs?limit=\(limit)", auth: true)
        return r.logs
    }

    // MARK: - 小说管理

    /// GET /api/novels（管理列表：search / status / page / limit）。
    static func novels(search: String = "", status: String = "", page: Int = 1, limit: Int = 20) async throws -> NovelListResponse {
        var params: [String: String] = ["page": "\(page)", "limit": "\(limit)"]
        if !search.isEmpty { params["search"] = search }
        if !status.isEmpty { params["status"] = status }
        return try await APIClient.shared.get(queryPath("/api/novels", params), auth: true)
    }

    /// POST /api/novels：新建小说（管理维护）。
    static func createNovel(_ fields: [String: Any]) async throws -> Novel {
        let r: NovelResponse = try await APIClient.shared.post("/api/novels", body: try jsonBody(fields), auth: true)
        return r.novel
    }

    /// PUT /api/novels/:id：更新小说（管理维护，title/author 必填）。
    static func updateNovel(id: String, _ fields: [String: Any]) async throws -> Novel {
        let r: NovelResponse = try await APIClient.shared.request(
            "PUT", "/api/novels/\(encode(id))", body: try jsonBody(fields), auth: true
        )
        return r.novel
    }

    /// DELETE /api/novels/:id：删除小说（级联删除章节，不可恢复）。
    static func deleteNovel(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/novels/\(encode(id))", auth: true)
    }

    // MARK: - 章节管理

    /// GET /api/chapters?novelId=：某部小说的章节列表（按顺序）。
    static func chapters(novelId: String) async throws -> [ChapterMeta] {
        let r: ChaptersResponse = try await APIClient.shared.get("/api/chapters?novelId=\(encode(novelId))", auth: true)
        return r.chapters
    }

    /// GET /api/chapters/:id：章节详情（含正文，管理编辑用）。
    static func chapterDetail(id: String) async throws -> ChapterFull {
        let r: ChapterResponse = try await APIClient.shared.get("/api/chapters/\(encode(id))", auth: true)
        return r.chapter
    }

    /// POST /api/chapters：新建章节（novelId + title 必填）。
    static func createChapter(_ fields: [String: Any]) async throws -> ChapterFull {
        let r: ChapterResponse = try await APIClient.shared.post("/api/chapters", body: try jsonBody(fields), auth: true)
        return r.chapter
    }

    /// PUT /api/chapters/:id：更新章节（title / content / order）。
    static func updateChapter(id: String, _ fields: [String: Any]) async throws -> ChapterFull {
        let r: ChapterResponse = try await APIClient.shared.request(
            "PUT", "/api/chapters/\(encode(id))", body: try jsonBody(fields), auth: true
        )
        return r.chapter
    }

    /// DELETE /api/chapters/:id：删除章节（不可恢复）。
    static func deleteChapter(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/chapters/\(encode(id))", auth: true)
    }

    // MARK: - 爬虫：智能分析 / 测试 / 启动

    /// POST /api/scrape action=detect-meta：智能识别源站并抽取小说信息与选择器。
    static func scrapeDetectMeta(sourceUrl: String) async throws -> ScrapeDetectedMeta {
        try await postScrape(["action": "detect-meta", "sourceUrl": sourceUrl])
    }

    /// POST /api/scrape action=test：用选择器抓取章节列表页并抽样正文。
    static func scrapeTest(sourceUrl: String, encoding: String, selectors: ScrapeSelectors) async throws -> ScrapeTestResponse {
        try await postScrape([
            "action": "test",
            "sourceUrl": sourceUrl,
            "encoding": encoding.isEmpty ? NSNull() : encoding,
            "selectors": selectorDict(selectors),
        ])
    }

    /// POST /api/scrape action=start：保存爬虫配置并启动抓取任务，返回 jobId。
    static func scrapeStart(novelId: String, sourceUrl: String, encoding: String, selectors: ScrapeSelectors) async throws -> AdminJobActionResponse {
        try await postScrape([
            "action": "start",
            "novelId": novelId,
            "sourceUrl": sourceUrl,
            "encoding": encoding.isEmpty ? NSNull() : encoding,
            "selectors": selectorDict(selectors),
        ])
    }

    // MARK: - 爬虫：源管理

    /// POST /api/scrape action=list-sources：源列表（分页）。
    static func scrapeSources(page: Int = 1, pageSize: Int = 50) async throws -> ScrapeSourcesResponse {
        try await postScrape(["action": "list-sources", "page": page, "pageSize": pageSize])
    }

    static func toggleScrapeSource(host: String, enabled: Bool) async throws {
        let _: AdminJobActionResponse = try await postScrape(["action": "toggle-source", "host": host, "enabled": enabled])
    }

    static func deleteScrapeSource(host: String) async throws {
        let _: AdminJobActionResponse = try await postScrape(["action": "delete-source", "host": host])
    }

    /// 连通性检查：hosts 传空数组表示检查全部。
    static func checkSourceConnectivity(hosts: [String] = []) async throws -> ScrapeConnectivityResponse {
        var body: [String: Any] = ["action": "check-source-connectivity"]
        if !hosts.isEmpty { body["hosts"] = hosts }
        return try await postScrape(body)
    }

    static func deleteUnreachableSources() async throws -> AdminJobActionResponse {
        try await postScrape(["action": "delete-unreachable-sources"])
    }

    static func testScrapeSource(host: String) async throws -> ScrapeTestResponse {
        try await postScrape(["action": "test-source", "host": host])
    }

    // MARK: - 爬虫：代理

    /// GET /api/scrape?action=proxy-config：当前代理配置。
    static func scrapeProxyConfig() async throws -> ScrapeProxyConfig {
        try await APIClient.shared.get("/api/scrape?action=proxy-config", auth: true)
    }

    /// POST /api/scrape action=save-proxy-config：保存运行时代理配置。
    static func saveProxyConfig(proxyBase: String, proxyBypass: String) async throws -> ScrapeProxyConfig {
        try await postScrape(["action": "save-proxy-config", "proxyBase": proxyBase, "proxyBypass": proxyBypass])
    }

    /// POST /api/scrape action=proxy-test：经代理请求目标网址验证可用性。
    static func testProxy(sourceUrl: String) async throws -> ScrapeProxyTestResponse {
        try await postScrape(["action": "proxy-test", "sourceUrl": sourceUrl])
    }

    /// GET /api/scrape?action=proxy-logs：最近代理请求日志。
    static func scrapeProxyLogs(limit: Int = 50) async throws -> [ScrapeProxyLogItem] {
        let r: ScrapeProxyLogsResponse = try await APIClient.shared.get("/api/scrape?action=proxy-logs&limit=\(limit)", auth: true)
        return r.logs
    }

    // MARK: - 内部辅助

    private static func postAction(_ dict: [String: Any]) async throws -> OkEnvelope {
        try await APIClient.shared.post("/api/admin-users", body: try jsonBody(dict), auth: true)
    }

    private static func postScrape<T: Decodable>(_ dict: [String: Any]) async throws -> T {
        try await APIClient.shared.post("/api/scrape", body: try jsonBody(dict), auth: true)
    }

    /// 选择器 → JSON 字典（空值字段用空串占位，服务端容错）。
    private static func selectorDict(_ selectors: ScrapeSelectors) -> [String: String] {
        [
            "chapterList": selectors.chapterList ?? "",
            "chapterTitle": selectors.chapterTitle ?? "",
            "chapterContent": selectors.chapterContent ?? "",
            "nextPage": selectors.nextPage ?? "",
        ]
    }

    private static func jsonBody(_ dict: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: dict)
    }

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    /// 组装 query 字符串（空值字段自动跳过），拼在 path 之后。
    private static func queryPath(_ path: String, _ params: [String: String]) -> String {
        let query = params.compactMap { key, value -> String? in
            guard !value.isEmpty else { return nil }
            return "\(key)=\(encode(value))"
        }.joined(separator: "&")
        return query.isEmpty ? path : path + "?" + query
    }
}
