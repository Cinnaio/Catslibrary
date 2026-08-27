import Foundation

// MARK: - AI 服务模型
// 字段与知舟仓库 web/src/lib/api.ts 的 aiApi 返回一一对应（camelCase）。

// MARK: 状态与配额（GET /api/ai/status）

struct AiFeatures: Codable {
    let recap: Bool?
    let catchup: Bool?
}

struct AiQuota: Codable {
    let used: Int?
    /// -1 表示不限额（管理员）
    let limit: Int?
    let resetAt: Int64?
}

struct AiStatus: Codable {
    let configured: Bool?
    let features: AiFeatures?
    let model: String?
    let quota: AiQuota?
    let catchupStaleDays: Int?
}

// MARK: 用量（GET /api/ai/usage）

struct AiUsageSummary: Codable {
    let calls: Int?
    let promptTokens: Int?
    let completionTokens: Int?
    let costMillicents: Int?
}

struct AiUsageResponse: Codable {
    let today: AiUsageSummary?
    let last30d: AiUsageSummary?
}

// MARK: 设置（GET/PUT /api/ai/settings）

struct AiSettings: Codable {
    // 前情提要
    let recapEnabled: Bool?
    let dailyQuota: Int?
    let maxChapterChars: Int?
    let recapTemperature: Double?
    let recapMaxTokens: Int?
    let recapSystemPrompt: String?
    // 回顾总结
    let catchupEnabled: Bool?
    let catchupStaleDays: Int?
    let catchupMaxChapters: Int?
    let catchupTemperature: Double?
    let catchupMaxTokens: Int?
    // AI 创作
    let writingTemperature: Double?
    let writingMaxTokens: Int?
    let writingSystemPrompt: String?
    let styleProfileMaxTokens: Int?
    let plotStateMaxTokens: Int?
    let relationshipProfileMaxTokens: Int?
    let titleMaxTokens: Int?
    let maxConcurrentWritingTasks: Int?
    // AI 封面
    let imageSize: String?
    let imageQuality: String?
    let imageResponseFormat: String?
    let coverImageSize: String?
    let coverRenderTitle: Bool?
    let coverPlatform: String?
    let coverPromptMaxChars: Int?
    // 运维与审计
    let taskRetentionDays: Int?
    let logIpAddress: Bool?
    let logUserAgent: Bool?
}

struct AiProviderInfo: Codable {
    let configured: Bool?
    let host: String?
    let model: String?
    let hasKey: Bool?
}

struct AiProviderConfig: Codable {
    let baseUrl: String?
    let model: String?
    let hasApiKey: Bool?
}

struct AiSettingsResponse: Codable {
    let settings: AiSettings?
    let provider: AiProviderInfo?
    let providerConfig: AiProviderConfig?
    let imageProvider: AiProviderInfo?
    let imageProviderConfig: AiProviderConfig?
}

/// PUT /api/ai/settings 的返回：{ settings: AiSettings }
struct AiSettingsSaveResponse: Codable {
    let settings: AiSettings
}

struct AiProviderSaveResponse: Codable {
    let ok: Bool?
    let provider: AiProviderInfo?
    let providerConfig: AiProviderConfig?
    let imageProvider: AiProviderInfo?
    let imageProviderConfig: AiProviderConfig?
}

struct AiTestResponse: Codable {
    let ok: Bool?
    let model: String?
    let reply: String?
    let error: String?
    let code: String?
    let elapsedMs: Int?
}

// MARK: 任务（GET /api/ai/tasks）

struct AiTaskInfo: Codable, Identifiable, Hashable {
    let id: String
    let userId: String?
    let novelId: String?
    let kind: String?
    let status: String?
    let current: Int?
    let total: Int?
    let step: String?
    let prompt: String?
    /// 任务产物 JSON；封面描述词任务完成后包含 prompt + metadata。
    let result: String?
    let batchId: String?
    /// 创建时的请求参数（JSON），非空才支持重试
    let params: String?
    let error: String?
    let createdAt: Int64?
    let updatedAt: Int64?
    let finishedAt: Int64?

    var isRunning: Bool {
        ["queued", "running"].contains(status ?? "")
    }
}

struct AiTasksResponse: Codable {
    let items: [AiTaskInfo]
    let total: Int?
    let limit: Int?
    let offset: Int?
}

/// GET /api/ai/tasks/:id 的返回（后台任务轮询）。
struct AiTaskDetailResponse: Codable {
    let task: AiTaskInfo
}

/// 封面描述词后台任务的 result JSON。
struct AiCoverPromptTaskResult: Codable, Hashable {
    let prompt: String
    let metadata: AiCoverMetadata?
}

// MARK: 审计（GET /api/ai/audit/users、/api/ai/audit/calls）

