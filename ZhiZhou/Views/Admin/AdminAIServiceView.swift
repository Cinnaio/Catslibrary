import SwiftUI

/// AI 服务：模块入口（状态与用量 / 供应商配置 / 运行参数 / 任务 / 审计）。
struct AdminAIServiceView: View {
    var body: some View {
        List {
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
    }
}
