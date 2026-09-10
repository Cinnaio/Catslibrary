import SwiftUI
import ZhiZhouCore

/// AI 创作：新写 / 续写，大纲 / 章节 / 多章续写后台任务，画像提取（风格/情节/关系）与标题生成。
/// 对齐 Web 端 admin ai AiWritingPanel（/api/ai/writing/*）。
struct AdminAIWritingView: View {
    @Environment(\.scenePhase) private var scenePhase

    enum Mode: String, CaseIterable, Identifiable {
        case new = "新写"
        case continueWriting = "续写"
        var id: String { rawValue }
    }

    enum TaskKind: String, CaseIterable, Identifiable {
        case outline = "大纲"
        case chapter = "章节"
        var id: String { rawValue }
    }

    // 选书
    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var novelId = ""
    @State private var showNovelPicker = false
    @State private var chapterOptions: [ChapterMeta] = []
    @State private var chapterLoadFailed = false
    @State private var afterChapterId = ""
    @State private var selectionRequests = ListRequestGuard<String>()
    @State private var profileRequests = ListRequestGuard<String>()

    // 表单
    @State private var mode: Mode = .new
    @State private var taskKind: TaskKind = .chapter
    @State private var title = ""
    @State private var instruction = ""
    @State private var outline = ""
    @State private var context = ""
    @State private var targetWords = 2000
    @State private var chapterCount = 1

    // 画像
    @State private var styleProfile = ""
    @State private var styleEligibility = ""
    @State private var plotState = ""
    @State private var plotChaptersThrough = 0
    @State private var plotChapterCount = 0
    @State private var relationshipProfile = ""
    @State private var relationshipEligibility = ""
    @State private var plotEligibility = ""
    @State private var profileBusy = ""

    // 任务
    @State private var starting = false
    @State private var taskStatusText: String?
    @State private var activeTask: AiTaskInfo?
    @State private var pollTask: Task<Void, Never>?
    @State private var pollingPaused = false
    @State private var writingPollingToken = UUID()
    @State private var showingTaskResults = false

    // 通用
    @State private var isLoading = true
    @State private var actionError: String?

