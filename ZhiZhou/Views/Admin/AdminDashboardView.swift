import SwiftUI

/// 总览：内容规模、任务状态、最近任务与最近更新（GET /api/admin/stats）。
struct AdminDashboardView: View {
    @State private var stats: AdminStats?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
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
                    panelRow {
                        VStack(spacing: 0) {
                            statsGrid(stats.totals)
                            Divider()
                                .padding(.horizontal, 16)
                            LabeledContent("数据库占用") {
                                Text(AdminFormat.byteSize(stats.totals.dbSize))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                        }
                    }
                }

                Section("任务状态") {
                    panelRow {
                        jobStatusRow(stats.jobStatus)
                    }
                }

                if !stats.recentJobs.isEmpty {
                    Section("最近任务") {
                        panelRow {
                            recentJobsPanel(stats.recentJobs)
                        }
                    }
                }

                if !stats.recentNovels.isEmpty {
                    Section("最近更新") {
                        panelRow {
                            recentNovelsPanel(stats.recentNovels)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .listStyle(.plain)
        .navigationTitle("总览")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: - 加载

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            stats = try await AdminAPI.stats()
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 内容规模

    private func statsGrid(_ totals: AdminTotals) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            statCell("小说", systemImage: "book", value: totals.novels, tint: AppTheme.primary)
            statCell("章节", systemImage: "doc.text", value: totals.chapters, tint: AppTheme.primary)
            statCell("用户", systemImage: "person", value: totals.users, tint: AppTheme.primary)
            statCell("封面", systemImage: "photo", value: totals.covers, tint: AppTheme.primary)
            statCell("今日章节", systemImage: "text.badge.plus", value: totals.todayChapters, tint: AppTheme.success)
            statCell("失败任务", systemImage: "exclamationmark.triangle", value: totals.failedJobs, tint: totals.failedJobs > 0 ? AppTheme.danger : AppTheme.success)
        }
        .padding(.horizontal, 16)
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
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 62, alignment: .leading)
        .padding(.horizontal, 4)
    }

    // MARK: - 任务状态

    private func jobStatusRow(_ jobStatus: AdminJobStatus) -> some View {
        HStack(spacing: 0) {
            statusChip("进行中", value: jobStatus.running, tint: AppTheme.warning)
            Rectangle()
                .fill(AppTheme.border)
                .frame(width: 1, height: 32)
            statusChip("已完成", value: jobStatus.completed, tint: AppTheme.success)
            Rectangle()
                .fill(AppTheme.border)
                .frame(width: 1, height: 32)
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
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    // MARK: - 行

    private func recentJobsPanel(_ jobs: [AdminJobSummary]) -> some View {
        VStack(spacing: 0) {
            ForEach(jobs.indices, id: \.self) { index in
                jobRow(jobs[index])
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                if index < jobs.count - 1 {
                    Divider()
                        .padding(.horizontal, 16)
                }
            }
        }
    }

    private func recentNovelsPanel(_ novels: [AdminNovelSummary]) -> some View {
        VStack(spacing: 0) {
            ForEach(novels.indices, id: \.self) { index in
                novelRow(novels[index])
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                if index < novels.count - 1 {
                    Divider()
                        .padding(.horizontal, 16)
                }
            }
        }
    }

    private func jobRow(_ job: AdminJobSummary) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(job.novelTitle.isEmpty ? "（未知书名）" : job.novelTitle)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
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
                    .lineLimit(2)
            }
        }
    }

    private func novelRow(_ novel: AdminNovelSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(novel.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
            Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章 · \(AdminFormat.relativeTime(novel.updatedAt))")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func panelRow<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(AppTheme.border.opacity(0.65), lineWidth: 1)
            )
            .shadow(color: AppTheme.cardShadow, radius: AppTheme.cardShadowRadius, y: AppTheme.cardShadowY)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    private func jobStatusTint(_ status: String) -> Color {
        switch status {
        case "completed", "partial": return AppTheme.success
        case "failed", "cancelled": return AppTheme.danger
        default: return AppTheme.warning
        }
    }
}
