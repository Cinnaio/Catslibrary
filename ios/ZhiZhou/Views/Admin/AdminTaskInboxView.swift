import SwiftUI

struct AdminTaskInboxView: View {
    var novelID: String? = nil
    @Environment(\.scenePhase) private var scenePhase
    @State private var overview = AdminWorkspaceOverview()
    @State private var filter: AdminInboxFilter = .all

    private var visibleTasks: [AdminInboxItem] {
        overview.tasks.filter { (novelID == nil || $0.novelID == novelID) && filter.includes($0.status) }
    }

    var body: some View {
        List {
            Section {
                Picker("任务状态", selection: $filter) {
                    ForEach(AdminInboxFilter.allCases) { Text($0.rawValue).tag($0) }
                }
            }
            if !overview.errors.isEmpty {
                LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                    Task { await overview.load() }
                }
            }
            if overview.loading && overview.tasks.isEmpty { ProgressView("读取任务…") }
            if !overview.loading && visibleTasks.isEmpty {
                ContentUnavailableView("没有匹配的近期任务", systemImage: "tray")
            }
            Section("近期任务") {
                ForEach(visibleTasks) { item in
                    AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
                }
            }
            Section {
                NavigationLink("待处理草稿") { AdminAIGenerationsView(novelID: novelID, initialStatus: "draft") }
                NavigationLink("下载记录") { AdminDownloadRecordsView() }
                NavigationLink("全部 AI 任务") { AdminAITasksView() }
                NavigationLink("全部抓取任务") { AdminJobsView() }
            } header: {
                Text("记录与内容")
            } footer: {
                Text("汇总最近 100 项 AI 任务及服务端返回的近期抓取任务。更早记录可进入各类任务查看。")
            }
        }
        .appListStyle(.settings)
        .navigationTitle(novelID == nil ? "任务中心" : "本书任务")
        .refreshable { await overview.load(forceMetadata: true) }
        .task(id: "\(scenePhase)-\(ContentAccessStore.shared.accountRevision)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await overview.load()
                do { try await Task.sleep(nanoseconds: 8_000_000_000) } catch { return }
            }
        }
    }
}

struct AdminInboxTaskLink: View {
    let item: AdminInboxItem
    let bookTitle: String?
    var body: some View {
        NavigationLink {
            switch item {
            case .ai(let task): AdminAITasksView(taskID: task.id)
            case .scrape(let job): AdminJobsView(jobID: job.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(bookTitle ?? item.title).font(.headline)
                Text("\(item.title) · \(AdminFormat.aiTaskStatus(item.status))")
                    .font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                if !item.detail.isEmpty { Text(item.detail).font(.caption).appTextLineLimit(2).foregroundStyle(AppTheme.textSecondary) }
            }
            .padding(.vertical, 4)
        }
        .accessibilityIdentifier("admin.inbox.\(item.id)")
    }
}
