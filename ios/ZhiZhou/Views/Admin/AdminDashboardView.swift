import SwiftUI
import ZhiZhouCore

/// 总览：内容规模、任务状态、最近任务与最近更新（GET /api/admin/stats）。
struct AdminDashboardView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var stats: AdminStats?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var requests = ListRequestGuard<String>()

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("后台总览")
            if let stats {
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) { Task { await load() } }
                }
                AdminWorkspaceSection("内容规模") {
                    statsGrid(stats.totals)
                    LabeledContent("数据库占用", value: AdminFormat.byteSize(stats.totals.dbSize))
                }
                AdminWorkspaceSection("抓取任务状态") {
                    jobStatusRow(stats.jobStatus)
                }
                if !stats.recentJobs.isEmpty {
                    AdminWorkspaceSection("最近抓取任务") {
                        ForEach(stats.recentJobs) { job in
                            NavigationLink { AdminJobsView(jobID: job.id) } label: { jobRow(job) }
                        }
                    }
                }
                if !stats.recentNovels.isEmpty {
                    AdminWorkspaceSection("最近更新") {
                        ForEach(stats.recentNovels) { novel in
                            NavigationLink { AdminNovelWorkspaceLoader(novelID: novel.id) } label: { novelRow(novel) }
                        }
                    }
                }
            } else if let errorMessage, !isLoading {
                ContentUnavailableView {
                    Label("加载失败", systemImage: "wifi.slash")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else {
                ProgressView("正在读取后台总览…")
                    .frame(maxWidth: .infinity, minHeight: 160)
                    .listRowBackground(Color.clear)
            }
        }
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
        let columns = [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 240 : 124), spacing: 16)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
            metric("小说", systemImage: "book", value: totals.novels)
            metric("章节", systemImage: "doc.text", value: totals.chapters)
            metric("用户", systemImage: "person", value: totals.users)
            metric("封面", systemImage: "photo", value: totals.covers)
            metric("今日章节", systemImage: "text.badge.plus", value: totals.todayChapters)
            metric("失败抓取", systemImage: "exclamationmark.triangle", value: totals.failedJobs)
        }
        .padding(.vertical, 10)
    }

    private func jobStatusRow(_ status: AdminJobStatus) -> some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 10))

        return layout {
            metric("进行中", systemImage: "clock", value: status.running)
            metric("已完成", systemImage: "checkmark.circle", value: status.completed)
            metric("失败", systemImage: "exclamationmark.circle", value: status.failed)
        }
        .padding(.vertical, 8)
    }

    private func metric(_ title: String, systemImage: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value, format: .number)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .contentTransition(reduceMotion ? .opacity : .numericText())
                .animation(reduceMotion ? nil : AppMotion.value, value: value)
            Label(title, systemImage: systemImage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - 行

    private func jobRow(_ job: AdminJobSummary) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            AppAdaptiveRow {
                Text(job.novelTitle.isEmpty ? "（未知书名）" : job.novelTitle)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
                    .appTextLineLimit(1)
                Spacer()
                Text(AdminFormat.jobStatus(job.status))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: min(max(job.progress, 0), 1))
                .progressViewStyle(.linear)
                .tint(jobStatusTint(job.status))
            Text("章节 \(job.current)/\(job.total) · \(AdminFormat.relativeTime(job.updatedAt))")
                .font(.caption)
                .foregroundStyle(.secondary)
            if !job.error.isEmpty {
                Text(job.error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .appTextLineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func novelRow(_ novel: AdminNovelSummary) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(novel.title)
                    .font(serifFont(.body, .medium))
                Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章 · \(AdminFormat.relativeTime(novel.updatedAt))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "book.closed")
        }
    }

    private func jobStatusTint(_ status: String) -> Color {
        switch status {
        case "completed", "partial": return .green
        case "failed", "cancelled": return .red
        default: return .accentColor
        }
    }
}
