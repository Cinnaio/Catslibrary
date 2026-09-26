import Foundation

// MARK: - 内容分级治理模型
// 字段与知舟仓库 api/src/routes/content-ratings.ts、
// content-rating-rule-candidates.ts、content-rating-ai.ts 的返回一一对应。

enum AdminContentRatingValue: String, Codable, CaseIterable, Identifiable, Hashable {
    case general
    case restricted
    case unknown

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "一般"
        case .restricted: return "限制级"
        case .unknown: return "未标注"
        }
    }
}

enum AdminContentRatingSource: String, Codable, CaseIterable, Identifiable, Hashable {
    case manual
    case aiTask = "ai_task"
    case prefill
    case sourceImport = "source_import"
    case migration
    case system
    case legacy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .manual: return "人工"
        case .aiTask: return "AI 任务"
        case .prefill: return "规则预填"
        case .sourceImport: return "来源导入"
        case .migration: return "迁移"
        case .system: return "系统"
        case .legacy: return "旧数据"
        }
    }
}

enum AdminContentRatingRuleKind: String, Codable, CaseIterable, Identifiable, Hashable {
    case category
    case phrase

    var id: String { rawValue }

    var title: String {
        switch self {
        case .category: return "分类标签"
        case .phrase: return "文本短语"
        }
    }
}

enum AdminContentRatingRuleStatus: String, Codable, CaseIterable, Identifiable, Hashable {
    case pending
    case approved
    case rejected

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pending: return "待审核"
        case .approved: return "已批准"
        case .rejected: return "已拒绝"
        }
    }
}

enum AdminContentRatingAISuggestionStatus: String, Codable, CaseIterable, Identifiable, Hashable {
    case pending
    case approved
    case rejected
    case stale
    case failed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pending: return "待审核"
        case .approved: return "已批准"
        case .rejected: return "已拒绝"
        case .stale: return "已过期"
        case .failed: return "失败"
        }
    }
}

struct AdminContentRatingEvidence: Codable, Hashable {
    let type: String
    let field: String?
    let value: String?
    let rule: String?
}

struct AdminContentRatingCounts: Codable {
    let general: Int
    let restricted: Int
    let unknown: Int
}

struct AdminContentRatingItem: Codable, Identifiable {
    let id: String
    let title: String
    let author: String
    let contentRating: AdminContentRatingValue
    let revision: Int
    let source: String
    let reason: String
    let evidence: [AdminContentRatingEvidence]
    let ruleVersion: String
    let updatedBy: String
    let updatedByName: String
    let contentRatingUpdatedAt: Int64
    let operationId: String
    let chapterCount: Int
    let updatedAt: Int64
}

struct AdminContentRatingListResponse: Codable {
    let items: [AdminContentRatingItem]
    let total: Int
    let limit: Int
    let offset: Int
    let counts: AdminContentRatingCounts
    let sources: [String]
}

struct AdminContentRatingHistoryItem: Codable, Identifiable {
    let id: String
    let novelId: String
    let fromRating: AdminContentRatingValue
    let toRating: AdminContentRatingValue
    let source: String
    let reason: String
    let evidence: [AdminContentRatingEvidence]
    let ruleVersion: String
    let operationId: String
    let actorUserId: String
    let actorName: String
    let createdAt: Int64
}

struct AdminContentRatingHistoryResponse: Codable {
    let history: [AdminContentRatingHistoryItem]
}

struct AdminContentRatingUpdateResponse: Codable {
    let item: AdminContentRatingItem
}

struct AdminContentRatingRuleCandidateExample: Codable {
    let novelId: String
    let novelTitle: String
    let novelAuthor: String
    let revision: Int
    let operationId: String
    let reason: String
    let evidence: [AdminContentRatingEvidence]
    let createdBy: String
    let createdByName: String
    let createdAt: Int64
}

struct AdminContentRatingRuleCandidate: Codable, Identifiable {
    let id: String
    let kind: AdminContentRatingRuleKind
    let value: String
    let normalizedValue: String
    let targetRating: AdminContentRatingValue
    let status: AdminContentRatingRuleStatus
    let createdBy: String
    let createdByName: String
    let createdAt: Int64
    let reviewedBy: String
    let reviewedByName: String
    let reviewedAt: Int64
    let reviewReason: String
    let updatedAt: Int64
    let revision: Int
    let ruleVersion: String
    let exampleCount: Int
    let latestExample: AdminContentRatingRuleCandidateExample?
}

