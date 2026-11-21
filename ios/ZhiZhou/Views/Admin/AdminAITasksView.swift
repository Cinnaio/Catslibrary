import SwiftUI
import ZhiZhouCore

/// AI 任务：任务列表（过滤 / 取消 / 重试 / 删除记录）。
struct AdminAITasksView: View {
    @State private var focusedTaskID: String?
    init(taskID: String? = nil) { _focusedTaskID = State(initialValue: taskID) }
    @State private var requests = ListRequestGuard<[String]>()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
        AdminWorkspaceList {
            AdminWorkspaceHeading(focusedTaskID == nil ? "AI 任务" : "AI 任务详情",
                                  detail: focusedTaskID == nil ? "查看真实进度、失败原因和生成结果。" : "进度与操作随任务状态更新。")
            if focusedTaskID == nil {
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
            if let errorMessage, !tasks.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            if isTransitioning {
                Label(isLoading ? "正在读取新条件，以下仍是上一次的任务" : "以下仍是上一次的任务，请重试读取",
                      systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            taskResults
                .opacity(isTransitioning ? 0.45 : 1)
                .disabled(isTransitioning)
            if focusedTaskID == nil && (totalTasks > pageSize || pageOffset > 0) {
                AppAdaptiveRow {
                    Button("上一页") { pageOffset = max(0, pageOffset - pageSize) }
                        .disabled(isLoading || isTransitioning || pageOffset == 0)
                    Spacer()
                    Text("第 \(pageOffset / pageSize + 1) 页")
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Spacer()
                    Button("下一页") { pageOffset += pageSize }
                        .disabled(isLoading || isTransitioning || pageOffset + pageSize >= totalTasks)
                }
                .buttonStyle(.borderless)
                .frame(minHeight: AppLayout.minimumTouchTarget)
            }
        }
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

    @ViewBuilder
    private var taskResults: some View {
        if isLoading && tasks.isEmpty {
            ProgressView("加载中…")
                .frame(maxWidth: .infinity, minHeight: 160)
        } else if let errorMessage, tasks.isEmpty {
            ContentUnavailableView {
                Label("加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await load() } }
            }
        } else if filteredTasks.isEmpty {
            ContentUnavailableView {
                Label("暂无任务", systemImage: "tray")
            } description: {
                Text("当前过滤条件下没有 AI 任务。")
            }
        } else {
            AdminWorkspaceSection(focusedTaskID == nil ? "任务（\(filteredTasks.count) / \(totalTasks)）" : "当前任务") {
                ForEach(Array(filteredTasks.enumerated()), id: \.element.id) { index, task in
                    taskRow(task)
                        .readingSpaceEntrance(index)
                        .transition(reduceMotion ? .identity : .opacity)
                }
            }
        }
    }

    private var isTransitioning: Bool {
        !tasks.isEmpty && loadedQuery != taskQuery
    }

    private var filteredTasks: [AiTaskInfo] {
        if isTransitioning || focusedTaskID != nil { return tasks }
        return statusFilter == "all" ? tasks : tasks.filter { $0.status == statusFilter }
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
            AdminAITaskProgressView(task: task, compact: focusedTaskID == nil, showsError: focusedTaskID == nil)
            if focusedTaskID == nil {
                NavigationLink("查看任务详情") { AdminAITasksView(taskID: task.id) }
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            } else {
                if let error = task.error, !error.isEmpty {
                    AccountSettingsNote(error, isError: true)
                }
                LabeledContent("任务 ID") {
                    Text(task.id).font(.caption.monospaced()).textSelection(.enabled)
                }
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
            }
            if ["continue", "write_chapter", "write_outline"].contains(task.kind ?? "") {
                NavigationLink("查看本次草稿与发布", destination: AdminAIGenerationsView(taskID: task.id))
                    .accessibilityIdentifier("admin.task.results.\(task.id)")
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            }
            if let reportURL = analysisReportURL(task) {
                Link("查看分析报告与核对记录", destination: reportURL)
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            }
            if let novelID = task.novelId, !novelID.isEmpty {
                NavigationLink("管理关联作品") { AdminNovelWorkspaceLoader(novelID: novelID) }
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            }
            if let prompt = task.prompt, !prompt.isEmpty {
                if focusedTaskID != nil {
                    DisclosureGroup("任务输入") {
                        Text(prompt)
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .padding(.vertical, 8)
                    }
                } else {
                    Text(prompt)
                        .font(.caption2)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }
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
                            if task.kind != "novel_analysis_review", task.kind != "chapter_edit" {
                                Button("重试", systemImage: "arrow.clockwise") {
                                    Task { await retry(task) }
                                }
                            }
                            Button("删除记录", systemImage: "trash", role: .destructive) {
                                pendingDelete = task
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(busyId != nil)
                    .accessibilityLabel("任务操作")
                }
            }
        }
        .padding(.vertical, 2)
        .buttonStyle(.borderless)
        .contextMenu {
            if task.isRunning {
                Button("取消任务", systemImage: "stop.circle") {
                    requestCancel(task)
                }
            } else {
                if task.kind != "novel_analysis_review", task.kind != "chapter_edit" {
                    Button("重试", systemImage: "arrow.clockwise") {
                        Task { await retry(task) }
                    }
                }
                Button("删除记录", systemImage: "trash", role: .destructive) {
                    pendingDelete = task
                }
            }
        }
    }

    // MARK: - 数据

    private func analysisReportURL(_ task: AiTaskInfo) -> URL? {
        guard ["novel_analysis", "novel_analysis_review"].contains(task.kind ?? ""),
              let novelID = task.novelId, !novelID.isEmpty,
              let base = ServerConfig.shared.baseURL else { return nil }
        var components = URLComponents(url: base.appendingPathComponent("admin/ai"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "sub", value: "writing"), URLQueryItem(name: "view", value: "analysis"),
                                 URLQueryItem(name: "novel", value: novelID)]
        if let data = task.params?.data(using: .utf8),
           let params = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let reportID = params["reportId"] as? String, !reportID.isEmpty {
            components?.queryItems?.append(URLQueryItem(name: "report", value: reportID))
        }
        return components?.url
    }

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
            let changesQuery = loadedQuery != query
            withAnimation(changesQuery && !reduceMotion ? AppMotion.micro : nil) {
                tasks = r.items
                totalTasks = r.total ?? r.items.count
                loadedQuery = query
            }
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
