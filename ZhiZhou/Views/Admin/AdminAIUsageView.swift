import SwiftUI

/// 用量与审计：用户用量汇总 + 最近调用明细。
struct AdminAIUsageView: View {
    @State private var users: [AiAuditUser] = []
    @State private var calls: [AiAuditCall] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading && users.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, users.isEmpty {
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
        .task { await load() }
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
                Text(call.type ?? "—")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(AppTheme.primary.opacity(0.12), in: Capsule())
                    .foregroundStyle(AppTheme.primary)
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

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let usersTask = AdminAPI.aiAuditUsers(limit: 50, offset: 0)
            async let callsTask = AdminAPI.aiAuditCalls(limit: 50, offset: 0)
            let (u, c) = try await (usersTask, callsTask)
            users = u.users
            calls = c.calls
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