struct AdminContentRatingRuleCandidateCounts: Codable {
    let pending: Int
    let approved: Int
    let rejected: Int
}

struct AdminContentRatingRuleCandidateListResponse: Codable {
    let items: [AdminContentRatingRuleCandidate]
    let total: Int
    let limit: Int
    let offset: Int
    let counts: AdminContentRatingRuleCandidateCounts
    let kinds: [AdminContentRatingRuleKind]
    let activeRuleVersion: String
}

struct AdminContentRatingRuleCandidateCreateResponse: Codable {
    let ok: Bool?
    let created: Bool
    let exampleAdded: Bool
    let candidate: AdminContentRatingRuleCandidate
}

struct AdminContentRatingRuleCandidatePreviewItem: Codable, Identifiable {
    let novelId: String
    let title: String
    let author: String
    let revision: Int
    let source: String
    let matchedFields: [String]
    let evidence: [AdminContentRatingEvidence]

    var id: String { novelId }
}

struct AdminContentRatingRuleCandidatePreviewResponse: Codable {
    let candidate: AdminContentRatingRuleCandidate
    let currentRuleVersion: String
    let prospectiveRuleVersion: String
    let affectedCount: Int
    let items: [AdminContentRatingRuleCandidatePreviewItem]
}

struct AdminContentRatingRuleCandidateReviewResponse: Codable {
    let ok: Bool?
    let decision: String
    let candidate: AdminContentRatingRuleCandidate
    let ruleVersion: String
    let matchedCount: Int
    let appliedCount: Int
    let operationId: String
}

struct AdminContentRatingAISnapshot: Codable {
    let novelId: String?
    let title: String?
    let author: String?
    let description: String?
    let categories: [String]?
    let ratingRevision: Int?
}

struct AdminContentRatingAISuggestion: Codable, Identifiable {
    let id: String
    let novelId: String
    let title: String
    let author: String
    let taskId: String
    let novelRevision: Int
    let currentRating: AdminContentRatingValue
    let currentSource: String
    let currentRevision: Int
    let inputSnapshot: AdminContentRatingAISnapshot
    let suggestedRating: AdminContentRatingValue
    let confidence: Double
    let reason: String
    let evidence: [AdminContentRatingEvidence]
    let model: String
    let promptVersion: String
    let status: AdminContentRatingAISuggestionStatus
    let revision: Int
    let reviewedBy: String
    let reviewedByName: String
    let reviewedAt: Int64
    let reviewReason: String
    let error: String
    let createdAt: Int64
    let updatedAt: Int64
}

struct AdminContentRatingAISuggestionCounts: Codable {
    let pending: Int
    let approved: Int
    let rejected: Int
    let stale: Int
    let failed: Int
}

struct AdminContentRatingAISuggestionListResponse: Codable {
    let items: [AdminContentRatingAISuggestion]
    let total: Int
    let counts: AdminContentRatingAISuggestionCounts
}

struct AdminContentRatingAIScanResponse: Codable {
    let ok: Bool?
    let taskId: String
    let selected: Int
    let total: Int
    let message: String?
    let task: AiTaskInfo?
}

struct AdminContentRatingAITaskProgress: Codable {
    let task: AiTaskInfo
    let total: Int
    let done: Int
    let remaining: Int
    let canResume: Bool
    let resumable: Bool
    let promptVersion: String
}

struct AdminContentRatingAILatestBatch: Codable {
    let task: AiTaskInfo?
    let total: Int
    let done: Int
    let remaining: Int
    let canResume: Bool
    let resumable: Bool
    let promptVersion: String
}

struct AdminContentRatingAIResumeResponse: Codable {
    let ok: Bool?
    let taskId: String
    let selected: Int
    let total: Int
    let skipped: Int
    let message: String?
    let task: AiTaskInfo?
}

struct AdminContentRatingAIReviewResponse: Codable {
    let ok: Bool?
    let decision: String
    let suggestion: AdminContentRatingAISuggestion
    let applied: Bool
    let operationId: String
}
