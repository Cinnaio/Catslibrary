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
    @State private var profileRequests = ListRequestGuard<String>()

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
    @State private var adultCharactersConfirmed = false

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

    // 画像
    @State private var styleProfile = ""
    @State private var styleEligibility = ""
    @State private var styleEffectiveContent = ""
    @State private var styleManualOverride: AiManualProfileOverride?
    @State private var styleBaseProfileRevision = ""
    @State private var styleUpdatedAt: Int64 = 0
    @State private var plotState = ""
    @State private var plotChaptersThrough = 0
    @State private var plotChapterCount = 0
    @State private var relationshipProfile = ""
    @State private var relationshipEligibility = ""
    @State private var plotEligibility = ""
    @State private var plotEffectiveContent = ""
    @State private var plotManualOverride: AiManualProfileOverride?
    @State private var plotBaseProfileRevision = ""
    @State private var plotUpdatedAt: Int64 = 0
    @State private var relationshipEffectiveContent = ""
    @State private var relationshipManualOverride: AiManualProfileOverride?
    @State private var relationshipBaseProfileRevision = ""
    @State private var relationshipUpdatedAt: Int64 = 0
    @State private var profileBusy = ""
    @State private var profileEditorKind = ""
    @State private var profileEditorText = ""
    @State private var profileEditorRevision = 0
    @State private var profileEditorBaseRevision = ""
    @State private var profileEditorBusy = false
    @State private var showingProfileEditor = false
    @State private var pendingProfileRefreshScope = ""
    @State private var pendingProfileRefreshNovelID = ""
    @State private var pendingProfileRefreshAnchorID = ""
    @State private var pendingProfileRefreshBaseline: Int64 = 0
    @State private var isRecoveringProfileRefresh = false

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
                contentPreferencesSection
                profileSection
                if mode == .continueWriting {
                    continuationAssistSection
                }
                launchSection
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
        .sheet(isPresented: $showingTaskResults) {
            NavigationStack {
                AdminAIGenerationsView(taskID: activeTask?.id)
            }
        }
        .sheet(isPresented: $showingProfileEditor) {
            profileEditorSheet
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            guard operation.action == .terminateAITask,
                  let taskID = operation.targetIDs.first else { return }
            Task { await cancelWritingTask(taskID: taskID, operationID: operation.operationID) }
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshAfterBecomingActive() }
            } else if phase == .background {
                // `.inactive` 只是切换过程中的短暂状态，不能在这里提前
                // 丢掉恢复上下文；真正进入后台后只暂停前台轮询。
                pollTask?.cancel()
                pollTask = nil
                writingPollingToken = UUID()
            }
        }
        .onChange(of: afterChapterId) { _, anchorID in
            guard mode == .continueWriting, !novelId.isEmpty else { return }
            resetContinuationAssistState(clearOutline: true)
            Task { await loadProfileStatuses(novelID: novelId, anchorID: anchorID.isEmpty ? nil : anchorID) }
        }
        .onChange(of: continuationScope) { _, value in
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
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: adultContentMode) { _, value in
            if value == .off {
                intimacyWeight = .none
                adultCharactersConfirmed = false
                consentRuleTier = .standard
            }
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: intimacyWeight) { _, _ in
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: consentRuleTier) { _, _ in
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: adultCharactersConfirmed) { _, _ in
            resetContinuationAssistState(clearOutline: true)
        }
        .onChange(of: suggestionFocus) { _, _ in
            resetContinuationAssistState()
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
            detailedBriefSection
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
            TextField("本次章节标题（可选）", text: $continuationTitle)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("续写要求（可选）", text: $instruction, axis: .vertical)
                .lineLimit(2...4)
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
                    Toggle("确认涉及角色均为成年人", isOn: $adultCharactersConfirmed)
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

    // MARK: - 画像

    private var profileSection: some View {
        Section {
            profileRow(
                label: "风格画像",
                value: styleEffectiveContent.isEmpty ? styleProfile : styleEffectiveContent,
                status: styleEligibility,
                origin: profileOrigin(for: styleManualOverride, effective: styleEffectiveContent),
                busy: profileBusy == "style",
                action: { Task { await refreshProfile("style") } },
                edit: { beginProfileEdit(kind: "style", content: styleEffectiveContent.isEmpty ? styleProfile : styleEffectiveContent, override: styleManualOverride, baseRevision: styleBaseProfileRevision) },
                empty: "未提取 · 提取后续写自动注入"
            )
            profileRow(
                label: "情节状态",
                value: plotEffectiveContent.isEmpty ? plotState : plotEffectiveContent,
                status: plotEligibility,
                origin: profileOrigin(for: plotManualOverride, effective: plotEffectiveContent),
                busy: profileBusy == "plot",
                action: { Task { await refreshProfile("plot") } },
                edit: { beginProfileEdit(kind: "plot", content: plotEffectiveContent.isEmpty ? plotState : plotEffectiveContent, override: plotManualOverride, baseRevision: plotBaseProfileRevision) },
                empty: plotSummary
            )
            profileRow(
                label: "关系画像",
                value: relationshipEffectiveContent.isEmpty ? relationshipProfile : relationshipEffectiveContent,
                status: relationshipEligibility,
                origin: profileOrigin(for: relationshipManualOverride, effective: relationshipEffectiveContent),
                busy: profileBusy == "relationship",
                action: { Task { await refreshProfile("relationship") } },
                edit: { beginProfileEdit(kind: "relationship", content: relationshipEffectiveContent.isEmpty ? relationshipProfile : relationshipEffectiveContent, override: relationshipManualOverride, baseRevision: relationshipBaseProfileRevision) },
                empty: "未提取 · 提取后续写自动注入"
            )
        } header: {
            Text("创作画像")
        } footer: {
            Text("画像会按当前小说与续写起点注入本次任务；可手动校正后再提交。")
        }
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
                ? "推荐情节用于补充创作要求；生成的大纲会按章节拆分后交给后台任务。"
                : "推荐情节可以直接填入续写要求；大纲生成后仍可手动修改。")
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
                if profileInjectionCount > 0 {
                    Text("本次将注入 \(profileInjectionCount) 项小说分析画像")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
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

    private var plotSummary: String {
        if plotChaptersThrough > 0 {
            return "已梳理到第 \(plotChaptersThrough) 章\(plotChapterCount > 0 ? "（全书 \(plotChapterCount) 章）" : "")"
        }
        return "未提取 · 提取后续写自动注入"
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

    private var profileInjectionCount: Int {
        [styleEffectiveContent, plotEffectiveContent, relationshipEffectiveContent]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .count
    }

    private func profileRow(label: String, value: String, status: String = "", origin: String = "", busy: Bool, action: @escaping () -> Void, edit: @escaping () -> Void, empty: String) -> some View {
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
                    HStack(spacing: 10) {
                        Button("提取 / 刷新") { action() }
                            .font(.caption)
                            .buttonStyle(.borderless)
                        Button("人工校正") { edit() }
                            .font(.caption)
                            .buttonStyle(.borderless)
                    }
                }
            }
            if value.isEmpty {
                Text(empty)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        guard !busy else { return }
                        edit()
                    }
            } else {
                Text(value)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        guard !busy else { return }
                        edit()
                    }
            }
            if !status.isEmpty, status != "usable" {
                Text(profileStatusText(status))
                    .font(.caption2)
                    .foregroundStyle(status == "legacy_unknown" || status == "source_changed" || status == "beyond_anchor" ? AppTheme.warning : AppTheme.textSecondary)
            }
            if !origin.isEmpty {
                Text(origin)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
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
        resetContinuationAssistState(clearOutline: true)
        if mode == .continueWriting {
            continuationTitle = ""
            instruction = ""
            suggestionFocus = ""
            chapterGoalsText = ""
            showDetailedBrief = false
        }
        if pendingProfileRefreshNovelID != id {
            clearPendingProfileRefresh()
        }
        let ticket = selectionRequests.begin(id)
        chapterOptions = []
        chapterLoadFailed = false
        afterChapterId = ""
        let profileTicket = profileRequests.begin("\(id)|")
        defer { profileRequests.finish(profileTicket) }
        styleProfile = ""
        styleEligibility = ""
        styleEffectiveContent = ""
        styleManualOverride = nil
        styleBaseProfileRevision = ""
        styleUpdatedAt = 0
        plotState = ""
        plotEligibility = ""
        plotEffectiveContent = ""
        plotManualOverride = nil
        plotBaseProfileRevision = ""
        plotUpdatedAt = 0
        plotChaptersThrough = 0
        plotChapterCount = 0
        relationshipProfile = ""
        relationshipEligibility = ""
        relationshipEffectiveContent = ""
        relationshipManualOverride = nil
        relationshipBaseProfileRevision = ""
        relationshipUpdatedAt = 0
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
            styleEffectiveContent = style?.effectiveContent ?? style?.profile ?? ""
            styleManualOverride = style?.manualOverride
            styleBaseProfileRevision = style?.baseProfileRevision ?? ""
            styleUpdatedAt = style?.updatedAt ?? 0
            plotState = plot?.state ?? ""
            plotEffectiveContent = plot?.effectiveContent ?? plot?.state ?? ""
            plotManualOverride = plot?.manualOverride
            plotBaseProfileRevision = plot?.baseProfileRevision ?? ""
            plotUpdatedAt = plot?.updatedAt ?? 0
            plotChaptersThrough = plot?.chaptersThrough ?? 0
            plotChapterCount = plot?.chapterCount ?? 0
            relationshipProfile = relation?.profile ?? ""
            relationshipEffectiveContent = relation?.effectiveContent ?? relation?.profile ?? ""
            relationshipManualOverride = relation?.manualOverride
            relationshipBaseProfileRevision = relation?.baseProfileRevision ?? ""
            relationshipUpdatedAt = relation?.updatedAt ?? 0
            styleEligibility = style?.eligibility ?? ""
            plotEligibility = plot?.eligibility ?? ""
            relationshipEligibility = relation?.eligibility ?? ""
        }
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
                contentPreferences: writingContentPreferencesPayload
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

    private func loadProfileStatuses(
        novelID: String,
        anchorID: String?,
        minimumUpdatedAt: Int64? = nil,
        minimumUpdatedScope: String? = nil
    ) async {
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
        let styleFloor = minimumUpdatedScope == "style" ? minimumUpdatedAt : nil
        let plotFloor = minimumUpdatedScope == "plot" ? minimumUpdatedAt : nil
        let relationshipFloor = minimumUpdatedScope == "relationship" ? minimumUpdatedAt : nil

        // A failed sibling GET must not turn a successful refresh into an empty
        // row. A response older than the POST result must not roll the row back
        // while the server is still making the new source visible.
        if let style,
           shouldApplyProfileResponse(updatedAt: style.updatedAt, minimumUpdatedAt: styleFloor, currentUpdatedAt: styleUpdatedAt) {
            applyStyleProfile(style)
        }
        if let plot,
           shouldApplyProfileResponse(updatedAt: plot.updatedAt, minimumUpdatedAt: plotFloor, currentUpdatedAt: plotUpdatedAt) {
            applyPlotProfile(plot)
        }
        if let relation,
           shouldApplyProfileResponse(updatedAt: relation.updatedAt, minimumUpdatedAt: relationshipFloor, currentUpdatedAt: relationshipUpdatedAt) {
            applyRelationshipProfile(relation)
        }
    }

    private func shouldApplyProfileResponse(
        updatedAt: Int64?,
        minimumUpdatedAt: Int64?,
        currentUpdatedAt: Int64
    ) -> Bool {
        let responseUpdatedAt = updatedAt ?? 0
        if let minimumUpdatedAt, minimumUpdatedAt > 0, responseUpdatedAt < minimumUpdatedAt {
            return false
        }
        if responseUpdatedAt == 0 {
            return currentUpdatedAt == 0 && (minimumUpdatedAt ?? 0) == 0
        }
        return currentUpdatedAt == 0 || responseUpdatedAt >= currentUpdatedAt
    }

    private func applyStyleProfile(_ profile: AiProfileGetResponse) {
        if let value = profile.profile {
            styleProfile = value
        }
        if let value = profile.effectiveContent {
            styleEffectiveContent = value
        } else if let value = profile.profile {
            styleEffectiveContent = value
        }
        styleManualOverride = profile.manualOverride
        styleBaseProfileRevision = profile.baseProfileRevision ?? ""
        styleUpdatedAt = profile.updatedAt ?? styleUpdatedAt
        styleEligibility = profile.eligibility ?? ""
    }

    private func applyPlotProfile(_ profile: AiPlotStateGetResponse) {
        if let value = profile.state {
            plotState = value
        }
        if let value = profile.effectiveContent {
            plotEffectiveContent = value
        } else if let value = profile.state {
            plotEffectiveContent = value
        }
        plotManualOverride = profile.manualOverride
        plotBaseProfileRevision = profile.baseProfileRevision ?? ""
        plotUpdatedAt = profile.updatedAt ?? plotUpdatedAt
        plotChaptersThrough = profile.source?.chapterOrdinal ?? profile.chaptersThrough ?? plotChaptersThrough
        plotEligibility = profile.eligibility ?? ""
    }

    private func applyRelationshipProfile(_ profile: AiProfileGetResponse) {
        if let value = profile.profile {
            relationshipProfile = value
        }
        if let value = profile.effectiveContent {
            relationshipEffectiveContent = value
        } else if let value = profile.profile {
            relationshipEffectiveContent = value
        }
        relationshipManualOverride = profile.manualOverride
        relationshipBaseProfileRevision = profile.baseProfileRevision ?? ""
        relationshipUpdatedAt = profile.updatedAt ?? relationshipUpdatedAt
        relationshipEligibility = profile.eligibility ?? ""
    }

    private func applyStyleRefreshResponse(_ response: AiProfileResponse) {
        if let value = response.profile {
            styleProfile = value
            styleEffectiveContent = styleManualOverride?.content ?? value
        }
        styleEligibility = "usable"
        if let updatedAt = response.updatedAt {
            styleUpdatedAt = max(styleUpdatedAt, updatedAt)
        }
    }

    private func applyPlotRefreshResponse(_ response: AiPlotStateResponse) {
        if let value = response.state {
            plotState = value
            plotEffectiveContent = plotManualOverride?.content ?? value
        }
        if let chaptersThrough = response.chaptersThrough {
            plotChaptersThrough = chaptersThrough
        }
        plotEligibility = "usable"
        if let updatedAt = response.updatedAt {
            plotUpdatedAt = max(plotUpdatedAt, updatedAt)
        }
    }

    private func applyRelationshipRefreshResponse(_ response: AiProfileResponse) {
        if let value = response.profile {
            relationshipProfile = value
            relationshipEffectiveContent = relationshipManualOverride?.content ?? value
        }
        relationshipEligibility = "usable"
        if let updatedAt = response.updatedAt {
            relationshipUpdatedAt = max(relationshipUpdatedAt, updatedAt)
        }
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
        guard pendingProfileRefreshScope.isEmpty else {
            taskStatusText = "画像提取仍在处理中，请等待结果刷新"
            return
        }
        let selectedID = novelId
        let selectedAnchorID = afterChapterId.isEmpty ? nil : afterChapterId
        pendingProfileRefreshScope = scope
        pendingProfileRefreshNovelID = selectedID
        pendingProfileRefreshAnchorID = selectedAnchorID ?? ""
        pendingProfileRefreshBaseline = profileUpdatedAt(for: scope)
        profileBusy = scope
        defer { profileBusy = "" }
        do {
            switch scope {
            case "style":
                let r = try await AdminAPI.aiRefreshStyleProfile(novelId: selectedID, afterChapterId: selectedAnchorID)
                guard !Task.isCancelled, novelId == selectedID else { return }
                applyStyleRefreshResponse(r)
                clearPendingProfileRefresh()
                await loadProfileStatuses(
                    novelID: selectedID,
                    anchorID: selectedAnchorID,
                    minimumUpdatedAt: r.updatedAt,
                    minimumUpdatedScope: "style"
                )
            case "plot":
                let r = try await AdminAPI.aiRefreshPlotState(novelId: selectedID, afterChapterId: selectedAnchorID)
                guard !Task.isCancelled, novelId == selectedID else { return }
                applyPlotRefreshResponse(r)
                clearPendingProfileRefresh()
                await loadProfileStatuses(
                    novelID: selectedID,
                    anchorID: selectedAnchorID,
                    minimumUpdatedAt: r.updatedAt,
                    minimumUpdatedScope: "plot"
                )
            default:
                let r = try await AdminAPI.aiRefreshRelationshipProfile(novelId: selectedID, afterChapterId: selectedAnchorID)
                guard !Task.isCancelled, novelId == selectedID else { return }
                applyRelationshipRefreshResponse(r)
                clearPendingProfileRefresh()
                await loadProfileStatuses(
                    novelID: selectedID,
                    anchorID: selectedAnchorID,
                    minimumUpdatedAt: r.updatedAt,
                    minimumUpdatedScope: "relationship"
                )
            }
        } catch {
            guard !Task.isCancelled, novelId == selectedID else { return }
            if isTransientTaskError(error) {
                // The model may still be running on the server after the app
                // was backgrounded. Re-read on the next foreground transition
                // instead of presenting a false operation failure.
                taskStatusText = "画像提取暂时中断，回到前台后会自动刷新"
                await recoverProfileRefreshAfterBecomingActive()
                return
            }
            clearPendingProfileRefresh()
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func profileUpdatedAt(for scope: String) -> Int64 {
        switch scope {
        case "style": return styleUpdatedAt
        case "plot": return plotUpdatedAt
        default: return relationshipUpdatedAt
        }
    }

    private func clearPendingProfileRefresh() {
        pendingProfileRefreshScope = ""
        pendingProfileRefreshNovelID = ""
        pendingProfileRefreshAnchorID = ""
        pendingProfileRefreshBaseline = 0
    }

    /// 客户端超时不代表同步模型调用已经停止；回到前台后用只读 GET
    /// 等待服务端把本次提取写入，而不是重新消耗一次模型调用。
    private func recoverProfileRefreshAfterBecomingActive() async {
        guard !isRecoveringProfileRefresh,
              !pendingProfileRefreshScope.isEmpty,
              !pendingProfileRefreshNovelID.isEmpty
        else { return }

        let scope = pendingProfileRefreshScope
        let novelID = pendingProfileRefreshNovelID
        let anchorID = pendingProfileRefreshAnchorID.isEmpty ? nil : pendingProfileRefreshAnchorID
        let baseline = pendingProfileRefreshBaseline
        let minimumUpdatedAt = baseline > 0 ? baseline + 1 : nil
        isRecoveringProfileRefresh = true
        defer { isRecoveringProfileRefresh = false }

        for attempt in 0..<8 {
            guard !Task.isCancelled,
                  pendingProfileRefreshScope == scope,
                  pendingProfileRefreshNovelID == novelID,
                  novelId == novelID
            else { return }

            if attempt > 0 {
                let delaySeconds = min(30, 2 << (attempt - 1))
                do {
                    try await Task.sleep(nanoseconds: UInt64(delaySeconds) * 1_000_000_000)
                } catch {
                    return
                }
            }

            await loadProfileStatuses(
                novelID: novelID,
                anchorID: anchorID,
                minimumUpdatedAt: minimumUpdatedAt,
                minimumUpdatedScope: scope
            )
            if pendingProfileRefreshScope.isEmpty {
                return
            }
            if profileUpdatedAt(for: scope) > baseline {
                clearPendingProfileRefresh()
                return
            }
        }

        taskStatusText = "画像提取仍在服务器处理中，回到前台后会继续刷新"
    }

    private func refreshAfterBecomingActive() async {
        await resumeWritingTask()
        guard !Task.isCancelled, !novelId.isEmpty else { return }
        if !pendingProfileRefreshScope.isEmpty {
            await recoverProfileRefreshAfterBecomingActive()
        } else {
            await loadProfileStatuses(
                novelID: novelId,
                anchorID: afterChapterId.isEmpty ? nil : afterChapterId
            )
        }
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
            activeTask = task
            starting = false
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
            "adultCharactersConfirmed": adultContentMode == .explicit && adultCharactersConfirmed,
            "consentRuleTier": adultContentMode == .explicit ? consentRuleTier.rawValue : ConsentRuleTier.standard.rawValue,
        ]
    }

    private var contentPreferencesValidationError: String? {
        guard adultContentMode == .explicit else { return nil }
        if intimacyWeight == .none { return "开启露骨 R18 后请选择亲密内容权重" }
        if !adultCharactersConfirmed { return "开启露骨 R18 前请确认涉及角色均为成年人" }
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

    @ViewBuilder
    private var profileEditorSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $profileEditorText)
                        .frame(minHeight: 220)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("\(profileEditorKind.isEmpty ? "画像" : profileEditorKind)人工校正")
                } footer: {
                    Text("只记录当前起点之前可确认的事实。保存会绑定当前自动画像来源；自动画像刷新不会覆盖这里的未保存内容。")
                }
                if profileEditorRevision > 0 {
                    Button("清除人工校正", role: .destructive) {
                        Task { await deleteProfileOverride() }
                    }
                    .disabled(profileEditorBusy)
                }
                Button {
                    Task { await saveProfileOverride() }
                } label: {
                    if profileEditorBusy {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    } else {
                        Text("保存人工校正")
                    }
                }
                .disabled(profileEditorBusy || profileEditorText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || profileEditorText.unicodeScalars.count > 20_000 || profileEditorBaseRevision.isEmpty)
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("人工画像")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { showingProfileEditor = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func profileOrigin(for manual: AiManualProfileOverride?, effective: String) -> String {
        if let manual, let manualContent = manual.content, !manualContent.isEmpty, manualContent == effective {
            return "最终使用：人工校正（第 \(manual.revision ?? 0) 版）"
        }
        if !effective.isEmpty { return "最终使用：自动画像" }
        if manual != nil { return "人工校正存在，但当前起点未采用" }
        return "当前起点未采用画像"
    }

    private func beginProfileEdit(kind: String, content: String, override: AiManualProfileOverride?, baseRevision: String) {
        guard !baseRevision.isEmpty else {
            actionError = "当前起点没有可绑定的自动画像来源，请先提取或刷新画像"
            return
        }
        profileEditorKind = kind
        profileEditorText = override?.content ?? content
        profileEditorRevision = override?.revision ?? 0
        profileEditorBaseRevision = baseRevision
        showingProfileEditor = true
    }

    private func saveProfileOverride() async {
        guard !profileEditorBusy, !profileEditorKind.isEmpty, !novelId.isEmpty else { return }
        let selectedNovelID = novelId
        let operationID = UUID().uuidString
        profileEditorBusy = true
        defer { profileEditorBusy = false }
        do {
            let response = try await AdminAPI.aiSaveProfileOverride(
                kind: profileEditorKind,
                novelId: selectedNovelID,
                content: profileEditorText.trimmingCharacters(in: .whitespacesAndNewlines),
                expectedRevision: profileEditorRevision,
                baseProfileRevision: profileEditorBaseRevision,
                afterChapterId: afterChapterId.isEmpty ? nil : afterChapterId,
                operationID: operationID
            )
            guard !Task.isCancelled, selectedNovelID == novelId else { return }
            if let saved = response.override {
                switch profileEditorKind {
                case "style": styleManualOverride = saved
                case "plot": plotManualOverride = saved
                default: relationshipManualOverride = saved
                }
            }
            showingProfileEditor = false
            await loadProfileStatuses(novelID: selectedNovelID, anchorID: afterChapterId.isEmpty ? nil : afterChapterId)
        } catch {
            guard !Task.isCancelled, selectedNovelID == novelId else { return }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func deleteProfileOverride() async {
        guard !profileEditorBusy, !profileEditorKind.isEmpty, profileEditorRevision > 0, !novelId.isEmpty else { return }
        let selectedNovelID = novelId
        let operationID = UUID().uuidString
        profileEditorBusy = true
        defer { profileEditorBusy = false }
        do {
            _ = try await AdminAPI.aiDeleteProfileOverride(
                kind: profileEditorKind,
                novelId: selectedNovelID,
                expectedRevision: profileEditorRevision,
                afterChapterId: afterChapterId.isEmpty ? nil : afterChapterId,
                operationID: operationID
            )
            guard !Task.isCancelled, selectedNovelID == novelId else { return }
            showingProfileEditor = false
            await loadProfileStatuses(novelID: selectedNovelID, anchorID: afterChapterId.isEmpty ? nil : afterChapterId)
        } catch {
            guard !Task.isCancelled, selectedNovelID == novelId else { return }
            actionError = AppCopy.friendlyError(error)
        }
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
