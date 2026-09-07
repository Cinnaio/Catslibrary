import SwiftUI
import ZhiZhouCore

/// 登录审计：登录记录查询（状态筛选 / 用户名搜索 / 分页）。
/// 对齐 Web 端 admin SettingsTab 的「登录审计」子页（GET /api/admin-users/login-audit）。
struct AdminLoginAuditView: View {
    @State private var audits: [LoginAuditItem] = []
    @State private var totalCount = 0
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var statusFilter = "all"
    @State private var username = ""

    private let pageSize = 20
    @State private var offset = 0
    @State private var loadingMore = false
    @State private var paginationError: String?
    @State private var requests = ListRequestGuard<[String]>()

    private var query: [String] {
        [statusFilter, username.trimmingCharacters(in: .whitespacesAndNewlines)]
    }

    var body: some View {
        List {
            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: auditStatusLabel) {
                        Picker("状态", selection: $statusFilter) {
                            Text("全部").tag("all")
                            Text("成功").tag("success")
                            Text("失败").tag("failure")
                            Text("受限").tag("limited")
                        }
                    }
                }
                TextField("按用户名筛选", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            if isLoading && audits.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, audits.isEmpty {
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
            } else if audits.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("暂无记录", systemImage: "lock.shield")
                    } description: {
                        Text("当前筛选条件下没有登录记录。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load() }
                    }
                }
                Section("共 \(totalCount) 条") {
                    ForEach(audits) { item in
                        auditRow(item)
                    }
                    if offset + pageSize < totalCount {
                        if let paginationError {
                            Text(paginationError).font(.footnote).foregroundStyle(AppTheme.danger)
                        }
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                if loadingMore { ProgressView() }
                                Text("加载更多（\(audits.count)/\(totalCount)）")
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.primary)
                                Spacer()
                            }
                        }
                        .listRowBackground(Color.clear)
                        .disabled(isLoading || loadingMore || errorMessage != nil)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("登录审计")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: query) {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private var auditStatusLabel: String {
        switch statusFilter {
        case "success": return "成功"
        case "failure": return "失败"
        case "limited": return "受限"
        default: return "全部状态"
        }
    }

    private func auditRow(_ item: LoginAuditItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(item.username.isEmpty ? "—" : "@\(item.username)")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                statusBadge(item)
            }
            Text(item.displayName.isEmpty ? "未知用户" : item.displayName)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            HStack(spacing: 8) {
                if !item.ipAddress.isEmpty {
                    Text(item.ipAddress)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text(AdminFormat.dateTime(item.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            if let reason = reasonText(item.reason) {
                Text(reason)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.warning)
                    .lineLimit(1)
            }
            if !item.userAgent.isEmpty {
                Text(item.userAgent)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private func statusBadge(_ item: LoginAuditItem) -> some View {
        let (text, tint): (String, Color) = item.isSuccess
            ? ("成功", AppTheme.success)
            : item.isLimited
                ? ("受限", AppTheme.warning)
                : ("失败", AppTheme.danger)
        return AdminStatusBadge(text, tint: tint)
    }

    private func reasonText(_ reason: String) -> String? {
        switch reason {
        case "invalid_credentials": return "用户名或密码错误"
        case "account_disabled": return "账号已被禁用"
        case "rate_limited": return "触发频率限制"
        case "not_found": return "用户不存在"
        default: return reason.isEmpty ? nil : reason
        }
    }

    private func load() async {
        let ticket = requests.begin(query)
        isLoading = true
        loadingMore = false
        paginationError = nil
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            let result = try await AdminAPI.loginAudit(
                status: ticket.query[0],
                username: ticket.query[1],
                limit: pageSize,
                offset: 0
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            audits = result.audits
            totalCount = result.total
            offset = 0
            errorMessage = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        guard !isLoading, !loadingMore, errorMessage == nil, offset + pageSize < totalCount,
              let ticket = requests.beginNext(query) else { return }
        loadingMore = true
        paginationError = nil
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                loadingMore = false
            }
        }
        do {
            let next = offset + pageSize
            let result = try await AdminAPI.loginAudit(
                status: ticket.query[0],
                username: ticket.query[1],
                limit: pageSize,
                offset: next
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            let existing = Set(audits.map(\.id))
            audits += result.audits.filter { !existing.contains($0.id) }
            offset = next
            totalCount = result.total
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            paginationError = AppCopy.friendlyError(error)
        }
    }
}
