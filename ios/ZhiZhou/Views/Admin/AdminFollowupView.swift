import SwiftUI

struct AdminFollowupView: View {
    let novel: Novel
    @State private var state: NovelFollowup?
    @State private var enabled = false
    @State private var hours = 6
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var requestID = UUID()

    var body: some View {
        Form {
            Section { Text(novel.title).font(.headline) }
            if let error { LoadErrorNotice(message: error, isLoading: busy) { Task { await load() } } }
            if let state {
                Section {
                    Toggle("自动追更", isOn: $enabled)
                        .disabled((!state.hasConfig || !state.ongoing) && !enabled)
                        .accessibilityIdentifier("admin.followup.enabled")
                    Picker("检查频率", selection: $hours) {
                        ForEach([1, 3, 6, 12, 24], id: \.self) { Text("每 \($0) 小时").tag($0) }
                    }
                    if !state.hasConfig { Text("请先在抓取中心配置目录和正文选择器。").foregroundStyle(.secondary) }
                    if !state.ongoing { Text("已完结作品暂停自动检查，仍可手动更新。").foregroundStyle(.secondary) }
                } footer: {
                    Text("无新章节时逐步降低检查频率，失败后由服务端安排重试。")
                }
                Section("最近检查") {
                    Text(state.message.isEmpty ? "尚未检查" : state.message)
                    LabeledContent("上次检查", value: state.checkedAt > 0 ? AdminFormat.dateTime(state.checkedAt) : "尚未检查")
                    LabeledContent("下次检查", value: state.nextCheckAt > 0 ? AdminFormat.dateTime(state.nextCheckAt) : "尚未安排")
                    LabeledContent("新增章节", value: String(state.addedCount))
                    if let job = state.jobId, !job.isEmpty {
                        NavigationLink("查看抓取任务") { AdminJobsView() }
                    }
                }
                Section {
                    Button("保存追更设置") { Task { await save() } }
                        .accessibilityIdentifier("admin.followup.save")
                    Button("刷新检查状态") { Task { await load(updateDraft: false) } }
                }
            } else if busy { ProgressView("读取追更设置…") }
            if let notice { Text(notice).foregroundStyle(AppTheme.success).accessibilityIdentifier("admin.followup.notice") }
        }
        .appListStyle(.settings)
        .navigationTitle("追更设置")
        .disabled(busy)
        .task(id: ContentAccessStore.shared.accountRevision) { requestID = UUID(); busy = false; state = nil; notice = nil; error = nil; await load() }
    }

    private func load(updateDraft: Bool = true) async {
        guard !busy, let token = APIClient.shared.token else { return }
        let id = UUID(); requestID = id
        busy = true
        defer { if requestID == id { busy = false } }
        do {
            let response = try await AdminAPI.followup(novelID: novel.id, token: token)
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            state = response
            if updateDraft { enabled = response.enabled; hours = response.intervalHours }
            error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func save() async {
        guard !busy, let token = APIClient.shared.token else { return }
        let id = UUID(); requestID = id
        busy = true; error = nil; notice = nil
        defer { if requestID == id { busy = false } }
        do {
            let response = try await AdminAPI.saveFollowup(novelID: novel.id, enabled: enabled, hours: hours, token: token)
            guard requestID == id, APIClient.shared.token == token else { return }
            state = response; enabled = response.enabled; hours = response.intervalHours
            notice = "追更设置已保存"
        } catch {
            guard requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
