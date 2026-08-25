import Foundation

// MARK: - 站点运营（GET /api/admin/site）
// 字段与知舟仓库 api/src/routes/site.ts 的 adminSiteRoutes.get('/') 返回一一对应（camelCase）。

/// 站点运营总览：流量指标 + 流量分析 + 内容健康度 + 公告。
struct SiteOverview: Codable {
    let announcement: String?
    let metrics: SiteMetrics?
    let popularNovels: [SitePopularNovel]?
    let traffic: SiteTraffic?
    let contentHealth: SiteContentHealth?
}

struct SiteMetrics: Codable {
    let todayPageViews: Int?
    let todayVisitors: Int?
    let weekPageViews: Int?
    let weekVisitors: Int?
    let activeReaders: Int?
}

struct SitePopularNovel: Codable, Identifiable, Hashable {
    var id: String { novelId }
    let novelId: String
    let title: String
    let views: Int?
}

struct SiteTraffic: Codable {
    let dailyTrend: [SiteTrendPoint]?
    let countries: [SiteCountry]?
    let devices: [SiteDimension]?
    let sources: [SiteDimension]?
}

struct SiteTrendPoint: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let pageViews: Int?
    let visitors: Int?
}

struct SiteCountry: Codable, Identifiable, Hashable {
    var id: String { countryCode }
    let countryCode: String
    let visits: Int?
    let visitors: Int?
}

struct SiteDimension: Codable, Identifiable, Hashable {
    var id: String { key }
    let key: String
    let visits: Int?
}

struct SiteContentHealth: Codable {
    let novels: Int?
    let chapters: Int?
    let newComments: Int?
    let openReports: Int?
    let categories: [SiteCategory]?
    let statuses: [String: Int]?
    let quality: SiteQuality?
    let recentUpdates: SiteRecentUpdates?
    let updateTrend: [SiteUpdatePoint]?
    let completeness: [SiteCompleteness]?
    let scrapeHealth: SiteScrapeHealth?
}

struct SiteCategory: Codable, Identifiable, Hashable {
    var id: String { category }
    let category: String
    let novels: Int?
}

struct SiteQuality: Codable {
    let uncategorized: Int?
    let missingCover: Int?
    let missingDescription: Int?
    let staleOngoing: Int?
}

struct SiteRecentUpdates: Codable {
    let last7Days: Int?
    let last30Days: Int?
    let novels: [SiteRecentNovel]?
}

struct SiteRecentNovel: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let updatedAt: Int64?
    let status: String?
}

struct SiteUpdatePoint: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let novels: Int?
}

struct SiteCompleteness: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let score: Int?
}

struct SiteScrapeHealth: Codable {
    let windowDays: Int?
    let failed: Int?
    let active: Int?
    let completed: Int?
    let lastUpdated: Int64?
}
