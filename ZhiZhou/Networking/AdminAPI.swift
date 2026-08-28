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

    // MARK: - 原作者源站同步

    static func sourceBindings(novelId: String) async throws -> [SourceBinding] {
        let r: SourceBindingsResponse = try await APIClient.shared.get(
            "/api/scrape?action=source-bindings&novelId=\(encode(novelId))", auth: true
        )
        return r.bindings
    }

    static func sourceSyncPreview(novelId: String, sourceUrl: String, onlyWeakTitles: Bool = true) async throws -> SourceSyncPreview {
        try await postScrape([
            "action": "source-sync-preview",
            "novelId": novelId,
            "sourceUrl": sourceUrl,
            "onlyWeakTitles": onlyWeakTitles,
        ])
    }

    static func sourceSyncApply(
        runId: String,
        metadataFields: [String],
        replaceMetadata: Bool = false,
        confirmedChangeIds: [String] = []
    ) async throws -> SourceSyncApplyResponse {
        try await postScrape([
            "action": "source-sync-apply",
            "runId": runId,
            "applyMetadata": !metadataFields.isEmpty,
            "metadataFields": metadataFields,
            "metadataMode": replaceMetadata ? "replace" : "missing",
            "confirmedChangeIds": confirmedChangeIds,
        ])
    }

    /// POST /api/scrape action=title-source-search：同时搜索晋江与 POPO 原作者页面。
    static func titleSourceSearch(title: String, author: String = "") async throws -> TitleSourceSearchResponse {
        try await postScrape([
            "action": "title-source-search",
            "title": title,
            "author": author,
        ])
    }

    /// POPO 账号状态、登录验证码与会话管理。
    static func po18Account() async throws -> Po18AccountStatus {
        try await APIClient.shared.get("/api/scrape?action=po18-account", auth: true)
    }

    static func savePo18Account(username: String, password: String? = nil, sessionCookie: String? = nil) async throws -> Po18AccountStatus {
        var body: [String: Any] = ["action": "po18-account-save", "username": username]
        if let password, !password.isEmpty { body["password"] = password }
        if let sessionCookie, !sessionCookie.isEmpty { body["sessionCookie"] = sessionCookie }
        return try await postScrape(body)
    }

    static func po18Captcha() async throws -> Po18CaptchaResponse {
        try await postScrape(["action": "po18-account-captcha"])
    }

    static func po18Login(challengeId: String, captcha: String = "") async throws -> Po18LoginResponse {
        try await postScrape(["action": "po18-account-login", "challengeId": challengeId, "captcha": captcha])
    }

    static func testPo18Account() async throws -> Po18LoginResponse {
        try await postScrape(["action": "po18-account-test"])
    }

    static func clearPo18Account() async throws {
        let _: OkEnvelope = try await postScrape(["action": "po18-account-clear"])
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

    // MARK: - AI 服务：状态 / 用量 / 设置

    static func aiStatus() async throws -> AiStatus {
        try await APIClient.shared.get("/api/ai/status", auth: true)
    }

    static func aiUsage() async throws -> AiUsageResponse {
        try await APIClient.shared.get("/api/ai/usage", auth: true)
    }

    static func aiSettings() async throws -> AiSettingsResponse {
        try await APIClient.shared.get("/api/ai/settings", auth: true)
    }

    /// PUT /api/ai/settings：支持部分字段更新（只传要改的字段）。
    static func saveAiSettings(_ patch: [String: Any]) async throws -> AiSettings {
        let r: AiSettingsSaveResponse = try await APIClient.shared.request(
            "PUT", "/api/ai/settings", body: try jsonBody(patch), auth: true
        )
        return r.settings
    }

    /// PUT /api/ai/provider：修改供应商配置；scope：text | image；apiKey 传空串表示清空。
    static func saveAiProvider(_ patch: [String: Any]) async throws -> AiProviderSaveResponse {
        try await APIClient.shared.request("PUT", "/api/ai/provider", body: try jsonBody(patch), auth: true)
    }

    /// POST /api/ai/test：连通性测试（用当前文本供应商）。
    static func testAi() async throws -> AiTestResponse {
        try await APIClient.shared.post("/api/ai/test", body: try jsonBody([:]), auth: true)
    }

    // MARK: - AI 服务：任务

    /// GET /api/ai/tasks；status：queued | running | completed | failed | cancelled | all。
    static func aiTasks(status: String = "all", limit: Int = 50, offset: Int = 0) async throws -> AiTasksResponse {
        let path = queryPath("/api/ai/tasks", ["status": status, "limit": "\(limit)", "offset": "\(offset)"])
        return try await APIClient.shared.get(path, auth: true)
    }

    static func cancelAiTask(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.post("/api/ai/tasks/\(encode(id))/cancel", body: try jsonBody([:]), auth: true)
    }

    static func deleteAiTask(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/ai/tasks/\(encode(id))", auth: true)
    }

    /// 按原参数重试失败/取消的创作任务，返回新任务 id。
    static func retryAiTask(id: String) async throws -> AdminJobActionResponse {
        try await APIClient.shared.post("/api/ai/tasks/\(encode(id))/retry", body: try jsonBody([:]), auth: true)
    }

    // MARK: - AI 服务：审计

    static func aiAuditUsers(limit: Int = 50, offset: Int = 0) async throws -> AiAuditUsersResponse {
        try await APIClient.shared.get("/api/ai/audit/users?limit=\(limit)&offset=\(offset)", auth: true)
    }

    static func aiAuditCalls(type: String = "all", limit: Int = 50, offset: Int = 0) async throws -> AiAuditCallsResponse {
        var path = "/api/ai/audit/calls?limit=\(limit)&offset=\(offset)"
        if type != "all" {
            path += "&type=\(encode(type))"
        }
        return try await APIClient.shared.get(path, auth: true)
    }

    /// GET /api/ai/audit/trend：近 N 天调用趋势。
    static func aiAuditTrend(days: Int = 30) async throws -> AiAuditTrendResponse {
        try await APIClient.shared.get("/api/ai/audit/trend?days=\(days)", auth: true)
    }

    // MARK: - 登录审计（GET /api/admin-users/login-audit）

    /// status：all | success | failure | limited
    static func loginAudit(status: String = "all", username: String = "", limit: Int = 50, offset: Int = 0) async throws -> LoginAuditResponse {
        var path = "/api/admin-users/login-audit?limit=\(limit)&offset=\(offset)"
        if status != "all" {
            path += "&status=\(encode(status))"
        }
        if !username.isEmpty {
            path += "&username=\(encode(username))"
        }
        return try await APIClient.shared.get(path, auth: true)
    }

    // MARK: - 站点运营总览（GET /api/admin/site）

    /// 完整站点运营数据：指标 + 流量分析 + 内容健康度 + 公告（一次拉取）。
    static func siteOverview() async throws -> SiteOverview {
        try await APIClient.shared.get("/api/admin/site", auth: true)
    }

    // MARK: - 爬虫：发现小说（POST /api/scrape action=discover / po18-search / popo-search）

    /// 榜单页 URL → 批量发现小说列表（分页）。
    static func scrapeDiscover(listUrl: String, rankingKind: String? = nil, rankingType: String? = nil) async throws -> DiscoverResponse {
        var body: [String: Any] = ["action": "discover", "listUrl": listUrl]
        if let rankingKind, let rankingType {
            body["rankingKind"] = rankingKind
            body["rankingType"] = rankingType
        }
        return try await postScrape(body)
    }

    /// PO18 站内搜索：searchType = articlename（书名）| author（作者）。
    static func scrapePo18Search(query: String, searchType: String = "articlename", page: Int = 1) async throws -> DiscoverResponse {
        try await postScrape(["action": "po18-search", "query": query, "searchType": searchType, "page": page])
    }

    /// POPO（po18.tw）站内搜索：searchType = book（书名）| author（作者）。
    static func scrapePopoSearch(query: String, searchType: String = "book", page: Int = 1) async throws -> DiscoverResponse {
        try await postScrape(["action": "popo-search", "query": query, "searchType": searchType, "page": page])
    }

    // MARK: - 爬虫：配置导入导出（action=list-configs / import-configs / import-legado）

    static func scrapeListConfigs() async throws -> ScrapeConfigsResponse {
        try await postScrape(["action": "list-configs"])
    }

    static func scrapeImportConfigs(_ configs: [ScrapeConfigImportItem]) async throws -> ScrapeImportResponse {
        try await postScrape(["action": "import-configs", "configs": try configs.map { try $0.asDictionary() }])
    }

    /// 导入 Legado 书源：payload 为 { url?: String } 或 { text?: String }（书源池 URL / 书源 JSON）。
    static func scrapeImportLegado(payload: [String: Any]) async throws -> ScrapeImportResponse {
        var body = payload
        body["action"] = "import-legado"
        return try await postScrape(body)
    }

    // MARK: - 爬虫：源批量操作（batch-toggle-sources / batch-delete-sources）

    static func batchToggleSources(hosts: [String], enabled: Bool) async throws -> BatchSourcesResponse {
        try await postScrape(["action": "batch-toggle-sources", "hosts": hosts, "enabled": enabled])
    }

    static func batchDeleteSources(hosts: [String]) async throws -> BatchSourcesResponse {
        try await postScrape(["action": "batch-delete-sources", "hosts": hosts])
    }

    // MARK: - AI 服务：封面生成

    /// POST /api/ai/cover/generate：启动封面生成后台任务。
    static func aiGenerateCover(
        novelId: String,
        prompt: String = "",
        renderTitle: Bool = true,
        platform: String = "default",
        stylePreset: String = "auto",
        composition: String = "auto",
        variationId: String = ""
    ) async throws -> AiTaskStartResponse {
        try await APIClient.shared.post("/api/ai/cover/generate", body: try jsonBody([
            "novelId": novelId,
            "prompt": prompt,
            "renderTitle": renderTitle,
            "platform": platform,
            "stylePreset": stylePreset,
            "composition": composition,
            "variationId": variationId,
        ]), auth: true)
    }

    /// POST /api/ai/cover/prompt：按书籍信息创建封面描述词后台任务。
    static func aiCoverPrompt(
        novelId: String,
        renderTitle: Bool = true,
        platform: String = "default",
        stylePreset: String = "auto",
        composition: String = "auto",
        variationId: String = "",
        clientRequestId: String = ""
    ) async throws -> AiTaskStartResponse {
        try await APIClient.shared.post("/api/ai/cover/prompt", body: try jsonBody([
            "novelId": novelId,
            "async": true,
            "clientRequestId": clientRequestId,
            "renderTitle": renderTitle,
            "platform": platform,
            "stylePreset": stylePreset,
            "composition": composition,
            "variationId": variationId,
        ]), auth: true)
    }

    /// GET /api/ai/cover/candidates：某部小说的封面候选列表（含 dataUrl）。
    static func aiCoverCandidates(novelId: String) async throws -> AiCoverCandidatesResponse {
        try await APIClient.shared.get("/api/ai/cover/candidates?novelId=\(encode(novelId))", auth: true)
    }

    /// 采纳候选：覆盖为当前封面并删除候选。
    static func aiAdoptCoverCandidate(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.post("/api/ai/cover/candidates/\(encode(id))/adopt", body: try jsonBody([:]), auth: true)
    }

    /// 弃用候选：删除，不影响当前封面。
    static func aiDiscardCoverCandidate(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/ai/cover/candidates/\(encode(id))", auth: true)
    }

    /// 上传本地图片替换当前封面（multipart/form-data）。
    static func aiUploadCover(novelId: String, imageData: Data, mimeType: String = "image/jpeg") async throws {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"novelId\"\r\n\r\n")
        append("\(novelId)\r\n")
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"cover\"; filename=\"cover.jpg\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(imageData)
        append("\r\n--\(boundary)--\r\n")
        let _: OkEnvelope = try await APIClient.shared.request(
            "POST", "/api/ai/cover/upload", body: body,
            auth: true, contentType: "multipart/form-data; boundary=\(boundary)"
        )
    }

    // MARK: - AI 服务：单个任务查询

    static func aiTask(id: String) async throws -> AiTaskDetailResponse {
        try await APIClient.shared.get("/api/ai/tasks/\(encode(id))", auth: true)
    }

    /// 订阅封面描述词任务的实时 SSE 快照；断流后由页面回退到任务轮询。
    static func aiCoverPromptStream(id: String) -> AsyncThrowingStream<AiTaskStreamEvent, Error> {
        let lines = APIClient.shared.streamLines("/api/ai/tasks/\(encode(id))/stream", auth: true)
        return AsyncThrowingStream { continuation in
            let task = Task {
                var dataLines: [String] = []

                func consumeEvent() {
                    guard !dataLines.isEmpty else { return }
                    let payload = dataLines.joined(separator: "\n")
                    dataLines.removeAll(keepingCapacity: true)
                    guard let data = payload.data(using: .utf8),
                          let event = try? JSONDecoder().decode(AiTaskStreamEvent.self, from: data)
                    else { return }
                    continuation.yield(event)
                }

                do {
                    for try await line in lines {
                        if line.isEmpty {
                            consumeEvent()
                        } else if line.hasPrefix("data:") {
                            dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                            // 服务端每个快照是一行紧凑 JSON；立即消费，不依赖某些实现是否保留空行。
                            consumeEvent()
                        }
                    }
                    consumeEvent()
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    // MARK: - AI 服务：已生成内容

    /// kind：all | summary | catchup | continue | write_outline | write_chapter
    /// scope：all | reader | writing；status：all | published | draft | rejected
    static func aiGenerations(kind: String = "all", scope: String = "all", status: String = "all", limit: Int = 50, offset: Int = 0) async throws -> AiGenerationsResponse {
        var path = "/api/ai/generations?limit=\(limit)&offset=\(offset)"
        if kind != "all" { path += "&kind=\(encode(kind))" }
        if scope != "all" { path += "&scope=\(encode(scope))" }
        if status != "all" { path += "&status=\(encode(status))" }
        return try await APIClient.shared.get(path, auth: true)
    }

    static func aiDeleteGeneration(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.delete("/api/ai/generations/\(encode(id))", auth: true)
    }

    static func aiDeleteGenerations(ids: [String]) async throws -> AiGenerationsBatchResponse {
        try await APIClient.shared.post("/api/ai/generations/batch-delete", body: try jsonBody(["ids": ids]), auth: true)
    }

    /// 撤销软删除：30 秒窗口内的删除记录可恢复。
    static func aiRestoreGenerations(ids: [String]) async throws -> AiGenerationsBatchResponse {
        try await APIClient.shared.post("/api/ai/generations/restore", body: try jsonBody(["ids": ids]), auth: true)
    }

    // MARK: - AI 服务：创作任务（后台任务模式）

    /// kind：write_outline | write_chapter | continue
    static func aiStartWriting(kind: String, body: [String: Any]) async throws -> AiTaskStartResponse {
        try await APIClient.shared.post("/api/ai/writing/\(encode(kind))", body: try jsonBody(body), auth: true)
    }

    /// POST /api/ai/writing/titles：为正文生成候选章节标题。
    static func aiWritingTitles(content: String, novelId: String = "", contextTitle: String = "") async throws -> AiTitlesResponse {
        var payload: [String: Any] = ["content": content]
        if !novelId.isEmpty { payload["novelId"] = novelId }
        if !contextTitle.isEmpty { payload["contextTitle"] = contextTitle }
        return try await APIClient.shared.post("/api/ai/writing/titles", body: try jsonBody(payload), auth: true)
    }

    // MARK: - AI 服务：画像提取

    static func aiRefreshStyleProfile(novelId: String, sampleChapters: Int? = nil) async throws -> AiProfileResponse {
        try await postAiProfile("style-profile", novelId: novelId, sampleChapters: sampleChapters)
    }

    static func aiGetStyleProfile(novelId: String) async throws -> AiProfileGetResponse {
        try await APIClient.shared.get("/api/ai/writing/style-profile/\(encode(novelId))", auth: true)
    }

    static func aiRefreshPlotState(novelId: String, sampleChapters: Int? = nil) async throws -> AiPlotStateResponse {
        var payload: [String: Any] = ["novelId": novelId]
        if let sampleChapters { payload["sampleChapters"] = sampleChapters }
        return try await APIClient.shared.post("/api/ai/writing/plot-state", body: try jsonBody(payload), auth: true)
    }

    static func aiGetPlotState(novelId: String) async throws -> AiPlotStateGetResponse {
        try await APIClient.shared.get("/api/ai/writing/plot-state/\(encode(novelId))", auth: true)
    }

    static func aiRefreshRelationshipProfile(novelId: String, sampleChapters: Int? = nil) async throws -> AiProfileResponse {
        try await postAiProfile("relationship-profile", novelId: novelId, sampleChapters: sampleChapters)
    }

    static func aiGetRelationshipProfile(novelId: String) async throws -> AiProfileGetResponse {
        try await APIClient.shared.get("/api/ai/writing/relationship-profile/\(encode(novelId))", auth: true)
    }

    // MARK: - AI 服务：草稿编辑与发布

    static func aiUpdateDraft(id: String, result: String) async throws -> AiDraftUpdateResponse {
        try await APIClient.shared.request("PUT", "/api/ai/writing/drafts/\(encode(id))", body: try jsonBody(["result": result]), auth: true)
    }

    static func aiPublishDraft(id: String, novelId: String, title: String) async throws -> AiPublishDraftResponse {
        try await APIClient.shared.post("/api/ai/writing/drafts/\(encode(id))/publish", body: try jsonBody(["novelId": novelId, "title": title]), auth: true)
    }

    static func aiPublishBatch(batchId: String, novelId: String) async throws -> AiPublishBatchResponse {
        try await APIClient.shared.post("/api/ai/writing/batches/\(encode(batchId))/publish", body: try jsonBody(["novelId": novelId]), auth: true)
    }

    static func aiUnpublishDraft(id: String) async throws {
        let _: OkEnvelope = try await APIClient.shared.post("/api/ai/writing/drafts/\(encode(id))/unpublish", body: try jsonBody([:]), auth: true)
    }

    static func aiUnpublishBatch(batchId: String) async throws -> AiUnpublishBatchResponse {
        try await APIClient.shared.post("/api/ai/writing/batches/\(encode(batchId))/unpublish", body: try jsonBody([:]), auth: true)
    }

    // MARK: - 内部辅助

    private static func postAiProfile(_ scope: String, novelId: String, sampleChapters: Int?) async throws -> AiProfileResponse {
        var payload: [String: Any] = ["novelId": novelId]
        if let sampleChapters { payload["sampleChapters"] = sampleChapters }
        return try await APIClient.shared.post("/api/ai/writing/\(scope)", body: try jsonBody(payload), auth: true)
    }

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
