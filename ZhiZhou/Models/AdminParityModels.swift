import Foundation

struct AdminRecordPage<Item: Decodable>: Decodable {
    let items: [Item]
    let total: Int
}

struct NovelFollowup: Decodable {
    let enabled: Bool
    let intervalHours: Int
    let nextCheckAt: Int64
    let checkedAt: Int64
    let result: String
    let message: String
    let addedCount: Int
    let hasConfig: Bool
    let ongoing: Bool
    let jobId: String?
}

struct AdminOperation: Decodable, Identifiable {
    let id: String
    let operationId: String
    let actorUsername: String
    let actorDisplayName: String
    let action: String
    let targetCount: Int
    let status: String
    let responseStatus: Int
    let replayCount: Int
    let error: String
    let createdAt: Int64
}
struct AdminOperationsResponse: Decodable {
    let operations: [AdminOperation]
    let total: Int
}

struct AdminSiteBranding: Decodable {
    let name: String
    let tagline: String
    let homeTitle: String
    let description: String
    let logoUrl: String
    let faviconUrl: String
}
struct AdminTurnstileStatus: Decodable {
    let siteKey: String
    let hostnames: [String]
    let secretSet: Bool
    let configured: Bool
    let encryptionReady: Bool
    let secretReadable: Bool
    let sources: [String: String]
}

struct BookImportPreview: Decodable {
    struct Book: Decodable { let title: String; let author: String }
    struct Candidate: Decodable, Identifiable {
        struct Target: Decodable { let id: String; let title: String; let author: String }
        let novel: Target
        let matchReason: String
        var id: String { novel.id }
    }
    struct Metadata: Decodable, Identifiable {
        let field: String
        let label: String
        let localValue: String
        let incomingValue: String
        let changed: Bool
        let selected: Bool
        var id: String { field }
    }
    struct Chapter: Decodable, Identifiable {
        let id: String
        let status: String
        let incomingTitle: String
        let incomingContent: String
        let localContent: String?
        let reason: String
        let selected: Bool
    }
    struct Summary: Decodable {
        let newCount: Int
        let changedCount: Int
        let unchangedCount: Int
        let conflictCount: Int
    }
    let runId: String
    let book: Book
    let candidates: [Candidate]
    let targetNovelId: String?
    let metadataDiff: [Metadata]
    let chapters: [Chapter]
    let summary: Summary
    let warnings: [String]
}
struct BookImportResult: Decodable {
    struct Conflict: Decodable { let id: String; let title: String; let reason: String }
    let novelId: String
    let created: Int
    let updated: Int
    let skipped: Int
    let conflicts: [Conflict]
}
struct BookImportHistory: Decodable, Identifiable {
    let runId: String
    let novelTitle: String
    let novelId: String
    let sourceLabel: String
    let sourceUrl: String
    let status: String
    let createdAt: Int64
    let created: Int
    let updated: Int
    let conflicts: Int
    var id: String { runId }
}

struct AdminBackupOverview: Decodable {
    struct Policy: Decodable {
        let enabled: Bool
        let schedule: String
        let time: String
        let timezone: String
        let nextRunAt: Int64
    }
    struct Capabilities: Decodable {
        let encryption: Bool
        let dump: Bool
        let restore: Bool
        let transfer: Bool
        let rehearsal: Bool
    }
    struct Target: Decodable, Identifiable {
        let id: String
        let name: String
        let type: String
        let enabled: Bool
    }
    struct Task: Decodable, Identifiable {
        let id: String
        let kind: String
        let state: String
        let stage: String
        let error: String
        let createdAt: Int64
    }
    let policy: Policy
    let capabilities: Capabilities
    let targets: [Target]
    let maintenance: Bool
    let tasks: [Task]
}
struct AdminBackupVersion: Decodable, Identifiable {
    struct Copy: Decodable, Identifiable {
        let targetId: String
        let name: String
        let state: String
        let error: String
        var id: String { targetId }
    }
    let id: String
    let createdAt: Int64
    let state: String
    let size: Int64
    let note: String
    let copies: [Copy]
}
struct AdminBackupEvent: Decodable, Identifiable {
    let id: Int
    let taskId: String
    let level: String
    let message: String
    let createdAt: Int64
}
