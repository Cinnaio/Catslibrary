import SwiftUI

struct AdminBackupsView: View {
    @State private var overview: AdminBackupOverview?
    @State private var loading = false
    @State private var error: String?
    @State private var requestID = UUID()
    var body: some View {
        List {
            if let error { LoadErrorNotice(message: error, isLoading: loading) { Task { await load() } } }
            if loading && overview == nil { ProgressView("读取备份状态…") }
            if let overview {
                Section("备份状态") {
                    LabeledContent("自动备份", value: overview.policy.enabled ? "已开启" : "已关闭")
                    LabeledContent("下次备份", value: overview.policy.nextRunAt > 0 ? AdminFormat.dateTime(overview.policy.nextRunAt) : "尚未安排")
                    LabeledContent("时区", value: overview.policy.timezone)
                    LabeledContent("维护模式", value: overview.maintenance ? "开启" : "关闭")
                    LabeledContent("加密", value: overview.capabilities.encryption ? "已就绪" : "未就绪")
                    LabeledContent("数据库导出", value: overview.capabilities.dump ? "已就绪" : "未就绪")
                    LabeledContent("恢复工具", value: overview.capabilities.restore ? "已就绪" : "未就绪")
                    LabeledContent("传输工具", value: overview.capabilities.transfer ? "已就绪" : "未就绪")
                    LabeledContent("演练库", value: overview.capabilities.rehearsal ? "已配置" : "未配置")
                }
                Section("存储目标") {
                    if overview.targets.isEmpty { Text("尚未配置存储目标").foregroundStyle(.secondary) }
                    ForEach(overview.targets) { target in
                        LabeledContent(target.name, value: "\(target.type) · \(target.enabled ? "启用" : "停用")")
                    }
                }
                Section("最近任务") {
                    if overview.tasks.isEmpty { Text("暂无任务").foregroundStyle(.secondary) }
                    ForEach(overview.tasks) { task in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(task.kind) · \(AdminParityCopy.state(task.state))")
                            Text(task.stage).font(.caption)
                            if !task.error.isEmpty { Text(task.error).foregroundStyle(AppTheme.danger) }
                            Text(AdminFormat.dateTime(task.createdAt)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("历史") {
                NavigationLink("备份版本") { AdminBackupVersionsView() }
                NavigationLink("操作日志") { AdminBackupEventsView() }
            }
            Section {
                AdminWebLink(title: "在 Web 管理备份与恢复", path: "/admin/backups")
            } footer: { Text("App 提供只读状态和历史。创建备份、重试与恢复请在 Web 操作，浏览器需单独登录。") }
        }
        .appListStyle(.settings)
        .navigationTitle("备份与恢复")
        .refreshable { await load() }
        .task(id: ContentAccessStore.shared.accountRevision) { overview = nil; error = nil; await load() }
    }
    private func load() async {
        guard let token = APIClient.shared.token else { return }
        let id = UUID(); requestID = id; loading = true
        defer { if requestID == id { loading = false } }
        do {
            let response: AdminBackupOverview = try await AdminAPI.parityRequest("GET", "/api/admin/backups/overview", token: token)
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            overview = response; error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

struct AdminBackupVersionsView: View {
    var body: some View {
        AdminRecordList(title: "备份版本", fetch: { offset in
            let response: AdminRecordPage<AdminBackupVersion> = try await AdminAPI.parityRequest("GET", "/api/admin/backups/versions?limit=50&offset=\(offset)")
            return response
        }) { version in
            VStack(alignment: .leading, spacing: 6) {
                Text(AdminFormat.dateTime(version.createdAt)).font(.headline)
                Text("\(AdminParityCopy.state(version.state)) · \(ByteCountFormatter.string(fromByteCount: version.size, countStyle: .file))")
                if !version.note.isEmpty { Text(version.note) }
                ForEach(version.copies) { copy in
                    Text("\(copy.name) · \(AdminParityCopy.state(copy.state))").font(.caption)
                    if !copy.error.isEmpty { Text(copy.error).font(.caption).foregroundStyle(AppTheme.danger) }
                }
            }
        }
    }
}

struct AdminBackupEventsView: View {
    var body: some View {
        AdminRecordList(title: "备份操作日志", fetch: { offset in
            let response: AdminRecordPage<AdminBackupEvent> = try await AdminAPI.parityRequest("GET", "/api/admin/backups/logs?limit=50&offset=\(offset)")
            return response
        }) { event in
            VStack(alignment: .leading, spacing: 6) {
                Text(event.message).textSelection(.enabled)
                Text("\(event.level) · \(AdminFormat.dateTime(event.createdAt))").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
