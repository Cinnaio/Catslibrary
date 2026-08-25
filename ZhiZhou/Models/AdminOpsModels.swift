import Foundation

// MARK: - 任务管理（GET/POST /api/scrape）
// 字段与知舟仓库 api/src/routes/scrape.ts、services/scraper/store.ts 的返回一一对应（camelCase）。

/// GET /api/scrape?action=jobs 的任务条目：JobData + getJobSummary 摘要合并后的扁平字段。
/// 摘要字段可能缺失，全部声明为可选，避免单个缺失字段导致整页解码失败。
struct AdminJobItem: Codable, Identifiable, Hashable {
    let id: String
    let novelId: String?
    let status: String
    let step: String?
    let current: Int?
    let total: Int?
    let chapterCount: Int?
    /// 抓取进度（0~1 小数，DB REAL 列）。
    let progress: Double?
    let error: String?
    let startedAt: Int64?
    let updatedAt: Int64?
    let localMode: Bool?
    let updateMode: Bool?
    let successCount: Int?
    let failedCount: Int?
    let skippedCount: Int?
    let speed: Double?
    let etaSeconds: Int?

    /// 运行中任务无 chapterCount（0），展示用章节进度。
    var displayChapterText: String {
        guard let current, let total, total > 0 else { return "" }
        return "章节 \(current)/\(total)"
    }
}

struct AdminJobsResponse: Codable { let jobs: [AdminJobItem] }

/// POST /api/scrape 动作（cancel / retry / retry-failed / update / clear-completed）的通用响应。
struct AdminJobActionResponse: Codable {
    let success: Bool?
    let ok: Bool?
    let jobId: String?
    let message: String?
    let deleted: Int?
    let total: Int?
    let updateMode: Bool?
}

// MARK: - 下载日志（GET /api/download-logs）

struct AdminDownloadLog: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let targetId: String
    let targetTitle: String
    let itemCount: Int
    let createdAt: Int64
}

struct AdminDownloadLogsResponse: Codable { let logs: [AdminDownloadLog] }

// MARK: - 小说管理（GET/POST /api/novels、PUT/DELETE /api/novels/:id）

struct NovelResponse: Codable { let novel: Novel }
