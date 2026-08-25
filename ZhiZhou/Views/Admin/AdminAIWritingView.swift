import SwiftUI

/// AI 创作：新写 / 续写，大纲 / 章节 / 多章续写后台任务，画像提取（风格/情节/关系）与标题生成。
/// 对齐 Web 端 admin ai AiWritingPanel（/api/ai/writing/*）。
struct AdminAIWritingView: View {
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
    @State private var afterChapterId = ""

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
    @State private var plotState = ""
    @State private var plotChaptersThrough = 0
    @State private var plotChapterCount = 0
    @State private var relationshipProfile = ""
    @State private var profileBusy = ""

    // 任务
    @State private var starting = false
    @State private var taskStatusText: String?
    @State private var pollTask: Task<Void, Never>?

    // 通用
    @State private var isLoading = true
    @State private var actionError: String?

    private var canStart: Bool {
        if mode == .new {
            if taskKind == .outline {
                return !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            return !novelId.isEmpty && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return !novelId.isEmpty
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
                if let taskStatusText {
                    Section {
                        Label(taskStatusText, systemImage: "hourglass")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("AI 创作")
        .navigationBarTitleDisplayMode(.large)
        .task { await initialLoad() }
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
        .onDisappear {
            pollTask?.cancel()
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
            .pickerStyle(.segmented)
            if mode == .new {
                Picker("任务类型", selection: $taskKind) {
                    ForEach(TaskKind.allCases) { k in
                        Text(k.rawValue).tag(k)
                    }
                }
                .pickerStyle(.segmented)
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
                            .lineLimit(1)
                        Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    Spacer()
                    Button("换一本") { showNovelPicker = true }
                        .font(.subheadline)
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
                Text("此书暂无章节，将从空白续写（需先有已发布章节）。")
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
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
                busy: profileBusy == "style",
                action: { Task { await refreshProfile("style") } },
                empty: "未提取 · 提取后续写自动注入"
            )
            profileRow(
                label: "情节状态",
                value: plotState,
                busy: profileBusy == "plot",
                action: { Task { await refreshProfile("plot") } },
                empty: plotSummary
            )
            profileRow(
                label: "关系画像",
                value: relationshipProfile,
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

    private var plotSummary: String {
        if plotChaptersThrough > 0 {
            return "已梳理到第 \(plotChaptersThrough) 章\(plotChapterCount > 0 ? "（全书 \(plotChapterCount) 章）" : "")"
        }
        return "未提取 · 提取后续写自动注入"
    }

    private func profileRow(label: String, value: String, busy: Bool, action: @escaping () -> Void, empty: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                if busy {
                    ProgressView().controlSize(.small)
                } else {
                    Button("提取 / 刷新") { action() }
                        .font(.caption)
                }
            }
            if value.isEmpty {
                Text(empty)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
            } else {
                Text(value)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(4)
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
        // 载入章节列表与已提取画像（并行发起，分别容错）
        async let chaptersTask = AdminAPI.chapters(novelId: id)
        async let styleTask = AdminAPI.aiGetStyleProfile(novelId: id)
        async let plotTask = AdminAPI.aiGetPlotState(novelId: id)
        async let relationTask = AdminAPI.aiGetRelationshipProfile(novelId: id)
        let chapters = (try? await chaptersTask) ?? []
        let style = try? await styleTask
        let plot = try? await plotTask
        let relation = try? await relationTask
        chapterOptions = chapters
        styleProfile = style?.profile ?? ""
        plotState = plot?.state ?? ""
        plotChaptersThrough = plot?.chaptersThrough ?? 0
        plotChapterCount = plot?.chapterCount ?? 0
        relationshipProfile = relation?.profile ?? ""
    }

    private func refreshProfile(_ scope: String) async {
        guard !novelId.isEmpty else {
            actionError = "请先选择小说"
            return
        }
        profileBusy = scope
        defer { profileBusy = "" }
        do {
            switch scope {
            case "style":
                let r = try await AdminAPI.aiRefreshStyleProfile(novelId: novelId)
                styleProfile = r.profile ?? ""
            case "plot":
                let r = try await AdminAPI.aiRefreshPlotState(novelId: novelId)
                plotState = r.state ?? ""
                plotChaptersThrough = r.chaptersThrough ?? 0
            default:
                let r = try await AdminAPI.aiRefreshRelationshipProfile(novelId: novelId)
                relationshipProfile = r.profile ?? ""
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func startTask() async {
        guard canStart else { return }
        starting = true
        taskStatusText = "任务已提交，等待队列…"
        defer { starting = false }
        do {
            var body: [String: Any] = [:]
            if mode == .continueWriting {
                body = [
                    "novelId": novelId,
                    "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                    "chapterCount": chapterCount,
                    "targetWords": targetWords,
                ]
                if !afterChapterId.isEmpty {
                    body["afterChapterId"] = afterChapterId
                }
                let result = try await AdminAPI.aiStartWriting(kind: "continue", body: body)
                pollWritingTask(result.taskId)
            } else if taskKind == .outline {
                body = [
                    "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                    "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                    "targetWords": targetWords,
                ]
                let result = try await AdminAPI.aiStartWriting(kind: "write_outline", body: body)
                pollWritingTask(result.taskId)
            } else {
                body = [
                    "novelId": novelId,
                    "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                    "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                    "outline": outline.trimmingCharacters(in: .whitespacesAndNewlines),
                    "context": context.trimmingCharacters(in: .whitespacesAndNewlines),
                    "targetWords": targetWords,
                ]
                let result = try await AdminAPI.aiStartWriting(kind: "write_chapter", body: body)
                pollWritingTask(result.taskId)
            }
        } catch {
            taskStatusText = nil
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func pollWritingTask(_ id: String) {
        pollTask?.cancel()
        pollTask = Task {
            var attempts = 0
            while !Task.isCancelled, attempts < 200 {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    let status = detail.task.status ?? ""
                    if ["completed", "failed", "cancelled"].contains(status) {
                        taskStatusText = "任务\(AdminFormat.aiTaskStatus(status))，可在「已生成内容」查看草稿。"
                        return
                    }
                    taskStatusText = "生成中（\(AdminFormat.aiTaskStatus(status))）…"
                } catch {
                    taskStatusText = AppCopy.friendlyError(error)
                    return
                }
            }
        }
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
                                .lineLimit(1)
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
            .pageBackground()
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
