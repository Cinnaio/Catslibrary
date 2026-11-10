import SwiftUI
import ZhiZhouCore

/// AI 创作：新写 / 续写，大纲 / 章节后台任务、小说分析参考入口与标题生成。
/// 对齐 Web 端 admin ai AiWritingPanel（/api/ai/writing/*）。
struct AdminAIWritingView: View {
    private let initialNovel: Novel?
    private let initialAfterChapterID: String?
    private let draftContextID: String
    @Environment(AppState.self) private var appState
    @State private var draftOwnerID: String?
    @State private var draftReady = false
    @State private var draftSaveFeedbackID: UUID?
    @State private var restoredSelection: [String: String]?
    @State private var lastSubmittedValues: [String: String]?
    @State private var workflowStep = 0
    @State private var showAdvancedOptions = false
    @State private var showInstructionEditor = false

    init(initialNovel: Novel? = nil, afterChapterID: String? = nil, draftContextID: String? = nil) {
        self.initialNovel = initialNovel
        self.initialAfterChapterID = afterChapterID
        self.draftContextID = draftContextID ?? initialNovel.map { "book:\($0.id)" } ?? "general"
        _novelId = State(initialValue: initialNovel?.id ?? "")
    }
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

    enum ContinuationScope: String, CaseIterable, Identifiable {
        case single = "单章精写"
        case multiple = "多章规划"

        var id: String { rawValue }
    }

    enum AdultContentMode: String, CaseIterable, Identifiable {
        case off
        case explicit

        var id: String { rawValue }
        var title: String {
            switch self {
            case .off: return "关闭"
            case .explicit: return "允许露骨 R18"
            }
        }
    }

    enum IntimacyWeight: String, CaseIterable, Identifiable {
        case none
        case low
        case medium
        case high

        var id: String { rawValue }
        var title: String {
            switch self {
            case .none: return "无"
            case .low: return "低"
            case .medium: return "中"
            case .high: return "高"
            }
        }
    }

    // 选书
    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var novelId = ""
    @State private var showNovelPicker = false
    @State private var chapterOptions: [ChapterMeta] = []
    @State private var chapterLoadFailed = false
    @State private var afterChapterId = ""
    @State private var selectionRequests = ListRequestGuard<String>()

    // 表单
    @State private var mode: Mode = .continueWriting
    @State private var taskKind: TaskKind = .chapter
    @State private var continuationScope: ContinuationScope = .single
    @State private var title = ""
    @State private var continuationTitle = ""
    @State private var instruction = ""
    @State private var outline = ""
    @State private var context = ""
    @State private var targetWords = 2000
    @State private var chapterCount = 1
    @State private var showDetailedBrief = false
    @State private var briefViewpoint = ""
    @State private var briefPace = ""
    @State private var briefObjective = ""
    @State private var briefRequiredFacts = ""
    @State private var briefForbiddenEvents = ""
    @State private var chapterGoalsText = ""
    @State private var pendingChapterCount: Int?
    @State private var showChapterCountWarning = false
    @State private var adultContentMode: AdultContentMode = .off
    @State private var intimacyWeight: IntimacyWeight = .none

    enum ConsentRuleTier: String, CaseIterable, Identifiable {
        case standard = "default"
        case fictionalNonconsent = "fictional_nonconsent"

        var id: String { rawValue }
        var title: String {
            switch self {
            case .standard: return "默认边界"
            case .fictionalNonconsent: return "虚构非自愿情节"
            }
        }
    }

    @State private var consentRuleTier: ConsentRuleTier = .standard

    // 续写辅助：推荐情节与按章大纲请求必须绑定当前小说/起点，避免旧响应回写。
    @State private var suggestionFocus = ""
    @State private var suggestions: [AiPlotSuggestion] = []
    @State private var suggestionBusy = false
    @State private var suggestionError: String?
    @State private var suggestionFillBackup: String?
    @State private var suggestionFilledValue: String?
    @State private var pendingSuggestion: AiPlotSuggestion?
    @State private var suggestionRequestToken = UUID()
    @State private var outlineBusy = false
    @State private var outlineError: String?
    @State private var outlineStatusText: String?
    @State private var outlineRequestToken = UUID()
    @State private var pendingGeneratedOutline = ""
    @State private var showOutlineOverwriteWarning = false
    @State private var showLargeTaskWarning = false
    @State private var pendingContinuationScope: ContinuationScope?

    // 任务
    @State private var starting = false
    @State private var taskStatusText: String?
    @State private var activeTask: AiTaskInfo?
    @State private var pollTask: Task<Void, Never>?
    @State private var isResumingWritingTask = false
    @State private var pollingPaused = false
    @State private var writingPollingToken = UUID()
    @State private var showingTaskResults = false
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    // 通用
    @State private var isLoading = true
    @State private var actionError: String?

