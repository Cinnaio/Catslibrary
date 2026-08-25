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

// MARK: - 爬虫：智能分析（POST /api/scrape action=detect-meta）

struct ScrapeSelectors: Codable, Hashable {
    let chapterList: String?
    let chapterTitle: String?
    let chapterContent: String?
    let nextPage: String?
}

struct ScrapeDetectedNovel: Codable {
    let title: String?
    let author: String?
    let description: String?
    let coverUrl: String?
    let categories: [String]?
    let category: String?
    let status: String?
    let sourceUrl: String?
}

struct ScrapeDetectedSite: Codable { let name: String? }

struct ScrapeDetectedMeta: Codable {
    let novel: ScrapeDetectedNovel?
    let selectors: ScrapeSelectors?
    let encoding: String?
    let chapterListUrl: String?
    let chapterCount: Int?
    let site: ScrapeDetectedSite?
    let error: String?
}

// MARK: - 爬虫：选择器测试（POST /api/scrape action=test / test-source）

struct ScrapeTestLink: Codable {
    let text: String?
    let href: String?
}

struct ScrapeTestDiagnostics: Codable {
    let duplicateCount: Int?
    let emptyTitleCount: Int?
}

struct ScrapeSampleChapter: Codable {
    let ok: Bool?
    let text: String?
    let href: String?
}

struct ScrapeTestResponse: Codable {
    let links: [ScrapeTestLink]?
    let diagnostics: ScrapeTestDiagnostics?
    let sampleChapters: [ScrapeSampleChapter]?
    let error: String?
}

// MARK: - 爬虫：源管理（POST /api/scrape action=list-sources 等）

struct ScrapeSourceRow: Codable, Identifiable, Hashable {
    let host: String
    let name: String
    let sourceUrl: String?
    let encoding: String?
    let support: String?
    let confidence: Int?
    let warnings: [String]?
    let enabled: Bool?
    let connectivity: String?
    let connectivityError: String?
    let connectivityCheckedAt: Int64?
    let chapterList: String?
    let chapterContent: String?
    let lastTestedAt: Int64?
    let updatedAt: Int64?

    var id: String { host }
}

struct ScrapeSourcesResponse: Codable {
    let sources: [ScrapeSourceRow]
    let page: Int?
    let pageSize: Int?
    let matchedTotal: Int?
    let totalPages: Int?
}

struct ScrapeConnectivityItem: Codable, Hashable {
    let host: String
    let connectivity: String?
    let error: String?
}

struct ScrapeConnectivityResponse: Codable {
    let success: Bool?
    let checked: Int?
    let reachable: Int?
    let unreachable: Int?
    let results: [ScrapeConnectivityItem]?
}

// MARK: - 爬虫：代理（GET/POST /api/scrape action=proxy-*）

struct ScrapeProxyPair: Codable, Hashable {
    let proxyBase: String
    let proxyBypass: String
}

struct ScrapeProxyConfig: Codable {
    let config: ScrapeProxyPair?
    let effective: ScrapeProxyPair?
    let noProxy: String?
    let effectiveHost: String?
    let configured: Bool?
    let source: String?
}

struct ScrapeProxyTestResponse: Codable {
    let ok: Bool?
    let error: String?
    let code: String?
    let targetHost: String?
    let proxyHost: String?
    let encoding: String?
    let length: Int?
    let elapsedMs: Int?
}

struct ScrapeProxyLogItem: Codable, Identifiable, Hashable {
    let id: Int
    let timestamp: Int64
    let scope: String?
    let method: String?
    let target: String?
    let targetHost: String?
    let proxySource: String?
    let proxyHost: String?
    let status: Int?
    let durationMs: Int?
    let ok: Bool?
    let error: String?
}

struct ScrapeProxyLogsResponse: Codable { let logs: [ScrapeProxyLogItem] }
