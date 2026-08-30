import SwiftUI
import Charts

/// 用量与审计：用户用量汇总 + 最近调用明细（类型筛选）+ 近 30 天调用趋势。
struct AdminAIUsageView: View {
    @State private var users: [AiAuditUser] = []
    @State private var calls: [AiAuditCall] = []
    @State private var trend: [AiAuditTrendPoint] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var typeFilter = "all"

    private let typeOptions: [(value: String, label: String)] = [
        ("all", "全部"), ("summary", "前情提要"), ("catchup", "回顾总结"), ("continue", "续写"),
        ("write_outline", "创作大纲"), ("write_chapter", "创作章节"), ("writing_title", "标题生成"),
        ("cover", "封面生成"), ("cover_prompt", "封面描述词"), ("test", "连通性测试"),
    ]

    var body: some View {
        List {
            if isLoading && users.isEmpty && trend.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, users.isEmpty && calls.isEmpty && trend.isEmpty {
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
                Section {
                    Picker("调用类型", selection: $typeFilter) {
                        ForEach(typeOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .listRowBackground(Color.clear)
                }

                if !trend.isEmpty {
                    Section("近 30 天趋势") {
                        Chart(recentTrend) { point in
                            BarMark(
                                x: .value("日期", point.date),
                                y: .value("调用次数", Double(point.calls ?? 0))
                            )
                            .foregroundStyle(AppTheme.primary)
                        }
                        .frame(height: 150)
                        .chartYAxis { AxisMarks(position: .leading) }
                        .chartXAxis {
                            AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                                AxisGridLine()
                                AxisValueLabel()
                            }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("近 14 天 AI 调用次数趋势")
                        .accessibilityValue(
                            recentTrend
                                .map { "\($0.date) \($0.calls ?? 0) 次" }
                                .joined(separator: "，")
                        )

                        ForEach(Array(recentTrend.reversed().prefix(5))) { point in
                            HStack(spacing: 8) {
                                Text(point.date)
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .frame(width: 72, alignment: .leading)
                                ProgressView(
                                    value: Double(point.calls ?? 0),
                                    total: Double(maxTrendCalls)
                                )
                                .progressViewStyle(.linear)
                                .tint(AppTheme.primary)
                                Text("\(point.calls ?? 0) 次")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textPrimary)
                                if let tokens = point.promptTokens, tokens > 0 {
                                    Text("\(tokens) tok")
                                        .font(.caption2)
                                        .foregroundStyle(AppTheme.textMuted)
                                }
                                Text(AdminFormat.aiCost(point.costMillicents))
                                    .font(.caption2)
                                    .foregroundStyle(AppTheme.textMuted)
                            }
                        }
                        Text("图表显示最近 14 天，明细列出最近 5 天。")
                            .font(.caption2)
                            .foregroundStyle(AppTheme.textMuted)
                    }
                }

                if users.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("暂无用量", systemImage: "chart.bar")
                        } description: {
                            Text("还没有 AI 调用记录。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else {
                    Section("用户用量（\(users.count)）") {
                        ForEach(users) { user in
                            userRow(user)
                        }
                    }
                }

                if !calls.isEmpty {
                    Section("最近调用（\(calls.count)）") {
                        ForEach(calls) { call in
                            callRow(call)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("用量与审计")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: typeFilter) {
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    // MARK: - 行

    private func userRow(_ user: AiAuditUser) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(user.displayName ?? user.username ?? user.id)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                Text("\(user.callCount ?? 0) 次")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            HStack(spacing: 8) {
                Text("输入 \(user.totalPromptTokens ?? 0)")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                Text("输出 \(user.totalCompletionTokens ?? 0)")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                Text(AdminFormat.aiCost(user.totalCostMillicents))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            if let last = user.lastCallAt, last > 0 {
                Text("最近调用：\(AdminFormat.dateTime(last))")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
        .padding(.vertical, 2)
    }

    private func callRow(_ call: AiAuditCall) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                AdminStatusBadge(
                    AdminFormat.aiTaskKind(call.type ?? ""),
                    tint: AppTheme.primary
                )
                Text(call.username ?? call.displayName ?? "—")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                Text(AdminFormat.relativeTime(call.createdAt ?? 0))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            HStack(spacing: 8) {
                if let model = call.model, !model.isEmpty {
                    Text(model)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text("\(call.promptTokens ?? 0) → \(call.completionTokens ?? 0) tok")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                if let count = call.imageCount, count > 0 {
                    Text("图 \(count)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text(AdminFormat.aiCost(call.costMillicents))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            if let title = call.novelTitle, !title.isEmpty {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
            if let ip = call.ipAddress, !ip.isEmpty {
                Text(ip)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var maxTrendCalls: Int {
        max(1, trend.map { $0.calls ?? 0 }.max() ?? 1)
    }

    private var recentTrend: [AiAuditTrendPoint] {
        Array(trend.suffix(14))
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let usersTask = AdminAPI.aiAuditUsers(limit: 50, offset: 0)
            async let callsTask = AdminAPI.aiAuditCalls(type: typeFilter, limit: 50, offset: 0)
            async let trendTask = AdminAPI.aiAuditTrend(days: 30)
            let (u, c, t) = try await (usersTask, callsTask, trendTask)
            users = u.users
            calls = c.calls
            trend = t.trend
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
