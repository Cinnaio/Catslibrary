import SwiftUI
import ZhiZhouCore

/// 总览：内容规模、任务状态、最近任务与最近更新（GET /api/admin/stats）。
struct AdminDashboardView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var stats: AdminStats?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var requests = ListRequestGuard<String>()

    var body: some View {
        List {
            if let errorMessage, stats != nil {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            if isLoading && stats == nil {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, stats == nil {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if let stats {
                Section("内容规模") {
                    statsGrid(stats.totals)
                    LabeledContent("数据库占用") {
                        Text(AdminFormat.byteSize(stats.totals.dbSize))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }

                Section("任务状态") {
                    jobStatusRow(stats.jobStatus)
                }

                if !stats.recentJobs.isEmpty {
                    Section("最近任务") {
                        ForEach(stats.recentJobs.indices, id: \.self) { index in
                            jobRow(stats.recentJobs[index])
                        }
                    }
                }

                if !stats.recentNovels.isEmpty {
                    Section("最近更新") {
                        ForEach(stats.recentNovels.indices, id: \.self) { index in
                            novelRow(stats.recentNovels[index])
                        }
                    }
                }
            }
        }
        .appListStyle(.browsing)
        .navigationTitle("总览")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: - 加载

    private func load() async {
        let ticket = requests.begin("stats")
        isLoading = true
        defer {
            if requests.accepts(ticket, query: "stats") { isLoading = false }
            requests.finish(ticket)
        }
        do {
            let response = try await AdminAPI.stats()
            guard !Task.isCancelled, requests.accepts(ticket, query: "stats") else { return }
            stats = response
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: "stats") else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 内容规模

    private func statsGrid(_ totals: AdminTotals) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 240 : 140), spacing: 12)], spacing: 12) {
            statCell("小说", systemImage: "book", value: totals.novels, tint: AppTheme.primary)
            statCell("章节", systemImage: "doc.text", value: totals.chapters, tint: AppTheme.primary)
            statCell("用户", systemImage: "person", value: totals.users, tint: AppTheme.primary)
            statCell("封面", systemImage: "photo", value: totals.covers, tint: AppTheme.primary)
            statCell("今日章节", systemImage: "text.badge.plus", value: totals.todayChapters, tint: AppTheme.success)
            statCell("失败任务", systemImage: "exclamationmark.triangle", value: totals.failedJobs, tint: totals.failedJobs > 0 ? AppTheme.danger : AppTheme.success)
        }
        .padding(.vertical, 12)
    }

    private func statCell(_ title: String, systemImage: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.caption)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Text("\(value)")
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(AppTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 62, alignment: .leading)
        .padding(.horizontal, 4)
    }

    // MARK: - 任务状态

    private func jobStatusRow(_ jobStatus: AdminJobStatus) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 180 : 80))], spacing: 12) {
            statusChip("进行中", value: jobStatus.running, tint: AppTheme.warning)
            statusChip("已完成", value: jobStatus.completed, tint: AppTheme.success)
            statusChip("失败", value: jobStatus.failed, tint: jobStatus.failed > 0 ? AppTheme.danger : AppTheme.success)
        }
        .padding(.vertical, 16)
    }

    private func statusChip(_ title: String, value: Int, tint: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.headline.weight(.semibold))
                .foregroundStyle(tint)
            Text(title)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    // MARK: - 行

    private func jobRow(_ job: AdminJobSummary) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            AppAdaptiveRow {
                Text(job.novelTitle.isEmpty ? "（未知书名）" : job.novelTitle)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(1)
                Spacer()
                AdminStatusBadge(
                    AdminFormat.jobStatus(job.status),
                    tint: jobStatusTint(job.status)
                )
            }
            ProgressView(value: min(max(job.progress, 0), 1))
                .progressViewStyle(.linear)
                .tint(jobStatusTint(job.status))
            Text("章节 \(job.current)/\(job.total) · \(AdminFormat.relativeTime(job.updatedAt))")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            if !job.error.isEmpty {
                Text(job.error)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.danger)
                    .appTextLineLimit(2)
            }
        }
    }

    private func novelRow(_ novel: AdminNovelSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(novel.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(AppTheme.textPrimary)
                .appTextLineLimit(1)
            Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章 · \(AdminFormat.relativeTime(novel.updatedAt))")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func jobStatusTint(_ status: String) -> Color {
        switch status {
        case "completed", "partial": return AppTheme.success
        case "failed", "cancelled": return AppTheme.danger
        default: return AppTheme.warning
        }
    }
}
