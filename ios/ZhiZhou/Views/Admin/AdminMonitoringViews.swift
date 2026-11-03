import SwiftUI

struct AdminTaskCenterView: View {
    var body: some View {
        List {
            Section("任务") {
                NavigationLink { AdminJobsView() } label: { AppIconLabel("抓取任务", systemImage: "shippingbox") }
                NavigationLink { AdminAITasksView() } label: { AppIconLabel("AI 任务", systemImage: "sparkles") }
            }
            Section("记录与内容") {
                NavigationLink { AdminDownloadRecordsView() } label: { AppIconLabel("下载记录", systemImage: "arrow.down.doc") }
                NavigationLink { AdminAIGenerationsView() } label: { AppIconLabel("已生成内容", systemImage: "doc.text.magnifyingglass") }
            }
        }
        .appListStyle(.settings)
        .navigationTitle("任务中心")
    }
}

struct AdminCallsView: View {
    var body: some View {
        List {
            NavigationLink { AdminAIUsageView() } label: { AppIconLabel("AI 调用与用量", systemImage: "chart.bar.xaxis") }
            NavigationLink { AdminOutboundRecordsView() } label: { AppIconLabel("出站请求", systemImage: "network") }
        }
        .appListStyle(.settings)
        .navigationTitle("调用与用量")
    }
}

struct AdminDownloadRecordsView: View {
    var body: some View {
        AdminRecordList(title: "下载记录", fetch: { _ in
            let response: AdminDownloadLogsResponse = try await AdminAPI.parityRequest("GET", "/api/download-logs?limit=100")
            return AdminRecordPage(items: response.logs, total: response.logs.count)
        }) { item in
            VStack(alignment: .leading, spacing: 6) {
                Text(item.targetTitle).font(.headline)
                Text("\(item.type) · \(item.itemCount) 项").font(.caption)
                Text(AdminFormat.relativeTime(item.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct AdminOutboundRecordsView: View {
    var body: some View {
        AdminRecordList(title: "出站请求（最近 100 条）", fetch: { _ in
            let response: ScrapeProxyLogsResponse = try await AdminAPI.parityRequest("GET", "/api/scrape?action=proxy-logs&limit=100")
            return AdminRecordPage(items: response.logs, total: response.logs.count)
        }) { item in
            VStack(alignment: .leading, spacing: 6) {
                Text("\(item.method ?? "GET") \(item.target ?? item.targetHost ?? "—")")
                    .font(.subheadline).textSelection(.enabled)
                Text("\(item.scope ?? "—") · \(item.proxySource ?? "none") · \(item.durationMs ?? 0) ms")
                    .font(.caption).foregroundStyle(.secondary)
                if let proxy = item.proxyHost, !proxy.isEmpty { Text(proxy).font(.caption) }
                Text(item.status.map { "HTTP \($0)" } ?? item.error ?? "无响应")
                    .foregroundStyle(item.ok == true ? AppTheme.success : AppTheme.danger)
                Text(AdminFormat.dateTime(item.timestamp)).font(.caption).foregroundStyle(.secondary)
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
            VStack(alignment: .leading, spacing: 6) {
                Text(item.action).font(.headline)
                Text("\(item.actorDisplayName.isEmpty ? item.actorUsername : item.actorDisplayName) · \(AdminParityCopy.state(item.status))")
                Text("对象 \(item.targetCount) · HTTP \(item.responseStatus) · 重放 \(item.replayCount)")
                    .font(.caption).foregroundStyle(.secondary)
                if !item.error.isEmpty { Text(item.error).foregroundStyle(AppTheme.danger) }
                Text(AdminFormat.dateTime(item.createdAt)).font(.caption).foregroundStyle(.secondary)
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
                Form {
                    Picker("结果", selection: $status) {
                        Text("全部").tag("all")
                        Text("等待中").tag("pending")
                        Text("成功").tag("completed")
                        Text("失败").tag("failed")
                    }
                    TextField("动作名称", text: $action).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("操作者用户名", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                .navigationTitle("审计筛选")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showFilters = false } } }
            }
        }
    }
}