    private var canStart: Bool {
        guard !starting, !selectionRequests.isLoading, activeTask?.isRunning != true else { return false }
        if mode == .new {
            if taskKind == .outline {
                return !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            return !novelId.isEmpty && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return !novelId.isEmpty && !chapterLoadFailed && !chapterOptions.isEmpty
    }

    var body: some View {
        List {
            if isLoading {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else {
                modeSection
                novelSection
                if mode == .continueWriting {
                    continueSection
                } else {
                    newSection
                }
                profileSection
                taskProgressSection
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("AI 创作")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await initialLoad()
            await resumeWritingTask()
        }
        .sheet(isPresented: $showNovelPicker) {
            AdminNovelPickerSheet(
                options: novelOptions,
                selectedId: novelId,
                onSelect: { id in
                    novelId = id
                    showNovelPicker = false
                    Task { await onNovelSelected(id) }
                }
            )
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .sheet(isPresented: $showingTaskResults) {
            NavigationStack {
                AdminAIGenerationsView(taskID: activeTask?.id)
            }
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await resumeWritingTask() }
            } else {
                pollTask?.cancel()
                pollTask = nil
                starting = false
            }
        }
        .onChange(of: afterChapterId) { _, anchorID in
            guard mode == .continueWriting, !novelId.isEmpty else { return }
            Task { await loadProfileStatuses(novelID: novelId, anchorID: anchorID.isEmpty ? nil : anchorID) }
        }
    }

    // MARK: - 模式与选书

    private var modeSection: some View {
        Section {
            Picker("模式", selection: $mode) {
                ForEach(Mode.allCases) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .accessibleSegmentedPicker()
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            if mode == .new {
                AdminFilterBar {
                    AdminFilterMenu("任务类型", value: taskKind.rawValue) {
                        Picker("任务类型", selection: $taskKind) {
                            ForEach(TaskKind.allCases) { k in
                                Text(k.rawValue).tag(k)
                            }
                        }
                    }
                }
            }
        } footer: {
            Text(mode == .new
                ? (taskKind == .outline ? "根据书名与要求生成创作大纲，不需要选书。" : "根据书籍设定与要求生成单章草稿，结果保存在「已生成内容」。")
                : "从指定章节后继续创作，可一次生成多章，草稿可在「已生成内容」中发布。")
        }
    }

    @ViewBuilder
    private var novelSection: some View {
        Section("目标小说") {
            if let novel = selectedNovel {
                HStack(spacing: 10) {
                    Image(systemName: "book.closed.fill")
                        .foregroundStyle(AppTheme.primary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(novel.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(AppTheme.textPrimary)
                            .appTextLineLimit(1)
                        Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    Spacer()
                    Button("换一本") { showNovelPicker = true }
                        .font(.subheadline)
                        .disabled(!profileBusy.isEmpty)
                }
                .listRowBackground(Color.clear)
            } else {
                Button {
                    showNovelPicker = true
                } label: {
                    Label(mode == .new && taskKind == .outline ? "可选（大纲可省略）" : "选择小说", systemImage: "book.closed")
                }
                .disabled(mode == .new && taskKind == .outline)
            }
        }
    }

    private var selectedNovel: AdminNovelSummary? {
        novelOptions.first { $0.id == novelId }
    }

    // MARK: - 新写表单

    private var newSection: some View {
        Section(taskKind == .outline ? "大纲要求" : "章节要求") {
            TextField("标题（书名 / 章节标题）", text: $title)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if taskKind == .chapter {
                TextField("写作要求（可选）", text: $instruction, axis: .vertical)
                    .lineLimit(2...4)
                TextField("大纲要点（可选）", text: $outline, axis: .vertical)
                    .lineLimit(2...4)
                TextField("前文背景（可选）", text: $context, axis: .vertical)
                    .lineLimit(2...4)
            } else {
                TextField("创作要求（可选）", text: $instruction, axis: .vertical)
                    .lineLimit(2...4)
            }
            Stepper("目标字数：\(targetWords)", value: $targetWords, in: 500...8000, step: 500)
        }
    }

    // MARK: - 续写表单

    private var continueSection: some View {
        Section("续写设置") {
            if !chapterOptions.isEmpty {
                Picker("起点章节", selection: $afterChapterId) {
                    Text("从最新章节续写").tag("")
                    ForEach(chapterOptions) { chapter in
                        Text(chapter.title).tag(chapter.id)
                    }
                }
            } else {
                Text(chapterLoadFailed ? "章节列表加载失败，请重试后再选择续写起点。" : "此书暂无已发布章节，续写需要先有章节；可切换到新写。")
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
                if chapterLoadFailed {
                    Button("重试加载章节") {
                        Task { await onNovelSelected(novelId) }
                    }
                    .font(.subheadline.weight(.medium))
                    .disabled(selectionRequests.isLoading)
                }
            }
            TextField("续写要求（可选）", text: $instruction, axis: .vertical)
                .lineLimit(2...4)
            Stepper("续写章数：\(chapterCount)", value: $chapterCount, in: 1...10)
            Stepper("目标字数：\(targetWords)", value: $targetWords, in: 500...8000, step: 500)
        }
    }

    // MARK: - 画像

    private var profileSection: some View {
        Section {
            profileRow(
                label: "风格画像",
                value: styleProfile,
                status: styleEligibility,
                busy: profileBusy == "style",
                action: { Task { await refreshProfile("style") } },
                empty: "未提取 · 提取后续写自动注入"
            )
            profileRow(
                label: "情节状态",
                value: plotState,
                status: plotEligibility,
                busy: profileBusy == "plot",
                action: { Task { await refreshProfile("plot") } },
                empty: plotSummary
            )
            profileRow(
                label: "关系画像",
                value: relationshipProfile,
                status: relationshipEligibility,
                busy: profileBusy == "relationship",
                action: { Task { await refreshProfile("relationship") } },
                empty: "未提取 · 提取后续写自动注入"
            )
            Button {
                Task { await startTask() }
            } label: {
                if starting {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Label(mode == .continueWriting ? "启动续写任务" : "启动创作任务", systemImage: "paperplane.fill")
                }
            }
            .disabled(starting || !canStart)
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.primary)
        } header: {
            Text("创作画像")
        } footer: {
            Text("任务完成后，草稿会出现在「已生成内容」中，可编辑后发布为正式章节。")
        }
    }

    @ViewBuilder
    private var taskProgressSection: some View {
        if let activeTask {
            Section("当前任务") {
                AdminAITaskProgressView(task: activeTask)
                if let taskStatusText {
                    Text(taskStatusText)
                        .font(.caption)
                        .foregroundStyle(activeTask.status == "failed" ? AppTheme.danger : AppTheme.textSecondary)
                }
                if pollingPaused, activeTask.isRunning {
                    Button("继续查询任务") {
                        pollingPaused = false
                        pollWritingTask(activeTask.id)
                    }
                    .font(.subheadline)
                }
                if let status = activeTask.status, ["completed", "failed", "cancelled"].contains(status) {
                    Button(status == "completed" ? "查看本次草稿" : "查看已生成内容") {
                        showingTaskResults = true
                    }
                    .font(.subheadline.weight(.medium))
                }
            }
        } else if let taskStatusText {
            Section {
                Label(taskStatusText, systemImage: "hourglass")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private var plotSummary: String {
        if plotChaptersThrough > 0 {
            return "已梳理到第 \(plotChaptersThrough) 章\(plotChapterCount > 0 ? "（全书 \(plotChapterCount) 章）" : "")"
        }
        return "未提取 · 提取后续写自动注入"
    }

    private func profileRow(label: String, value: String, status: String = "", busy: Bool, action: @escaping () -> Void, empty: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                if busy {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("正在提取…")
                    }
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                } else {
                    Button("提取 / 刷新") { action() }
                        .font(.caption)
                }
            }
            if value.isEmpty {
                Text(empty)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                Text(value)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(4)
            }
            if !status.isEmpty, status != "usable" {
                Text(profileStatusText(status))
                    .font(.caption2)
                    .foregroundStyle(status == "legacy_unknown" || status == "source_changed" || status == "beyond_anchor" ? AppTheme.warning : AppTheme.textSecondary)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - 数据

    private func initialLoad() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let index = try await AdminAPI.novelIndex(limit: 200)
            novelOptions = index.novels
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func onNovelSelected(_ id: String) async {
        guard id == novelId else { return }
        let ticket = selectionRequests.begin(id)
        chapterOptions = []
        chapterLoadFailed = false
        afterChapterId = ""
        let profileTicket = profileRequests.begin("\(id)|")
        defer { profileRequests.finish(profileTicket) }
        styleProfile = ""
        styleEligibility = ""
        plotState = ""
        plotEligibility = ""
        plotChaptersThrough = 0
        plotChapterCount = 0
        relationshipProfile = ""
        relationshipEligibility = ""
        defer { selectionRequests.finish(ticket) }
        // 载入章节列表与已提取画像（并行发起，分别容错）
        async let chaptersTask = AdminAPI.chapters(novelId: id)
        async let styleTask = AdminAPI.aiGetStyleProfile(novelId: id)
        async let plotTask = AdminAPI.aiGetPlotState(novelId: id)
        async let relationTask = AdminAPI.aiGetRelationshipProfile(novelId: id)
        let chaptersResult = try? await chaptersTask
        let chapters = chaptersResult ?? []
        let style = try? await styleTask
        let plot = try? await plotTask
        let relation = try? await relationTask
        guard !Task.isCancelled, selectionRequests.accepts(ticket, query: novelId) else { return }
        chapterOptions = chapters
        chapterLoadFailed = chaptersResult == nil
        if profileRequests.accepts(profileTicket, query: "\(id)|") {
            styleProfile = style?.profile ?? ""
            plotState = plot?.state ?? ""
            plotChaptersThrough = plot?.chaptersThrough ?? 0
            plotChapterCount = plot?.chapterCount ?? 0
            relationshipProfile = relation?.profile ?? ""
            styleEligibility = style?.eligibility ?? ""
            plotEligibility = plot?.eligibility ?? ""
            relationshipEligibility = relation?.eligibility ?? ""
        }
    }

    private func loadProfileStatuses(novelID: String, anchorID: String?) async {
        guard novelID == self.novelId else { return }
        let query = "\(novelID)|\(anchorID ?? "")"
        let ticket = profileRequests.begin(query)
        defer { profileRequests.finish(ticket) }
        async let styleTask = AdminAPI.aiGetStyleProfile(novelId: novelID, afterChapterId: anchorID)
        async let plotTask = AdminAPI.aiGetPlotState(novelId: novelID, afterChapterId: anchorID)
        async let relationTask = AdminAPI.aiGetRelationshipProfile(novelId: novelID, afterChapterId: anchorID)
        let style = try? await styleTask
        let plot = try? await plotTask
        let relation = try? await relationTask
        guard !Task.isCancelled, novelID == self.novelId, profileRequests.accepts(ticket, query: query) else { return }
        styleProfile = style?.profile ?? ""
        plotState = plot?.state ?? ""
        plotChaptersThrough = plot?.source?.chapterOrdinal ?? plot?.chaptersThrough ?? 0
        relationshipProfile = relation?.profile ?? ""
        styleEligibility = style?.eligibility ?? ""
        plotEligibility = plot?.eligibility ?? ""
        relationshipEligibility = relation?.eligibility ?? ""
    }

    private func profileStatusText(_ status: String) -> String {
        switch status {
        case "usable": return "用于本次"
        case "stale": return "来源较早，情节状态不会自动注入"
        case "beyond_anchor": return "来源晚于当前起点，需重新提取"
        case "legacy_unknown": return "来源未记录，需重新提取后才会注入"
        case "source_changed": return "来源正文已变化，需重新提取"
        case "missing": return "未提取"
        default: return status
        }
    }

    private func refreshProfile(_ scope: String) async {
        guard !novelId.isEmpty else {
            actionError = "请先选择小说"
            return
        }
        guard profileBusy.isEmpty, !selectionRequests.isLoading else { return }
        let selectedID = novelId
        profileBusy = scope
        defer { profileBusy = "" }
        do {
            switch scope {
            case "style":
                let r = try await AdminAPI.aiRefreshStyleProfile(novelId: selectedID, afterChapterId: afterChapterId.isEmpty ? nil : afterChapterId)
                guard !Task.isCancelled, novelId == selectedID else { return }
                styleProfile = r.profile ?? ""
                styleEligibility = "usable"
            case "plot":
                let r = try await AdminAPI.aiRefreshPlotState(novelId: selectedID, afterChapterId: afterChapterId.isEmpty ? nil : afterChapterId)
                guard !Task.isCancelled, novelId == selectedID else { return }
                plotState = r.state ?? ""
                plotChaptersThrough = r.chaptersThrough ?? 0
                plotEligibility = "usable"
            default:
                let r = try await AdminAPI.aiRefreshRelationshipProfile(novelId: selectedID, afterChapterId: afterChapterId.isEmpty ? nil : afterChapterId)
                guard !Task.isCancelled, novelId == selectedID else { return }
                relationshipProfile = r.profile ?? ""
                relationshipEligibility = "usable"
            }
        } catch {
            guard !Task.isCancelled, novelId == selectedID else { return }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func resumeWritingTask() async {
        guard pollTask == nil else { return }
        do {
            guard let task = try await AdminAITaskCoordinator.shared.resume(
                key: AdminAITaskCoordinator.OperationKey.writing,
                recoveryAttempts: 5
            ) else { return }
            activeTask = task
            if let taskNovelID = task.novelId, !taskNovelID.isEmpty {
                novelId = taskNovelID
                await onNovelSelected(taskNovelID)
            }
            if task.isRunning {
                taskStatusText = "已恢复正在处理的创作任务"
                pollWritingTask(task.id)
            } else {
                taskStatusText = "任务\(AdminFormat.aiTaskStatus(task.status ?? ""))，可在「已生成内容」查看草稿。"
            }
        } catch {
            taskStatusText = "创作任务暂时无法查询，请稍后重试"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func startTask() async {
        guard canStart else { return }
        starting = true
        activeTask = nil
        taskStatusText = "任务已提交，等待队列…"
        defer { starting = false }

        var body: [String: Any]
        let kind: String
        let resourceID: String?
        if mode == .continueWriting {
            kind = "continue"
            resourceID = novelId
            body = [
                "novelId": novelId,
                "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                "chapterCount": chapterCount,
                "targetWords": targetWords,
            ]
            if !afterChapterId.isEmpty { body["afterChapterId"] = afterChapterId }
        } else if taskKind == .outline {
            kind = "write_outline"
            resourceID = nil
            body = [
                "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                "targetWords": targetWords,
            ]
        } else {
            kind = "write_chapter"
            resourceID = novelId
            body = [
                "novelId": novelId,
                "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                "outline": outline.trimmingCharacters(in: .whitespacesAndNewlines),
                "context": context.trimmingCharacters(in: .whitespacesAndNewlines),
                "targetWords": targetWords,
            ]
        }

        let requestPayloadJSON = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) }
        do {
            let launch = try await AdminAITaskCoordinator.shared.start(
                key: AdminAITaskCoordinator.OperationKey.writing,
                kind: kind,
                resourceID: resourceID,
                requestPayloadJSON: requestPayloadJSON,
                requestFingerprint: requestPayloadJSON
            ) { clientRequestID in
                let result = try await AdminAPI.aiStartWriting(
                    kind: kind,
                    body: body,
                    clientRequestID: clientRequestID
                )
                return result.taskId
            }
            let task = launch.snapshot ?? .pending(
                id: launch.taskID,
                kind: kind,
                novelId: resourceID
            )
            activeTask = task
            if task.isRunning {
                taskStatusText = launch.reusedExistingOperation ? "已恢复正在处理的创作任务" : nil
                pollWritingTask(task.id)
            } else {
                taskStatusText = "任务\(AdminFormat.aiTaskStatus(task.status ?? ""))，可在「已生成内容」查看草稿。"
            }
        } catch {
            taskStatusText = "请求中断时会按稳定请求 ID 自动恢复"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func pollWritingTask(_ id: String) {
        pollTask?.cancel()
        let token = UUID()
        writingPollingToken = token
        pollingPaused = false
        pollTask = Task {
            var attempts = 0
            var interval: UInt64 = 3_000_000_000
            var consecutiveFailures = 0
            defer {
                if !Task.isCancelled, writingPollingToken == token { pollTask = nil }
            }
            while !Task.isCancelled, attempts < 200 {
                if attempts > 0 {
                    try? await Task.sleep(nanoseconds: interval)
                    guard !Task.isCancelled, writingPollingToken == token else { return }
                }
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    guard AdminAITaskCoordinator.shared.isCurrent(
                        key: AdminAITaskCoordinator.OperationKey.writing,
                        taskID: id
                    ), writingPollingToken == token else { return }
                    consecutiveFailures = 0
                    activeTask = detail.task
                    let status = detail.task.status ?? ""
                    if ["completed", "failed", "cancelled"].contains(status) {
                        AdminAITaskCoordinator.shared.finish(
                            key: AdminAITaskCoordinator.OperationKey.writing,
                            taskID: detail.task.id
                        )
                        taskStatusText = "任务\(AdminFormat.aiTaskStatus(status))，可在「已生成内容」查看草稿。"
                        pollingPaused = false
                        return
                    }
                    interval = 3_000_000_000
                } catch {
                    guard !Task.isCancelled, writingPollingToken == token else { return }
                    if isTransientTaskError(error) {
                        consecutiveFailures += 1
                        interval = min(30_000_000_000, max(3_000_000_000, interval * 2))
                        taskStatusText = "网络暂时不可用，正在退避重试（\(consecutiveFailures)/5）…"
                        if consecutiveFailures < 5 { continue }
                        pollingPaused = true
                        pollTask = nil
                        taskStatusText = "任务仍在服务器运行，查询暂时中断；点按“继续查询任务”恢复。"
                        return
                    }
                    pollingPaused = false
                    pollTask = nil
                    taskStatusText = taskQueryErrorText(error)
                    return
                }
            }
            guard !Task.isCancelled, writingPollingToken == token else { return }
            pollingPaused = true
            pollTask = nil
            taskStatusText = "任务仍在服务器运行，查询窗口已结束；点按“继续查询任务”恢复。"
        }
    }

    private func isTransientTaskError(_ error: Error) -> Bool {
        if case APIError.network = error { return true }
        if case APIError.http(let status, _) = error { return status == 408 || status == 429 || status >= 500 }
        return false
    }

    private func taskQueryErrorText(_ error: Error) -> String {
        if case APIError.http(let status, _) = error {
            switch status {
            case 401: return "登录已失效，请重新登录后继续查询任务"
            case 403: return "当前账号没有查询该任务的权限"
            case 404: return "任务记录不存在，无法继续查询"
            default: break
            }
        }
        return "无法读取任务状态：\(AppCopy.friendlyError(error))"
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - 选书 Sheet（与封面视图共用结构，独立实现避免跨文件依赖）

struct AdminNovelPickerSheet: View {
    let options: [AdminNovelSummary]
    let selectedId: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var filtered: [AdminNovelSummary] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return options }
        return options.filter {
            $0.title.localizedCaseInsensitiveContains(q) || $0.author.localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { novel in
                Button {
                    onSelect(novel.id)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(novel.title)
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                                .appTextLineLimit(1)
                            Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Spacer()
                        if novel.id == selectedId {
                            Image(systemName: "checkmark")
                                .foregroundStyle(AppTheme.primary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.browsing)
            .navigationTitle("选择小说")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "搜索书名 / 作者")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