struct AiAuditUser: Codable, Identifiable, Hashable {
    let id: String
    let username: String?
    let displayName: String?
    let callCount: Int?
    let totalPromptTokens: Int?
    let totalCompletionTokens: Int?
    let totalCostMillicents: Int?
    let lastCallAt: Int64?
}

struct AiAuditUsersResponse: Codable {
    let users: [AiAuditUser]
    let total: Int?
    let limit: Int?
    let offset: Int?
}

struct AiAuditCall: Codable, Identifiable, Hashable {
    let id: String
    let type: String?
    let model: String?
    let promptTokens: Int?
    let completionTokens: Int?
    let imageCount: Int?
    let costMillicents: Int?
    let createdAt: Int64?
    let userId: String?
    let username: String?
    let displayName: String?
    let novelId: String?
    let novelTitle: String?
    let chapterId: String?
    let chapterTitle: String?
    let ipAddress: String?
    let userAgent: String?
}

struct AiAuditCallsResponse: Codable {
    let calls: [AiAuditCall]
    let total: Int?
    let limit: Int?
    let offset: Int?
}

// MARK: 审计趋势（GET /api/ai/audit/trend）

struct AiAuditTrendPoint: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let calls: Int?
    let promptTokens: Int?
    let completionTokens: Int?
    let costMillicents: Int?
}

struct AiAuditTrendResponse: Codable {
    let trend: [AiAuditTrendPoint]
    let days: Int?
}

// MARK: 封面候选（GET /api/ai/cover/candidates 等）

struct AiCoverMetadata: Codable, Hashable {
    let genre: String?
    let genres: [String]?
    let stylePreset: String?
    let composition: String?
    let variationId: String?
    let romanceSubtype: String?
    let romanceEmotion: String?
    let visualConcept: String?
    let visualAnchor: String?
    let storySetting: String?
}

struct AiCoverCandidate: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String
    let contentType: String?
    let prompt: String?
    let taskId: String?
    let createdAt: Int64?
    let metadata: AiCoverMetadata?
    /// 图片 data URL（可直接用于展示）。
    let dataUrl: String
}

struct AiCoverCandidatesResponse: Codable {
    let items: [AiCoverCandidate]
    let total: Int?
}

/// POST /api/ai/cover/generate 与创作类接口的通用返回（后台任务模式）。
struct AiTaskStartResponse: Codable {
    let ok: Bool?
    let taskId: String
    let batchId: String
    let total: Int
}

/// POST /api/ai/cover/prompt 的返回。
struct AiCoverPromptResponse: Codable {
    let prompt: String
    let metadata: AiCoverMetadata?
}

// MARK: 已生成内容（GET /api/ai/generations 等）

struct AiGeneration: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String?
    let novelTitle: String?
    let chapterId: String?
    let chapterTitle: String?
    let kind: String?
    let model: String?
    let result: String?
    let status: String?
    let createdAt: Int64?
    let prompt: String?
    let batchId: String?
    let batchIndex: Int?
    let batchCount: Int?
    /// 续写时从 AI 输出解析出的章节标题（发布时自动填写）。
    let draftTitle: String?

    var isDraft: Bool { status == "draft" }
    var isPublished: Bool { status == "published" }
    var isRejected: Bool { status == "rejected" }
}

struct AiGenerationsResponse: Codable {
    let items: [AiGeneration]
    let total: Int?
    let limit: Int?
    let offset: Int?
}

struct AiGenerationsBatchResponse: Codable {
    let ok: Bool?
    let deleted: Int?
    let restored: Int?
}

// MARK: 草稿发布（POST /api/ai/writing/drafts/:id/publish 等）

struct AiPublishedChapter: Codable, Hashable {
    let id: String
    let title: String
    let order: Int
}

struct AiPublishDraftResponse: Codable {
    let ok: Bool?
    let chapter: AiPublishedChapter?
}

struct AiPublishBatchResponse: Codable {
    let ok: Bool?
    let published: [AiPublishedChapter]?
    let novelId: String?
}

struct AiUnpublishBatchResponse: Codable {
    let ok: Bool?
    let restored: Int?
}

/// PUT /api/ai/writing/drafts/:id 的返回。
struct AiDraftUpdateResponse: Codable {
    let ok: Bool?
    let id: String?
    let result: String?
}

// MARK: 画像提取（POST/GET /api/ai/writing/style-profile 等）

struct AiProfileResponse: Codable {
    let ok: Bool?
    let profile: String?
    let model: String?
}

struct AiProfileGetResponse: Codable {
    let profile: String?
}

struct AiPlotStateResponse: Codable {
    let ok: Bool?
    let state: String?
    let chaptersThrough: Int?
    let model: String?
}

struct AiPlotStateGetResponse: Codable {
    let state: String?
    let chaptersThrough: Int?
    let chapterCount: Int?
}

/// POST /api/ai/writing/titles 的返回。
struct AiTitlesResponse: Codable {
    let titles: [String]?
}
