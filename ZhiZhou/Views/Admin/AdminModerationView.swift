import SwiftUI

/// 内容审核：评论 / 举报 / 想法（段评）三合一。
/// 数据源：/api/admin/comments、/api/admin/comment-reports、/api/thoughts?admin=1。
struct AdminModerationView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case comments = "评论"
        case reports = "举报"
        case thoughts = "想法"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .comments
    @State private var statusFilter = "all"
    @State private var search = ""
    @State private var comments: [AdminComment] = []
    @State private var reports: [CommentReport] = []
    @State private var thoughts: [AdminThought] = []
    @State private var totalCount = 0
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var pendingDeleteComment: AdminComment?
    @State private var pendingDeleteThought: AdminThought?
    @State private var pendingReport: CommentReport?
    @State private var busyActionKey: String?

    var body: some View {
        List {
            Section {
                Picker("类型", selection: $mode) {
                    ForEach(Mode.allCases) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .onChange(of: mode) { _, _ in
                    resetFilters()
                    Task { await load() }
                }
            }

            if isLoading && itemsEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, itemsEmpty {
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
            } else if itemsEmpty {
                Section {
                    ContentUnavailableView(
                        "这里空空如也",
                        systemImage: "checkmark.circle",
                        description: Text("当前筛选条件下没有内容")
                    )
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .frame(maxWidth: .infinity, minHeight: 240)
                }
            } else {
                Section("共 \(totalCount) 条") {
                    switch mode {
                    case .comments:
                        ForEach(comments) { comment in
                            commentRow(comment)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if comment.status == "visible" {
                                        Button("隐藏") { Task { await hide(comment: comment) } }
                                            .tint(AppTheme.warning)
                                    } else {
                                        Button("恢复") { Task { await restore(comment: comment) } }
                                            .tint(AppTheme.success)
                                    }
                                    Button("删除", role: .destructive) { pendingDeleteComment = comment }
                                }
                        }
                    case .reports:
                        ForEach(reports) { report in
                            reportRow(report)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button("处理") { pendingReport = report }
                                        .tint(AppTheme.primary)
                                }
                        }
                    case .thoughts:
                        ForEach(thoughts) { thought in
                            thoughtRow(thought)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if thought.status == "visible" {
                                        Button("隐藏") { Task { await hide(thought: thought) } }
                                            .tint(AppTheme.warning)
                                    } else {
                                        Button("恢复") { Task { await restore(thought: thought) } }
                                            .tint(AppTheme.success)
                                    }
                                    Button("删除", role: .destructive) { pendingDeleteThought = thought }
                                }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("内容审核")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "搜索内容 / 用户名 / 书名")
        .task(id: search) {
            try? await Task.sleep(for: .milliseconds(350))
            await load()
        }
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(statusOptions, id: \.value) { option in
                        Button(option.label) {
                            statusFilter = option.value
                            Task { await load() }
                        }
                    }
                } label: {
                    Label(statusLabel, systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .alert("操作未完成", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .confirmationDialog("删除评论", isPresented: Binding(
            get: { pendingDeleteComment != nil },
            set: { if !$0 { pendingDeleteComment = nil } }
        ), titleVisibility: .visible) {
            Button("永久删除", role: .destructive) {
                if let comment = pendingDeleteComment {
                    Task { await delete(comment: comment) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("删除后不可恢复。")
        }
        .confirmationDialog("永久删除想法", isPresented: Binding(
            get: { pendingDeleteThought != nil },
            set: { if !$0 { pendingDeleteThought = nil } }
        ), titleVisibility: .visible) {
            Button("永久删除", role: .destructive) {
                if let thought = pendingDeleteThought {
                    Task { await delete(thought: thought) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作不可恢复。")
        }
        .confirmationDialog("处理举报", isPresented: Binding(
            get: { pendingReport != nil },
            set: { if !$0 { pendingReport = nil } }
        ), titleVisibility: .visible) {
            if let report = pendingReport {
                if report.commentStatus != "hidden" {
                    Button("隐藏评论并解决", role: .destructive) {
                        Task { await resolve(report: report, status: "resolved", action: "hide") }
                    }
                } else {
                    Button("恢复评论并解决") {
                        Task { await resolve(report: report, status: "resolved", action: "restore") }
                    }
                }
                Button("仅标记解决") {
                    Task { await resolve(report: report, status: "resolved", action: "none") }
                }
                Button("忽略举报", role: .cancel) {
                    Task { await resolve(report: report, status: "dismissed", action: "none") }
                }
            }
        } message: {
            if let report = pendingReport {
                Text("举报理由：\(AdminFormat.reportReason(report.reason))。处理后将无法撤销。")
            }
        }
    }

    // MARK: - 数据

    private var itemsEmpty: Bool {
        switch mode {
        case .comments: return comments.isEmpty
        case .reports: return reports.isEmpty
        case .thoughts: return thoughts.isEmpty
        }
    }

    private var statusOptions: [(label: String, value: String)] {
        switch mode {
        case .comments, .thoughts:
            return [("全部", "all"), ("可见", "visible"), ("已隐藏", "hidden")]
        case .reports:
            return [("待处理", "open"), ("已解决", "resolved"), ("已忽略", "dismissed"), ("全部", "all")]
        }
    }

    private var statusLabel: String {
        statusOptions.first { $0.value == statusFilter }?.label ?? "筛选"
    }

    private func resetFilters() {
        statusFilter = "all"
        search = ""
        comments = []
        reports = []
        thoughts = []
        totalCount = 0
        errorMessage = nil
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            switch mode {
            case .comments:
                let r: CommentsResponse = try await AdminAPI.comments(status: statusFilter, search: search)
                comments = r.comments
                totalCount = r.total
            case .reports:
                let r: CommentReportsResponse = try await AdminAPI.commentReports(status: statusFilter)
                reports = r.reports
                totalCount = r.total
            case .thoughts:
                let r: ThoughtsResponse = try await AdminAPI.thoughts(status: statusFilter, search: search)
                thoughts = r.thoughts
                totalCount = r.total
            }
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 动作

    private func hide(comment: AdminComment) async {
        await runAction(key: "comment-\(comment.id)-hide") {
            try await AdminAPI.setCommentStatus(id: comment.id, status: "hidden")
        }
    }

    private func restore(comment: AdminComment) async {
        await runAction(key: "comment-\(comment.id)-restore") {
            try await AdminAPI.setCommentStatus(id: comment.id, status: "visible")
        }
    }

    private func delete(comment: AdminComment) async {
        await runAction(key: "comment-\(comment.id)-delete") {
            try await AdminAPI.deleteComment(id: comment.id)
        }
    }

    private func hide(thought: AdminThought) async {
        await runAction(key: "thought-\(thought.id)-hide") {
            try await AdminAPI.setThoughtStatus(id: thought.id, status: "hidden")
        }
    }

    private func restore(thought: AdminThought) async {
        await runAction(key: "thought-\(thought.id)-restore") {
            try await AdminAPI.setThoughtStatus(id: thought.id, status: "visible")
        }
    }

    private func delete(thought: AdminThought) async {
        await runAction(key: "thought-\(thought.id)-delete") {
            try await AdminAPI.deleteThought(id: thought.id, hard: true)
        }
    }

    private func resolve(report: CommentReport, status: String, action: String) async {
        await runAction(key: "report-\(report.id)-resolve") {
            try await AdminAPI.resolveReport(id: report.id, status: status, action: action)
        }
    }

    private func runAction(key: String, operation: () async throws -> Void) async {
        guard busyActionKey == nil else { return }
        busyActionKey = key
        defer { busyActionKey = nil }
        do {
            try await operation()
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 行

    private func commentRow(_ comment: AdminComment) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(comment.userDisplayName.isEmpty ? comment.displayName : comment.userDisplayName)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                if comment.status == "hidden" {
                    statusBadge("已隐藏", tint: AppTheme.warning)
                }
                Spacer()
                Text(AdminFormat.relativeTime(comment.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            Text(comment.commentText.isEmpty ? "（评论内容为空）" : comment.commentText)
                .font(.callout)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(3)
            HStack(spacing: 10) {
                Text(comment.novelTitle.isEmpty ? "未知书籍" : comment.novelTitle)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                if comment.reportCount > 0 {
                    Label("\(comment.reportCount)", systemImage: "flag.fill")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.danger)
                }
                if comment.hasSpoiler {
                    Text("剧透")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.warning)
                }
            }
            actionRow {
                if comment.status == "visible" {
                    Button("隐藏", systemImage: "eye.slash") {
                        Task { await hide(comment: comment) }
                    }
                } else {
                    Button("恢复", systemImage: "eye") {
                        Task { await restore(comment: comment) }
                    }
                }
                Button("删除", systemImage: "trash", role: .destructive) {
                    pendingDeleteComment = comment
                }
            } isBusy: {
                busyActionKey?.hasPrefix("comment-\(comment.id)") == true
            }
        }
        .padding(.vertical, 2)
    }

    private func reportRow(_ report: CommentReport) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(AdminFormat.reportReason(report.reason))
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(reasonTint(report.reason).opacity(0.15), in: Capsule())
                    .foregroundStyle(reasonTint(report.reason))
                if report.status == "open" {
                    Text("待处理")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.warning)
                }
                Spacer()
                Text(AdminFormat.relativeTime(report.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            Text(report.commentText.isEmpty ? "（评论已删除）" : report.commentText)
                .font(.callout)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(3)
            HStack(spacing: 10) {
                Text(report.novelTitle.isEmpty ? "未知书籍" : report.novelTitle)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                Spacer()
                Text("举报：\(report.reporterDisplayName.isEmpty ? report.reporterUsername : report.reporterDisplayName)")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }
            if !report.note.isEmpty {
                Text("备注：\(report.note)")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(2)
            }
            actionRow {
                Button("处理举报", systemImage: "checkmark.seal") {
                    pendingReport = report
                }
            } isBusy: {
                busyActionKey?.hasPrefix("report-\(report.id)") == true
            }
        }
        .padding(.vertical, 2)
    }

    private func thoughtRow(_ thought: AdminThought) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(thought.userDisplayName.isEmpty ? thought.displayName : thought.userDisplayName)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                if thought.status == "hidden" {
                    statusBadge("已隐藏", tint: AppTheme.warning)
                }
                Spacer()
                Text(AdminFormat.relativeTime(thought.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            if !thought.selectedText.isEmpty {
                Text("「\(thought.selectedText)」")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(2)
            }
            Text(thought.thoughtText.isEmpty ? "（想法内容为空）" : thought.thoughtText)
                .font(.callout)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(3)
            HStack(spacing: 10) {
                Text("\(thought.novelTitle.isEmpty ? "未知书籍" : thought.novelTitle) · \(thought.chapterTitle.isEmpty ? "未知章节" : thought.chapterTitle)")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                if thought.reportCount > 0 {
                    Label("\(thought.reportCount)", systemImage: "flag.fill")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.danger)
                }
            }
            actionRow {
                if thought.status == "visible" {
                    Button("隐藏", systemImage: "eye.slash") {
                        Task { await hide(thought: thought) }
                    }
                } else {
                    Button("恢复", systemImage: "eye") {
                        Task { await restore(thought: thought) }
                    }
                }
                Button("删除", systemImage: "trash", role: .destructive) {
                    pendingDeleteThought = thought
                }
            } isBusy: {
                busyActionKey?.hasPrefix("thought-\(thought.id)") == true
            }
        }
        .padding(.vertical, 2)
    }

    private func actionRow(
        @ViewBuilder actions: () -> some View,
        isBusy: () -> Bool
    ) -> some View {
        HStack {
            Spacer(minLength: 8)
            if isBusy() {
                AdminInlineProgress()
            } else {
                Menu {
                    actions()
                } label: {
                    Label("操作", systemImage: "ellipsis.circle")
                        .font(.caption)
                }
                .disabled(busyActionKey != nil)
            }
        }
    }

    private func statusBadge(_ text: String, tint: Color) -> some View {
        AdminStatusBadge(text, tint: tint)
    }

    private func reasonTint(_ reason: String) -> Color {
        switch reason {
        case "spam", "offensive": return AppTheme.danger
        case "spoiler": return AppTheme.warning
        default: return AppTheme.primary
        }
    }
}
