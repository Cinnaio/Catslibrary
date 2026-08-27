import SwiftUI

/// 任务管理：抓取任务列表（过滤 / 终止 / 整本重试 / 重试失败章节 / 清理已完成）+ 下载日志。
/// 对齐 Web 端 admin JobsTab：运行中任务每 4 秒自动刷新，空闲每 20 秒。
struct AdminJobsView: View {
    @State private var jobs: [AdminJobItem] = []
    @State private var logs: [AdminDownloadLog] = []
    @State private var novelTitles: [String: String] = [:]
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var filter: JobFilter = .all
    @State private var isBusy = false
    @State private var busyJobId: String?
    @State private var actionError: String?
    @State private var showClearConfirm = false

    enum JobFilter: String, CaseIterable, Identifiable {
        case all = "全部"
        case running = "运行中"
        case completed = "已完成"
        case failed = "失败/终止"
        var id: String { rawValue }
    }

    var body: some View {
        List {
            Section {
                AdminFilterBar {
                    AdminFilterMenu("过滤", value: filter.rawValue) {
                        Picker("过滤", selection: $filter) {
                            ForEach(JobFilter.allCases) { item in
                                Text(item.rawValue).tag(item)
                            }
                        }
                    }
                }
            }

            if isLoading && jobs.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, jobs.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await loadAll() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if filteredJobs.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("暂无任务", systemImage: "tray")
                        } description: {
                            Text("当前过滤条件下没有抓取任务。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else {
                    Section("任务（\(filteredJobs.count)）") {
                        ForEach(filteredJobs) { job in
                            jobRow(job)
                        }
                    }
                }

                if !logs.isEmpty {
                    Section("下载日志") {
                        ForEach(logs) { log in
                            logRow(log)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("任务管理")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await loadAll() }
        .task { await autoRefresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("清理已完成任务", role: .destructive) { showClearConfirm = true }
                } label: {
                    if isBusy {
                        AdminInlineProgress()
                    } else {
                        Label("更多", systemImage: "ellipsis.circle")
                    }
                }
                .disabled(isBusy)
            }
        }
        .alert("清理已完成", isPresented: $showClearConfirm) {
            Button("删除已完成任务", role: .destructive) { Task { await clearCompleted() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除所有已完成 / 部分完成 / 已取消的任务记录，不可恢复。")
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 列表

    private var filteredJobs: [AdminJobItem] {
        switch filter {
        case .all: return jobs
        case .running: return jobs.filter { AdminFormat.isJobRunning($0.status) }
        case .completed: return jobs.filter { $0.status == "completed" }
        case .failed: return jobs.filter { ["failed", "cancelled", "partial"].contains($0.status) }
        }
    }

    private func jobRow(_ job: AdminJobItem) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(title(for: job))
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                AdminStatusBadge(
                    AdminFormat.jobStatus(job.status),
                    tint: jobTint(job.status)
                )
            }
            ProgressView(value: min(max(job.progress ?? 0, 0), 1))
                .progressViewStyle(.linear)
                .tint(jobTint(job.status))
            HStack(spacing: 12) {
                jobMetric("公开章节", value: job.publicChapterCount)
                jobMetric("受保护正文", value: job.protectedChapterCount)
            }
            Text(subtitle(for: job))
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            if let error = job.error, !error.isEmpty {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.danger)
                    .lineLimit(2)
            }
            HStack {
                Spacer()
                if busyJobId == job.id {
                    AdminInlineProgress()
                } else {
                    Menu {
                        if AdminFormat.isJobRunning(job.status) {
                            Button("终止任务", systemImage: "stop.circle") {
                                Task { await runAction(.cancel, job: job) }
                            }
                        }
                        Button("整本重试", systemImage: "arrow.clockwise") {
                            Task { await runAction(.retry, job: job) }
                        }
                        Button("重试失败章节", systemImage: "arrow.counterclockwise") {
                            Task { await runAction(.retryFailed, job: job) }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .frame(width: 36, height: 36)
                    }
                    .disabled(isBusy)
                    .accessibilityLabel("任务操作")
                }
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            if AdminFormat.isJobRunning(job.status) {
                Button("终止任务", systemImage: "stop.circle") {
                    Task { await runAction(.cancel, job: job) }
                }
            }
            Button("整本重试", systemImage: "arrow.clockwise") {
                Task { await runAction(.retry, job: job) }
            }
            Button("重试失败章节", systemImage: "arrow.counterclockwise") {
                Task { await runAction(.retryFailed, job: job) }
            }
        }
    }

    private func logRow(_ log: AdminDownloadLog) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(log.targetTitle.isEmpty ? log.targetId : log.targetTitle)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Text(typeLabel(log.type))
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(log.itemCount) 项")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                Text(AdminFormat.dateTime(log.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
    }

    // MARK: - 数据

    private enum JobAction: String {
        case cancel = "cancel"
        case retry = "retry"
        case retryFailed = "retry-failed"
    }

    private func loadAll() async {
        isLoading = true
        defer { isLoading = false }
        do {
            jobs = try await AdminAPI.scrapeJobs()
            logs = try await AdminAPI.downloadLogs(limit: 50)
            errorMessage = nil
            if let index = try? await AdminAPI.novelIndex(limit: 2000) {
                novelTitles = Dictionary(uniqueKeysWithValues: index.novels.map { ($0.id, $0.title) })
            }
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    /// 运行中每 4 秒、空闲每 20 秒自动刷新（对齐 Web 端）。
    private func autoRefresh() async {
        while !Task.isCancelled {
            await loadAll()
            let hasRunning = jobs.contains { AdminFormat.isJobRunning($0.status) }
            try? await Task.sleep(nanoseconds: (hasRunning ? 4 : 20) * 1_000_000_000)
        }
    }

    private func runAction(_ action: JobAction, job: AdminJobItem) async {
        guard !isBusy else { return }
        isBusy = true
        busyJobId = job.id
        defer {
            isBusy = false
            busyJobId = nil
        }
        do {
            _ = try await AdminAPI.scrapeAction(action.rawValue, jobId: job.id)
            await loadAll()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func clearCompleted() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await AdminAPI.scrapeAction("clear-completed")
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
            Text("\(value ?? 0)")
                .fontWeight(.semibold)
                .monospacedDigit()
        }
        .font(.caption2)
        .foregroundStyle(AppTheme.textMuted)
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
