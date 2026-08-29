import SwiftUI

/// AI 服务：模块入口（状态与用量 / 供应商配置 / 运行参数 / 任务 / 审计）。
struct AdminAIServiceView: View {
    @State private var activeTasks: [AiTaskInfo] = []

    var body: some View {
        List {
            if !activeTasks.isEmpty {
                Section("正在处理") {
                    ForEach(activeTasks) { task in
                        NavigationLink {
                            AdminAITasksView()
                        } label: {
                            AdminAITaskProgressView(task: task, compact: true)
                        }
                    }
                }
            }

            Section("生成") {
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

            Section("观测与设置") {
                NavigationLink {
                    AdminAIStatusView()
                } label: {
                    Label("状态与用量", systemImage: "gauge.with.dots.needle.50percent")
                }
                NavigationLink {
                    AdminAIUsageView()
                } label: {
                    Label("用量与审计", systemImage: "chart.bar.xaxis")
                }
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
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("AI 服务")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await loadActiveTasks() }
        .task { await monitorActiveTasks() }
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
        guard let response = try? await AdminAPI.aiTasks(status: "all", limit: 100, offset: 0) else { return }
        activeTasks = response.items.filter(\.isRunning)
    }
}
