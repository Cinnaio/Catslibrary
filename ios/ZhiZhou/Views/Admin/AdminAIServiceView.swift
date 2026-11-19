import SwiftUI
import ZhiZhouCore

/// AI 服务：模块入口（状态与用量 / 供应商配置 / 运行参数 / 任务 / 审计）。
struct AdminAIServiceView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var activeTasks: [AiTaskInfo] = []
    @State private var requests = ListRequestGuard<String>()
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                LoadErrorNotice(message: errorMessage, isLoading: requests.isLoading) {
                    Task { await loadActiveTasks() }
                }
            }
            if !activeTasks.isEmpty {
                Section("正在处理") {
                    ForEach(activeTasks) { task in
                        NavigationLink {
                            AdminAITasksView(taskID: task.id)
                        } label: {
                            AdminAITaskProgressView(task: task, compact: true)
                        }
                    }
                }
            }

            Section("创作") {
                NavigationLink { AdminAIAgentView() } label: {
                    Label("对话创作", systemImage: "bubble.left.and.bubble.right")
                }
                NavigationLink {
                    AdminAIWritingView()
                } label: {
                    Label("AI 创作", systemImage: "pencil.and.outline")
                }
                NavigationLink {
                    AdminAICoverView()
                } label: {
                    Label("封面生成", systemImage: "photo.on.rectangle.angled")
                }
            }

            Section("任务与内容") {
                NavigationLink {
                    AdminAITasksView()
                } label: {
                    Label("AI 任务", systemImage: "list.bullet.rectangle")
                }
                NavigationLink {
                    AdminAIGenerationsView()
                } label: {
                    Label("已生成内容", systemImage: "doc.text.magnifyingglass")
                }
            }

            Section("运行") {
                NavigationLink {
                    AdminAIStatusView()
                } label: {
                    Label("状态与用量", systemImage: "gauge.with.dots.needle.50percent")
                }
                NavigationLink {
                    AdminAIUsageView()
                } label: {
                    Label("AI 调用与用量", systemImage: "chart.bar.xaxis")
                }
            }
            if appState.user?.isSuperAdmin == true {
                Section("配置") {
                    NavigationLink {
                        AdminAIProviderView()
                    } label: {
                        Label("供应商配置", systemImage: "server.rack")
                    }
                    NavigationLink {
                        AdminAISettingsView()
                    } label: {
                        Label("运行参数", systemImage: "slider.horizontal.3")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("AI 服务")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await loadActiveTasks() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await monitorActiveTasks()
        }
    }

    private func monitorActiveTasks() async {
        await loadActiveTasks()
        while !Task.isCancelled {
            let interval: UInt64 = activeTasks.isEmpty
                ? 15_000_000_000
                : 3_000_000_000
            try? await Task.sleep(nanoseconds: interval)
            guard !Task.isCancelled else { return }
            await loadActiveTasks()
        }
    }

    private func loadActiveTasks() async {
        let ticket = requests.begin("active")
        defer { requests.finish(ticket) }
        do {
            let response = try await AdminAPI.aiTasks(status: "all", limit: 100, offset: 0)
            guard !Task.isCancelled, requests.accepts(ticket, query: "active") else { return }
            AdminAITaskCoordinator.shared.reconcile(response.items)
            activeTasks = response.items.filter(\.isRunning)
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: "active") else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
