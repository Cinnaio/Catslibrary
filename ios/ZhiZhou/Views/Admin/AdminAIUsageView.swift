import SwiftUI
import ZhiZhouCore
import Charts

/// 用量与审计：用户用量汇总 + 最近调用明细（类型筛选）+ 可选时间范围的调用趋势。
struct AdminAIUsageView: View {
    @State private var requests = ListRequestGuard<[String]>()
    @State private var users: [AiAuditUser] = []
    @State private var calls: [AiAuditCall] = []
    @State private var trend: [AiAuditTrendPoint] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var typeFilter = "all"
    @State private var days = 30
    @State private var callOffset = 0
    @State private var callTotal = 0
    @State private var rangeStart: Int64 = 0
    @State private var rangeEnd: Int64 = 0
    private var query: [String] { [typeFilter, String(days)] }

    private let typeOptions: [(value: String, label: String)] = [
        ("all", "全部"), ("summary", "前情提要"), ("catchup", "回顾总结"), ("continue", "续写"),
        ("write_outline", "创作大纲"), ("write_chapter", "创作章节"), ("rewrite_selection", "选段改写"), ("writing_title", "标题生成"),
        ("novel_analysis", "小说分析报告"), ("novel_analysis_review", "小说分析事实核对"),
        ("cover", "封面生成"), ("cover_prompt", "封面描述词"), ("test", "连通性测试"),
    ]

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("AI 调用与用量")
            Group {
                Picker("时间范围", selection: $days) {
                    ForEach([7, 30, 90], id: \.self) { Text("近 \($0) 天").tag($0) }
                }
                .accessibilityIdentifier("admin.calls.days")
                Picker("调用类型", selection: $typeFilter) {
                    ForEach(typeOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .listRowBackground(Color.clear)
            }
            if let errorMessage, !users.isEmpty || !calls.isEmpty || !trend.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            if isLoading && users.isEmpty && calls.isEmpty && trend.isEmpty {
                Group {
                    ProgressView("正在读取调用与用量…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, users.isEmpty && calls.isEmpty && trend.isEmpty {
                Group {
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
                if !trend.isEmpty {
                    let recentDays = Array(trend.reversed().prefix(5))
                    AdminWorkspaceSection("近 \(days) 天趋势（全部类型）") {
                        Chart(trend) { point in
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
                        .accessibilityLabel("近 \(days) 天 AI 调用次数趋势")
                        .accessibilityValue(
                            trend
                                .map { "\($0.date) \($0.calls ?? 0) 次" }
                                .joined(separator: "，")
                        )

                        DisclosureGroup("查看最近 \(recentDays.count) 个记录日明细") {
                            ForEach(recentDays) { point in
                                ReadingSpaceSummaryRow(
                                    title: point.date,
                                    value: "\(point.calls ?? 0) 次",
                                    detail: trendDayDetail(point)
                                )
                            }
                        }
                    }
                }

                if users.isEmpty {
                    Group {
                        ContentUnavailableView {
                            Label("暂无用户累计用量", systemImage: "chart.bar")
                        } description: {
                            Text("服务端尚未返回用户用量汇总。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else {
                    AdminWorkspaceSection("用户累计用量（前 \(users.count) 位，不随时间筛选）") {
                        ReadingSpaceSummaryRows(users) { user, showsDetails in
                            userRow(user, showsDetails: showsDetails)
                        }
                    }
                }

                if !calls.isEmpty {
                    AdminWorkspaceSection("所选范围调用（\(calls.count)/\(callTotal)）") {
                        ForEach(Array(calls.enumerated()), id: \.element.id) { index, call in
                            callRow(call).readingSpaceEntrance(index)
                        }
                        if callOffset < callTotal {
                            Button("加载更多调用") { Task { await loadMoreCalls() } }
                                .disabled(isLoading)
                        }
                    }
                }
            }
        }
        .refreshable { await load() }
        .task(id: query + [ContentAccessStore.shared.accountRevision.uuidString]) {
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    // MARK: - 行

    private func userRow(_ user: AiAuditUser, showsDetails: Bool) -> some View {
        var detail = ""
        if showsDetails {
            let tokens = "输入 \(user.totalPromptTokens ?? 0) · 输出 \(user.totalCompletionTokens ?? 0)"
            detail = "\(tokens) · \(AdminFormat.aiCost(user.totalCostMillicents))"
            if let last = user.lastCallAt, last > 0 {
                detail += "\n最近调用 \(AdminFormat.dateTime(last))"
            }
        }
        return ReadingSpaceSummaryRow(
            title: user.displayName ?? user.username ?? user.id,
            value: "\(user.callCount ?? 0) 次",
            detail: detail
        )
    }

    private func callRow(_ call: AiAuditCall) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            AppAdaptiveRow(spacing: 6) {
                AdminStatusBadge(
                    AdminFormat.aiTaskKind(call.type ?? ""),
                    tint: AppTheme.primary
                )
                Text(call.username ?? call.displayName ?? "—")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(1)
                Spacer()
                Text(AdminFormat.relativeTime(call.createdAt ?? 0))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            AppAdaptiveRow(spacing: 8) {
                if let model = call.model, !model.isEmpty {
                    Text(model)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Text("\(call.promptTokens ?? 0) → \(call.completionTokens ?? 0) tok")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                if let count = call.imageCount, count > 0 {
                    Text("图 \(count)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Text(AdminFormat.aiCost(call.costMillicents))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if let title = call.novelTitle, !title.isEmpty {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
            }
            if let ip = call.ipAddress, !ip.isEmpty {
                Text(ip)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private func trendDayDetail(_ point: AiAuditTrendPoint) -> String {
        let cost = AdminFormat.aiCost(point.costMillicents)
        guard let tokens = point.promptTokens, tokens > 0 else { return cost }
        return "\(tokens) tok · \(cost)"
    }

    // MARK: - 数据

    private func load() async {
        let ticket = requests.begin(query)
        isLoading = true
        let token = APIClient.shared.token
        let selectedDays = Int(ticket.query[1]) ?? 30
        let to = Int64(Date().timeIntervalSince1970 * 1000)
        let from = to - Int64(selectedDays) * 86_400_000
        users = []; calls = []; trend = []; errorMessage = nil
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            async let usersTask = AdminAPI.aiAuditUsers(limit: 50, offset: 0)
            async let callsTask = AdminAPI.aiAuditCalls(type: ticket.query[0], limit: 50, offset: 0, from: from, to: to)
            async let trendTask = AdminAPI.aiAuditTrend(days: selectedDays)
            let (u, c, t) = try await (usersTask, callsTask, trendTask)
            guard !Task.isCancelled, requests.accepts(ticket, query: query), APIClient.shared.token == token else { return }
            users = u.users
            calls = c.calls
            trend = t.trend
            callOffset = c.calls.count
            callTotal = c.total ?? c.calls.count
            rangeStart = from
            rangeEnd = to
            errorMessage = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query), APIClient.shared.token == token else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }
    private func loadMoreCalls() async {
        guard !isLoading, callOffset < callTotal, let ticket = requests.beginNext(query) else { return }
        let token = APIClient.shared.token
        isLoading = true
        defer { if requests.accepts(ticket, query: ticket.query) { requests.finish(ticket); isLoading = false } }
        do {
            let response = try await AdminAPI.aiAuditCalls(type: ticket.query[0], limit: 50, offset: callOffset, from: rangeStart, to: rangeEnd)
            guard !Task.isCancelled, requests.accepts(ticket, query: query), APIClient.shared.token == token else { return }
            let existing = Set(calls.map(\.id))
            calls += response.calls.filter { !existing.contains($0.id) }
            callOffset += response.calls.count
            callTotal = response.calls.isEmpty ? callOffset : (response.total ?? callOffset)
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query), APIClient.shared.token == token else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

}
