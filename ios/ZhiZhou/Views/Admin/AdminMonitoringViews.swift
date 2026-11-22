import SwiftUI

struct AdminTaskCenterView: View {
    var body: some View {
        AdminTaskInboxView()
    }
}

struct AdminDownloadRecordsView: View {
    var body: some View {
        AdminRecordList(title: "下载记录", fetch: { _ in
            let response: AdminDownloadLogsResponse = try await AdminAPI.parityRequest("GET", "/api/download-logs?limit=100")
            return AdminRecordPage(items: response.logs, total: response.logs.count)
        }) { item in
            ReadingSpaceSummaryRow(
                title: item.targetTitle,
                value: "\(item.itemCount) 项",
                detail: "\(item.type) · \(AdminFormat.relativeTime(item.createdAt))"
            )
        }
    }
}

struct AdminOutboundRecordsView: View {
    var body: some View {
        AdminRecordList(title: "出站请求（最近 100 条）", fetch: { _ in
            let response: ScrapeProxyLogsResponse = try await AdminAPI.parityRequest("GET", "/api/scrape?action=proxy-logs&limit=100")
            return AdminRecordPage(items: response.logs, total: response.logs.count)
        }) { item in
            VStack(alignment: .leading, spacing: 4) {
                AppAdaptiveRow {
                    Text("\(item.method ?? "GET") \(item.target ?? item.targetHost ?? "—")")
                        .font(.subheadline.weight(.medium))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(item.status.map { "HTTP \($0)" } ?? "无响应")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(item.ok == true ? AppTheme.success : AppTheme.danger)
                        .layoutPriority(1)
                }
                Text("\(item.scope ?? "—") · \(item.proxySource ?? "none") · \(item.durationMs ?? 0) ms")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                let timestamp = AdminFormat.dateTime(item.timestamp)
                let proxy = item.proxyHost.flatMap { $0.isEmpty ? nil : $0 }
                Text(proxy.map { "\(timestamp) · \($0)" } ?? timestamp)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                if item.status == nil, let error = item.error, !error.isEmpty {
                    Text(error).font(.footnote).foregroundStyle(AppTheme.danger)
                }
            }
        }
    }
}

struct AdminOperationsView: View {
    @State private var status = "all"
    @State private var action = ""
    @State private var username = ""
    @State private var showFilters = false
    var body: some View {
        AdminRecordList(title: "操作审计", query: String(describing: [status, action, username]), fetch: { offset in
            let response: AdminOperationsResponse = try await AdminAPI.parityRequest("GET", "/api/admin/operations?" + HomeView.query([
                "status": status == "all" ? "" : status, "action": action, "username": username,
                "limit": "50", "offset": String(offset),
            ]))
            return AdminRecordPage(items: response.operations, total: response.total)
        }) { item in
            VStack(alignment: .leading, spacing: 4) {
                let actor = item.actorDisplayName.isEmpty ? item.actorUsername : item.actorDisplayName
                ReadingSpaceSummaryRow(
                    title: item.action,
                    value: AdminParityCopy.state(item.status),
                    detail: "\(actor) · \(AdminFormat.dateTime(item.createdAt))",
                    valueTint: item.error.isEmpty ? ReadingSpace.ink : AppTheme.danger
                )
                Text("对象 \(item.targetCount) · HTTP \(item.responseStatus) · 重放 \(item.replayCount)")
                    .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                if !item.error.isEmpty { Text(item.error).font(.footnote).foregroundStyle(AppTheme.danger) }
                Text("操作编号：\(item.operationId)").font(.caption2).textSelection(.enabled)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("筛选", systemImage: "line.3.horizontal.decrease") { showFilters = true }
            }
        }
        .sheet(isPresented: $showFilters) {
            NavigationStack {
                AdminWorkspaceList {
                    AdminWorkspaceHeading("审计筛选")
                    Picker("结果", selection: $status) {
                        Text("全部").tag("all")
                        Text("等待中").tag("pending")
                        Text("成功").tag("completed")
                        Text("失败").tag("failed")
                    }
                    AdminWorkspaceInput("动作名称") {
                        TextField("动作名称", text: $action).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    AdminWorkspaceInput("操作者用户名") {
                        TextField("操作者用户名", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showFilters = false } } }
            }
            .presentationBackground(ReadingSpace.profilePaper)
        }
    }
}
