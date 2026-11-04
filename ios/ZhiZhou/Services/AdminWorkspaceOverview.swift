import Foundation
import Observation

enum AdminInboxFilter: String, CaseIterable, Identifiable {
    case active = "进行中"
    case attention = "失败与中断"
    case all = "全部"
    var id: String { rawValue }
    func includes(_ status: String) -> Bool {
        switch self {
        case .active: return ["queued", "pending", "running"].contains(status)
        case .attention: return ["failed", "cancelled", "canceled", "interrupted", "partial"].contains(status)
        case .all: return true
        }
    }
}

enum AdminInboxItem: Identifiable {
    case ai(AiTaskInfo)
    case scrape(AdminJobItem)
    var id: String {
        switch self { case .ai(let task): return "ai.\(task.id)"; case .scrape(let job): return "scrape.\(job.id)" }
    }
    var novelID: String? {
        switch self { case .ai(let task): return task.novelId; case .scrape(let job): return job.novelId }
    }
    var status: String {
        switch self { case .ai(let task): return task.status ?? ""; case .scrape(let job): return job.status }
    }
    var timestamp: Int64 {
        switch self { case .ai(let task): return task.createdAt ?? 0; case .scrape(let job): return job.startedAt ?? 0 }
    }
    var title: String {
        switch self { case .ai(let task): return AdminFormat.aiTaskKind(task.kind ?? ""); case .scrape: return "抓取与更新" }
    }
    var detail: String {
        switch self { case .ai(let task): return task.error?.isEmpty == false ? task.error! : task.step ?? ""; case .scrape(let job): return job.error?.isEmpty == false ? job.error! : job.step ?? "" }
    }
}

/// Read-only aggregation of existing endpoints; mutations stay in the established task screens.
@MainActor
@Observable
final class AdminWorkspaceOverview {
    private(set) var aiTasks: [AiTaskInfo] = []
    private(set) var jobs: [AdminJobItem] = []
    private(set) var bookTitles: [String: String] = [:]
    private(set) var draftCount: Int?
    private(set) var loading = false
    private(set) var errors: [String] = []
    private var requestID = UUID()
    private var metadataLoadedAt: Date?

    var tasks: [AdminInboxItem] {
        (aiTasks.map(AdminInboxItem.ai) + jobs.map(AdminInboxItem.scrape)).sorted {
            $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp > $1.timestamp
        }
    }

    func load(forceMetadata: Bool = false) async {
        guard AppState.shared.user?.role == "admin", let token = APIClient.shared.token else { return }
        let id = UUID(); requestID = id; loading = true; errors = []
        defer { if requestID == id { loading = false } }
        async let ai: Void = loadAI(id: id, token: token)
        async let scrape: Void = loadJobs(id: id, token: token)
        if forceMetadata || metadataLoadedAt == nil || Date().timeIntervalSince(metadataLoadedAt!) >= 60 {
            async let books: Void = loadBooks(id: id, token: token)
            async let drafts: Void = loadDrafts(id: id, token: token)
            _ = await (books, drafts)
            if accepts(id, token) { metadataLoadedAt = Date() }
        }
        _ = await (ai, scrape)
    }

    private func accepts(_ id: UUID, _ token: String) -> Bool {
        !Task.isCancelled && requestID == id && APIClient.shared.token == token
    }
    private func loadAI(id: UUID, token: String) async {
        do {
            let response: AiTasksResponse = try await AdminAPI.parityRequest("GET", "/api/ai/tasks?status=all&limit=100&offset=0", token: token)
            guard accepts(id, token) else { return }
            aiTasks = response.items
            AdminAITaskCoordinator.shared.reconcile(response.items)
        } catch { if accepts(id, token) { errors.append("AI 任务：\(AppCopy.friendlyError(error))") } }
    }
    private func loadJobs(id: UUID, token: String) async {
        do {
            let response: AdminJobsResponse = try await AdminAPI.parityRequest("GET", "/api/scrape?action=jobs", token: token)
            guard accepts(id, token) else { return }; jobs = response.jobs
        } catch { if accepts(id, token) { errors.append("抓取任务：\(AppCopy.friendlyError(error))") } }
    }
    private func loadBooks(id: UUID, token: String) async {
        do {
            let response: NovelIndexResponse = try await AdminAPI.parityRequest("GET", "/api/admin/novel-index?limit=200", token: token)
            guard accepts(id, token) else { return }
            bookTitles = Dictionary(response.novels.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        } catch { if accepts(id, token) { errors.append("作品名称：\(AppCopy.friendlyError(error))") } }
    }
    private func loadDrafts(id: UUID, token: String) async {
        do {
            let response: AiGenerationsResponse = try await AdminAPI.parityRequest("GET", "/api/ai/generations?scope=writing&status=draft&limit=10", token: token)
            guard accepts(id, token) else { return }; draftCount = response.total ?? response.items.count
        } catch { if accepts(id, token) { draftCount = nil; errors.append("待处理草稿：\(AppCopy.friendlyError(error))") } }
    }
}
