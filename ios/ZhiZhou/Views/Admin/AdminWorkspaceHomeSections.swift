import SwiftUI
import ZhiZhouCore

struct AdminWorkspaceHomeSections<Shortcuts: View>: View {
    let overview: AdminWorkspaceOverview
    private let shortcuts: Shortcuts
    @Environment(AppState.self) private var appState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var recent: [AdminRecentBook] = []
    @State private var drafts: [AdminWritingDraft] = []

    init(overview: AdminWorkspaceOverview, @ViewBuilder shortcuts: () -> Shortcuts) {
        self.overview = overview
        self.shortcuts = shortcuts()
    }

    var body: some View {
        let tasks = overview.tasks
        let active = tasks.filter { AdminInboxFilter.active.includes($0) }
        let attention = tasks.filter { AdminInboxFilter.attention.includes($0) }
        let countsAvailable = overview.hasCompleteTaskSnapshot
        let followups = Array((Array(attention.prefix(2)) + Array(active.prefix(3))).prefix(3))

        Group {
            AdminWorkspaceSection("任务与草稿") {
                taskSummary(active: countsAvailable ? active.count : nil,
                            attention: countsAvailable ? attention.count : nil)
                if !overview.errors.isEmpty {
                    LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                        Task { await overview.load(forceMetadata: true) }
                    }
                }
                ForEach(Array(followups.enumerated()), id: \.element.id) { index, item in
                    followupTaskLink(item)
                        .readingSpaceEntrance(index)
                }
                NavigationLink { AdminTaskInboxView() } label: {
                    AdminWorkspaceEntry("查看全部近期任务", systemImage: "tray.full")
                }
                .accessibilityIdentifier("admin.home.tasks")
            }
            shortcuts
            inputDraftsSection
            recentBooksSection
        }
        .onAppear { refreshLocal() }
        .onChange(of: ContentAccessStore.shared.accountRevision) { _, _ in refreshLocal() }
    }

    private func taskSummary(active: Int?, attention: Int?) -> some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 0))
        return layout {
            NavigationLink { AdminTaskInboxView(initialFilter: .attention) } label: {
                summaryValue("失败与中断", count: attention,
                             color: (attention ?? 0) > 0 ? AppTheme.warning : ReadingSpace.ink)
            }
            NavigationLink { AdminAIGenerationsView(initialStatus: "draft") } label: {
                summaryValue("待处理草稿", count: overview.draftCount)
            }
            .accessibilityIdentifier("admin.home.drafts")
            NavigationLink { AdminTaskInboxView(initialFilter: .active) } label: {
                summaryValue("进行中", count: active)
            }
        }
        .buttonStyle(.plain)
        .padding(4)
        .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(contrast == .increased ? ReadingSpace.profileMuted : Color.clear, lineWidth: 1)
                .allowsHitTesting(false)
        }
    }

    private func summaryValue(_ title: String, count: Int?, color: Color = ReadingSpace.ink) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                if let count {
                    Text(count, format: .number)
                } else if overview.loading {
                    ProgressView().controlSize(.small).accessibilityLabel("正在读取")
                } else {
                    Text("—").accessibilityLabel("数据暂不可用")
                }
            }
            .font(.title2.weight(.semibold).monospacedDigit())
            .foregroundStyle(color)
            Text(title)
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func followupTaskLink(_ item: AdminInboxItem) -> some View {
        let bookTitle = item.novelID.flatMap { overview.bookTitles[$0] }
        let needsAttention = AdminInboxFilter.attention.includes(item)
        let status: String
        switch item {
        case .ai: status = AdminFormat.aiTaskStatus(item.status)
        case .scrape: status = AdminFormat.jobStatus(item.status)
        }
        return NavigationLink {
            switch item {
            case .ai(let task): AdminAITasksView(taskID: task.id)
            case .scrape(let job): AdminJobsView(jobID: job.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(bookTitle ?? item.title)
                    .font(bookTitle == nil ? .body.weight(.medium) : serifFont(.headline, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                Label(bookTitle == nil ? status : "\(item.title) · \(status)",
                      systemImage: needsAttention ? "exclamationmark.circle" : "clock")
                    .font(.footnote)
                    .foregroundStyle(needsAttention ? AppTheme.warning : ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(2)
                }
            }
            .padding(.vertical, 4)
        }
        .accessibilityIdentifier("admin.inbox.\(item.id)")
    }

    @ViewBuilder
    private var inputDraftsSection: some View {
        if !drafts.isEmpty {
            AdminWorkspaceSection("继续填写") {
                ForEach(Array(drafts.prefix(5).enumerated()), id: \.element.id) { index, draft in
                    NavigationLink { AdminAIWritingView(draftContextID: draft.id) } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(draft.values["novelTitle"].flatMap { $0.isEmpty ? nil : $0 } ?? "新建创作")
                                .font(serifFont(.headline, .medium))
                                .foregroundStyle(ReadingSpace.ink)
                                .appTextLineLimit(2)
                            Text("本机创作输入 · \(AdminFormat.relativeTime(draft.updatedAt))")
                                .font(.footnote)
                                .foregroundStyle(ReadingSpace.profileMuted)
                        }
                        .padding(.vertical, 4)
                    }
                    .readingSpaceEntrance(index)
                    .accessibilityIdentifier("admin.home.inputDraft.\(draft.id)")
                }
            }
        }
    }

    @ViewBuilder
    private var recentBooksSection: some View {
        if !recent.isEmpty {
            AdminWorkspaceSection("最近管理") {
                ForEach(Array(recent.enumerated()), id: \.element.id) { index, book in
                    NavigationLink { AdminNovelWorkspaceLoader(novelID: book.id) } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(book.title)
                                .font(serifFont(.headline, .medium))
                                .foregroundStyle(ReadingSpace.ink)
                                .appTextLineLimit(2)
                            if !book.author.isEmpty {
                                Text(book.author)
                                    .font(.footnote)
                                    .foregroundStyle(ReadingSpace.profileMuted)
                                    .appTextLineLimit(2)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .readingSpaceEntrance(index)
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
