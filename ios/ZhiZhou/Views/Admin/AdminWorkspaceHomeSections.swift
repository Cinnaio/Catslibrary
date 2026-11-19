import SwiftUI
import ZhiZhouCore

struct AdminWorkspaceHomeSections: View {
    let overview: AdminWorkspaceOverview
    @Environment(AppState.self) private var appState
    @State private var recent: [AdminRecentBook] = []
    @State private var drafts: [AdminWritingDraft] = []

    var body: some View {
        let tasks = overview.tasks
        let active = tasks.filter { AdminInboxFilter.active.includes($0) }
        let attention = tasks.filter { AdminInboxFilter.attention.includes($0) }
        let countsAvailable = overview.hasCompleteTaskSnapshot

        Group {
            Section("近期任务") {
                taskLink(.active, count: countsAvailable ? active.count : nil, systemImage: "clock")
                taskLink(.attention, count: countsAvailable ? attention.count : nil, systemImage: "exclamationmark.circle")
                NavigationLink {
                    AdminAIGenerationsView(initialStatus: "draft")
                } label: {
                    countLabel("待处理草稿", count: overview.draftCount, systemImage: "doc.text")
                }
                .accessibilityIdentifier("admin.home.drafts")
                NavigationLink { AdminTaskInboxView() } label: {
                    Label("查看全部近期任务", systemImage: "tray.full")
                }
                .accessibilityIdentifier("admin.home.tasks")
                if !overview.errors.isEmpty {
                    LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                        Task { await overview.load(forceMetadata: true) }
                    }
                }
            }
            if !active.isEmpty || !attention.isEmpty {
                Section("待跟进任务") {
                    ForEach(Array(attention.prefix(2)) + Array(active.prefix(3))) { item in
                        AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
                    }
                }
            }
            inputDraftsSection
            recentBooksSection
        }
        .onAppear { refreshLocal() }
        .onChange(of: ContentAccessStore.shared.accountRevision) { _, _ in refreshLocal() }
    }

    private func taskLink(_ filter: AdminInboxFilter, count: Int?, systemImage: String) -> some View {
        NavigationLink {
            AdminTaskInboxView(initialFilter: filter)
        } label: {
            countLabel(filter.rawValue, count: count, systemImage: systemImage)
        }
    }

    private func countLabel(_ title: String, count: Int?, systemImage: String) -> some View {
        LabeledContent {
            if let count {
                Text(count, format: .number)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            } else if overview.loading {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("正在读取")
            } else {
                Text("—")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("数据暂不可用")
            }
        } label: {
            Label(title, systemImage: systemImage)
        }
    }

    @ViewBuilder
    private var inputDraftsSection: some View {
        if !drafts.isEmpty {
            Section("继续填写") {
                ForEach(Array(drafts.prefix(5))) { draft in
                    NavigationLink { AdminAIWritingView(draftContextID: draft.id) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(draft.values["novelTitle"].flatMap { $0.isEmpty ? nil : $0 } ?? "新建创作")
                                Text("本机创作输入 · \(AdminFormat.relativeTime(draft.updatedAt))")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: "pencil.and.outline") }
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
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(book.title)
                                if !book.author.isEmpty {
                                    Text(book.author).font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        } icon: { Image(systemName: "book.closed") }
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
