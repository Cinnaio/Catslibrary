import Foundation

// MARK: - 移动端客户端监控（GET/PUT /api/admin/mobile-telemetry）

struct AdminMobileTelemetryResponse: Codable {
    let events: [AdminMobileTelemetryEvent]
    let total: Int
    let limit: Int
    let offset: Int
    let summary: AdminMobileTelemetrySummary
}

struct AdminMobileTelemetryEvent: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let name: String
    let severity: String
    let appVersion: String
    let buildVersion: String
    let osVersion: String
    let deviceModel: String
    let properties: String
    let clientCreatedAt: Int64
    let receivedAt: Int64
    let status: String
    let adminNote: String
}

struct AdminMobileTelemetrySummary: Codable {
    let events: Int
    let errors: Int
    let diagnostics: Int
    let installs: Int
    let open: Int
    let topEvents: [AdminMobileTelemetryTopEvent]
    let trend: [AdminMobileTelemetryTrendPoint]
}

struct AdminMobileTelemetryTopEvent: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    let count: Int
}

struct AdminMobileTelemetryTrendPoint: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let events: Int
    let errors: Int
}
