import SwiftUI
import ZhiZhouCore

/// Separate sections keep the home list small enough for SwiftUI's type checker.
struct AdminWorkspaceHomeSections: View {
    @Environment(AppState.self) private var appState
    @State private var overview = AdminWorkspaceOverview()
    @State private var recent: [AdminRecentBook] = []
    @State private var drafts: [AdminWritingDraft] = []

    var body: some View {
        Group {
            statusSection
            inputDraftsSection
            recentBooksSection
        }
        .task(id: ContentAccessStore.shared.accountRevision) {
            refreshLocal()
            await overview.load(forceMetadata: true)
        }
        .onAppear { refreshLocal() }
    }

    private var statusSection: some View {
        Section("工作台") {
            if overview.loading && overview.tasks.isEmpty { ProgressView("读取近期任务…") }
            if !overview.errors.isEmpty {
                LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                    Task { await overview.load() }
                }
            }
            let active = overview.tasks.filter { AdminInboxFilter.active.includes($0.status) }
            ForEach(Array(active.prefix(3))) { item in
                AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
            }
            let attention = overview.tasks.filter { AdminInboxFilter.attention.includes($0.status) }
            ForEach(Array(attention.prefix(2))) { item in
                AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
            }
            NavigationLink { AdminTaskInboxView() } label: {
                Label(active.isEmpty ? "查看近期任务与异常" : "查看全部近期任务", systemImage: "shippingbox")
            }
            .accessibilityIdentifier("admin.home.tasks")
            NavigationLink { AdminAIGenerationsView(initialStatus: "draft") } label: {
                LabeledContent("待处理创作草稿", value: overview.draftCount.map { String($0) } ?? "—")
            }
            .accessibilityIdentifier("admin.home.drafts")
            HStack {
                Button("刷新工作台", systemImage: "arrow.clockwise") {
                    refreshLocal()
                    Task { await overview.load(forceMetadata: true) }
                }
                .disabled(overview.loading)
            }
        }
    }

    @ViewBuilder
    private var inputDraftsSection: some View {
        if !drafts.isEmpty {
            Section("继续填写") {
                ForEach(Array(drafts.prefix(5))) { draft in
                    NavigationLink { AdminAIWritingView(draftContextID: draft.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(draft.values["novelTitle"].flatMap { $0.isEmpty ? nil : $0 } ?? "新建创作")
                            Text("本机创作输入 · \(AdminFormat.relativeTime(draft.updatedAt))")
                                .font(.caption).foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("admin.home.inputDraft.\(draft.id)")
                }
            }
        }
    }

    @ViewBuilder
    private var recentBooksSection: some View {
        if !recent.isEmpty {
            Section("最近管理") {
                ForEach(recent) { book in
                    NavigationLink { AdminNovelWorkspaceLoader(novelID: book.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(book.title).font(serifFont(.headline, .medium))
                            Text(book.author).font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("admin.home.book.\(book.id)")
                }
            }
        }
    }

    private func refreshLocal() {
        guard let user = appState.user, user.isAdmin else { recent = []; drafts = []; return }
        let store = AdminWorkspaceLocalStore()
        recent = store.recentBooks(userID: user.id)
        drafts = store.drafts(userID: user.id)
    }
}
