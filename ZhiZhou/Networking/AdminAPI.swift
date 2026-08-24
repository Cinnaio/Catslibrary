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

    // MARK: - 内部辅助

    private static func postAction(_ dict: [String: Any]) async throws -> OkEnvelope {
        try await APIClient.shared.post("/api/admin-users", body: try jsonBody(dict), auth: true)
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
