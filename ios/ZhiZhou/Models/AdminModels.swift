import Foundation

// MARK: - 管理后台模型
// 字段与知舟仓库 api/src/routes/admin.ts、admin-users.ts、site.ts、thoughts.ts 的返回一一对应（camelCase）。

// MARK: 总览统计（GET /api/admin/stats）

struct AdminStats: Codable {
    let totals: AdminTotals
    let jobStatus: AdminJobStatus
    let recentJobs: [AdminJobSummary]
    let recentNovels: [AdminNovelSummary]
}

struct AdminTotals: Codable {
    let novels: Int
    let chapters: Int
    let users: Int
    let covers: Int
    let failedJobs: Int
    let todayChapters: Int
    /// 数据库占用字节数；托管环境不允许查询时为 null。
    let dbSize: Int?
}

struct AdminJobStatus: Codable {
    let running: Int
    let completed: Int
    let failed: Int
}

struct AdminJobSummary: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String
    let novelTitle: String
    let status: String
    let step: String
    let current: Int
    let total: Int
    let chapterCount: Int
    /// 抓取进度（0~1 小数，与 DB REAL 列一致；对齐 web 端 job.progress * 100）
    let progress: Double
    let error: String
    let startedAt: Int64
    let updatedAt: Int64
}

struct AdminNovelSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let author: String
    let chapterCount: Int
    let updatedAt: Int64
}

// MARK: 紧凑书目索引（GET /api/admin/novel-index）

struct NovelIndexResponse: Codable {
    let novels: [AdminNovelSummary]
    let capped: Bool
}

// MARK: 评论审核（GET/PUT/DELETE /api/admin/comments）

struct AdminComment: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String
    let userId: String
    let parentId: String
    let commentText: String
    let displayName: String
    let hasSpoiler: Bool
    let status: String
    let likeCount: Int
    let reportCount: Int
    let createdAt: Int64
    let updatedAt: Int64
    let userLiked: Bool
    let canEdit: Bool
    let novelTitle: String
    let userUsername: String
    let userDisplayName: String
    let clientIdHash: String
    let ipHash: String
}

struct CommentsResponse: Codable {
    let comments: [AdminComment]
    let total: Int
    let limit: Int
    let offset: Int
}

// MARK: 评论举报（GET/PUT /api/admin/comment-reports）

struct CommentReport: Codable, Identifiable, Hashable {
    let id: String
    let commentId: String
    let reportedBy: String
    let reason: String
    let note: String
    let status: String
    let resolvedBy: String
    let resolvedAt: Int64
    let createdAt: Int64
    let commentText: String
    let commentStatus: String
    let commentNovelId: String
    let commentAuthor: String
    let novelTitle: String
    let reporterUsername: String
    let reporterDisplayName: String
    let resolverUsername: String
}

struct CommentReportsResponse: Codable {
    let reports: [CommentReport]
    let total: Int
    let limit: Int
    let offset: Int
}

// MARK: 想法审核（GET /api/thoughts?admin=1，PUT/DELETE /api/thoughts）

struct AdminThought: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String
    let chapterId: String
    let paragraphIndex: Int
    let paragraphHash: String
    let selectedText: String
    let thoughtText: String
    let displayName: String
    let status: String
    let reportCount: Int
    let createdAt: Int64
    let updatedAt: Int64
    let userId: String
    let avatarUrl: String
    let novelTitle: String
    let chapterTitle: String
    let userUsername: String
    let userDisplayName: String
    let clientIdHash: String
    let ipHash: String
}

struct ThoughtsResponse: Codable {
    let thoughts: [AdminThought]
    let total: Int
    let limit: Int
    let offset: Int
}

// MARK: 用户 / 邀请码 / 注册设置（GET /api/admin-users）

struct AdminUsersResponse: Codable {
    let settings: AdminRegisterSettings
    let schemaHealth: AdminSchemaHealth
    let invites: [AdminInvite]
    let users: [AdminUser]
}

/// registerMode：closed（关闭）| open（开放）| invite（邀请制）
struct AdminRegisterSettings: Codable {
    let registerMode: String
}

struct AdminSchemaHealth: Codable {
    let ok: Bool
    let missing: [String]
}

struct AdminInvite: Codable, Identifiable, Hashable {
    var id: String { code }
    let code: String
    let createdAt: Int64
    let usedAt: Int64
    let usedBy: String
    let usedByName: String
    let disabledAt: Int64

    var isUsed: Bool { usedAt > 0 }
    var isDisabled: Bool { disabledAt > 0 }
}

struct AdminUser: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let role: String
    let status: String
    let createdAt: Int64
    let updatedAt: Int64
    let lastLoginAt: Int64
    let bio: String
    let avatarUrl: String
    let thoughtCount: Int

    var isAdmin: Bool { role == "admin" }
    var isDisabled: Bool { status == "disabled" }
}

// MARK: 用户动作响应（POST /api/admin-users）

struct InviteCreateResponse: Codable {
    let code: String
    let codes: [String]
}

struct ResetPasswordResponse: Codable {
    let success: Bool?
    let username: String
    let tempPassword: String
}

// MARK: 内容安全（GET/PUT /api/admin/content-policy）

struct ContentPolicyResponse: Codable {
    let adultContentEnabled: Bool
}

// MARK: 站点公告（GET/PUT /api/admin/site）

struct AdminSiteResponse: Codable {
    let announcement: String
}
