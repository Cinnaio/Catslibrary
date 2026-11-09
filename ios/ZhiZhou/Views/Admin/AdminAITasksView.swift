import SwiftUI
import ZhiZhouCore

/// AI 任务：任务列表（过滤 / 取消 / 重试 / 删除记录）。
struct AdminAITasksView: View {
    @State private var focusedTaskID: String?
    init(taskID: String? = nil) { _focusedTaskID = State(initialValue: taskID) }
    @State private var requests = ListRequestGuard<[String]>()
    @Environment(\.scenePhase) private var scenePhase
    @State private var tasks: [AiTaskInfo] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var statusFilter = "all"
    @State private var pageOffset = 0
    @State private var totalTasks = 0
    @State private var loadedQuery: [String] = []
    private let pageSize = 50
    @State private var busyId: String?
    @State private var actionError: String?
    @State private var pendingDelete: AiTaskInfo?
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    var body: some View {
        List {
            if let errorMessage, !tasks.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: taskStatusLabel) {
                        Picker("状态", selection: $statusFilter) {
                            Text("全部").tag("all")
                            Text("排队中").tag("queued")
                            Text("运行中").tag("running")
                            Text("已完成").tag("completed")
                            Text("已失败").tag("failed")
                            Text("已取消").tag("cancelled")
                        }
                    }
                }
            }

            if isLoading && tasks.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, tasks.isEmpty {
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
            } else {
                if filteredTasks.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("暂无任务", systemImage: "tray")
                        } description: {
                            Text("当前过滤条件下没有 AI 任务。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else {
                    Section("任务（\(filteredTasks.count) / \(totalTasks)）") {
                        ForEach(Array(filteredTasks.enumerated()), id: \.element.id) { index, task in
                            taskRow(task)
                                .modifier(AdminTaskRowEntrance(index: index))
                        }
                    }
                }
            }
            if focusedTaskID == nil && (totalTasks > pageSize || pageOffset > 0) {
                Section {
                    HStack {
                        Button("上一页") { pageOffset = max(0, pageOffset - pageSize) }
                            .disabled(isLoading || pageOffset == 0)
                        Spacer()
                        Text("第 \(pageOffset / pageSize + 1) 页")
                            .foregroundStyle(AppTheme.textSecondary)
                        Spacer()
                        Button("下一页") { pageOffset += pageSize }
                            .disabled(isLoading || pageOffset + pageSize >= totalTasks)
                    }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("AI 任务")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .onChange(of: statusFilter) { _, _ in pageOffset = 0 }
        .task(id: "\(statusFilter)-\(pageOffset)-\(focusedTaskID ?? "")-\(scenePhase)") {
            guard scenePhase == .active else { return }
            await monitorTasks()
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .confirmationDialog(
            "删除 AI 任务",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除记录", role: .destructive) {
                guard let task = pendingDelete else { return }
                pendingDelete = nil
                Task { await delete(task) }
            }
            Button("取消", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("删除后任务记录不可恢复。")
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            guard operation.action == .terminateAITask,
                  let taskID = operation.targetIDs.first else { return }
            Task { await cancel(taskID: taskID, operationID: operation.operationID) }
        }
    }

    // MARK: - 列表

    private var filteredTasks: [AiTaskInfo] {
        statusFilter == "all" ? tasks : tasks.filter { $0.status == statusFilter }
    }

    private var taskQuery: [String] {
        [focusedTaskID ?? "", statusFilter, String(pageOffset)]
    }

    private var taskStatusLabel: String {
        switch statusFilter {
        case "queued": return "排队中"
        case "running": return "运行中"
        case "completed": return "已完成"
        case "failed": return "已失败"
        case "cancelled": return "已取消"
        default: return "全部状态"
        }
    }

    private func taskRow(_ task: AiTaskInfo) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            AdminAITaskProgressView(task: task, compact: true)
            if ["continue", "write_chapter", "write_outline"].contains(task.kind ?? "") {
                NavigationLink("查看本次草稿与发布", destination: AdminAIGenerationsView(taskID: task.id))
                    .accessibilityIdentifier("admin.task.results.\(task.id)")
            }
            if let novelID = task.novelId, !novelID.isEmpty {
                NavigationLink("管理关联作品") { AdminNovelWorkspaceLoader(novelID: novelID) }
            }
            if let prompt = task.prompt, !prompt.isEmpty {
                Text(prompt)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
            }
            HStack {
                Spacer(minLength: 8)
                if busyId == task.id {
                    AdminInlineProgress()
                } else {
                    Menu {
                        if task.isRunning {
                            Button("取消任务", systemImage: "stop.circle") {
                                requestCancel(task)
                            }
                        } else {
                            Button("重试", systemImage: "arrow.clockwise") {
                                Task { await retry(task) }
                            }
                            Button("删除记录", systemImage: "trash", role: .destructive) {
                                pendingDelete = task
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .foregroundStyle(AppTheme.textSecondary)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(busyId != nil)
                    .accessibilityLabel("任务操作")
                }
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            if task.isRunning {
                Button("取消任务", systemImage: "stop.circle") {
                    requestCancel(task)
                }
            } else {
                Button("重试", systemImage: "arrow.clockwise") {
                    Task { await retry(task) }
                }
                Button("删除记录", systemImage: "trash", role: .destructive) {
                    pendingDelete = task
                }
            }
        }
    }

    // MARK: - 数据

    private func monitorTasks() async {
        await load()
        while !Task.isCancelled {
            let interval: UInt64 = tasks.contains(where: { $0.isRunning })
                ? 2_000_000_000
                : 15_000_000_000
            try? await Task.sleep(nanoseconds: interval)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func load() async {
        let query = taskQuery
        let ticket = requests.begin(query)
        if loadedQuery != query {
            tasks = []
            totalTasks = 0
        }
        isLoading = true
        defer {
            if requests.accepts(ticket, query: taskQuery) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            let r: AiTasksResponse
            if let focusedTaskID {
                let detail = try await AdminAPI.aiTask(id: focusedTaskID)
                r = AiTasksResponse(items: [detail.task], total: 1, limit: 1, offset: 0)
            } else {
                r = try await AdminAPI.aiTasks(status: query[1], limit: pageSize, offset: Int(query[2]) ?? 0)
            }
            guard !Task.isCancelled, requests.accepts(ticket, query: taskQuery) else { return }
            tasks = r.items
            totalTasks = r.total ?? r.items.count
            loadedQuery = query
            AdminAITaskCoordinator.shared.reconcile(tasks)
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: taskQuery) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func requestCancel(_ task: AiTaskInfo) {
        guard busyId == nil else { return }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .terminateAITask,
            kind: .terminate,
            targetIDs: [task.id],
            title: "取消 AI 任务",
            message: "将终止“\(AdminFormat.aiTaskKind(task.kind ?? ""))”任务。任务可能已经产生部分用量，取消后不能继续。",
            confirmLabel: "确认取消任务"
        )
    }

    private func cancel(taskID: String, operationID: String) async {
        guard busyId == nil else { return }
        busyId = taskID
        defer { busyId = nil }
        do {
            try await AdminAPI.cancelAiTask(id: taskID, operationID: operationID)
            AdminAITaskCoordinator.shared.finish(taskID: taskID)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func retry(_ task: AiTaskInfo) async {
        guard busyId == nil else { return }
        busyId = task.id
        defer { busyId = nil }
        do {
            let launch = try await AdminAITaskCoordinator.shared.start(
                key: AdminAITaskCoordinator.OperationKey.retry(taskID: task.id),
                kind: task.kind ?? "retry",
                resourceID: task.novelId,
                requestPayloadJSON: task.params,
                requestFingerprint: task.params
            ) { clientRequestID in
                let result = try await AdminAPI.retryAiTask(
                    id: task.id,
                    clientRequestID: clientRequestID
                )
                return result.jobId ?? ""
            }
            if focusedTaskID != nil { focusedTaskID = launch.taskID }
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func delete(_ task: AiTaskInfo) async {
        guard busyId == nil else { return }
        busyId = task.id
        defer { busyId = nil }
        do {
            try await AdminAPI.deleteAiTask(id: task.id)
            AdminAITaskCoordinator.shared.finish(taskID: task.id)
            tasks.removeAll { $0.id == task.id }
            totalTasks = max(0, totalTasks - 1)
            if focusedTaskID == task.id {
                focusedTaskID = nil
                statusFilter = "all"
                pageOffset = 0
            }
            if tasks.isEmpty && pageOffset > 0 {
                pageOffset = max(0, pageOffset - pageSize)
            } else {
                await load()
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

private struct AdminTaskRowEntrance: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 4)
            .onAppear {
                withAnimation(reduceMotion ? nil : AppMotion.micro.delay(Double(min(index, 6)) * 0.02)) {
                    appeared = true
                }
            }
    }
}
