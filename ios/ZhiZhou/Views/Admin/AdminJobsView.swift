import SwiftUI
import ZhiZhouCore

/// 任务管理：抓取任务列表（过滤 / 终止 / 整本重试 / 重试失败章节 / 清理已完成）+ 下载日志。
/// 对齐 Web 端 admin JobsTab：运行中任务每 4 秒自动刷新，空闲每 20 秒。
struct AdminJobsView: View {
    private let focusedJobID: String?
    init(jobID: String? = nil) { focusedJobID = jobID }
    @State private var requests = ListRequestGuard<Bool>()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var jobs: [AdminJobItem] = []
    @State private var logs: [AdminDownloadLog] = []
    @State private var novelTitles: [String: String] = [:]
    @State private var lastNovelIndexRefresh: Date?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var filter: JobFilter = .all
    @State private var isBusy = false
    @State private var busyJobId: String?
    @State private var actionError: String?
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    enum JobFilter: String, CaseIterable, Identifiable {
        case all = "全部"
        case running = "运行中"
        case completed = "已完成"
        case failed = "失败/终止"
        var id: String { rawValue }
    }

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading(focusedJobID == nil ? "抓取任务" : "抓取任务详情",
                                  detail: "查看抓取进度、章节结果与失败原因。")
            if focusedJobID == nil {
                AdminFilterMenu("状态", value: filter.rawValue) {
                    Picker("状态", selection: Binding(get: { filter }, set: { value in
                        withAnimation(reduceMotion ? nil : AppMotion.micro) { filter = value }
                    })) {
                        ForEach(JobFilter.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                }
            }
            if let errorMessage, !jobs.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await loadAll() }
                }
            }
            jobResults
        }
        .refreshable { await loadAll() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await autoRefresh()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("清理已完成任务", role: .destructive) { requestClearCompleted() }
                } label: {
                    if isBusy {
                        AdminInlineProgress()
                    } else {
                        Label("更多", systemImage: "ellipsis.circle")
                    }
                }
                .disabled(isBusy || focusedJobID != nil)
            }
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            switch operation.action {
            case .terminateScrapeJob:
                guard let jobID = operation.targetIDs.first else { return }
                Task {
                    await runAction(.cancel, jobID: jobID, operationID: operation.operationID)
                }
            case .clearCompletedScrapeJobs:
                Task { await clearCompleted(operationID: operation.operationID, jobIDs: operation.targetIDs) }
            default:
                break
            }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 列表

    @ViewBuilder
    private var jobResults: some View {
        if isLoading && jobs.isEmpty {
            ProgressView("加载中…")
                .frame(maxWidth: .infinity, minHeight: 160)
        } else if let errorMessage, jobs.isEmpty {
            ContentUnavailableView {
                Label("加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await loadAll() } }
            }
        } else {
            if filteredJobs.isEmpty {
                ContentUnavailableView {
                    Label("暂无任务", systemImage: "tray")
                } description: {
                    Text("当前过滤条件下没有抓取任务。")
                }
            } else {
                AdminWorkspaceSection(focusedJobID == nil ? "任务（\(filteredJobs.count)）" : "当前任务") {
                    ForEach(Array(filteredJobs.enumerated()), id: \.element.id) { index, job in
                        jobRow(job)
                            .readingSpaceEntrance(index)
                            .transition(reduceMotion ? .identity : .opacity)
                    }
                }
            }
            if focusedJobID == nil && !logs.isEmpty {
                AdminWorkspaceSection("下载日志") {
                    ForEach(Array(logs.enumerated()), id: \.element.id) { index, log in
                        logRow(log).readingSpaceEntrance(index)
                    }
                }
            }
        }
    }

    private var filteredJobs: [AdminJobItem] {
        if let focusedJobID { return jobs.filter { $0.id == focusedJobID } }
        switch filter {
        case .all: return jobs
        case .running: return jobs.filter { AdminFormat.isJobRunning($0.status) }
        case .completed: return jobs.filter { $0.status == "completed" }
        case .failed: return jobs.filter { ["failed", "cancelled", "partial"].contains($0.status) }
        }
    }

    private func jobRow(_ job: AdminJobItem) -> some View {
        let hasBookTitle = job.novelId.flatMap { novelTitles[$0] }?.isEmpty == false
        return VStack(alignment: .leading, spacing: 5) {
            AppAdaptiveRow(spacing: 8) {
                Text(title(for: job))
                    .font(hasBookTitle ? serifFont(.body, .medium) : .body.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                AdminStatusBadge(
                    AdminFormat.jobStatus(job.status),
                    tint: jobTint(job.status)
                )
            }
            if let progress = job.progress {
                ProgressView(value: min(max(progress, 0), 1))
                    .progressViewStyle(.linear)
                    .tint(jobTint(job.status))
            } else if AdminFormat.isJobRunning(job.status) {
                ProgressView("正在抓取…")
                    .font(.caption)
                    .tint(jobTint(job.status))
            }
            AppAdaptiveRow(spacing: 12) {
                jobMetric("公开章节", value: job.publicChapterCount)
                jobMetric("受保护正文", value: job.protectedChapterCount)
            }
            Text(subtitle(for: job))
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
            if let error = job.error, !error.isEmpty {
                if focusedJobID != nil {
                    AccountSettingsNote(error, isError: true)
                } else {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .appTextLineLimit(2)
                }
            }
            if focusedJobID == nil {
                NavigationLink("查看任务详情") { AdminJobsView(jobID: job.id) }
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            } else {
                LabeledContent("任务 ID") {
                    Text(job.id).font(.caption.monospaced()).textSelection(.enabled)
                }
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                if let novelID = job.novelId, !novelID.isEmpty {
                    NavigationLink("管理关联作品") { AdminNovelWorkspaceLoader(novelID: novelID) }
                        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                }
            }
            HStack {
                Spacer()
                if busyJobId == job.id {
                    AdminInlineProgress()
                } else {
                    Menu {
                        if AdminFormat.isJobRunning(job.status) {
                            Button("终止任务", systemImage: "stop.circle") {
                                requestCancel(job)
                            }
                        }
                        Button("整本重试", systemImage: "arrow.clockwise") {
                            Task { await runAction(.retry, jobID: job.id) }
                        }
                        Button("重试失败章节", systemImage: "arrow.counterclockwise") {
                            Task { await runAction(.retryFailed, jobID: job.id) }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(isBusy)
                    .accessibilityLabel("任务操作")
                }
            }
        }
        .padding(.vertical, 2)
        .buttonStyle(.borderless)
        .contextMenu {
            if AdminFormat.isJobRunning(job.status) {
                Button("终止任务", systemImage: "stop.circle") {
                    requestCancel(job)
                }
            }
            Button("整本重试", systemImage: "arrow.clockwise") {
                Task { await runAction(.retry, jobID: job.id) }
            }
            Button("重试失败章节", systemImage: "arrow.counterclockwise") {
                Task { await runAction(.retryFailed, jobID: job.id) }
            }
        }
    }

    private func logRow(_ log: AdminDownloadLog) -> some View {
        AppAdaptiveRow(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(log.targetTitle.isEmpty ? log.targetId : log.targetTitle)
                    .font(serifFont(.body, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(1)
                Text(typeLabel(log.type))
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            Spacer()
            VStack(alignment: .leading, spacing: 3) {
                Text("\(log.itemCount) 项")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                Text(AdminFormat.dateTime(log.createdAt))
                    .font(.caption2)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
        }
    }

    // MARK: - 数据

    private enum JobAction: String {
        case cancel = "cancel"
        case retry = "retry"
        case retryFailed = "retry-failed"
    }

    private func loadAll(refreshNovelIndex: Bool = true) async {
        let ticket = requests.begin(true)
        isLoading = true
        defer {
            if requests.accepts(ticket, query: true) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            async let jobResult = AdminAPI.scrapeJobs()
            async let logResult = AdminAPI.downloadLogs(limit: 50)
            let (loadedJobs, loadedLogs) = try await (jobResult, logResult)
            guard !Task.isCancelled, requests.accepts(ticket, query: true) else { return }
            jobs = loadedJobs
            logs = loadedLogs
            errorMessage = nil
            if refreshNovelIndex || lastNovelIndexRefresh == nil {
                if let index = try? await AdminAPI.novelIndex(limit: 2000) {
                    guard !Task.isCancelled, requests.accepts(ticket, query: true) else { return }
                    novelTitles = Dictionary(uniqueKeysWithValues: index.novels.map { ($0.id, $0.title) })
                    lastNovelIndexRefresh = Date()
                }
            }
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: true) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    /// 运行中每 4 秒、空闲每 20 秒自动刷新（对齐 Web 端）。
    private func autoRefresh() async {
        await loadAll(refreshNovelIndex: true)
        while !Task.isCancelled {
            let hasRunning = jobs.contains { AdminFormat.isJobRunning($0.status) }
            try? await Task.sleep(nanoseconds: (hasRunning ? 4 : 20) * 1_000_000_000)
            guard !Task.isCancelled else { return }
            let refreshNovelIndex = lastNovelIndexRefresh.map {
                Date().timeIntervalSince($0) >= 300
            } ?? true
            await loadAll(refreshNovelIndex: refreshNovelIndex)
        }
    }

    private func requestCancel(_ job: AdminJobItem) {
        guard !isBusy else { return }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .terminateScrapeJob,
            kind: .terminate,
            targetIDs: [job.id],
            title: "终止抓取任务",
            message: "将终止“\(title(for: job))”的当前抓取。已写入的章节不会自动回滚。",
            confirmLabel: "确认终止任务"
        )
    }

    private func requestClearCompleted() {
        guard !isBusy else { return }
        let jobIDs = jobs
            .filter { ["completed", "partial", "cancelled"].contains($0.status) }
            .map(\.id)
            .sorted()
        pendingDangerousOperation = AdminDangerousOperation(
            action: .clearCompletedScrapeJobs,
            kind: .batchDelete,
            targetIDs: jobIDs,
            title: "清理已完成任务",
            message: jobIDs.isEmpty
                ? "确认时没有找到已完成、部分完成或已取消的任务，不会删除新出现的记录。"
                : "将删除确认时发现的 \(jobIDs.count) 个已结束任务；之后新结束的任务会保留。",
            confirmLabel: jobIDs.isEmpty ? "确认空操作" : "删除 \(jobIDs.count) 条记录"
        )
    }

    private func runAction(
        _ action: JobAction,
        jobID: String,
        operationID: String = ""
    ) async {
        guard !isBusy else { return }
        isBusy = true
        busyJobId = jobID
        defer {
            isBusy = false
            busyJobId = nil
        }
        do {
            _ = try await AdminAPI.scrapeAction(
                action.rawValue,
                jobId: jobID,
                operationID: operationID
            )
            await loadAll()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func clearCompleted(operationID: String, jobIDs: [String]) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await AdminAPI.scrapeAction(
                "clear-completed",
                operationID: operationID,
                targetIDs: jobIDs
            )
            await loadAll()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 展示辅助

    private func title(for job: AdminJobItem) -> String {
        if let novelId = job.novelId, let name = novelTitles[novelId], !name.isEmpty {
            return name
        }
        if job.updateMode == true { return "增量更新任务" }
        return job.novelId == nil ? "（未关联小说）" : "（书名未收录）"
    }

    private func subtitle(for job: AdminJobItem) -> String {
        var parts: [String] = []
        if let step = job.step, !step.isEmpty {
            parts.append(AdminFormat.jobStatus(step))
        }
        let text = job.displayChapterText
        if !text.isEmpty {
            parts.append(text)
        }
        if let eta = job.etaSeconds, eta > 0 {
            parts.append("预计剩余约 \(eta) 秒")
        }
        if let updated = job.updatedAt, updated > 0 {
            parts.append(AdminFormat.relativeTime(updated))
        }
        return parts.joined(separator: " · ")
    }

    private func jobMetric(_ title: String, value: Int?) -> some View {
        HStack(spacing: 3) {
            Text(title)
            Text(value.map { String($0) } ?? "未提供")
                .fontWeight(.semibold)
                .monospacedDigit()
        }
        .font(.caption2)
        .foregroundStyle(ReadingSpace.profileMuted)
    }

    private func jobTint(_ status: String) -> Color {
        if AdminFormat.isJobRunning(status) { return AppTheme.primary }
        switch status {
        case "completed": return AppTheme.success
        case "failed", "cancelled", "partial": return AppTheme.danger
        default: return AppTheme.textSecondary
        }
    }

    private func typeLabel(_ type: String) -> String {
        switch type {
        case "novel_txt": return "单本 TXT"
        case "novel_txt_batch": return "批量 TXT"
        case "scrape_configs": return "爬虫配置"
        default: return type
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
