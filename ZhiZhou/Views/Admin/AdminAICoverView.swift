import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

/// AI 封面生成：选书 → 生成描述词 → 生成封面（后台任务）→ 轮询 → 候选采纳/弃用/上传。
/// 对齐 Web 端 admin ai AiCoverPanel（/api/ai/cover/*）。
struct AdminAICoverView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("zhizhou.ai.coverPromptTaskId") private var pendingPromptTaskId = ""
    @AppStorage("zhizhou.ai.coverPromptRequestId") private var pendingPromptRequestId = ""
    @AppStorage("zhizhou.ai.coverPromptNovelId") private var pendingPromptNovelId = ""
    @AppStorage("zhizhou.ai.coverPromptStartedAt") private var pendingPromptStartedAt = 0

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
    @State private var generatingPrompt = false

    // 任务
    @State private var generating = false
    @State private var taskStatusText: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var promptPollTask: Task<Void, Never>?

    // 候选
    @State private var candidates: [AiCoverCandidate] = []
    @State private var candidatesLoaded = false
    @State private var candidateBusy = ""
    @State private var pendingDiscard: AiCoverCandidate?
    @State private var previewCandidate: AiCoverCandidate?
    @State private var promptCandidate: AiCoverCandidate?

    // 上传
    @State private var showPhotoPicker = false
    @State private var pickedItem: PhotosPickerItem?
    @State private var uploading = false

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
        ("cinematic", "电影概念设计"),
        ("illustration", "编辑插画"),
        ("ink", "东方水墨"),
        ("minimal", "极简海报"),
        ("noir", "黑色电影"),
        ("graphic", "现代平面设计"),
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
                candidateSection
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("封面生成")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await loadCandidates() }
        .scrollDismissesKeyboard(.interactively)
        .task {
            await initialLoad()
            await resumePendingPromptTask()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await resumePendingPromptTask() }
            } else {
                // 前台流连接不跨越系统挂起；服务端任务继续执行，回到前台后重新订阅。
                promptPollTask?.cancel()
                promptPollTask = nil
                generatingPrompt = false
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
                    variationId = ""
                    promptMetadata = nil
                    showNovelPicker = false
                    Task { await loadCandidates() }
                }
            )
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedItem, matching: .images)
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task { await uploadPicked(newItem) }
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
        .fullScreenCover(item: $previewCandidate) { candidate in
            AdminCoverCandidatePreview(image: dataUrlImage(candidate.dataUrl))
        }
        .sheet(item: $promptCandidate) { candidate in
            AdminCoverPromptSheet(prompt: candidate.prompt ?? "")
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
                            .lineLimit(1)
                        Text("\(novel.author.isEmpty ? "佚名" : novel.author) · \(novel.chapterCount) 章")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    Spacer()
                    Button("换一本") { showNovelPicker = true }
                        .font(.subheadline)
                }
            } else {
                Button {
                    showNovelPicker = true
                } label: {
                    Label("选择小说", systemImage: "book.closed")
                }
            }
        }
    }

    private var selectedNovel: AdminNovelSummary? {
        novelOptions.first { $0.id == selectedNovelId }
    }

    private var promptTaskInFlight: Bool {
        generatingPrompt || !pendingPromptTaskId.isEmpty || !pendingPromptNovelId.isEmpty
    }

    // MARK: - 生成配置

    private var configSection: some View {
        Section("生成配置") {
            Toggle("封面渲染书名", isOn: $renderTitle)

            Picker("平台版式", selection: $platform) {
                ForEach(platformOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty)

            Picker("主视觉风格", selection: $stylePreset) {
                ForEach(styleOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty || generatingPrompt || generating)

            Text("会结合题材和变体轮换，让每一版都有明确的视觉方向。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)

            Picker("构图方向", selection: $composition) {
                ForEach(compositionOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedNovelId.isEmpty || generatingPrompt || generating)

            Text("控制主体位置、镜头关系和留白方式。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)

            promptControls

            if let taskStatusText {
                Label(taskStatusText, systemImage: "hourglass")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }

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

    private var promptControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            promptEditor

            HStack(spacing: 10) {
                Button {
                    Task { await generatePrompt() }
                } label: {
                    HStack(spacing: 6) {
                        Spacer(minLength: 0)
                        if generatingPrompt {
                            ProgressView()
                        } else {
                            Label("AI 生成描述词", systemImage: "wand.and.stars")
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 38)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(promptTaskInFlight || selectedNovelId.isEmpty)

                Button {
                    Task { await generatePrompt(forceNewVariation: true) }
                } label: {
                    HStack(spacing: 6) {
                        Spacer(minLength: 0)
                        Label("换一版方向", systemImage: "arrow.triangle.2.circlepath")
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 38)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(promptTaskInFlight || generating || selectedNovelId.isEmpty)
            }

            if let promptMetadata {
                VStack(alignment: .leading, spacing: 2) {
                    Text("本版：\(label(for: promptMetadata.stylePreset, in: styleOptions)) · \(label(for: promptMetadata.composition, in: compositionOptions))")
                        .font(.caption)
                    if let direction = romanceDirectionLabel(promptMetadata) {
                        Text(direction)
                            .font(.caption)
                    }
                }
                .foregroundStyle(AppTheme.primary)
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
                            .frame(minHeight: 40)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.primary)
                .controlSize(.regular)
                .disabled(generating || selectedNovelId.isEmpty)
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
                    .foregroundStyle(AppTheme.textMuted)
                Spacer()
                Text("\(prompt.count)/\(coverPromptMaxCharacters)")
                    .font(.caption)
                    .foregroundStyle(prompt.count >= coverPromptMaxCharacters ? AppTheme.warning : AppTheme.textMuted)
            }

            ZStack(alignment: .topLeading) {
                TextEditor(text: $prompt)
                    .frame(height: 96)
                    .font(.subheadline)
                    .scrollContentBackground(.hidden)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(generatingPrompt)
                    .onChange(of: prompt) { _, value in
                        if value.count > coverPromptMaxCharacters {
                            prompt = String(value.prefix(coverPromptMaxCharacters))
                        }
                    }

                if prompt.isEmpty {
                    Text("留空自动生成，也可以直接编辑后用于生成")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textMuted)
                        .padding(.top, 8)
                        .padding(.horizontal, 5)
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 96, alignment: .topLeading)
            .clipped()
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
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
        } else if candidatesLoaded && candidates.isEmpty {
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
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }

            HStack(alignment: .top, spacing: 12) {
                candidateImage(candidate)
                    .frame(width: 96, height: 144)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onLongPressGesture(minimumDuration: 0.35, maximumDistance: 24) {
                        let generator = UIImpactFeedbackGenerator(style: .medium)
                        generator.prepare()
                        generator.impactOccurred()
                        previewCandidate = candidate
                    }
                    .accessibilityLabel("候选封面")
                    .accessibilityHint("长按查看大图")

                VStack(alignment: .leading, spacing: 8) {
                    if let promptText = candidate.prompt, !promptText.isEmpty {
                        Text(promptText)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .lineLimit(3)
                            .lineSpacing(2)

                        Button {
                            promptCandidate = candidate
                        } label: {
                            Label("查看提示词", systemImage: "doc.text")
                                .font(.caption.weight(.medium))
                        }
                        .buttonStyle(.borderless)
                        .tint(AppTheme.primary)
                        .accessibilityHint("打开完整提示词")
                    }

                    if let metadata = candidate.metadata, (metadata.stylePreset != nil || metadata.composition != nil) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(label(for: metadata.stylePreset, in: styleOptions)) · \(label(for: metadata.composition, in: compositionOptions))")
                                .font(.caption2.weight(.medium))
                                .lineLimit(2)
                            if let direction = romanceDirectionLabel(metadata) {
                                Text(direction)
                                    .font(.caption2)
                                    .lineLimit(2)
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
                HStack(spacing: 12) {
                    Button {
                        pendingDiscard = nil
                        Task { await adopt(candidate) }
                    } label: {
                        Label("采纳", systemImage: "checkmark")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(!candidateBusy.isEmpty)

                    Button(role: .destructive) {
                        pendingDiscard = candidate
                    } label: {
                        Label("弃用", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.danger)
                    .disabled(!candidateBusy.isEmpty)
                }
            }
        }
        .padding(12)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(AppTheme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
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

    /// App 回到前台或页面重新打开时，恢复尚未取回结果的提示词任务。
    private func resumePendingPromptTask() async {
        guard promptPollTask == nil else { return }
        var id = pendingPromptTaskId
        do {
            // 如果 App 在 POST 返回 taskId 前被挂起/终止，通过本地 requestId 从最近任务中找回。
            if id.isEmpty, !pendingPromptNovelId.isEmpty {
                for attempt in 0..<5 {
                    let tasks = try await AdminAPI.aiTasks(status: "all", limit: 100, offset: 0)
                    let requestMatch = tasks.items
                        .filter { task in
                            task.kind == "cover_prompt" &&
                            task.novelId == pendingPromptNovelId &&
                            (pendingPromptRequestId.isEmpty || task.params?.contains(pendingPromptRequestId) == true)
                        }
                        .max { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
                    let timeMatch = tasks.items
                        .filter { task in
                            task.kind == "cover_prompt" &&
                            task.novelId == pendingPromptNovelId &&
                            (pendingPromptStartedAt == 0 || (task.createdAt ?? 0) >= Int64(pendingPromptStartedAt - 120_000))
                        }
                        .max { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
                    if let recovered = requestMatch ?? timeMatch {
                        id = recovered.id
                        pendingPromptTaskId = recovered.id
                        break
                    }
                    if attempt < 4 {
                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                        guard !Task.isCancelled else { return }
                    }
                }
            }
            guard !id.isEmpty else {
                generatingPrompt = false
                taskStatusText = "正在恢复提示词任务…"
                return
            }
            let detail = try await AdminAPI.aiTask(id: id)
            if let novelId = detail.task.novelId, !novelId.isEmpty {
                selectedNovelId = novelId
                await loadCandidates()
            }
            startPromptStreaming(id)
        } catch {
            if case APIError.http(status: 404, message: _) = error {
                clearPendingPromptTask()
            }
            // 网络暂时失败时保留任务 ID，下次回到前台继续查询。
            generatingPrompt = false
            taskStatusText = "提示词任务暂时无法查询，请稍后重试"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generatePrompt(forceNewVariation: Bool = false) async {
        guard !selectedNovelId.isEmpty else { return }
        generatingPrompt = true
        taskStatusText = "提示词任务已提交，等待队列…"
        let clientRequestId = UUID().uuidString
        pendingPromptTaskId = ""
        pendingPromptRequestId = clientRequestId
        pendingPromptNovelId = selectedNovelId
        pendingPromptStartedAt = Int(Date().timeIntervalSince1970 * 1000)
        do {
            let requestedVariationId = forceNewVariation ? UUID().uuidString : variationId
            let result = try await AdminAPI.aiCoverPrompt(
                novelId: selectedNovelId,
                renderTitle: renderTitle,
                platform: platform,
                stylePreset: stylePreset,
                composition: composition,
                variationId: requestedVariationId,
                clientRequestId: clientRequestId
            )
            pendingPromptTaskId = result.taskId
            startPromptStreaming(result.taskId)
        } catch {
            if case APIError.network = error {
                generatingPrompt = false
                taskStatusText = "请求中断，正在后台确认任务…"
            } else {
                clearPendingPromptTask()
                taskStatusText = nil
            }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func clearPendingPromptTask() {
        pendingPromptTaskId = ""
        pendingPromptRequestId = ""
        pendingPromptNovelId = ""
        pendingPromptStartedAt = 0
    }

    /// 前台优先订阅 SSE；连接断开、代理不支持或页面回到后台时自动回退到轮询。
    private func startPromptStreaming(_ id: String) {
        promptPollTask?.cancel()
        generatingPrompt = true
        promptPollTask = Task {
            do {
                for try await event in AdminAPI.aiCoverPromptStream(id: id) {
                    guard !Task.isCancelled else { return }
                    if applyPromptTaskSnapshot(event.task) { return }
                }
                guard !Task.isCancelled, pendingPromptTaskId == id else { return }
                promptPollTask = nil
                taskStatusText = "实时连接已结束，正在继续查询…"
                startPromptPolling(id)
            } catch {
                guard !Task.isCancelled else { return }
                promptPollTask = nil
                taskStatusText = "实时连接已断开，正在继续查询…"
                startPromptPolling(id)
            }
        }
    }

    /// 应用服务端任务快照；running 快照也会把当前已生成的提示词显示出来。
    @discardableResult
    private func applyPromptTaskSnapshot(_ task: AiTaskInfo) -> Bool {
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
                taskStatusText = "封面描述词已生成，可继续编辑"
            }
            clearPendingPromptTask()
            generatingPrompt = false
            promptPollTask = nil
            return true
        }
        if ["failed", "cancelled"].contains(status) {
            taskStatusText = AdminFormat.aiTaskStatus(status)
            if let error = task.error, !error.isEmpty {
                actionError = error
            }
            clearPendingPromptTask()
            generatingPrompt = false
            promptPollTask = nil
            return true
        }
        taskStatusText = status == "running" ? "提示词生成中（实时输出）…" : "提示词生成中（等待队列）…"
        return false
    }

    /// 轮询提示词后台任务；结果已保存在服务端，App 暂停期间不影响任务本身。
    private func startPromptPolling(_ id: String) {
        guard promptPollTask == nil else { return }
        generatingPrompt = true
        promptPollTask = Task {
            var attempts = 0
            while !Task.isCancelled, attempts < 100 {
                if attempts > 0 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    guard !Task.isCancelled else { return }
                }
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    if applyPromptTaskSnapshot(detail.task) { return }
                } catch {
                    taskStatusText = AppCopy.friendlyError(error)
                    // 保留 pendingPromptTaskId；下次回到前台时继续查询。
                    generatingPrompt = false
                    promptPollTask = nil
                    return
                }
            }
            // 超过本地轮询窗口后，任务仍由服务端执行，保留 ID 等待下次前台恢复。
            generatingPrompt = false
            taskStatusText = "提示词仍在后台生成，稍后会自动恢复"
            promptPollTask = nil
        }
    }

    private func generateCover() async {
        guard !selectedNovelId.isEmpty else { return }
        let finalPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard finalPrompt.count <= coverPromptMaxCharacters else {
            actionError = "封面描述词不能超过 \(coverPromptMaxCharacters) 个字符"
            return
        }
        generating = true
        taskStatusText = "任务已提交，等待队列…"
        defer { generating = false }
        do {
            let result = try await AdminAPI.aiGenerateCover(
                novelId: selectedNovelId,
                prompt: finalPrompt,
                renderTitle: renderTitle,
                platform: platform,
                stylePreset: stylePreset,
                composition: composition,
                variationId: variationId
            )
            pollCoverTask(result.taskId)
        } catch {
            actionError = AppCopy.friendlyError(error)
            taskStatusText = nil
        }
    }

    /// 轮询封面生成任务直到结束，结束后刷新候选。
    private func pollCoverTask(_ id: String) {
        pollTask?.cancel()
        pollTask = Task {
            var attempts = 0
            while !Task.isCancelled, attempts < 100 {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                attempts += 1
                do {
                    let detail = try await AdminAPI.aiTask(id: id)
                    let status = detail.task.status ?? ""
                    if ["completed", "failed", "cancelled"].contains(status) {
                        taskStatusText = AdminFormat.aiTaskStatus(status)
                        if status == "completed" {
                            await loadCandidates()
                        }
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

    private func loadCandidates() async {
        guard !selectedNovelId.isEmpty else { return }
        do {
            let result = try await AdminAPI.aiCoverCandidates(novelId: selectedNovelId)
            candidates = result.items
            candidatesLoaded = true
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func adopt(_ candidate: AiCoverCandidate) async {
        guard candidateBusy.isEmpty else { return }
        candidateBusy = candidate.id
        defer { candidateBusy = "" }
        do {
            try await AdminAPI.aiAdoptCoverCandidate(id: candidate.id)
            await loadCandidates()
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
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func uploadPicked(_ item: PhotosPickerItem) async {
        guard !selectedNovelId.isEmpty else { return }
        uploading = true
        defer { uploading = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                actionError = "无法读取所选图片"
                return
            }
            guard let mime = item.supportedContentTypes.first?.preferredMIMEType, mime.hasPrefix("image/") else {
                actionError = "封面必须是图片文件"
                return
            }
            try await AdminAPI.aiUploadCover(novelId: selectedNovelId, imageData: data, mimeType: mime)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
        pickedItem = nil
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
                .buttonStyle(ScaleButtonStyle())
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
                            .frame(width: 40, height: 40)
                            .background(.thinMaterial, in: Circle())
                    }
                    .accessibilityLabel("关闭预览")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)

                Spacer()

                Text("双击放大 · 捏合调整大小")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.78))
                    .padding(.bottom, 18)
            }
        }
        .statusBarHidden()
    }
}

private struct AdminCoverPromptSheet: View {
    let prompt: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(prompt)
                    .font(.body)
                    .foregroundStyle(AppTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .lineSpacing(4)
                    .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("提示词")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