    private var canStart: Bool {
        guard !starting, !selectionRequests.isLoading, activeTask?.isRunning != true else { return false }
        guard contentPreferencesValidationError == nil else { return false }
        if mode == .new {
            if taskKind == .outline {
                return !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            return !novelId.isEmpty && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return !novelId.isEmpty && !chapterLoadFailed && !chapterOptions.isEmpty
    }

    var body: some View {
        contentPreferenceObservers
    }

    // Each opaque view is a type-checking boundary. Keep modifier order while
    // avoiding one expression containing every sheet, alert and state observer.
    private var writingContent: some View {
        List {
            if isLoading {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else {
                workflowSections
                taskProgressSection
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("AI 创作")
        .navigationBarTitleDisplayMode(.large)
    }

    private var inputDraftContent: some View {
        writingContent
        .task {
            await initialLoad()
            await resumeWritingTask()
        }
        .onChange(of: inputDraftValues) { _, _ in saveInputDraft() }
        .task(id: draftSaveFeedbackID) {
            guard let feedbackID = draftSaveFeedbackID else { return }
            do { try await Task.sleep(nanoseconds: 2_000_000_000) }
            catch { return }
            if draftSaveFeedbackID == feedbackID { draftSaveFeedbackID = nil }
        }
        .sheet(isPresented: $showInstructionEditor) {
            NavigationStack {
                TextEditor(text: $instruction)
                    .font(.body).padding()
                    .accessibilityIdentifier("admin.writing.instructionEditor")
                    .navigationTitle("创作要求")
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { showInstructionEditor = false }
                    } }
            }
        }
    }

    private var selectionAlertContent: some View {
        inputDraftContent
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
        .alert("减少续写章数？", isPresented: $showChapterCountWarning) {
            Button("保留并减少", role: .destructive) {
                if let pendingChapterCount {
                    chapterCount = pendingChapterCount
                    let lines = chapterGoalsText.components(separatedBy: .newlines)
                    chapterGoalsText = lines.prefix(pendingChapterCount).joined(separator: "\n")
                }
                if let pendingContinuationScope {
                    continuationScope = pendingContinuationScope
                }
                self.pendingChapterCount = nil
                self.pendingContinuationScope = nil
            }
            Button("取消", role: .cancel) {
                pendingChapterCount = nil
                pendingContinuationScope = nil
            }
        } message: {
            Text(droppedChapterGoalsMessage)
        }
    }

    private var writingConfirmationContent: some View {
        selectionAlertContent
        .confirmationDialog(
            "确认启动多章续写？",
            isPresented: $showLargeTaskWarning,
            titleVisibility: .visible
        ) {
            Button("继续生成 \(chapterCount) 章", role: .destructive) {
                Task { await startTask(confirmedLargeTask: true) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将连续调用 AI 生成 \(chapterCount) 章。已经完成的草稿会保留，未开始的章节可以稍后重新生成。")
        }
        .confirmationDialog(
            "使用推荐情节",
            isPresented: Binding(
                get: { pendingSuggestion != nil },
                set: { if !$0 { pendingSuggestion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("替换当前要求") {
                guard let suggestion = pendingSuggestion else { return }
                pendingSuggestion = nil
                applySuggestion(suggestion, replacing: true)
            }
            Button("追加到当前要求") {
                guard let suggestion = pendingSuggestion else { return }
                pendingSuggestion = nil
                applySuggestion(suggestion, replacing: false)
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("当前已经填写了续写要求。请选择替换，或把推荐内容追加到末尾。")
        }
        .alert("覆盖现有大纲？", isPresented: $showOutlineOverwriteWarning) {
            Button("生成并覆盖", role: .destructive) {
                applyPendingGeneratedOutline()
            }
            Button("取消", role: .cancel) {
                pendingGeneratedOutline = ""
            }
        } message: {
            Text("当前大纲中已有内容，生成新的大纲会替换它。")
        }
    }

    private var presentedContent: some View {
        writingConfirmationContent
        .sheet(isPresented: $showingTaskResults) {
            NavigationStack {
                AdminAIGenerationsView(taskID: activeTask?.id)
            }
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            guard operation.action == .terminateAITask,
                  let taskID = operation.targetIDs.first else { return }
            Task { await cancelWritingTask(taskID: taskID, operationID: operation.operationID) }
        }
    }

    private var lifecycleContent: some View {
        presentedContent
        .onDisappear {
            saveInputDraft()
            pollTask?.cancel()
            pollTask = nil
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshAfterBecomingActive() }
            } else if phase == .background {
                saveInputDraft()
                // `.inactive` 只是切换过程中的短暂状态，不能在这里提前
                // 丢掉恢复上下文；真正进入后台后只暂停前台轮询。
                pollTask?.cancel()
                pollTask = nil
                writingPollingToken = UUID()
            }
        }
    }

    private var selectionObservers: some View {
        lifecycleContent
        .onChange(of: afterChapterId) { _, _ in
            guard restoredSelection != selectionSnapshot else { return }
            guard mode == .continueWriting, !novelId.isEmpty else { return }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: continuationScope) { _, value in
            guard restoredSelection != selectionSnapshot else { return }
            if value == .single, chapterCount > 1 {
                let hasExtraGoals = chapterGoalsText
                    .components(separatedBy: .newlines)
                    .enumerated()
                    .contains { index, line in
                        index >= 1 && !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    }
                if hasExtraGoals {
                    pendingContinuationScope = .single
                    continuationScope = .multiple
                    pendingChapterCount = 1
                    showChapterCountWarning = true
                } else {
                    chapterCount = 1
                }
            } else if value == .multiple, chapterCount < 2 {
                chapterCount = 2
            }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: mode) { _, _ in
            guard restoredSelection != selectionSnapshot else { return }
            resetContinuationAssistState(clearOutline: true)
        }
    }

    private var contentPreferenceObservers: some View {
        selectionObservers
        .onChange(of: adultContentMode) { _, value in
            guard restoredSelection != selectionSnapshot else { return }
            if value == .off {
                intimacyWeight = .none
                consentRuleTier = .standard
            }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: intimacyWeight) { _, _ in
            guard restoredSelection != selectionSnapshot else { return }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: consentRuleTier) { _, _ in
            guard restoredSelection != selectionSnapshot else { return }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: suggestionFocus) { _, _ in
            guard restoredSelection != selectionSnapshot else { return }
            resetContinuationAssistState()
        }
    }

    @ViewBuilder
    private var workflowSections: some View {
        Section {
            Picker("创作步骤", selection: $workflowStep) {
                Text("1 作品").tag(0)
                Text("2 要求").tag(1)
                Text("3 生成").tag(2)
            }
            .accessibleSegmentedPicker()
            .accessibilityIdentifier("admin.writing.steps")
        }
        if workflowStep == 0 {
            modeSection
            novelSection
            Section {
                Button("下一步：填写要求", systemImage: "arrow.right") { workflowStep = 1 }
                    .accessibilityIdentifier("admin.writing.next")
            } footer: {
                draftAutosaveFooter
            }
        } else if workflowStep == 1 {
            if mode == .continueWriting { continueSection } else { newSection }
            Section {
                Button(showAdvancedOptions ? "收起高级创作选项" : "高级创作选项", systemImage: "slider.horizontal.3") {
                    showAdvancedOptions.toggle()
                }
            }
            if showAdvancedOptions {
                contentPreferencesSection
                analysisReferenceSection
                if mode == .continueWriting { continuationAssistSection }
            }
            Section {
                Button("下一步：检查并生成", systemImage: "arrow.right") { workflowStep = 2 }
                    .accessibilityIdentifier("admin.writing.review")
                    .disabled(!canStart)
            } footer: {
                draftAutosaveFooter
            }
        } else {
            Section("本次创作") {
                LabeledContent("作品", value: selectedNovel?.title ?? title)
                LabeledContent("类型", value: mode == .continueWriting ? "续写" : taskKind.rawValue)
                LabeledContent("目标字数", value: String(targetWords))
                if !instruction.isEmpty { Text(instruction).font(.subheadline).textSelection(.enabled) }
                Button("返回修改要求") { workflowStep = 1 }
            }
            launchSection
        }
    }

    private var selectionSnapshot: [String: String] {
        ["novelId": novelId, "mode": mode.rawValue, "anchor": afterChapterId,
         "scope": continuationScope.rawValue, "adult": adultContentMode.rawValue,
         "intimacy": intimacyWeight.rawValue, "consent": consentRuleTier.rawValue, "focus": suggestionFocus]
    }

    @ViewBuilder
    private var draftAutosaveFooter: some View {
        if draftReady {
            VStack(alignment: .leading, spacing: 4) {
                Text(draftSaveFeedbackID == nil ? "创作输入自动保存到本机" : "已自动保存到本机")
                Text("按账号与作品分别保留")
            }
        }
    }

    private var inputDraftValues: [String: String] {
        ["novelId": novelId, "novelTitle": selectedNovel?.title ?? initialNovel?.title ?? "",
         "mode": mode.rawValue, "taskKind": taskKind.rawValue, "scope": continuationScope.rawValue,
         "title": title, "continuationTitle": continuationTitle, "instruction": instruction,
         "outline": outline, "context": context, "targetWords": String(targetWords),
         "chapterCount": String(chapterCount), "anchor": afterChapterId,
         "adult": adultContentMode.rawValue, "intimacy": intimacyWeight.rawValue,
         "consent": consentRuleTier.rawValue, "focus": suggestionFocus,
         "viewpoint": briefViewpoint, "pace": briefPace, "objective": briefObjective,
         "facts": briefRequiredFacts, "forbidden": briefForbiddenEvents, "goals": chapterGoalsText,
         "detailed": String(showDetailedBrief), "step": String(workflowStep)]
    }

    private func saveInputDraft() {
        guard draftReady, let owner = draftOwnerID, appState.user?.id == owner,
              appState.user?.isAdmin == true else { return }
        let store = AdminWorkspaceLocalStore()
        let values = inputDraftValues
        guard values != lastSubmittedValues else {
            store.removeDraft(contextID: draftContextID, userID: owner)
            draftSaveFeedbackID = nil
            return
        }
        let textKeys = ["title", "continuationTitle", "instruction", "outline", "context", "viewpoint", "pace", "objective", "facts", "forbidden", "goals"]
        guard textKeys.contains(where: { !(values[$0] ?? "").isEmpty }) || targetWords != 2000 || chapterCount != 1 else {
            store.removeDraft(contextID: draftContextID, userID: owner)
            draftSaveFeedbackID = nil
            return
        }
        store.save(AdminWritingDraft(id: draftContextID, values: values,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000)), userID: owner)
        draftSaveFeedbackID = UUID()
    }

    private func restoreInputDraft(_ values: [String: String]) {
        mode = Mode(rawValue: values["mode"] ?? "") ?? .continueWriting
        taskKind = TaskKind(rawValue: values["taskKind"] ?? "") ?? .chapter
        continuationScope = ContinuationScope(rawValue: values["scope"] ?? "") ?? .single
        title = values["title"] ?? ""; continuationTitle = values["continuationTitle"] ?? ""
        instruction = values["instruction"] ?? ""; outline = values["outline"] ?? ""; context = values["context"] ?? ""
        targetWords = min(mode == .new ? 8000 : 30000, max(mode == .new ? 500 : 300, Int(values["targetWords"] ?? "") ?? 2000))
        chapterCount = min(20, max(1, Int(values["chapterCount"] ?? "") ?? 1))
        adultContentMode = AdultContentMode(rawValue: values["adult"] ?? "") ?? .off
        intimacyWeight = IntimacyWeight(rawValue: values["intimacy"] ?? "") ?? .none
        consentRuleTier = ConsentRuleTier(rawValue: values["consent"] ?? "") ?? .standard
        if adultContentMode == .off { intimacyWeight = .none; consentRuleTier = .standard }
        suggestionFocus = values["focus"] ?? ""
        briefViewpoint = values["viewpoint"] ?? ""; briefPace = values["pace"] ?? ""
        briefObjective = values["objective"] ?? ""; briefRequiredFacts = values["facts"] ?? ""
        briefForbiddenEvents = values["forbidden"] ?? ""; chapterGoalsText = values["goals"] ?? ""
        showDetailedBrief = values["detailed"] == "true"
        workflowStep = min(2, max(0, Int(values["step"] ?? "") ?? 1))
        restoredSelection = selectionSnapshot
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
                    if draftContextID == "general" {
                        Button("换一本") { showNovelPicker = true }
                            .font(.subheadline)
                    }
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
            detailedBriefSection
            Button("展开编辑创作要求", systemImage: "arrow.up.left.and.arrow.down.right") { showInstructionEditor = true }
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
                .accessibilityIdentifier("admin.writing.anchor")
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
            TextField("本次章节标题（可选）", text: $continuationTitle)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("续写要求（可选）", text: $instruction, axis: .vertical)
                .lineLimit(2...4)
                .accessibilityIdentifier("admin.writing.instruction")
            Button("展开编辑创作要求", systemImage: "arrow.up.left.and.arrow.down.right") { showInstructionEditor = true }
            Picker("写作范围", selection: $continuationScope) {
                ForEach(ContinuationScope.allCases) { scope in
                    Text(scope.rawValue).tag(scope)
                }
            }
            .accessibleSegmentedPicker()
            detailedBriefSection
            if continuationScope == .multiple {
                Stepper("续写章数：\(chapterCount)", value: chapterCountBinding, in: 2...20)
            } else {
                Text("本次生成 1 章")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Stepper("目标字数：\(targetWords)", value: $targetWords, in: 300...30000, step: 500)
        }
    }

    @ViewBuilder
    private var contentPreferencesSection: some View {
        if mode == .continueWriting || taskKind == .chapter {
            Section {
                Picker("成人内容模式", selection: $adultContentMode) {
                    ForEach(AdultContentMode.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                if adultContentMode == .explicit {
                    Picker("亲密内容权重", selection: $intimacyWeight) {
                        ForEach(IntimacyWeight.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    Picker("同意规则", selection: $consentRuleTier) {
                        ForEach(ConsentRuleTier.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    LabeledContent("成年人确认", value: "adultCharactersConfirmed: true")
                    if let error = contentPreferencesValidationError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(AppTheme.warning)
                    }
                }
            } header: {
                Text("成人内容参数")
            } footer: {
                Text(adultContentMode == .explicit
                    ? "权重表示亲密内容在剧情中的叙事强调程度，不是固定字数百分比；即使开启，上游模型仍可能依据其内容政策拒绝请求。"
                    : "默认不主动加入成人露骨内容。该参数只作用于本次创作任务。")
            }
        }
    }

    @ViewBuilder
    private var detailedBriefSection: some View {
        DisclosureGroup("更多创作要求", isExpanded: $showDetailedBrief) {
            TextField("叙事视角（最多 200 字）", text: $briefViewpoint, axis: .vertical)
                .lineLimit(1...3)
            TextField("节奏（最多 200 字）", text: $briefPace, axis: .vertical)
                .lineLimit(1...3)
            TextField("本章目标（最多 1000 字）", text: $briefObjective, axis: .vertical)
                .lineLimit(2...5)
            TextField("必须保留的事实（可选）", text: $briefRequiredFacts, axis: .vertical)
                .lineLimit(2...5)
            TextField("禁止发生的事件（可选）", text: $briefForbiddenEvents, axis: .vertical)
                .lineLimit(2...5)
            if mode == .continueWriting {
                TextField("分章目标：每行对应一章，从第 1 章开始", text: $chapterGoalsText, axis: .vertical)
                    .lineLimit(3...8)
            }
            if let error = writingBriefValidationError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
            } else if let preview = writingBriefPreview {
                Text(preview)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .font(.subheadline)
    }

    private var analysisReferenceSection: some View {
        Section("小说分析参考") {
            Text("生成时自动选取当前起点以内、正文未变化的各主题最新完整报告；没有可用报告时直接依据正文创作。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            if let analysisURL {
                Link("阅读与修订分析报告", destination: analysisURL)
            }
        } footer: {
            Text("报告可能包含推断，应结合原文核对。需要手动选择或取消参考时，可在网页创作工作区调整。")
        }
    }

    private var analysisURL: URL? {
        guard !novelId.isEmpty, let base = ServerConfig.shared.baseURL else { return nil }
        var components = URLComponents(url: base.appendingPathComponent("admin/ai"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "sub", value: "writing"), URLQueryItem(name: "view", value: "analysis"),
                                 URLQueryItem(name: "novel", value: novelId)]
        if !afterChapterId.isEmpty {
            components?.queryItems?.append(URLQueryItem(name: "afterChapterId", value: afterChapterId))
        }
        return components?.url
    }

    private var continuationAssistSection: some View {
        Section {
            TextField("创作重点（可选，例如：强化冲突、推进感情线）", text: $suggestionFocus, axis: .vertical)
                .lineLimit(1...3)

            Button {
                Task { await loadPlotSuggestions() }
            } label: {
                HStack {
                    Label("推荐情节", systemImage: "wand.and.stars")
                    Spacer()
                    if suggestionBusy {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
            .disabled(!canUseContinuationAssist || suggestionBusy || outlineBusy)

            if let suggestionError {
                Text(suggestionError)
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
            }

            if !suggestions.isEmpty {
                ForEach(suggestions) { suggestion in
                    Button {
                        chooseSuggestion(suggestion)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(suggestion.direction)
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(suggestion.effect)
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("选择后填入续写要求")
                }
                if suggestionFillBackup != nil {
                    Button("撤销上次填入") {
                        guard instruction == suggestionFilledValue else { return }
                        instruction = suggestionFillBackup ?? ""
                        suggestionFillBackup = nil
                        suggestionFilledValue = nil
                    }
                    .font(.caption)
                    .disabled(suggestionFilledValue != instruction)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("续写大纲")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    Button {
                        Task { await generateContinuationOutline() }
                    } label: {
                        if outlineBusy {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text(outline.isEmpty
                                ? (continuationScope == .multiple ? "按情节推荐生成大纲（多章）" : "按情节推荐生成大纲（单章）")
                                : "重新生成")
                        }
                    }
                    .font(.caption.weight(.medium))
                    .disabled(!canUseContinuationAssist || suggestionBusy || outlineBusy)
                }
                TextField(
                    continuationScope == .multiple
                        ? "每章一行、以「第N章」开头；可手动编辑生成结果"
                        : "可留空，也可补充本章提纲；生成后仍可手动编辑",
                    text: $outline,
                    axis: .vertical
                )
                    .lineLimit(4...12)
                if let outlineStatusText {
                    Text(outlineStatusText)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                if let outlineError {
                    Text(outlineError)
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                }
            }
            .padding(.top, 6)
        } header: {
            Text("本次情节与大纲")
        } footer: {
            Text(continuationScope == .multiple
                ? "选定的推荐情节会作为大纲主线，按章节展开；生成后仍可手动修改。"
                : "选定的推荐情节会作为本章大纲方向；生成后仍可手动修改。")
        }
    }

    private var launchSection: some View {
        Section {
            if mode == .continueWriting {
                LabeledContent("小说", value: selectedNovel?.title ?? "未选择")
                LabeledContent("续写起点", value: selectedAnchorTitle)
                LabeledContent("写作范围", value: continuationScope == .multiple ? "多章规划，共 \(chapterCount) 章" : "单章精写")
                LabeledContent("目标字数", value: "每章约 \(targetWords) 字")
                LabeledContent("R18", value: adultContentMode == .explicit ? "开启" : "关闭")
            }
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
            Text("生成回执")
        } footer: {
            VStack(alignment: .leading, spacing: 8) {
                Text("任务完成后，草稿会出现在「已生成内容」中，可编辑后发布为正式章节。")
                draftAutosaveFooter
            }
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
                if activeTask.isRunning {
                    Button("取消任务", role: .destructive) {
                        requestCancelWritingTask(activeTask)
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

    private var canUseContinuationAssist: Bool {
        mode == .continueWriting
            && !novelId.isEmpty
            && !chapterLoadFailed
            && !chapterOptions.isEmpty
            && !selectionRequests.isLoading
            && contentPreferencesValidationError == nil
    }

    private var selectedAnchorTitle: String {
        guard !afterChapterId.isEmpty else { return "最新章节之后" }
        return chapterOptions.first { $0.id == afterChapterId }?.title ?? "指定章节之后"
    }

    // MARK: - 数据

    private func initialLoad() async {
        isLoading = true
        defer { isLoading = false }
        guard let owner = appState.user?.id, appState.user?.isAdmin == true, let token = APIClient.shared.token else { return }
        draftOwnerID = owner
        draftReady = false
        let saved = AdminWorkspaceLocalStore().draft(contextID: draftContextID, userID: owner)
        do {
            let index: NovelIndexResponse = try await AdminAPI.parityRequest("GET", "/api/admin/novel-index?limit=200", token: token)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            novelOptions = index.novels
        } catch {
            if APIClient.shared.token == token { actionError = AppCopy.friendlyError(error) }
        }
        guard !Task.isCancelled, APIClient.shared.token == token, appState.user?.id == owner else { return }
        let selectedID = initialNovel?.id ?? saved?.values["novelId"] ?? ""
        if let novel = initialNovel, !novelOptions.contains(where: { $0.id == novel.id }) {
            novelOptions.insert(AdminNovelSummary(id: novel.id, title: novel.title, author: novel.author,
                chapterCount: novel.chapterCount, updatedAt: novel.updatedAt), at: 0)
        } else if !selectedID.isEmpty, !novelOptions.contains(where: { $0.id == selectedID }) {
            do {
                let response: NovelResponse = try await AdminAPI.parityRequest("GET", "/api/novels/\(ReaderMediaAPI.pathSegment(selectedID))", token: token)
                guard !Task.isCancelled, APIClient.shared.token == token else { return }
                let novel = response.novel
                novelOptions.insert(AdminNovelSummary(id: novel.id, title: novel.title, author: novel.author,
                    chapterCount: novel.chapterCount, updatedAt: novel.updatedAt), at: 0)
            } catch { if APIClient.shared.token == token { actionError = AppCopy.friendlyError(error) } }
        }
        if let saved { restoreInputDraft(saved.values) }
        novelId = selectedID
        if !selectedID.isEmpty {
            await onNovelSelected(selectedID, resetInput: false)
            guard !Task.isCancelled, APIClient.shared.token == token, appState.user?.id == owner else { return }
            let anchor = initialAfterChapterID ?? saved?.values["anchor"] ?? ""
            if anchor.isEmpty || chapterOptions.contains(where: { $0.id == anchor }) {
                afterChapterId = anchor
            }
            guard !Task.isCancelled, APIClient.shared.token == token, appState.user?.id == owner else { return }
        }
        if let saved { restoreInputDraft(saved.values) }
        else if initialNovel != nil { workflowStep = 1 }
        restoredSelection = selectionSnapshot
        draftReady = true
    }

    private func onNovelSelected(_ id: String, resetInput: Bool = true) async {
        guard id == novelId else { return }
        resetContinuationAssistState(clearOutline: resetInput)
        if resetInput && mode == .continueWriting {
            continuationTitle = ""
            instruction = ""
            suggestionFocus = ""
            chapterGoalsText = ""
            showDetailedBrief = false
        }
        let ticket = selectionRequests.begin(id)
        chapterOptions = []
        chapterLoadFailed = false
        afterChapterId = ""
        defer { selectionRequests.finish(ticket) }
        let chaptersResult = try? await AdminAPI.chapters(novelId: id)
        guard !Task.isCancelled, selectionRequests.accepts(ticket, query: novelId) else { return }
        chapterOptions = chaptersResult ?? []
        chapterLoadFailed = chaptersResult == nil
    }

    private func resetContinuationAssistState(clearOutline: Bool = false) {
        suggestionRequestToken = UUID()
        outlineRequestToken = UUID()
        suggestionBusy = false
        outlineBusy = false
        suggestionError = nil
        outlineError = nil
        outlineStatusText = nil
        suggestions = []
        suggestionFillBackup = nil
        suggestionFilledValue = nil
        pendingSuggestion = nil
        pendingGeneratedOutline = ""
        showOutlineOverwriteWarning = false
        if clearOutline {
            outline = ""
        }
    }

    private func chooseSuggestion(_ suggestion: AiPlotSuggestion) {
        let current = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        if current.isEmpty {
            applySuggestion(suggestion, replacing: true)
        } else {
            pendingSuggestion = suggestion
        }
    }

    private func applySuggestion(_ suggestion: AiPlotSuggestion, replacing: Bool) {
        suggestionFillBackup = instruction
        if replacing {
            instruction = suggestion.direction
        } else {
            let current = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
            instruction = current.isEmpty ? suggestion.direction : "\(current)\n\n\(suggestion.direction)"
        }
        suggestionFilledValue = instruction
    }

    private func loadPlotSuggestions() async {
        guard canUseContinuationAssist else { return }
        let selectedNovelID = novelId
        let selectedAnchorID = afterChapterId
        let token = UUID()
        suggestionRequestToken = token
        suggestionBusy = true
        suggestionError = nil
        do {
            let result = try await AdminAPI.aiPlotSuggestions(
                novelId: selectedNovelID,
                afterChapterId: selectedAnchorID.isEmpty ? nil : selectedAnchorID,
                focus: suggestionFocus,
                contentPreferences: writingContentPreferencesPayload
            )
            guard !Task.isCancelled,
                  suggestionRequestToken == token,
                  selectedNovelID == novelId,
                  selectedAnchorID == afterChapterId
            else { return }
            suggestionBusy = false
            suggestions = result.suggestions
            if result.suggestions.isEmpty {
                suggestionError = "暂时没有生成可用的情节方向，请调整创作重点后重试。"
            }
        } catch {
            guard !Task.isCancelled,
                  suggestionRequestToken == token,
                  selectedNovelID == novelId,
                  selectedAnchorID == afterChapterId
            else { return }
            suggestionBusy = false
            suggestionError = AppCopy.friendlyError(error)
        }
    }

    private func generateContinuationOutline() async {
        guard canUseContinuationAssist else { return }
        let selectedNovelID = novelId
        let selectedAnchorID = afterChapterId
        let selectedPlotDirection = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = UUID()
        outlineRequestToken = token
        outlineBusy = true
        outlineError = nil
        outlineStatusText = nil
        defer {
            if outlineRequestToken == token {
                outlineBusy = false
            }
        }
        do {
            let result = try await AdminAPI.aiPlotSuggestions(
                novelId: selectedNovelID,
                afterChapterId: selectedAnchorID.isEmpty ? nil : selectedAnchorID,
                focus: suggestionFocus,
                chapterCount: chapterCount,
                contentPreferences: writingContentPreferencesPayload,
                plotDirection: selectedPlotDirection
            )
            guard !Task.isCancelled,
                  outlineRequestToken == token,
                  selectedNovelID == novelId,
                  selectedAnchorID == afterChapterId
            else { return }
            guard let generated = result.outline?.trimmingCharacters(in: .whitespacesAndNewlines), !generated.isEmpty else {
                outlineError = "服务端没有返回可用的大纲，请稍后重试。"
                return
            }
            if outline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                outline = generated
                outlineStatusText = "已生成 \(chapterCount) 章大纲，可继续编辑。"
            } else {
                pendingGeneratedOutline = generated
                showOutlineOverwriteWarning = true
            }
        } catch {
            guard !Task.isCancelled,
                  outlineRequestToken == token,
                  selectedNovelID == novelId,
                  selectedAnchorID == afterChapterId
            else { return }
            outlineError = AppCopy.friendlyError(error)
        }
    }

    private func applyPendingGeneratedOutline() {
        guard !pendingGeneratedOutline.isEmpty else { return }
        outline = pendingGeneratedOutline
        outlineStatusText = "已生成 \(chapterCount) 章大纲，可继续编辑。"
        pendingGeneratedOutline = ""
        outlineError = nil
    }

    private func refreshAfterBecomingActive() async {
        await resumeWritingTask()
    }

    private func resumeWritingTask() async {
        guard pollTask == nil, !isResumingWritingTask else { return }
        isResumingWritingTask = true
        defer { isResumingWritingTask = false }
        do {
            guard let task = try await AdminAITaskCoordinator.shared.resume(
                key: AdminAITaskCoordinator.OperationKey.writing,
                recoveryAttempts: 5
            ) else { return }
            if !novelId.isEmpty, let taskNovelID = task.novelId, taskNovelID != novelId {
                if task.isRunning {
                    activeTask = task
                    taskStatusText = "另一本书有创作任务正在处理，可先查看任务结果。"
                    pollWritingTask(task.id)
                }
                return
            }
            activeTask = task
            starting = false
            if let taskNovelID = task.novelId, !taskNovelID.isEmpty {
                if taskNovelID != novelId {
                    novelId = taskNovelID
                    await onNovelSelected(taskNovelID, resetInput: false)
                }
            }
            if task.isRunning {
                taskStatusText = "已恢复正在处理的创作任务"
                pollWritingTask(task.id)
            } else {
                taskStatusText = "任务\(AdminFormat.aiTaskStatus(task.status ?? ""))，可在「已生成内容」查看草稿。"
            }
        } catch {
            guard !Task.isCancelled else { return }
            if isTransientTaskError(error) {
                taskStatusText = "创作任务暂时无法查询，回到前台后会自动重试"
                return
            }
            taskStatusText = "创作任务暂时无法查询，请稍后重试"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func startTask(confirmedLargeTask: Bool = false) async {
        guard canStart else { return }
        if let writingBriefValidationError {
            actionError = writingBriefValidationError
            showDetailedBrief = true
            return
        }
        if mode == .continueWriting, continuationScope == .multiple, chapterCount > 5, !confirmedLargeTask {
            showLargeTaskWarning = true
            return
        }
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
            let requestedChapterCount = continuationScope == .single ? 1 : min(20, max(2, chapterCount))
            body = [
                "novelId": novelId,
                "title": continuationTitle.trimmingCharacters(in: .whitespacesAndNewlines),
                "instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines),
                "chapterCount": requestedChapterCount,
                "targetWords": targetWords,
            ]
            if !afterChapterId.isEmpty { body["afterChapterId"] = afterChapterId }
            let trimmedOutline = outline.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedOutline.isEmpty { body["outline"] = trimmedOutline }
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
        if let writingBriefPayload {
            body["writingBrief"] = writingBriefPayload
        }
        body["contentPreferences"] = writingContentPreferencesPayload

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
            lastSubmittedValues = inputDraftValues
            saveInputDraft()
            activeTask = task
            if task.isRunning {
                taskStatusText = launch.reusedExistingOperation ? "已恢复正在处理的创作任务" : nil
                pollWritingTask(task.id)
            } else {
                taskStatusText = "任务\(AdminFormat.aiTaskStatus(task.status ?? ""))，可在「已生成内容」查看草稿。"
            }
        } catch {
            guard !Task.isCancelled else { return }
            if isTransientTaskError(error) {
                taskStatusText = "请求暂时中断，回到前台后会自动确认任务"
                return
            }
            taskStatusText = "请求中断时会按稳定请求 ID 自动恢复"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func requestCancelWritingTask(_ task: AiTaskInfo) {
        guard task.isRunning else { return }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .terminateAITask,
            kind: .terminate,
            targetIDs: [task.id],
            title: "取消续写任务",
            message: "已经完成的草稿会保留，未开始的章节不会继续生成。取消后可以在「已生成内容」中查看已有草稿。",
            confirmLabel: "确认取消任务"
        )
    }

    private func cancelWritingTask(taskID: String, operationID: String) async {
        guard activeTask?.id == taskID else { return }
        do {
            try await AdminAPI.cancelAiTask(id: taskID, operationID: operationID)
            pollTask?.cancel()
            pollTask = nil
            AdminAITaskCoordinator.shared.finish(taskID: taskID)
            if let latest = try? await AdminAPI.aiTask(id: taskID).task {
                activeTask = latest
            }
            taskStatusText = "任务已取消，已经完成的草稿仍可在「已生成内容」查看。"
        } catch {
            guard !Task.isCancelled else { return }
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

    private var chapterCountBinding: Binding<Int> {
        Binding(
            get: { chapterCount },
            set: { requestChapterCountChange($0) }
        )
    }

    private var parsedChapterGoals: [AiWritingBriefGoal] {
        chapterGoalsText
            .components(separatedBy: .newlines)
            .enumerated()
            .compactMap { index, value in
                let goal = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return goal.isEmpty ? nil : AiWritingBriefGoal(index: index + 1, goal: goal)
            }
    }

    private var writingBriefPayload: [String: Any]? {
        let values = [briefViewpoint, briefPace, briefObjective, briefRequiredFacts, briefForbiddenEvents]
        guard values.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) || !parsedChapterGoals.isEmpty else { return nil }
        let brief = AiWritingBrief(
            viewpoint: briefViewpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            pace: briefPace.trimmingCharacters(in: .whitespacesAndNewlines),
            objective: briefObjective.trimmingCharacters(in: .whitespacesAndNewlines),
            requiredFacts: briefRequiredFacts.trimmingCharacters(in: .whitespacesAndNewlines),
            forbiddenEvents: briefForbiddenEvents.trimmingCharacters(in: .whitespacesAndNewlines),
            chapterGoals: parsedChapterGoals
        )
        guard let data = try? JSONEncoder().encode(brief),
              let object = try? JSONSerialization.jsonObject(with: data),
              let payload = object as? [String: Any] else { return nil }
        return payload
    }

    private var writingContentPreferencesPayload: [String: Any] {
        [
            "version": 1,
            "adultContentMode": adultContentMode.rawValue,
            "intimacyWeight": adultContentMode == .explicit ? intimacyWeight.rawValue : IntimacyWeight.none.rawValue,
            "adultCharactersConfirmed": adultContentMode == .explicit,
            "consentRuleTier": adultContentMode == .explicit ? consentRuleTier.rawValue : ConsentRuleTier.standard.rawValue,
        ]
    }

    private var contentPreferencesValidationError: String? {
        guard adultContentMode == .explicit else { return nil }
        if intimacyWeight == .none { return "开启露骨 R18 后请选择亲密内容权重" }
        return nil
    }

    private var writingBriefValidationError: String? {
        let values: [(String, String, Int)] = [
            ("叙事视角", briefViewpoint, 200),
            ("节奏", briefPace, 200),
            ("本章目标", briefObjective, 1000),
            ("必须保留的事实", briefRequiredFacts, 3000),
            ("禁止发生的事件", briefForbiddenEvents, 3000),
        ]
        for (label, value, limit) in values where value.unicodeScalars.count > limit {
            return "\(label)超过 \(limit) 个 Unicode 标量"
        }
        for goal in parsedChapterGoals where goal.goal.unicodeScalars.count > 1000 {
            return "第 \(goal.index) 章目标超过 1000 个 Unicode 标量"
        }
        let total = values.reduce(0) { $0 + $1.1.unicodeScalars.count } + parsedChapterGoals.reduce(0) { $0 + $1.goal.unicodeScalars.count }
        if total > 12_000 { return "结构化要求总长度超过 12000 个 Unicode 标量" }
        if parsedChapterGoals.contains(where: { $0.index > chapterCount }) {
            return "分章目标不能超过本次续写章数"
        }
        return nil
    }

    private var writingBriefPreview: String? {
        let parts = [
            briefViewpoint.isEmpty ? nil : "视角：\(briefViewpoint)",
            briefPace.isEmpty ? nil : "节奏：\(briefPace)",
            briefObjective.isEmpty ? nil : "目标：\(briefObjective)",
            parsedChapterGoals.isEmpty ? nil : "已填写 \(parsedChapterGoals.count) 个分章目标",
        ].compactMap { $0 }
        return parts.isEmpty ? nil : "提交预览 · " + parts.joined(separator: "；")
    }

    private var droppedChapterGoalsMessage: String {
        guard let pendingChapterCount else { return "" }
        let dropped = chapterGoalsText
            .components(separatedBy: .newlines)
            .enumerated()
            .filter { index, value in index + 1 > pendingChapterCount && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map { "第 \($0.offset + 1) 章" }
        return dropped.isEmpty ? "减少章数后不会删除已填写目标。" : "以下目标将被删除：\(dropped.joined(separator: "、"))。是否继续？"
    }

    private func requestChapterCountChange(_ value: Int) {
        let next = min(20, max(1, value))
        guard next != chapterCount else { return }
        if next < chapterCount,
           chapterGoalsText.components(separatedBy: .newlines).enumerated().contains(where: { $0.offset + 1 > next && !$0.element.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            pendingChapterCount = next
            showChapterCountWarning = true
            return
        }
        chapterCount = next
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
            .appListStyle(.settings)
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
