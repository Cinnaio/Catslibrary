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
