import Foundation

// MARK: - 登录审计（GET /api/admin-users/login-audit）

struct LoginAuditItem: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let username: String
    let displayName: String
    let status: String
    let reason: String
    let ipAddress: String
    let userAgent: String
    let createdAt: Int64

    var isSuccess: Bool { status == "success" }
    var isFailure: Bool { status == "failure" }
    var isLimited: Bool { status == "limited" }
}

struct LoginAuditResponse: Codable {
    let audits: [LoginAuditItem]
    let total: Int
    let limit: Int
    let offset: Int
}
