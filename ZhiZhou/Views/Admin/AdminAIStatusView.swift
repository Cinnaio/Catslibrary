import SwiftUI

/// AI 状态与用量：配置状态 / 配额 / 今日与近 30 天用量。
struct AdminAIStatusView: View {
    @State private var status: AiStatus?
    @State private var usage: AiUsageResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading && status == nil {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, status == nil {
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
                Section("配置状态") {
                    LabeledContent("已配置") {
                        Text(status?.configured == true ? "是" : "否")
                            .foregroundStyle(status?.configured == true ? AppTheme.success : AppTheme.textMuted)
                    }
                    if let model = status?.model, !model.isEmpty {
                        LabeledContent("模型", value: model)
                    }
                    if let features = status?.features {
                        LabeledContent("前情提要") {
                            Text(features.recap == true ? "已开启" : "未开启")
                                .foregroundStyle(features.recap == true ? AppTheme.success : AppTheme.textMuted)
                        }
                        LabeledContent("回顾总结") {
                            Text(features.catchup == true ? "已开启" : "未开启")
                                .foregroundStyle(features.catchup == true ? AppTheme.success : AppTheme.textMuted)
                        }
                    }
                    if let stale = status?.catchupStaleDays, stale > 0 {
                        LabeledContent("回顾过期天数", value: "\(stale) 天")
                    }
                }

                Section("配额") {
                    if let quota = status?.quota {
                        if quota.limit == -1 {
                            LabeledContent("已用", value: "\(quota.used ?? 0) 次（管理员不限额）")
                        } else {
                            LabeledContent("已用", value: "\(quota.used ?? 0) / \(quota.limit ?? 0) 次")
                            if let resetAt = quota.resetAt, resetAt > 0 {
                                LabeledContent("重置时间", value: AdminFormat.dateTime(resetAt))
                            }
                        }
                    } else {
                        Text("无配额限制")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }

                usageSection(title: "今日用量", summary: usage?.today)
                usageSection(title: "近 30 天用量", summary: usage?.last30d)
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("状态与用量")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
    }

    private func usageSection(title: String, summary: AiUsageSummary?) -> some View {
        Section(title) {
            LabeledContent("调用次数", value: "\(summary?.calls ?? 0)")
            LabeledContent("输入 Tokens", value: "\(summary?.promptTokens ?? 0)")
            LabeledContent("输出 Tokens", value: "\(summary?.completionTokens ?? 0)")
            LabeledContent("成本", value: AdminFormat.aiCost(summary?.costMillicents))
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let statusTask = AdminAPI.aiStatus()
            async let usageTask = AdminAPI.aiUsage()
            let (s, u) = try await (statusTask, usageTask)
            status = s
            usage = u
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
