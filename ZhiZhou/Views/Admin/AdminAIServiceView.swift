import SwiftUI

/// AI 服务：模块入口（状态与用量 / 供应商配置 / 运行参数 / 任务 / 审计）。
struct AdminAIServiceView: View {
    var body: some View {
        List {
            Section("运行状态") {
                NavigationLink {
                    AdminAIStatusView()
                } label: {
                    Label("状态与用量", systemImage: "gauge.with.dots.needle.50percent")
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

            Section("任务与审计") {
                NavigationLink {
                    AdminAITasksView()
                } label: {
                    Label("AI 任务", systemImage: "list.bullet.rectangle")
                }
                NavigationLink {
                    AdminAIUsageView()
                } label: {
                    Label("用量与审计", systemImage: "chart.bar.xaxis")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("AI 服务")
        .navigationBarTitleDisplayMode(.large)
    }
}
