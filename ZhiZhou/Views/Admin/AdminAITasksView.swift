import SwiftUI

/// AI 任务：任务列表（过滤 / 取消 / 重试 / 删除记录）。
struct AdminAITasksView: View {
    @State private var tasks: [AiTaskInfo] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var statusFilter = "all"
    @State private var busyId: String?
    @State private var actionError: String?
    @State private var pendingDelete: AiTaskInfo?

    var body: some View {
        List {
            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: taskStatusLabel) {
                        Picker("状态", selection: $statusFilter) {
                            Text("全部").tag("all")
                            Text("排队/运行").tag("running")
                            Text("已完成").tag("completed")
                            Text("失败/取消").tag("failed")
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
                    Section("任务（\(filteredTasks.count)）") {
                        ForEach(filteredTasks) { task in
                            taskRow(task)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("AI 任务")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: statusFilter) {
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await load()
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
    }

    // MARK: - 列表

    private var filteredTasks: [AiTaskInfo] {
        switch statusFilter {
        case "running": return tasks.filter { $0.isRunning }
        case "completed": return tasks.filter { $0.status == "completed" }
        case "failed": return tasks.filter { ["failed", "cancelled"].contains($0.status ?? "") }
        default: return tasks
        }
    }

    private var taskStatusLabel: String {
        switch statusFilter {
        case "running": return "排队/运行"
        case "completed": return "已完成"
        case "failed": return "失败/取消"
        default: return "全部状态"
        }
    }

    private func taskRow(_ task: AiTaskInfo) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(AdminFormat.aiTaskKind(task.kind ?? ""))
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                AdminStatusBadge(
                    AdminFormat.aiTaskStatus(task.status ?? ""),
                    tint: statusTint(task.status ?? "")
                )
            }
            HStack(spacing: 8) {
                if let total = task.total, total > 0, let current = task.current {
                    Text("\(current)/\(total)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                if let step = task.step, !step.isEmpty {
                    Text(step)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }
                if let createdAt = task.createdAt, createdAt > 0 {
                    Text(AdminFormat.relativeTime(createdAt))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
            if let prompt = task.prompt, !prompt.isEmpty {
                Text(prompt)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
            if let error = task.error, !error.isEmpty {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.danger)
                    .lineLimit(2)
            }
            HStack {
                Spacer(minLength: 8)
                if busyId == task.id {
                    AdminInlineProgress()
                } else {
                    Menu {
                        if task.isRunning {
                            Button("取消任务", systemImage: "stop.circle") {
                                Task { await cancel(task) }
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
                            .frame(width: 36, height: 36)
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
                    Task { await cancel(task) }
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

    private func statusTint(_ status: String) -> Color {
        switch status {
        case "queued", "running": return AppTheme.primary
        case "completed": return AppTheme.success
        case "failed", "cancelled": return AppTheme.danger
        default: return AppTheme.textSecondary
        }
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let r = try await AdminAPI.aiTasks(status: "all", limit: 200, offset: 0)
            tasks = r.items
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func cancel(_ task: AiTaskInfo) async {
        guard busyId == nil else { return }
        busyId = task.id
        defer { busyId = nil }
        do {
            try await AdminAPI.cancelAiTask(id: task.id)
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
            _ = try await AdminAPI.retryAiTask(id: task.id)
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
            tasks.removeAll { $0.id == task.id }
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
