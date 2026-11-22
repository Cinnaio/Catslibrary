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

        Group {
            AdminWorkspaceSection("待处理") {
                taskSummary(attention: countsAvailable ? attention.count : nil)
                NavigationLink { AdminTaskInboxView() } label: {
                    AdminWorkspaceEntry(
                        "任务中心", systemImage: "tray.full",
                        detail: countsAvailable && !active.isEmpty ? "\(active.count) 项进行中" : ""
                    )
                }
                .accessibilityIdentifier("admin.home.tasks")
                if !overview.errors.isEmpty {
                    LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                        Task { await overview.load(forceMetadata: true) }
                    }
                }
            }
            shortcuts
            if !attention.isEmpty {
                AdminWorkspaceSection("近期失败与中断") {
                    ForEach(Array(attention.prefix(2).enumerated()), id: \.element.id) { index, item in
                        AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
                            .readingSpaceEntrance(index)
                    }
                }
            }
            continueWork
        }
        .onAppear { refreshLocal() }
        .onChange(of: ContentAccessStore.shared.accountRevision) { _, _ in refreshLocal() }
    }

    private func taskSummary(attention: Int?) -> some View {
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

    @ViewBuilder
    private var continueWork: some View {
        if !drafts.isEmpty || !recent.isEmpty {
            AdminWorkspaceSection("继续工作") {
                if let draft = drafts.first { draftLink(draft) }
                if let book = recent.first { recentBookLink(book) }
                if drafts.count > 1 || recent.count > 1 {
                    DisclosureGroup("查看其他草稿与作品") {
                        ForEach(Array(drafts.prefix(5).dropFirst().enumerated()), id: \.element.id) { index, draft in
                            draftLink(draft).readingSpaceEntrance(index)
                        }
                        ForEach(Array(recent.dropFirst().enumerated()), id: \.element.id) { index, book in
                            recentBookLink(book).readingSpaceEntrance(index)
                        }
                    }
                }
            }
        }
    }

    private func draftLink(_ draft: AdminWritingDraft) -> some View {
        NavigationLink { AdminAIWritingView(draftContextID: draft.id) } label: {
            AdminWorkspaceEntry(
                draft.values["novelTitle"].flatMap { $0.isEmpty ? nil : $0 } ?? "新建创作",
                systemImage: "pencil.and.outline",
                detail: "继续填写 · \(AdminFormat.relativeTime(draft.updatedAt))"
            )
        }
        .accessibilityIdentifier("admin.home.inputDraft.\(draft.id)")
    }

    private func recentBookLink(_ book: AdminRecentBook) -> some View {
        NavigationLink { AdminNovelWorkspaceLoader(novelID: book.id) } label: {
            AdminWorkspaceEntry(
                book.title,
                systemImage: "book.closed",
                detail: book.author.isEmpty ? "最近管理" : "最近管理 · \(book.author)"
            )
        }
        .accessibilityIdentifier("admin.home.book.\(book.id)")
    }

    private func refreshLocal() {
        guard let user = appState.user, user.isAdmin else { recent = []; drafts = []; return }
        let store = AdminWorkspaceLocalStore()
        recent = store.recentBooks(userID: user.id)
        drafts = store.drafts(userID: user.id)
    }
}
