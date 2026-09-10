import SwiftUI
import ZhiZhouCore
import UIKit
import PhotosUI
import UniformTypeIdentifiers

private struct PendingAdminCoverUpload {
    let operationID: String
    let novelID: String
    let imageData: Data
    let mimeType: String
    let expectedCoverVersion: String?
}

private struct AdminCoverPromptDraftSnapshot {
    let prompt: String
    let metadata: AiCoverMetadata?
    let mode: String
    let sourceSignature: String
}

/// AI 封面生成：选书 → 生成描述词 → 生成封面（后台任务）→ 轮询 → 候选采纳/弃用/上传。
/// 对齐 Web 端 admin ai AiCoverPanel（/api/ai/cover/*）。
struct AdminAICoverView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var coverPromptMaxCharacters = 2000

    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var selectedNovelId = ""
    @State private var novelSearch = ""
    @State private var showNovelPicker = false

    // 生成配置
    @State private var renderTitle = true
    @State private var platform = "default"
    @State private var stylePreset = "auto"
    @State private var composition = "auto"
    @State private var variationId = ""
    @State private var promptMetadata: AiCoverMetadata?
    @State private var prompt = ""
    @State private var promptMode = "auto"
    @State private var promptSourceSignature = ""
    @State private var promptTaskOriginal: AdminCoverPromptDraftSnapshot?
    @State private var generatingPrompt = false

    // 任务
    @State private var generating = false
    @State private var taskStatusText: String?
    @State private var activeTask: AiTaskInfo?
    @State private var pollTask: Task<Void, Never>?
    @State private var promptPollTask: Task<Void, Never>?
    @State private var pollingPaused = false
    @State private var coverPollingToken = UUID()
    @State private var promptPollingToken = UUID()

    // 候选
    @State private var candidates: [AiCoverCandidate] = []
    @State private var candidatesLoaded = false
    @State private var candidateRequests = ListRequestGuard<String>()
    @State private var candidatesNovelID = ""
    @State private var candidateBusy = ""
    @State private var pendingDiscard: AiCoverCandidate?
    @State private var previewCandidate: AiCoverCandidate?
    @State private var promptCandidate: AiCoverCandidate?
    @State private var showPromptEditor = false
    @State private var compareCandidateIDs: [String] = []
    @State private var coverHistory: [AiCoverHistoryItem] = []
    @State private var coverHistoryCurrent: AiCurrentCoverState?
    @State private var coverHistoryLoaded = false
    @State private var previewHistory: AiCoverHistoryItem?
    @State private var historyBusyID = ""
    @State private var pendingDangerousOperation: AdminDangerousOperation?
    @State private var coverRefreshFailed = false

    // 上传
    @State private var showPhotoPicker = false
    @State private var pickedItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var pendingCoverUpload: PendingAdminCoverUpload?

    // 通用
    @State private var isLoading = true
    @State private var actionError: String?

    private let platformOptions: [(value: String, label: String)] = [
        ("default", "通用（竖版 2:3）"),
        ("fanqie", "番茄小说"),
        ("qidian", "起点"),
        ("jinjiang", "晋江"),
        ("zhihu", "知乎盐言"),
        ("qimao", "七猫"),
        ("ciweimao", "刺猬猫"),
    ]

    private let styleOptions: [(value: String, label: String)] = [
        ("auto", "自动推荐"),
        ("soft_watercolor", "清透水彩"),
        ("moonlit_dream", "月色梦境"),
        ("ancient_guochao", "古风国色"),
        ("romance_illustration", "人物言情插画"),
        ("dark_cinematic", "暗夜电影感"),
        ("pastel_romance", "粉彩轻甜"),
        ("botanical_literary", "草木文学"),
        ("minimal_typographic", "留白字章"),
        ("cinematic", "电影概念设计"),
        ("illustration", "编辑插画"),
        ("ink", "东方水墨"),
        ("minimal", "极简海报"),
        ("noir", "黑色电影"),
        ("graphic", "现代平面设计"),
    ]

    private let styleDescriptions: [String: String] = [
        "auto": "自动推荐会结合题材和变体轮换，优先选择与故事气质匹配的方向。",
        "soft_watercolor": "浅桃、奶油、薄荷或雾蓝的透明水彩，边缘柔和，画面轻盈留白。",
        "moonlit_dream": "蓝紫月色、云雾和远景剪影，柔光低对比，适合诗意或清冷氛围。",
        "ancient_guochao": "朱砂、青玉、墨色与克制金色，汉服人物或古建筑，带国风画册质感。",
        "romance_illustration": "精致商业言情插画，突出人物关系、表情、发饰与服装细节。",
        "dark_cinematic": "深紫、藏蓝与黑色的高反差电影感，局部轮廓光，保留危险和拉扯。",
        "pastel_romance": "腮红、暖白、浅杏与淡紫的柔和粉彩，轻甜但不喧闹，适合细腻情感。",
        "botanical_literary": "鼠尾草、橄榄绿和旧纸色的草木纹理，低噪、安静、偏文学气质。",
        "minimal_typographic": "米白或浅色底，大面积留白，一处淡淡的水彩/符号质感，让书名成为主视觉。",
        "cinematic": "有明确焦点和景深层次的电影概念设计。",
        "illustration": "强调叙事、笔触和轮廓的编辑插画。",
        "ink": "东方水墨与纸张肌理，克制细节和自然留白。",
        "minimal": "以单一视觉隐喻和留白为主的极简海报。",
        "noir": "硬朗方向光、深阴影和颗粒感的黑色电影。",
        "graphic": "大胆色块、清晰层级和印刷肌理的现代平面设计。",
    ]

    private let compositionOptions: [(value: String, label: String)] = [
        ("auto", "自动变化"),
        ("portrait", "人物特写"),
        ("duo", "双人物关系"),
        ("environment", "环境叙事"),
        ("symbolic", "关键物件"),
        ("silhouette", "剪影留白"),
        ("off_center", "非对称构图"),
    ]

    private let romanceSubtypeLabels: [String: String] = [
        "sweet": "甜宠",
        "contract": "合约/豪门",
        "workplace": "职场关系",
        "campus": "校园初恋",
        "reunion": "久别重逢",
        "healing": "治愈救赎",
        "suspense": "悬疑言情",
        "revenge": "虐恋复仇",
        "historical": "古言爱情",
        "general": "现代言情",
    ]

    private let romanceEmotionLabels: [String: String] = [
        "sweet": "甜蜜",
        "tension": "暧昧拉扯",
        "bittersweet": "酸涩遗憾",
        "healing": "温柔治愈",
        "dangerous": "危险克制",
        "playful": "轻快俏皮",
    ]

    private let romanceConceptLabels: [String: String] = [
        "object": "关键物件",
        "distance": "情绪距离",
        "environment": "环境叙事",
        "action": "决定性动作",
        "threshold": "边界构图",
        "split": "双时空对照",
        "silhouette": "剪影留白",
        "aftermath": "事件余波",
    ]

    private var promptConfigSignature: String {
        "\(selectedNovelId)|\(renderTitle ? "1" : "0")|\(platform)|\(stylePreset)|\(composition)|\(variationId)"
    }

    private var promptConfigurationChanged: Bool {
        !promptSourceSignature.isEmpty && promptSourceSignature != promptConfigSignature
    }

    /// 用户明确选择沿用完整描述词后，选择器不再声称会影响这次生图。
    private var usesExactPrompt: Bool {
        promptMode == "exact"
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && promptSourceSignature.isEmpty
    }

    var body: some View {
        List {
            if isLoading && selectedNovelId.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else {
                novelSection
                configSection
                taskProgressSection
                candidateSection
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("封面生成")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await loadCandidates()
            await loadHistory()
        }
        .scrollDismissesKeyboard(.interactively)
        .task {
            await initialLoad()
            await resumePendingPromptTask()
            await resumePendingCoverTask()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await resumePendingPromptTask()
                    await resumePendingCoverTask()
                }
            } else {
                // 前台流连接不跨越系统挂起；服务端任务继续执行，回到前台后重新订阅。
                promptPollTask?.cancel()
                pollTask?.cancel()
                promptPollTask = nil
                pollTask = nil
                generatingPrompt = false
                generating = false
            }
        }
        .sheet(isPresented: $showNovelPicker) {
            NovelPickerSheet(
                options: novelOptions,
                search: $novelSearch,
                selectedId: selectedNovelId,
                onSelect: { id in
                    selectedNovelId = id
                    prompt = ""
                    promptMode = "auto"
                    promptSourceSignature = ""
                    variationId = ""
                    promptMetadata = nil
                    compareCandidateIDs = []
                    coverHistory = []
                    coverHistoryCurrent = nil
                    coverHistoryLoaded = false
                    previewHistory = nil
                    historyBusyID = ""
                    coverRefreshFailed = false
                    showNovelPicker = false
                    Task {
                        await loadCandidates()
                        await loadHistory()
                    }
                }
            )
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedItem, matching: .images)
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task { await prepareUpload(newItem) }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .confirmationDialog(
            "弃用候选封面",
            isPresented: Binding(
                get: { pendingDiscard != nil },
                set: { if !$0 { pendingDiscard = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("弃用候选", role: .destructive) {
                guard let candidate = pendingDiscard else { return }
                pendingDiscard = nil
                Task { await discard(candidate) }
            }
            Button("取消", role: .cancel) { pendingDiscard = nil }
        } message: {
            Text("弃用后该候选封面将从列表中移除。")
        }
        .adminDangerousOperationConfirmation(
            $pendingDangerousOperation,
            onConfirm: performDangerousOperation,
            onCancel: { operation in
                if pendingCoverUpload?.operationID == operation.operationID {
                    pendingCoverUpload = nil
                }
            }
        )
        .fullScreenCover(item: $previewCandidate) { candidate in
            AdminCoverCandidatePreview(image: dataUrlImage(candidate.dataUrl))
        }
        .sheet(item: $promptCandidate) { candidate in
            AdminCoverPromptEditorSheet(
                prompt: candidate.prompt ?? "",
                maxCharacters: coverPromptMaxCharacters,
                onSave: { edited in
                    applyPromptEdit(edited)
                    promptCandidate = nil
                }
            )
        }
        .sheet(isPresented: $showPromptEditor) {
            AdminCoverPromptEditorSheet(
                prompt: prompt,
                maxCharacters: coverPromptMaxCharacters,
                onSave: applyPromptEdit
            )
        }
        .sheet(item: $previewHistory) { history in
            AdminCoverHistoryPreviewSheet(
                novelID: selectedNovelId,
                item: history,
                onRestore: { requestRestore(history) }
            )
        }
        .onDisappear {
            pollTask?.cancel()
            promptPollTask?.cancel()
            pollTask = nil
            promptPollTask = nil
            generatingPrompt = false
        }
    }

    // MARK: - 选书

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
                        .disabled(promptTaskInFlight || coverTaskInFlight || uploading)
                }

                HStack(alignment: .top, spacing: 12) {
                    CachedAsyncImage(
                        url: APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt),
                        targetSize: CGSize(width: 104, height: 156)
                    ) { image in
                        image
                            .resizable()
                            .scaledToFill()
                    } placeholder: {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(AppTheme.surface.opacity(0.6))
                            Image(systemName: "photo")
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    .frame(width: 104, height: 156)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityLabel("当前封面")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("当前封面")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.textPrimary)
                        Text("采纳候选或上传图片后，这里会使用服务端的新版本时间戳刷新。")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if coverRefreshFailed {
                            Button("刷新当前封面") {
                                let novelID = novel.id
                                Task {
                                    _ = await refreshSelectedNovel(novelID)
                                    await loadCandidates()
                                }
                            }
                            .font(.subheadline.weight(.medium))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            } else {
                Button {
                    showNovelPicker = true
                } label: {
                    Label("选择小说", systemImage: "book.closed")
                }
                .disabled(promptTaskInFlight || coverTaskInFlight || uploading)
            }
        }
    }

    private var selectedNovel: AdminNovelSummary? {
        novelOptions.first { $0.id == selectedNovelId }
    }

    private var promptTaskInFlight: Bool {
        generatingPrompt || (activeTask?.kind == "cover_prompt" && activeTask?.isRunning == true)
    }

    private var coverTaskInFlight: Bool {
        generating || (activeTask?.kind == "cover" && activeTask?.isRunning == true)
    }

    // MARK: - 生成配置

    private var configSection: some View {
        Section("生成配置") {
            Toggle("封面渲染书名", isOn: $renderTitle)
                .disabled(selectedNovelId.isEmpty || promptTaskInFlight || coverTaskInFlight || usesExactPrompt)

            Picker("平台版式", selection: $platform) {
                ForEach(platformOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty || promptTaskInFlight || coverTaskInFlight || usesExactPrompt)

            Picker("主视觉风格", selection: $stylePreset) {
                ForEach(styleOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty || promptTaskInFlight || coverTaskInFlight || usesExactPrompt)

            Text(styleDescriptions[stylePreset] ?? "会结合题材和变体轮换，让每一版都有明确的视觉方向。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)

            Picker("构图方向", selection: $composition) {
                ForEach(compositionOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty || promptTaskInFlight || coverTaskInFlight || usesExactPrompt)

            Text("控制主体位置、镜头关系和留白方式。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)

            promptControls

            Button {
                showPhotoPicker = true
            } label: {
                if uploading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("上传本地图片替换封面", systemImage: "photo.badge.plus")
                }
            }
            .disabled(selectedNovelId.isEmpty || uploading)
        }
    }

    private var promptActionLayout: AnyLayout {
        dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(spacing: 10))
            : AnyLayout(HStackLayout(spacing: 10))
    }

    private var promptControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            promptEditor

            promptActionLayout {
                Button {
                    Task { await generatePrompt() }
                } label: {
                    HStack(spacing: 6) {
                        Spacer(minLength: 0)
                        if generatingPrompt {
                            ProgressView()
                        } else {
                            Label("AI 生成描述词", systemImage: "wand.and.stars")
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(promptTaskInFlight || coverTaskInFlight || selectedNovelId.isEmpty)

                Button {
                    Task { await generatePrompt(forceNewVariation: true) }
                } label: {
                    HStack(spacing: 6) {
                        Spacer(minLength: 0)
                        Label("换一版方向", systemImage: "arrow.triangle.2.circlepath")
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(promptTaskInFlight || coverTaskInFlight || selectedNovelId.isEmpty)
            }

            if let promptMetadata {
                VStack(alignment: .leading, spacing: 2) {
                    if promptMetadata.promptMode == "exact" {
                        Text("本版：完整描述词（当前配置不额外注入）")
                            .font(.caption)
                    } else {
                        Text("本版：\(label(for: promptMetadata.stylePreset, in: styleOptions)) · \(label(for: promptMetadata.composition, in: compositionOptions))")
                            .font(.caption)
                    }
                    if let direction = romanceDirectionLabel(promptMetadata) {
                        Text(direction)
                            .font(.caption)
                    }
                }
                .foregroundStyle(AppTheme.primary)
            }

            if promptConfigurationChanged {
                VStack(alignment: .leading, spacing: 8) {
                    Label("配置已更改，当前描述词需要重新确认", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AppTheme.warning)
                    Text("可以按新配置重新生成描述词，也可以明确使用现有完整描述词。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                    promptActionLayout {
                        Button("使用现有描述词") {
                            promptMode = "exact"
                            promptSourceSignature = ""
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.primary)

                        Button("按新设定更新") {
                            Task { await generatePrompt(forceNewVariation: true) }
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.primary)
                    }
                }
                .padding(10)
                .appMaterialBackground(.thinMaterial, fallback: AppTheme.controlFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else if usesExactPrompt {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Label("画面以完整描述词为准", systemImage: "text.quote")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AppTheme.primary)
                    Spacer(minLength: 4)
                    Button("返回配置生成") {
                        prompt = ""
                        promptMetadata = nil
                        promptMode = "auto"
                        promptSourceSignature = ""
                    }
                    .font(.caption.weight(.medium))
                }
            }

            HStack {
                Spacer(minLength: 0)
                Button {
                    Task { await generateCover() }
                } label: {
                    if generating {
                        ProgressView()
                            .frame(minWidth: 72, minHeight: 40)
                    } else {
                        Label("生成封面", systemImage: "sparkles")
                            .frame(minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.primary)
                .controlSize(.regular)
                .disabled(coverTaskInFlight || promptTaskInFlight || selectedNovelId.isEmpty || promptConfigurationChanged)
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 10)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 6, trailing: 16))
    }

    private var promptEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("封面描述词")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                Text("可选")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text("\(prompt.count)/\(coverPromptMaxCharacters)")
                    .font(.caption)
                    .foregroundStyle(prompt.count >= coverPromptMaxCharacters ? AppTheme.warning : AppTheme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                if prompt.isEmpty {
                    Text("留空自动生成；已有描述词可打开完整编辑器修改。")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    Text(prompt)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(3)
                        .lineSpacing(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    showPromptEditor = true
                } label: {
                    Label(prompt.isEmpty ? "填写完整描述词" : "编辑完整描述词", systemImage: "square.and.pencil")
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.borderless)
                .tint(AppTheme.primary)
                .disabled(generatingPrompt)
            }
            .frame(maxWidth: .infinity)
            .padding(AppLayout.textEditorInset)
            .appFieldSurface()
        }
    }

    @ViewBuilder
    private var taskProgressSection: some View {
        if let activeTask {
            Section("当前任务") {
                AdminAITaskProgressView(
                    task: activeTask,
                    showsPromptPreview: activeTask.kind == "cover_prompt"
                )
                if let taskStatusText {
                    Text(taskStatusText)
                        .font(.caption)
                        .foregroundStyle(activeTask.status == "failed" ? AppTheme.danger : AppTheme.textSecondary)
                }
                if pollingPaused, activeTask.isRunning {
                    Button("继续查询任务") {
                        pollingPaused = false
                        if activeTask.kind == "cover_prompt" {
                            startPromptPolling(activeTask.id)
                        } else if activeTask.kind == "cover" {
                            pollCoverTask(activeTask.id)
                        }
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

    // MARK: - 候选

    @ViewBuilder
    private var candidateSection: some View {
        if selectedNovelId.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("未选择小说", systemImage: "book.closed")
                } description: {
                    Text("先选择要生成封面的小说。")
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .frame(maxWidth: .infinity, minHeight: 160)
            }
        } else {
            comparisonSection
            if candidatesLoaded && candidates.isEmpty {
                Section("封面候选（0）") {
                    ContentUnavailableView {
                        Label("暂无候选", systemImage: "photo.on.rectangle.angled")
                    } description: {
                        Text("生成完成后，候选封面会出现在这里，采纳后替换当前封面。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if !candidates.isEmpty {
                Section("封面候选（\(candidates.count)）") {
                    ForEach(candidates) { candidate in
                        candidateRow(candidate)
                    }
                }
            }
            historySection
        }
    }

    @ViewBuilder
    private var historySection: some View {
        if coverHistoryLoaded {
            Section("封面历史（\(coverHistory.count)）") {
                Text("最多保留最近 10 个旧版本；历史图片仅管理员可查看。")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if coverHistory.isEmpty {
                    Text("暂时没有可恢复的旧封面。")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(coverHistory) { history in
                        Button {
                            previewHistory = history
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                AuthenticatedCoverHistoryImage(novelID: selectedNovelId, historyID: history.id)
                                    .frame(width: 72, height: 108)
                                    .background(AppTheme.surface.opacity(0.45))
                                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(AdminFormat.relativeTime(history.createdAt ?? 0))
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(AppTheme.textPrimary)
                                    Text("来源：\(history.source?.isEmpty == false ? history.source! : "未知") · \(history.reason?.isEmpty == false ? history.reason! : "替换")")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textSecondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if let prompt = history.prompt, !prompt.isEmpty {
                                        Text(prompt)
                                            .font(.caption2)
                                            .foregroundStyle(AppTheme.textSecondary)
                                            .lineLimit(3)
                                    }
                                    Label("查看预览并恢复", systemImage: "arrow.uturn.backward.circle")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(AppTheme.primary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(historyBusyID == history.id)
                    }
                }
            }
        }
    }

    private var comparedCandidates: [AiCoverCandidate] {
        compareCandidateIDs.compactMap { id in candidates.first { $0.id == id } }
    }

    private var comparisonLayout: AnyLayout {
        horizontalSizeClass == .regular && dynamicTypeSize < .xxxLarge
            ? AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
    }

    @ViewBuilder
    private var comparisonSection: some View {
        Section("封面对比") {
            Text("当前封面固定为参考；最多选择两张候选。加入对比只改变本地比较状态，不会采纳或弃用。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if comparedCandidates.isEmpty {
                Text("在候选中点“加入对比”后，会在这里并排或纵向显示。")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            comparisonLayout {
                currentCoverComparisonCard
                ForEach(comparedCandidates) { candidate in
                    candidateComparisonCard(candidate)
                }
            }
        }
    }

    private var currentCoverComparisonCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            CachedAsyncImage(
                url: selectedNovel.flatMap { APIClient.shared.coverURL(novelId: $0.id, updatedAt: $0.updatedAt) },
                targetSize: CGSize(width: 360, height: 540)
            ) { image in
                image
                    .resizable()
                    .scaledToFit()
            } placeholder: {
                ZStack {
                    RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                        .fill(AppTheme.surface.opacity(0.65))
                    Image(systemName: "photo")
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .background(AppTheme.surface.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))
            Text("当前封面")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Text("固定参考 · 不产生新请求")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .paperCard()
    }

    private func candidateComparisonCard(_ candidate: AiCoverCandidate) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let image = dataUrlImage(candidate.dataUrl) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                            .fill(AppTheme.surface.opacity(0.65))
                        Image(systemName: "photo.slash")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .background(AppTheme.surface.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))
            Text(["候选", String(candidate.id.prefix(8))].joined(separator: " "))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Text(candidate.taskId?.isEmpty == false ? "来源：AI 任务 \(candidate.taskId!.prefix(8))" : "来源：AI 生成候选")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
            if let metadata = candidate.metadata, metadata.promptMode == "exact" {
                Text("完整描述词")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(AppTheme.primary)
            } else if let metadata = candidate.metadata, (metadata.stylePreset != nil || metadata.composition != nil) {
                Text("\(label(for: metadata.stylePreset, in: styleOptions)) · \(label(for: metadata.composition, in: compositionOptions))")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.primary)
            }
            if let prompt = candidate.prompt, !prompt.isEmpty {
                Text(prompt)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(4)
                    .lineSpacing(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .paperCard()
    }

    private func candidateRow(_ candidate: AiCoverCandidate) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label("已完成", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.success)
                Spacer(minLength: 8)
                Text(AdminFormat.relativeTime(candidate.createdAt ?? 0))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
            }

            candidateLayout {
                Button {
                    previewCandidate = candidate
                } label: {
                    candidateImage(candidate)
                        .frame(width: 96, height: 144)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("候选封面")
                .accessibilityHint("点按查看大图")

                VStack(alignment: .leading, spacing: 8) {
                    if let promptText = candidate.prompt, !promptText.isEmpty {
                        Text(promptText)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .appTextLineLimit(3)
                            .lineSpacing(2)

                        Button {
                            promptCandidate = candidate
                        } label: {
                            Label("查看提示词", systemImage: "doc.text")
                                .font(.subheadline.weight(.medium))
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                        }
                        .buttonStyle(.borderless)
                        .tint(AppTheme.primary)
                        .accessibilityHint("打开完整提示词")
                    }

                    if let metadata = candidate.metadata, metadata.promptMode == "exact" {
                        Text("完整描述词 · 当前配置不额外注入")
                            .font(.caption2.weight(.medium))
                            .appTextLineLimit(2)
                            .foregroundStyle(AppTheme.primary)
                    } else if let metadata = candidate.metadata, (metadata.stylePreset != nil || metadata.composition != nil) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(label(for: metadata.stylePreset, in: styleOptions)) · \(label(for: metadata.composition, in: compositionOptions))")
                                .font(.caption2.weight(.medium))
                                .appTextLineLimit(2)
                            if let direction = romanceDirectionLabel(metadata) {
                                Text(direction)
                                    .font(.caption2)
                                    .appTextLineLimit(2)
                            }
                        }
                        .foregroundStyle(AppTheme.primary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .layoutPriority(1)
            }

            Divider()

            if candidateBusy == candidate.id {
                ProgressView("处理中…")
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                promptActionLayout {
                    Button {
                        toggleCompare(candidate)
                    } label: {
                        Label(compareCandidateIDs.contains(candidate.id) ? "移出对比" : "加入对比", systemImage: compareCandidateIDs.contains(candidate.id) ? "checkmark.circle" : "rectangle.split.2x1")
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(!compareCandidateIDs.contains(candidate.id) && compareCandidateIDs.count >= 2)

                    Button {
                        requestAdopt(candidate)
                    } label: {
                        Label("采纳", systemImage: "checkmark")
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(!candidateBusy.isEmpty)

                    Button(role: .destructive) {
                        pendingDiscard = candidate
                    } label: {
                        Label("弃用", systemImage: "trash")
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.danger)
                    .disabled(!candidateBusy.isEmpty)
                }
            }
        }
        .padding(12)
        .paperCard()
        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    @ViewBuilder
    private func candidateImage(_ candidate: AiCoverCandidate) -> some View {
        if let image = dataUrlImage(candidate.dataUrl) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(AppTheme.surface.opacity(0.6))
                Image(systemName: "photo")
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private var candidateLayout: AnyLayout {
        dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    }

    /// data URL（data:image/png;base64,...）→ UIImage。
    private func dataUrlImage(_ dataUrl: String) -> UIImage? {
        guard let comma = dataUrl.range(of: ",") else { return nil }
        let base64 = String(dataUrl[comma.upperBound...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }

    // MARK: - 数据

    private func initialLoad() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let index = try await AdminAPI.novelIndex(limit: 200)
            novelOptions = index.novels
            if let settings = try? await AdminAPI.aiSettings(), let configuredLimit = settings.settings?.coverPromptMaxChars {
                coverPromptMaxCharacters = normalizedCoverPromptLimit(configuredLimit)
                prompt = String(prompt.prefix(coverPromptMaxCharacters))
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func normalizedCoverPromptLimit(_ value: Int) -> Int {
        min(10000, max(100, value))
    }

    private func applyPromptEdit(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        prompt = String(trimmed.prefix(coverPromptMaxCharacters))
        if prompt.isEmpty {
            promptMode = "auto"
            promptSourceSignature = ""
        } else {
            promptMode = "exact"
            promptSourceSignature = ""
        }
    }

    /// App 回到前台或页面重新打开时，恢复尚未取回结果的提示词任务。
    private func resumePendingPromptTask() async {
        guard promptPollTask == nil else { return }
        do {
            guard let task = try await AdminAITaskCoordinator.shared.resume(
                key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                recoveryAttempts: 5
            ) else { return }
            activeTask = task
            if let novelId = task.novelId, !novelId.isEmpty {
                selectedNovelId = novelId
                await loadCandidates()
                await loadHistory()
            }
            if !applyPromptTaskSnapshot(task) {
                startPromptStreaming(task.id)
            }
        } catch {
            generatingPrompt = false
            taskStatusText = "提示词任务暂时无法查询，请稍后重试"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generatePrompt(forceNewVariation: Bool = false) async {
        guard !selectedNovelId.isEmpty else { return }
        promptTaskOriginal = AdminCoverPromptDraftSnapshot(
            prompt: prompt,
            metadata: promptMetadata,
            mode: promptMode,
            sourceSignature: promptSourceSignature
        )
        let frozenNovelID = selectedNovelId
        let frozenRenderTitle = renderTitle
        let frozenPlatform = platform
        let frozenStylePreset = stylePreset
        let frozenComposition = composition
        let frozenVariationID = forceNewVariation ? UUID().uuidString : variationId
        generatingPrompt = true
        activeTask = nil
        taskStatusText = "提示词任务已提交，等待队列…"
        do {
            let requestPayload: [String: Any] = ["novelId": frozenNovelID, "renderTitle": frozenRenderTitle, "platform": frozenPlatform, "stylePreset": frozenStylePreset, "composition": frozenComposition, "variationId": frozenVariationID]
            let requestPayloadJSON = (try? JSONSerialization.data(withJSONObject: requestPayload, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) }
            let launch = try await AdminAITaskCoordinator.shared.start(
                key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                kind: "cover_prompt",
                resourceID: frozenNovelID,
                requestPayloadJSON: requestPayloadJSON,
                requestFingerprint: requestPayloadJSON
            ) { clientRequestID in
                let result = try await AdminAPI.aiCoverPrompt(
                    novelId: frozenNovelID,
                    renderTitle: frozenRenderTitle,
                    platform: frozenPlatform,
                    stylePreset: frozenStylePreset,
                    composition: frozenComposition,
                    variationId: frozenVariationID,
                    clientRequestId: clientRequestID
                )
                return result.taskId
            }
            // forceNewVariation 也必须成为后续生图和来源签名的一部分；否则
            // 新提示词会显示为已完成，但仍沿用上一版的变体 ID。
            variationId = frozenVariationID
            let task = launch.snapshot ?? .pending(
                id: launch.taskID,
                kind: "cover_prompt",
                novelId: frozenNovelID
            )
            activeTask = task
            taskStatusText = launch.reusedExistingOperation ? "已恢复正在处理的提示词任务" : nil
            if !applyPromptTaskSnapshot(task) {
                startPromptStreaming(launch.taskID)
            }
        } catch {
            restorePromptTaskOriginal()
            if case APIError.network = error {
                generatingPrompt = false
                taskStatusText = "请求中断，正在后台确认任务…"
            } else {
                taskStatusText = nil
            }
            actionError = AppCopy.friendlyError(error)
        }
    }

    /// 前台优先订阅 SSE；连接断开、代理不支持或页面回到后台时自动回退到轮询。
    private func startPromptStreaming(_ id: String) {
        promptPollTask?.cancel()
        let token = UUID()
        promptPollingToken = token
        pollingPaused = false
        generatingPrompt = true
        promptPollTask = Task {
            defer {
                if !Task.isCancelled, promptPollingToken == token {
                    promptPollTask = nil
                }
            }
            do {
                for try await event in AdminAPI.aiCoverPromptStream(id: id) {
                    guard !Task.isCancelled,
                          promptPollingToken == token,
                          AdminAITaskCoordinator.shared.isCurrent(
                            key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                            taskID: id
                          ) else { return }
                    if applyPromptTaskSnapshot(event.task) { return }
                }
                guard !Task.isCancelled,
                      promptPollingToken == token,
                      AdminAITaskCoordinator.shared.isCurrent(
                        key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                        taskID: id
                      ) else { return }
                promptPollTask = nil
                taskStatusText = "实时连接已结束，正在继续查询…"
                startPromptPolling(id)
            } catch {
                guard !Task.isCancelled, promptPollingToken == token else { return }
                promptPollTask = nil
                taskStatusText = "实时连接已断开，正在继续查询…"
                startPromptPolling(id)
            }
        }
    }

    /// 应用服务端任务快照；running 快照也会把当前已生成的提示词显示出来。
    @discardableResult
    private func applyPromptTaskSnapshot(_ task: AiTaskInfo) -> Bool {
        activeTask = task
        let status = task.status ?? ""
        if let resultText = task.result,
           let data = resultText.data(using: .utf8),
           let result = try? JSONDecoder().decode(AiCoverPromptTaskResult.self, from: data),
           !result.prompt.isEmpty {
            prompt = String(result.prompt.prefix(coverPromptMaxCharacters))
            promptMetadata = result.metadata
            variationId = result.metadata?.variationId ?? variationId
        } else if let generatedPrompt = task.prompt,
                  !generatedPrompt.isEmpty,
                  generatedPrompt != "生成封面描述词" {
            // 兼容没有 result 字段的旧任务记录。
            prompt = String(generatedPrompt.prefix(coverPromptMaxCharacters))
        }

        if status == "completed" {
            if prompt.isEmpty {
                actionError = "任务已完成，但没有返回提示词"
                taskStatusText = nil
            } else {
                promptMode = "exact"
                promptSourceSignature = promptConfigSignature
                taskStatusText = "封面描述词已生成，可继续编辑"
            }
            AdminAITaskCoordinator.shared.finish(
                key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                taskID: task.id
            )
            generatingPrompt = false
            promptTaskOriginal = nil
            promptPollTask = nil
            pollingPaused = false
            return true
        }
        if ["failed", "cancelled"].contains(status) {
            restorePromptTaskOriginal()
            taskStatusText = AdminFormat.aiTaskStatus(status)
            if let error = task.error, !error.isEmpty {
                actionError = error
            }
            AdminAITaskCoordinator.shared.finish(
                key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                taskID: task.id
            )
            generatingPrompt = false
            promptPollTask = nil
            pollingPaused = false
            return true
        }
        taskStatusText = nil
        return false
    }

    /// 轮询提示词后台任务；结果已保存在服务端，App 暂停期间不影响任务本身。
    private func startPromptPolling(_ id: String) {
        guard promptPollTask == nil else { return }
        let token = UUID()
        promptPollingToken = token
        pollingPaused = false
        generatingPrompt = true
        promptPollTask = Task {
            defer {
                if !Task.isCancelled, promptPollingToken == token {
                    promptPollTask = nil
                }
            }
            var attempts = 0
            var consecutiveFailures = 0
            var interval: UInt64 = 2_000_000_000
            while !Task.isCancelled, attempts < 100 {
                if attempts > 0 {
                    try? await Task.sleep(nanoseconds: interval)
                    guard !Task.isCancelled else { return }
                }
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    guard AdminAITaskCoordinator.shared.isCurrent(
                        key: AdminAITaskCoordinator.OperationKey.coverPrompt,
                        taskID: id
                    ), promptPollingToken == token else { return }
                    consecutiveFailures = 0
                    interval = 2_000_000_000
                    if applyPromptTaskSnapshot(detail.task) { return }
                } catch {
                    guard !Task.isCancelled, promptPollingToken == token else { return }
                    if isTransientTaskError(error) {
                        consecutiveFailures += 1
                        if consecutiveFailures < 5 {
                            interval = min(30_000_000_000, max(2_000_000_000, interval * 2))
                            taskStatusText = "网络暂时不可用，正在退避重试（\(consecutiveFailures)/5）…"
                            continue
                        }
                        generatingPrompt = false
                        pollingPaused = true
                        promptPollTask = nil
                        taskStatusText = "提示词任务仍在服务器运行，查询已暂停；点按“继续查询任务”恢复。"
                        return
                    }
                    generatingPrompt = false
                    pollingPaused = false
                    promptPollTask = nil
                    taskStatusText = taskQueryErrorText(error)
                    return
                }
            }
            guard !Task.isCancelled, promptPollingToken == token else { return }
            generatingPrompt = false
            pollingPaused = true
            promptPollTask = nil
            taskStatusText = "提示词任务仍在后台生成，查询窗口已结束；点按“继续查询任务”恢复。"
        }
    }

    private func resumePendingCoverTask() async {
        guard pollTask == nil else { return }
        do {
            guard let task = try await AdminAITaskCoordinator.shared.resume(
                key: AdminAITaskCoordinator.OperationKey.coverImage,
                recoveryAttempts: 5
            ) else { return }
            activeTask = task
            if let novelID = task.novelId, !novelID.isEmpty {
                selectedNovelId = novelID
                await loadHistory()
            }
            let status = task.status ?? ""
            if status == "completed" {
                pollingPaused = false
                taskStatusText = "候选封面已更新，可在下方查看。"
                await loadCandidates()
            } else if ["failed", "cancelled"].contains(status) {
                pollingPaused = false
                taskStatusText = AdminFormat.aiTaskStatus(status)
            } else {
                generating = true
                pollCoverTask(task.id)
            }
        } catch {
            generating = false
            taskStatusText = "封面任务暂时无法查询，请稍后重试"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generateCover() async {
        guard !selectedNovelId.isEmpty else { return }
        let finalPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !promptConfigurationChanged else {
            actionError = "配置已更改，请更新描述词或选择使用现有描述词后再生成封面"
            return
        }
        guard finalPrompt.count <= coverPromptMaxCharacters else {
            actionError = "封面描述词不能超过 \(coverPromptMaxCharacters) 个字符"
            return
        }
        let frozenNovelID = selectedNovelId
        let frozenPrompt = finalPrompt
        let frozenPromptMode = finalPrompt.isEmpty ? "auto" : "exact"
        let frozenRenderTitle = renderTitle
        let frozenPlatform = platform
        let frozenStylePreset = stylePreset
        let frozenComposition = composition
        let frozenVariationID = variationId
        generating = true
        activeTask = nil
        taskStatusText = "任务已提交，等待队列…"
        defer { generating = false }
        do {
            let requestPayload: [String: Any] = ["novelId": frozenNovelID, "prompt": frozenPrompt, "promptMode": frozenPromptMode, "renderTitle": frozenRenderTitle, "platform": frozenPlatform, "stylePreset": frozenStylePreset, "composition": frozenComposition, "variationId": frozenVariationID]
            let requestPayloadJSON = (try? JSONSerialization.data(withJSONObject: requestPayload, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) }
            let launch = try await AdminAITaskCoordinator.shared.start(
                key: AdminAITaskCoordinator.OperationKey.coverImage,
                kind: "cover",
                resourceID: frozenNovelID,
                requestPayloadJSON: requestPayloadJSON,
                requestFingerprint: requestPayloadJSON
            ) { clientRequestID in
                let result = try await AdminAPI.aiGenerateCover(
                    novelId: frozenNovelID,
                    prompt: frozenPrompt,
                    promptMode: frozenPromptMode,
                    renderTitle: frozenRenderTitle,
                    platform: frozenPlatform,
                    stylePreset: frozenStylePreset,
                    composition: frozenComposition,
                    variationId: frozenVariationID,
                    clientRequestID: clientRequestID
                )
                return result.taskId
            }
            let task = launch.snapshot ?? .pending(
                id: launch.taskID,
                kind: "cover",
                novelId: frozenNovelID
            )
            activeTask = task
            if task.isRunning {
                taskStatusText = launch.reusedExistingOperation ? "已恢复正在处理的封面任务" : nil
                pollCoverTask(launch.taskID)
            } else {
                let status = task.status ?? ""
                taskStatusText = status == "completed"
                    ? "候选封面已更新，可在下方查看。"
                    : AdminFormat.aiTaskStatus(status)
                if status == "completed" { await loadCandidates() }
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
            taskStatusText = "请求中断时会按稳定请求 ID 自动恢复"
        }
    }

    /// 轮询封面生成任务直到结束，结束后刷新候选。
    private func pollCoverTask(_ id: String) {
        pollTask?.cancel()
        let token = UUID()
        coverPollingToken = token
        pollingPaused = false
        pollTask = Task {
            defer {
                if !Task.isCancelled, coverPollingToken == token {
                    pollTask = nil
                }
            }
            var attempts = 0
            var consecutiveFailures = 0
            var interval: UInt64 = 3_000_000_000
            while !Task.isCancelled, attempts < 100 {
                if attempts > 0 {
                    try? await Task.sleep(nanoseconds: interval)
                    guard !Task.isCancelled else { return }
                }
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    guard AdminAITaskCoordinator.shared.isCurrent(
                        key: AdminAITaskCoordinator.OperationKey.coverImage,
                        taskID: id
                    ), coverPollingToken == token else { return }
                    consecutiveFailures = 0
                    interval = 3_000_000_000
                    activeTask = detail.task
                    let status = detail.task.status ?? ""
                    if ["completed", "failed", "cancelled"].contains(status) {
                        AdminAITaskCoordinator.shared.finish(
                            key: AdminAITaskCoordinator.OperationKey.coverImage,
                            taskID: detail.task.id
                        )
                        taskStatusText = status == "completed"
                            ? "候选封面已更新，可在下方查看。"
                            : AdminFormat.aiTaskStatus(status)
                        pollingPaused = false
                        if status == "completed" {
                            await loadCandidates()
                        }
                        return
                    }
                } catch {
                    guard !Task.isCancelled, coverPollingToken == token else { return }
                    if isTransientTaskError(error) {
                        consecutiveFailures += 1
                        if consecutiveFailures < 5 {
                            interval = min(30_000_000_000, max(3_000_000_000, interval * 2))
                            taskStatusText = "网络暂时不可用，正在退避重试（\(consecutiveFailures)/5）…"
                            continue
                        }
                        generating = false
                        pollingPaused = true
                        pollTask = nil
                        taskStatusText = "封面任务仍在服务器运行，查询已暂停；点按“继续查询任务”恢复。"
                        return
                    }
                    generating = false
                    pollingPaused = false
                    pollTask = nil
                    taskStatusText = taskQueryErrorText(error)
                    return
                }
            }
            guard !Task.isCancelled, coverPollingToken == token else { return }
            generating = false
            pollingPaused = true
            pollTask = nil
            taskStatusText = "封面任务仍在后台生成，查询窗口已结束；点按“继续查询任务”恢复。"
        }
    }

    private func isTransientTaskError(_ error: Error) -> Bool {
        if case APIError.network = error { return true }
        if case APIError.http(let status, _) = error {
            return status == 408 || status == 429 || status >= 500
        }
        return false
    }

    private func restorePromptTaskOriginal() {
        guard let original = promptTaskOriginal else { return }
        prompt = original.prompt
        promptMetadata = original.metadata
        promptMode = original.mode
        promptSourceSignature = original.sourceSignature
        promptTaskOriginal = nil
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

    private func loadCandidates() async {
        guard !selectedNovelId.isEmpty else { return }
        let ticket = candidateRequests.begin(selectedNovelId)
        if candidatesNovelID != selectedNovelId {
            candidates = []
            candidatesLoaded = false
            candidatesNovelID = selectedNovelId
        }
        defer { candidateRequests.finish(ticket) }
        do {
            let result = try await AdminAPI.aiCoverCandidates(novelId: ticket.query)
            guard !Task.isCancelled, candidateRequests.accepts(ticket, query: selectedNovelId) else { return }
            candidates = result.items
            compareCandidateIDs = compareCandidateIDs.filter { id in result.items.contains { $0.id == id } }
            candidatesLoaded = true
        } catch {
            guard !Task.isCancelled, candidateRequests.accepts(ticket, query: selectedNovelId) else { return }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func loadHistory() async {
        guard !selectedNovelId.isEmpty else { return }
        let novelID = selectedNovelId
        do {
            let result = try await AdminAPI.aiCoverHistory(novelId: novelID)
            guard !Task.isCancelled, selectedNovelId == novelID else { return }
            coverHistory = result.items
            coverHistoryCurrent = result.current
            coverHistoryLoaded = true
        } catch {
            guard !Task.isCancelled, selectedNovelId == novelID else { return }
            coverHistoryLoaded = false
            // 老服务端尚未提供历史端点时不阻断候选/生图主流程。
            if case APIError.http(let status, _) = error, status == 404 { return }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func toggleCompare(_ candidate: AiCoverCandidate) {
        if let index = compareCandidateIDs.firstIndex(of: candidate.id) {
            compareCandidateIDs.remove(at: index)
        } else if compareCandidateIDs.count < 2 {
            compareCandidateIDs.append(candidate.id)
        } else {
            actionError = "最多同时比较两张候选封面"
        }
    }

    /// 采纳/上传成功后重新读取服务端的 updatedAt，让当前封面 URL 使用新版本。
    @discardableResult
    private func refreshSelectedNovel(_ novelID: String) async -> Bool {
        do {
            let index = try await AdminAPI.novelIndex(limit: 200)
            guard !Task.isCancelled, selectedNovelId == novelID else { return false }
            guard let fresh = index.novels.first(where: { $0.id == novelID }) else {
                coverRefreshFailed = true
                taskStatusText = "封面已更新，但暂时找不到这本书的最新信息，请稍后刷新。"
                return false
            }
            if let position = novelOptions.firstIndex(where: { $0.id == novelID }) {
                novelOptions[position] = fresh
            } else {
                novelOptions.append(fresh)
            }
            coverRefreshFailed = false
            return true
        } catch {
            guard !Task.isCancelled, selectedNovelId == novelID else { return false }
            coverRefreshFailed = true
            taskStatusText = "封面已更新，预览暂未刷新；请稍后重试。"
            return false
        }
    }

    private func requestAdopt(_ candidate: AiCoverCandidate) {
        guard candidateBusy.isEmpty else { return }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .adoptCoverCandidate,
            kind: .overwrite,
            targetIDs: [candidate.id, selectedNovelId, coverHistoryCurrent?.version ?? ""],
            title: "替换当前封面",
            message: "采纳后将用这个候选替换当前封面，并从候选列表移除该图片。",
            confirmLabel: "采纳并替换封面"
        )
    }

    private func adopt(candidateID: String, operationID: String, expectedCoverVersion: String?) async {
        guard candidateBusy.isEmpty else { return }
        let novelID = selectedNovelId
        candidateBusy = candidateID
        defer { candidateBusy = "" }
        do {
            try await AdminAPI.aiAdoptCoverCandidate(
                id: candidateID,
                operationID: operationID,
                expectedCoverVersion: expectedCoverVersion
            )
            guard !Task.isCancelled, selectedNovelId == novelID else { return }
            let refreshed = await refreshSelectedNovel(novelID)
            await loadCandidates()
            await loadHistory()
            if refreshed {
                taskStatusText = "封面已采纳，当前预览已更新。"
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func discard(_ candidate: AiCoverCandidate) async {
        guard candidateBusy.isEmpty else { return }
        candidateBusy = candidate.id
        defer { candidateBusy = "" }
        do {
            try await AdminAPI.aiDiscardCoverCandidate(id: candidate.id)
            candidates.removeAll { $0.id == candidate.id }
            compareCandidateIDs.removeAll { $0 == candidate.id }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func prepareUpload(_ item: PhotosPickerItem) async {
        guard !selectedNovelId.isEmpty else { return }
        uploading = true
        defer {
            uploading = false
            pickedItem = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                actionError = "无法读取所选图片"
                return
            }
            guard let mime = item.supportedContentTypes.first?.preferredMIMEType, mime.hasPrefix("image/") else {
                actionError = "封面必须是图片文件"
                return
            }
            let operation = AdminDangerousOperation(
                action: .uploadCover,
                kind: .overwrite,
                targetIDs: [selectedNovelId],
                title: "上传并替换封面",
                message: "将用所选本地图片替换当前封面；现有封面会保留在历史记录中。",
                confirmLabel: "上传并替换封面"
            )
            pendingCoverUpload = PendingAdminCoverUpload(
                operationID: operation.operationID,
                novelID: selectedNovelId,
                imageData: data,
                mimeType: mime,
                expectedCoverVersion: coverHistoryCurrent?.version
            )
            pendingDangerousOperation = operation
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func performDangerousOperation(_ operation: AdminDangerousOperation) {
        switch operation.action {
        case .adoptCoverCandidate:
            guard let candidateID = operation.targetIDs.first else { return }
            let expectedVersion = operation.targetIDs.dropFirst(2).first.flatMap { $0.isEmpty ? nil : $0 }
            Task {
                await adopt(candidateID: candidateID, operationID: operation.operationID, expectedCoverVersion: expectedVersion)
            }
        case .restoreCoverHistory:
            guard operation.targetIDs.count >= 3,
                  let historyID = operation.targetIDs.first,
                  let novelID = operation.targetIDs.dropFirst().first,
                  let expectedVersion = operation.targetIDs.dropFirst(2).first,
                  !historyID.isEmpty, !novelID.isEmpty, !expectedVersion.isEmpty else { return }
            Task {
                await restoreHistory(
                    historyID: historyID,
                    novelID: novelID,
                    expectedCoverVersion: expectedVersion,
                    operationID: operation.operationID
                )
            }
        case .uploadCover:
            guard let upload = pendingCoverUpload,
                  upload.operationID == operation.operationID else { return }
            pendingCoverUpload = nil
            Task { await uploadCover(upload) }
        default:
            break
        }
    }

    private func uploadCover(_ upload: PendingAdminCoverUpload) async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }
        do {
            try await AdminAPI.aiUploadCover(
                novelId: upload.novelID,
                imageData: upload.imageData,
                mimeType: upload.mimeType,
                operationID: upload.operationID,
                expectedCoverVersion: upload.expectedCoverVersion
            )
            guard !Task.isCancelled, selectedNovelId == upload.novelID else { return }
            let refreshed = await refreshSelectedNovel(upload.novelID)
            await loadHistory()
            if refreshed {
                taskStatusText = "封面已上传，当前预览已更新。"
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func requestRestore(_ history: AiCoverHistoryItem) {
        guard historyBusyID.isEmpty,
              history.novelId == selectedNovelId,
              let currentVersion = coverHistoryCurrent?.version,
              !currentVersion.isEmpty else {
            actionError = "当前封面版本尚未读取，刷新后再试"
            return
        }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .restoreCoverHistory,
            kind: .overwrite,
            targetIDs: [history.id, selectedNovelId, currentVersion],
            title: "恢复历史封面",
            message: "将用这个历史版本替换当前封面，当前封面会继续保留在历史记录中。",
            confirmLabel: "恢复并替换封面"
        )
    }

    private func restoreHistory(historyID: String, novelID: String, expectedCoverVersion: String, operationID: String) async {
        guard historyBusyID.isEmpty else { return }
        historyBusyID = historyID
        defer { historyBusyID = "" }
        do {
            try await AdminAPI.aiRestoreCoverHistory(
                novelId: novelID,
                historyID: historyID,
                expectedCoverVersion: expectedCoverVersion,
                operationID: operationID
            )
            guard !Task.isCancelled, selectedNovelId == novelID else { return }
            let refreshed = await refreshSelectedNovel(novelID)
            await loadHistory()
            if refreshed {
                taskStatusText = "历史封面已恢复，当前预览已更新。"
            }
        } catch {
            guard selectedNovelId == novelID else { return }
            await loadHistory()
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }

    private func label(for value: String?, in options: [(value: String, label: String)]) -> String {
        guard let value else { return "自动" }
        return options.first(where: { $0.value == value })?.label ?? value
    }

    private func romanceDirectionLabel(_ metadata: AiCoverMetadata) -> String? {
        let parts = [
            metadata.romanceSubtype.map { "主线：\(romanceSubtypeLabels[$0] ?? $0)" },
            metadata.romanceEmotion.map { "情绪：\(romanceEmotionLabels[$0] ?? $0)" },
            metadata.visualConcept.map { "概念：\(romanceConceptLabels[$0] ?? $0)" },
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - 选书 Sheet

private struct NovelPickerSheet: View {
    let options: [AdminNovelSummary]
    @Binding var search: String
    let selectedId: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss

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
                .buttonStyle(ScaleButtonStyle())
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

private struct AdminCoverCandidatePreview: View {
    let image: UIImage?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .contentShape(Rectangle())
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = min(4, max(1, lastScale * value))
                            }
                            .onEnded { _ in
                                lastScale = scale
                                if scale < 1.05 {
                                    scale = 1
                                    lastScale = 1
                                }
                            }
                    )
                    .onTapGesture(count: 2) {
                        let nextScale: CGFloat = scale > 1.05 ? 1 : 2
                        withAnimation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1)) {
                            scale = nextScale
                            lastScale = nextScale
                        }
                    }
                    .accessibilityLabel("封面大图")
                    .accessibilityHint("双击放大或还原，捏合调整大小")
            } else {
                ContentUnavailableView("图片不可用", systemImage: "photo.slash")
                    .foregroundStyle(.white)
            }

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: AppLayout.minimumTouchTarget, height: AppLayout.minimumTouchTarget)
                            .appMaterialBackground(.thinMaterial, fallback: Color.black.opacity(0.72), in: Circle())
                    }
                    .accessibilityLabel("关闭预览")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)

                Spacer()
            }
        }
        .statusBarHidden()
    }
}

private struct AuthenticatedCoverHistoryImage: View {
    let novelID: String
    let historyID: String

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else if failed {
                Image(systemName: "photo.slash")
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: "\(novelID)-\(historyID)") {
            do {
                let data = try await AdminAPI.aiCoverHistoryImage(novelId: novelID, historyID: historyID)
                guard !Task.isCancelled, let decoded = UIImage(data: data) else { return }
                image = decoded
                failed = false
            } catch {
                guard !Task.isCancelled else { return }
                failed = true
            }
        }
        .accessibilityLabel("封面历史预览")
    }
}

private struct AdminCoverHistoryPreviewSheet: View {
    let novelID: String
    let item: AiCoverHistoryItem
    let onRestore: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Group {
                        if let image {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                        } else if failed {
                            ContentUnavailableView("图片不可用", systemImage: "photo.slash")
                        } else {
                            ProgressView("加载历史图片…")
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 300)
                    .background(AppTheme.surface.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))

                    Text("生成于 \(AdminFormat.relativeTime(item.createdAt ?? 0))")
                        .font(.headline)
                        .foregroundStyle(AppTheme.textPrimary)
                    Text("来源：\(item.source?.isEmpty == false ? item.source! : "未知") · 原因：\(item.reason?.isEmpty == false ? item.reason! : "替换")")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                    if let prompt = item.prompt, !prompt.isEmpty {
                        Text("提示词")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        Text(prompt)
                            .font(.body)
                            .foregroundStyle(AppTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                    Button {
                        dismiss()
                        onRestore()
                    } label: {
                        Label("恢复此版本", systemImage: "arrow.uturn.backward.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 46)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                }
                .padding(16)
            }
            .pageBackground(.browsing)
            .navigationTitle("历史封面")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .task(id: "\(novelID)-\(item.id)") {
            do {
                let data = try await AdminAPI.aiCoverHistoryImage(novelId: novelID, historyID: item.id)
                guard !Task.isCancelled, let decoded = UIImage(data: data) else { return }
                image = decoded
                failed = false
            } catch {
                guard !Task.isCancelled else { return }
                failed = true
            }
        }
    }

}

private struct AdminCoverPromptEditorSheet: View {
    let prompt: String
    let maxCharacters: Int
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var editorFocused: Bool
    @State private var draft = ""
    @State private var showCloseConfirmation = false

    private var isDirty: Bool { draft != prompt }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text("完整描述词")
                        .font(.headline)
                        .foregroundStyle(AppTheme.textPrimary)
                    TextEditor(text: $draft)
                        .focused($editorFocused)
                        .font(.body)
                        .frame(minHeight: 320)
                        .scrollContentBackground(.hidden)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(AppLayout.textEditorInset)
                        .appFieldSurface()
                        .onChange(of: draft) { _, value in
                            if value.count > maxCharacters {
                                draft = String(value.prefix(maxCharacters))
                            }
                        }
                    HStack {
                        Text("长描述词可滚动编辑，生成失败时会保留原词。")
                        Spacer()
                        Text("\(draft.count)/\(maxCharacters)")
                    }
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .pageBackground(.browsing)
            .navigationTitle("编辑提示词")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { requestClose() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("使用") { save() }
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isDirty)
        .confirmationDialog("有未保存的描述词修改", isPresented: $showCloseConfirmation, titleVisibility: .visible) {
            Button("保存并使用") { save() }
            Button("放弃修改", role: .destructive) { dismiss() }
            Button("继续编辑", role: .cancel) {}
        } message: {
            Text("关闭后会丢失当前编辑。")
        }
        .onAppear {
            draft = prompt
            editorFocused = false
        }
    }

    private func requestClose() {
        if isDirty {
            showCloseConfirmation = true
        } else {
            dismiss()
        }
    }

    private func save() {
        let value = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxCharacters))
        onSave(value)
        dismiss()
    }
}
