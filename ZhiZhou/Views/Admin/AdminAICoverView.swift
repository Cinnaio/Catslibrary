import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// AI 封面生成：选书 → 生成描述词 → 生成封面（后台任务）→ 轮询 → 候选采纳/弃用/上传。
/// 对齐 Web 端 admin ai AiCoverPanel（/api/ai/cover/*）。
struct AdminAICoverView: View {
    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var selectedNovelId = ""
    @State private var novelSearch = ""
    @State private var showNovelPicker = false

    // 生成配置
    @State private var renderTitle = true
    @State private var platform = "default"
    @State private var prompt = ""
    @State private var generatingPrompt = false

    // 任务
    @State private var generating = false
    @State private var taskStatusText: String?
    @State private var pollTask: Task<Void, Never>?

    // 候选
    @State private var candidates: [AiCoverCandidate] = []
    @State private var candidatesLoaded = false
    @State private var candidateBusy = ""

    // 上传
    @State private var showPhotoPicker = false
    @State private var pickedItem: PhotosPickerItem?

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
        .task { await initialLoad() }
        .sheet(isPresented: $showNovelPicker) {
            NovelPickerSheet(
                options: novelOptions,
                search: $novelSearch,
                selectedId: selectedNovelId,
                onSelect: { id in
                    selectedNovelId = id
                    prompt = ""
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
        .onDisappear {
            pollTask?.cancel()
        }
    }

    // MARK: - 选书

    private var novelSection: some View {
        Section {
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
                    Label("选择小说", systemImage: "book.closed")
                }
            }
        } header: {
            Text("目标小说")
        }
    }

    private var selectedNovel: AdminNovelSummary? {
        novelOptions.first { $0.id == selectedNovelId }
    }

    // MARK: - 生成配置

    private var configSection: some View {
        Section("生成配置") {
            Toggle("封面渲染书名", isOn: $renderTitle)
            Picker("平台风格", selection: $platform) {
                ForEach(platformOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .disabled(selectedNovelId.isEmpty)

            TextField("封面描述词（可选，留空自动生成）", text: $prompt, axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Button {
                Task { await generatePrompt() }
            } label: {
                if generatingPrompt {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Label("AI 生成描述词", systemImage: "wand.and.stars")
                }
            }
            .disabled(generatingPrompt || selectedNovelId.isEmpty)

            Button {
                Task { await generateCover() }
            } label: {
                if generating {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Label("生成封面", systemImage: "sparkles")
                }
            }
            .disabled(generating || selectedNovelId.isEmpty)
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.primary)

            if let taskStatusText {
                Label(taskStatusText, systemImage: "hourglass")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Button {
                showPhotoPicker = true
            } label: {
                Label("上传本地图片替换封面", systemImage: "photo.badge.plus")
            }
            .disabled(selectedNovelId.isEmpty)
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
        HStack(alignment: .top, spacing: 10) {
            candidateImage(candidate)
                .frame(width: 66, height: 99)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                if let promptText = candidate.prompt, !promptText.isEmpty {
                    Text(promptText)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(3)
                }
                Text(AdminFormat.relativeTime(candidate.createdAt ?? 0))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                Spacer(minLength: 0)
                HStack(spacing: 12) {
                    Button("采纳") {
                        Task { await adopt(candidate) }
                    }
                    .font(.subheadline)
                    .disabled(!candidateBusy.isEmpty)
                    Button("弃用", role: .destructive) {
                        Task { await discard(candidate) }
                    }
                    .font(.subheadline)
                    .disabled(!candidateBusy.isEmpty)
                    if candidateBusy == candidate.id {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, 2)
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
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generatePrompt() async {
        guard !selectedNovelId.isEmpty else { return }
        generatingPrompt = true
        defer { generatingPrompt = false }
        do {
            let result = try await AdminAPI.aiCoverPrompt(novelId: selectedNovelId, renderTitle: renderTitle, platform: platform)
            prompt = result.prompt
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generateCover() async {
        guard !selectedNovelId.isEmpty else { return }
        generating = true
        taskStatusText = "任务已提交，等待队列…"
        defer { generating = false }
        do {
            let result = try await AdminAPI.aiGenerateCover(
                novelId: selectedNovelId,
                prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
                renderTitle: renderTitle,
                platform: platform
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
