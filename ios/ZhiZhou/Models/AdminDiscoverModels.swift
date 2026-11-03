import Foundation

// MARK: - 爬虫「发现」模型
// 字段与知舟仓库 web/src/pages/admin/scrape/types.ts 的 DiscoverNovel 及
// api/src/routes/scrape.ts 的 discover / po18-search / popo-search 返回一一对应（camelCase）。

/// 「发现」列表中的一部小说（榜单浏览 / PO18 / POPO 搜索共用）。
struct DiscoverNovel: Codable, Identifiable, Hashable {
    var id: String { url }
    let bookId: String?
    let title: String
    let author: String?
    let coverUrl: String?
    let url: String
    let existing: Bool?
    let description: String?
    let chapterCount: Int?
    let status: String?
    let source: String?
    let sourceName: String?

    var isCollected: Bool { existing == true }
}

struct DiscoverResponse: Codable {
    let novels: [DiscoverNovel]
    let total: Int?
    let site: String?
    let totalPages: Int?
}

// MARK: - 爬虫配置导入导出（POST /api/scrape action=list-configs / import-configs）

/// 已保存的抓取配置行（list-configs）。
struct ScrapeConfigRow: Codable, Identifiable, Hashable {
    var id: String { novelId }
    let novelId: String
    let novelTitle: String
    let sourceUrl: String
    let selectors: [String: String]
    let encoding: String
    let updatedAt: Int64
}

struct ScrapeConfigsResponse: Codable { let configs: [ScrapeConfigRow] }

/// import-configs 的请求体条目（novelId + sourceUrl 必填）。
struct ScrapeConfigImportItem: Codable {
    let novelId: String
    let sourceUrl: String
    let selectors: [String: String]?
    let encoding: String?

    func asDictionary() throws -> [String: Any] {
        var dict: [String: Any] = ["novelId": novelId, "sourceUrl": sourceUrl]
        if let selectors { dict["selectors"] = selectors }
        if let encoding { dict["encoding"] = encoding }
        return dict
    }
}

/// import-configs / import-legado 的统一响应。
struct ScrapeImportResponse: Codable {
    let success: Bool?
    let imported: Int?
    let updated: Int?
    let skipped: Int?
    let unsupported: Int?
    let bySupport: LegadoSupportStats?
    let parseErrors: [LegadoParseError]?
    let parseErrorCount: Int?
}

struct LegadoSupportStats: Codable {
    let full: Int?
    let partial: Int?
    let unsupported: Int?
}

struct LegadoParseError: Codable {
    let error: String?
    let preview: String?
}

// MARK: - 源批量操作（batch-toggle-sources / batch-delete-sources）

struct BatchSourcesResponse: Codable {
    let success: Bool?
    let hosts: [String]?
    let enabled: Bool?
    let updated: Int?
    let deleted: Int?
}
