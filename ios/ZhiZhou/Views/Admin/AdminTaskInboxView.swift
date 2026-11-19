import SwiftUI

struct AdminTaskInboxView: View {
    let novelID: String?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var overview = AdminWorkspaceOverview()
    @State private var filter: AdminInboxFilter

    init(novelID: String? = nil, initialFilter: AdminInboxFilter = .all) {
        self.novelID = novelID
        _filter = State(initialValue: initialFilter)
    }

    private var visibleTasks: [AdminInboxItem] {
        overview.tasks.filter { (novelID == nil || $0.novelID == novelID) && filter.includes($0) }
    }

    var body: some View {
        List {
            Section {
                taskFilters
                if !overview.errors.isEmpty {
                    LoadErrorNotice(message: overview.errors.joined(separator: "\n"), isLoading: overview.loading) {
                        Task { await overview.load() }
                    }
                }
            }
            Section("近期任务") { taskResults }
            records
        }
        .listStyle(.insetGrouped)
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

    @ViewBuilder
    private var taskFilters: some View {
        let selection = Binding(get: { filter }, set: { value in
            withAnimation(reduceMotion ? nil : AppMotion.micro) { filter = value }
        })
        let picker = Picker("任务状态", selection: selection) {
            ForEach([AdminInboxFilter.all, .active, .attention]) { option in
                Text(option.rawValue).tag(option)
            }
        }
        if dynamicTypeSize >= .xxxLarge {
            picker.pickerStyle(.menu)
        } else {
            picker.pickerStyle(.segmented)
                .frame(minHeight: AppLayout.minimumTouchTarget)
        }
    }

    @ViewBuilder
    private var taskResults: some View {
        let tasks = visibleTasks
        if tasks.isEmpty {
            if overview.hasCompleteTaskSnapshot {
                ContentUnavailableView("没有匹配的近期任务", systemImage: "tray")
            } else if overview.loading || overview.errors.isEmpty {
                ProgressView("读取近期任务…")
            }
        } else {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, item in
                AdminInboxTaskLink(item: item, bookTitle: item.novelID.flatMap { overview.bookTitles[$0] })
                    .transition(reduceMotion ? .identity : .asymmetric(
                        insertion: .opacity.animation(AppMotion.micro.delay(Double(min(index, 10)) * 0.016)),
                        removal: .opacity
                    ))
            }
        }
    }

    private var records: some View {
        Section {
            NavigationLink { AdminAIGenerationsView(novelID: novelID, initialStatus: "draft") } label: {
                Label("待处理草稿", systemImage: "doc.text")
            }
            NavigationLink { AdminDownloadRecordsView() } label: {
                Label("下载记录", systemImage: "arrow.down.circle")
            }
            NavigationLink { AdminAITasksView() } label: {
                Label("AI 任务", systemImage: "sparkles")
            }
            NavigationLink { AdminJobsView() } label: {
                Label("抓取任务", systemImage: "scope")
            }
        } header: {
            Text("完整记录")
        } footer: {
            Text("近期任务汇总最近 100 项 AI 任务及服务端返回的抓取任务。")
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
            switch item {
            case .ai:
                taskRow(status: AdminFormat.aiTaskStatus(item.status), systemImage: "sparkles")
            case .scrape:
                taskRow(status: AdminFormat.jobStatus(item.status), systemImage: "scope")
            }
        }
        .accessibilityIdentifier("admin.inbox.\(item.id)")
    }

    private func taskRow(status: String, systemImage: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(bookTitle ?? item.title)
                    .font(.headline)
                Text(bookTitle == nil ? status : "\(item.title) · \(status)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .appTextLineLimit(2)
                }
            }
            .padding(.vertical, 4)
        } icon: {
            Image(systemName: systemImage)
        }
    }
}
