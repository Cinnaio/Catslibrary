import SwiftUI
import ZhiZhouCore

/// 章节管理：选择小说 → 章节列表（搜索 / 编辑 / 新建 / 删除）。
/// 对齐 Web 端 admin ChaptersTab（/api/chapters 系列接口）。
struct AdminChaptersView: View {
    init(initialNovel: Novel? = nil) {
        if let novel = initialNovel {
            let summary = AdminNovelSummary(id: novel.id, title: novel.title, author: novel.author,
                                           chapterCount: novel.chapterCount, updatedAt: novel.updatedAt)
            _selectedNovel = State(initialValue: summary)
            _novelOptions = State(initialValue: [summary])
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var requests = ListRequestGuard<String?>()
    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var selectedNovel: AdminNovelSummary?
    @State private var displayedNovelID: String?
    @State private var chapters: [ChapterMeta] = []
    @State private var chapterSearch = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showNovelPicker = false
    @State private var showSourceSync = false
    @State private var editorIntent: ChapterEditorIntent?
    @State private var deleteTarget: ChapterMeta?
    @State private var busyChapterId: String?
    @State private var actionError: String?

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("章节管理")
            if let selectedNovel {
                AppAdaptiveRow(spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(selectedNovel.title)
                            .font(serifFont(.title3, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(selectedNovel.author) · \(selectedNovel.chapterCount) 章")
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                    Spacer(minLength: 8)
                    Button("换一本") { showNovelPicker = true }
                        .buttonStyle(.borderless)
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                        .disabled(busyChapterId != nil)
                }
            }
            if let errorMessage, !chapters.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await loadChapters() }
                }
            }
            if isTransitioning {
                Label(isLoading ? "正在读取所选作品，以下仍是上一本的章节" : "以下仍是上一本的章节，请重试读取",
                      systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .accessibilityValue(isLoading ? "正在加载" : "加载未完成")
            }
            chapterResults
                .opacity(isTransitioning ? 0.45 : 1)
                .disabled(isTransitioning)
        }
        .searchable(text: Binding(get: { chapterSearch }, set: { value in
            withAnimation(reduceMotion ? nil : AppMotion.micro) { chapterSearch = value }
        }), prompt: "搜索章节标题")
        .refreshable { await loadChapters() }
        .task { await loadChapters() }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button("选择小说", systemImage: "book.closed") { showNovelPicker = true }
                        .disabled(busyChapterId != nil)
                    Button("从源站融合", systemImage: "arrow.triangle.2.circlepath") {
                        showSourceSync = true
                    }
                    .disabled(selectedNovel == nil || isTransitioning)
                } label: {
                    Label("更多", systemImage: "ellipsis")
                        .labelStyle(.iconOnly)
                }
                Button("新建章节", systemImage: "plus") {
                    editorIntent = .create
                }
                .labelStyle(.iconOnly)
                .disabled(selectedNovel == nil || isTransitioning || busyChapterId != nil)
            }
        }
        .sheet(isPresented: $showNovelPicker) {
            NovelPickerSheet(options: novelOptions, selectedNovelID: selectedNovel?.id) { novel in
                selectedNovel = novel
                Task { await loadChapters() }
            }
            .task {
                guard let token = APIClient.shared.token else { return }
                if let index: NovelIndexResponse = try? await AdminAPI.parityRequest("GET", "/api/admin/novel-index?limit=2000", token: token),
                   !Task.isCancelled, APIClient.shared.token == token {
                    novelOptions = index.novels
                    if let selectedNovel, !novelOptions.contains(where: { $0.id == selectedNovel.id }) {
                        novelOptions.insert(selectedNovel, at: 0)
                    }
                }
            }
        }
        .sheet(isPresented: $showSourceSync) {
            if let selectedNovel {
                SourceSyncSheet(novel: selectedNovel) {
                    Task { await loadChapters() }
                }
            }
        }
        .sheet(item: $editorIntent) { intent in
            ChapterEditSheet(novel: selectedNovel, chapter: intent.chapter) { chapter in
                if let idx = chapters.firstIndex(where: { $0.id == chapter.id }) {
                    chapters[idx] = chapter
                } else {
                    chapters.append(chapter)
                    chapters.sort { $0.order < $1.order }
                }
                if var novel = selectedNovel {
                    novel = AdminNovelSummary(
                        id: novel.id, title: novel.title, author: novel.author,
                        chapterCount: chapters.count, updatedAt: novel.updatedAt
                    )
                    selectedNovel = novel
                }
            }
        }
        .confirmationDialog(
            "删除章节",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除「\(deleteTarget?.title ?? "")」", role: .destructive) {
                guard let target = deleteTarget else { return }
                Task { await delete(target) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("该操作不可恢复。")
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 列表

    private var isTransitioning: Bool {
        !chapters.isEmpty && displayedNovelID != selectedNovel?.id
    }

    @ViewBuilder
    private var chapterResults: some View {
        if isLoading && chapters.isEmpty {
            AppLoadingState(selectedNovel == nil ? "正在读取作品…" : "正在读取章节…")
                .frame(minHeight: 160)
        } else if let errorMessage, chapters.isEmpty {
            ContentUnavailableView {
                Label("加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await loadChapters() } }
            }
        } else if selectedNovel == nil {
            ContentUnavailableView {
                Label("未选择小说", systemImage: "book.closed")
            } description: {
                Text("先选择要管理章节的小说。")
            } actions: {
                Button("选择小说") { showNovelPicker = true }
            }
        } else if filteredChapters.isEmpty {
            ContentUnavailableView {
                Label("暂无章节", systemImage: "doc.text")
            } description: {
                Text(chapterSearch.isEmpty ? "这本书还没有章节，点右上角 + 新建。" : "没有匹配「\(chapterSearch)」的章节。")
            }
        } else {
            AdminWorkspaceSection("章节（\(filteredChapters.count)）") {
                ForEach(Array(filteredChapters.enumerated()), id: \.element.id) { index, chapter in
                    chapterRow(chapter)
                        .readingSpaceEntrance(index)
                        .transition(reduceMotion ? .identity : .opacity)
                }
            }
        }
    }

    private var filteredChapters: [ChapterMeta] {
        let trimmed = chapterSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return chapters }
        return chapters.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

    private func chapterRow(_ chapter: ChapterMeta) -> some View {
        HStack(spacing: 10) {
            Text("\(chapter.order)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(minWidth: 24, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(chapter.title)
                    .font(serifFont(.body, .medium))
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(chapter.wordCount) 字 · \(AdminFormat.relativeTime(chapter.createdAt))")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            Spacer()
            if busyChapterId == chapter.id {
                AdminInlineProgress()
            } else {
                Menu {
                    Button("编辑", systemImage: "pencil") {
                        editorIntent = .edit(chapter)
                    }
                    Button("删除", systemImage: "trash", role: .destructive) {
                        deleteTarget = chapter
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 44, height: 44)
                }
                .disabled(busyChapterId != nil)
                .accessibilityLabel("章节操作")
            }
        }
        .contextMenu {
            Button("编辑", systemImage: "pencil") {
                editorIntent = .edit(chapter)
            }
            Button("删除", systemImage: "trash", role: .destructive) {
                deleteTarget = chapter
            }
        }
    }

    // MARK: - 数据

    private func loadChapters() async {
        let ticket = requests.begin(selectedNovel?.id)
        isLoading = true
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        guard let selectedNovel else {
            if novelOptions.isEmpty {
                do {
                    let index = try await AdminAPI.novelIndex(limit: 2000)
                    guard !Task.isCancelled, requests.accepts(ticket, query: self.selectedNovel?.id) else { return }
                    novelOptions = index.novels
                    errorMessage = nil
                } catch {
                    guard !Task.isCancelled, requests.accepts(ticket, query: self.selectedNovel?.id) else { return }
                    errorMessage = AppCopy.friendlyError(error)
                }
            }
            return
        }
        do {
            let result = try await AdminAPI.chapters(novelId: selectedNovel.id)
            guard !Task.isCancelled, requests.accepts(ticket, query: self.selectedNovel?.id) else { return }
            chapters = result
            displayedNovelID = selectedNovel.id
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: self.selectedNovel?.id) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func delete(_ chapter: ChapterMeta) async {
        guard busyChapterId == nil else { return }
        busyChapterId = chapter.id
        defer { busyChapterId = nil }
        do {
            try await AdminAPI.deleteChapter(id: chapter.id)
            chapters.removeAll { $0.id == chapter.id }
            if var novel = selectedNovel {
                novel = AdminNovelSummary(
                    id: novel.id, title: novel.title, author: novel.author,
                    chapterCount: chapters.count, updatedAt: novel.updatedAt
                )
                selectedNovel = novel
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - 源站同步

private struct SourceSyncSheet: View {
    let novel: AdminNovelSummary
    let onApplied: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case title, author, url }
    @State private var isApplying = false
    @State private var sourceURL = ""
    @State private var searchTitle = ""
    @State private var searchAuthor = ""
    @State private var sourceSearch: TitleSourceSearchResponse?
    @State private var isSearching = false
    @State private var preview: SourceSyncPreview?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var metadataFields: Set<String> = ["title", "author", "description", "coverUrl", "categories", "status"]
    @State private var replaceMetadata = false
    @State private var expandedSearchSites: Set<String> = []
    @State private var confirmedChangeIds: Set<String> = []
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    private let metadataLabels: [(String, String)] = [
        ("title", "标题"),
        ("author", "作者"),
        ("description", "简介"),
        ("coverUrl", "封面"),
        ("categories", "分类"),
        ("status", "状态"),
    ]

    var body: some View {
        NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading("源站同步", detail: novel.title)
                sourceSearchFields
                if let sourceSearch {
                    ForEach(sourceSearch.sources.keys.sorted(), id: \.self) { id in
                        if let bucket = sourceSearch.sources[id] {
                            sourceCandidates(siteKey: id, title: bucket.siteName ?? bucket.results.first?.siteName ?? siteName(id), bucket: bucket)
                                .opacity(isSearching ? 0.45 : 1)
                                .disabled(isSearching || isLoading)
                        }
                    }
                }
                sourceAddressFields
                if let preview { previewSections(preview) }
            }
            .buttonStyle(.borderless)
            .disabled(isApplying)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(isApplying)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        focusedField = nil
                        requestApplyPreview()
                    } label: {
                        HStack(spacing: 6) {
                            if isApplying { ProgressView().controlSize(.small).accessibilityHidden(true) }
                            Text("应用同步")
                        }
                    }
                    .disabled(preview == nil || isLoading || isSearching || isApplying)
                    .accessibilityValue(isApplying ? "正在应用同步" : "")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { focusedField = nil }
                }
            }
            .task {
                searchTitle = novel.title
                searchAuthor = novel.author
                await loadBinding()
            }
            .alert("操作未完成", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
                guard operation.action == .replaceSourceMetadata else { return }
                Task { await applyPreview(operationID: operation.operationID) }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .interactiveDismissDisabled(isApplying)
    }

    private var sourceSearchFields: some View {
        AdminWorkspaceSection("搜索原作者源站") {
            AccountSettingsField("书名", isFocused: focusedField == .title) {
                TextField("书名", text: $searchTitle).focused($focusedField, equals: .title)
            }
            AccountSettingsField("作者", isFocused: focusedField == .author) {
                TextField("作者（可选）", text: $searchAuthor).focused($focusedField, equals: .author)
            }
            Button {
                focusedField = nil
                Task { await searchSources() }
            } label: {
                AccountSettingsActionLabel(title: "搜索原作者作品", symbol: "magnifyingglass", isWorking: isSearching)
            }
            .disabled(isLoading || isSearching || (searchTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && searchAuthor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            AccountSettingsNote("先选择准确的作品，再读取详情和章节目录。每个源站默认显示前 5 条结果，展开后可查看全部。")
        }
        .disabled(isSearching || isLoading)
    }

    private var sourceAddressFields: some View {
        AdminWorkspaceSection("原作者源站") {
            AccountSettingsField("源站地址", isFocused: focusedField == .url) {
                TextField("原作者源站 URL", text: Binding(get: { sourceURL }, set: { value in
                    sourceURL = value
                    preview = nil
                    confirmedChangeIds.removeAll()
                }))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .url)
            }
            Button {
                focusedField = nil
                Task { await loadPreview() }
            } label: {
                AccountSettingsActionLabel(title: "读取源站并预览", symbol: "arrow.down.circle", isWorking: isLoading && !isApplying)
            }
            .disabled(isLoading || isSearching || sourceURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            AccountSettingsNote("这里只读取小说信息和章节目录。无法访问时可在 Web 端手动粘贴。")
        }
        .disabled(isLoading || isSearching)
    }

    @ViewBuilder
    private func previewSections(_ preview: SourceSyncPreview) -> some View {
        AdminWorkspaceSection("同步预览") {
            LabeledContent("源站", value: preview.siteName ?? siteName(preview.site))
            LabeledContent("目录章节", value: "\(preview.sourceChapterCount) 章")
            LabeledContent("本地内容", value: "\(preview.localChapterCount) 节")
            LabeledContent("已匹配", value: "\(preview.matchedSourceCount) 章")
            if preview.splitLocalChapterCount > 0 {
                LabeledContent("拆分节", value: "\(preview.splitLocalChapterCount) 节")
            }
            if !preview.unmatchedSource.isEmpty || !preview.unmatchedLocal.isEmpty {
                Text("未匹配：源站 \(preview.unmatchedSource.count) 章，本地 \(preview.unmatchedLocal.count) 节")
                    .foregroundStyle(AppTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(preview.warnings, id: \.self) { warning in
                Text(warning).foregroundStyle(AppTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        AdminWorkspaceSection("小说信息") {
            ForEach(Array(metadataLabels.enumerated()), id: \.offset) { item in
                let key = item.element.0
                let label = item.element.1
                Toggle(isOn: Binding(
                    get: { metadataFields.contains(key) },
                    set: { enabled in
                        if enabled { metadataFields.insert(key) } else { metadataFields.remove(key) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(label)
                        Text(metadataValue(key, preview: preview).isEmpty ? "未识别" : metadataValue(key, preview: preview))
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .appTextLineLimit(3)
                    }
                }
                .disabled(metadataValue(key, preview: preview).isEmpty)
            }
            Toggle("覆盖已有小说信息", isOn: $replaceMetadata)
            AccountSettingsNote("默认只补全本地为空的字段；开启覆盖后才会替换已有标题、作者、简介等信息。")
        }
        if !preview.mappings.filter({ $0.relation == "split" }).isEmpty {
            AdminWorkspaceSection("拆分章节映射") {
                ForEach(preview.mappings.filter { $0.relation == "split" }.prefix(30)) { mapping in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("源站第 \(mapping.sourceOrder) 章「\(mapping.sourceTitle)」")
                            .font(serifFont(.body))
                        Text("→ 本地 \(mapping.localChapterIds.count) 节 · \(confidenceName(mapping.confidence))")
                            .font(.caption)
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        chapterChanges(preview)
    }

    private func chapterChanges(_ preview: SourceSyncPreview) -> some View {
        let automaticChanges = preview.changes.filter(\.eligible)
        let manualChanges = preview.changes.filter { !$0.eligible }
        let confirmedManualCount = manualChanges.filter { confirmedChangeIds.contains($0.id) }.count

        return AdminWorkspaceSection("章节名变更（\(preview.changes.count)）") {
            if preview.changes.isEmpty {
                AccountSettingsNote("没有需要变更的章节名")
            } else {
                AppAdaptiveRow {
                    Label("自动应用 \(automaticChanges.count) 项", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(AppTheme.success)
                    Spacer(minLength: 8)
                    if !manualChanges.isEmpty {
                        Text("已确认 \(confirmedManualCount)/\(manualChanges.count) 项")
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                }
                .font(.footnote)
                if !manualChanges.isEmpty {
                    Button {
                        let ids = manualChanges.map(\.id)
                        if confirmedManualCount == manualChanges.count {
                            confirmedChangeIds.subtract(ids)
                        } else {
                            confirmedChangeIds.formUnion(ids)
                        }
                    } label: {
                        Label(
                            confirmedManualCount == manualChanges.count ? "取消全部人工确认" : "确认全部人工变更",
                            systemImage: confirmedManualCount == manualChanges.count ? "checkmark.circle" : "checkmark.circle.fill"
                        )
                        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                    }
                }
                ForEach(preview.changes.prefix(80)) { change in
                    sourceSyncChangeRow(change)
                }
                if preview.changes.count > 80 {
                    AccountSettingsNote("另有 \(preview.changes.count - 80) 项未显示")
                }
            }
            AccountSettingsNote(manualChanges.isEmpty
                ? "点击右上角“应用同步”后，将自动应用这些章节名变更。"
                : "高置信度变更会自动应用；低置信度变更需要先打开右侧开关确认，未确认的项目不会修改。")
        }
    }

    private func sourceSyncChangeRow(_ change: SourceSyncChange) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(change.localOrder).")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(width: 30, alignment: .trailing)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top, spacing: 6) {
                    Text("本地")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Text(change.oldTitle)
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.ink)
                        .appTextLineLimit(2)
                }

                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "arrow.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                        .frame(width: 16)
                    Text(change.newTitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(ReadingSpace.ink)
                        .appTextLineLimit(2)
                }

                if change.partCount > 1 {
                    Text("拆分 \(change.partIndex)/\(change.partCount) · \(confidenceName(change.confidence))")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                } else if change.eligible {
                    Text("高置信度 · 将自动应用")
                        .font(.caption)
                        .foregroundStyle(AppTheme.success)
                } else {
                    Text("低置信度 · 请确认后应用")
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if change.eligible {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(AppTheme.success)
                    .frame(width: 44, height: 44)
                    .accessibilityLabel("将自动应用")
            } else {
                Toggle(
                    "",
                    isOn: Binding(
                        get: { confirmedChangeIds.contains(change.id) },
                        set: { confirmed in
                            if confirmed {
                                confirmedChangeIds.insert(change.id)
                            } else {
                                confirmedChangeIds.remove(change.id)
                            }
                        }
                    )
                )
                .labelsHidden()
                .tint(AppTheme.primary)
                .frame(width: 44, height: 44)
                .accessibilityLabel("确认应用第 \(change.localOrder) 项章节名变更")
            }
        }
        .padding(.vertical, 6)
    }

    private func loadBinding() async {
        do {
            let bindings = try await AdminAPI.sourceBindings(novelId: novel.id)
            if let primary = bindings.first(where: { $0.isPrimary }) ?? bindings.first {
                sourceURL = primary.sourceUrl
            }
        } catch {
            // 没有已绑定源站时保持空输入，允许管理员手动填写。
        }
    }

    private func searchSources() async {
        let title = searchTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let author = searchAuthor.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty || !author.isEmpty else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            sourceSearch = try await AdminAPI.titleSourceSearch(title: title, author: author)
            expandedSearchSites.removeAll()
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    @ViewBuilder
    private func sourceCandidates(siteKey: String, title: String, bucket: TitleSourceSearchBucket) -> some View {
        let isExpanded = expandedSearchSites.contains(siteKey)
        let visibleResults = isExpanded ? bucket.results : Array(bucket.results.prefix(5))

        AdminWorkspaceSection(title) {
            if !bucket.results.isEmpty {
                AccountSettingsNote("\(bucket.results.count) 个结果")
            }
            if let error = bucket.error, !error.isEmpty {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.warning)
            }

            if bucket.results.isEmpty {
                Text(bucket.ok ? "没有结果" : "搜索不可用")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
            } else {
                ForEach(Array(visibleResults.enumerated()), id: \.element.id) { index, candidate in
                    sourceCandidateRow(candidate)
                        .readingSpaceEntrance(index)
                        .transition(reduceMotion ? .identity : .opacity)
                }

                if bucket.results.count > 5 {
                    Button {
                        if isExpanded {
                            expandedSearchSites.remove(siteKey)
                        } else {
                            expandedSearchSites.insert(siteKey)
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                                .font(.caption.weight(.semibold))
                            Text(isExpanded ? "收起结果" : "查看全部 \(bucket.results.count) 个结果")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                        }
                        .foregroundStyle(AppTheme.primary)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func sourceCandidateRow(_ candidate: TitleSourceCandidate) -> some View {
        Button {
            sourceURL = candidate.url
            Task { await loadPreview(url: candidate.url) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(candidate.title.isEmpty ? "未识别书名" : candidate.title)
                            .font(serifFont(.body, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .appTextLineLimit(2)
                            .layoutPriority(1)

                        if !candidate.status.isEmpty {
                            Text(candidate.status == "completed" ? "完结" : "连载")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(AppTheme.primary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(AppTheme.primaryLight, in: Capsule())
                        }
                    }

                    Text(candidate.author.isEmpty ? "作者未识别" : candidate.author)
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "arrow.down.circle")
                    .font(.title3)
                    .foregroundStyle(AppTheme.primary)
                    .frame(width: 44, height: 44)
                    .accessibilityLabel("选择并读取源站")
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func loadPreview(url overrideURL: String? = nil) async {
        let url = (overrideURL ?? sourceURL).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        sourceURL = url
        preview = nil
        isLoading = true
        defer { isLoading = false }
        do {
            preview = try await AdminAPI.sourceSyncPreview(novelId: novel.id, sourceUrl: url)
            confirmedChangeIds.removeAll()
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func requestApplyPreview() {
        guard let preview else { return }
        guard replaceMetadata, !metadataFields.isEmpty else {
            Task { await applyPreview() }
            return
        }
        let fields = metadataFields.sorted()
        pendingDangerousOperation = AdminDangerousOperation(
            action: .replaceSourceMetadata,
            kind: .overwrite,
            targetIDs: [novel.id, preview.runId],
            title: "覆盖已有小说信息",
            message: "将用源站数据覆盖当前小说的 \(fields.count) 个已选信息字段。章节名只会应用预览中自动通过或已人工确认的变更。",
            confirmLabel: "确认覆盖并同步"
        )
    }

    private func applyPreview(operationID: String = "") async {
        guard let preview, !isApplying else { return }
        isLoading = true
        isApplying = true
        defer {
            isLoading = false
            isApplying = false
        }
        do {
            _ = try await AdminAPI.sourceSyncApply(
                runId: preview.runId,
                metadataFields: Array(metadataFields),
                replaceMetadata: replaceMetadata,
                confirmedChangeIds: Array(confirmedChangeIds),
                operationID: operationID
            )
            onApplied()
            dismiss()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func siteName(_ site: String) -> String {
        switch site {
        case "jjwxc": return "晋江"
        default: return site
        }
    }

    private func confidenceName(_ confidence: String) -> String {
        switch confidence {
        case "high": return "高置信度"
        case "medium": return "中置信度"
        default: return "低置信度"
        }
    }

    private func metadataValue(_ key: String, preview: SourceSyncPreview) -> String {
        switch key {
        case "title": return preview.metadata.title
        case "author": return preview.metadata.author
        case "description": return preview.metadata.description
        case "coverUrl": return preview.metadata.coverUrl
        case "categories": return preview.metadata.categories.joined(separator: "、")
        case "status": return preview.metadata.status
        default: return ""
        }
    }
}

// MARK: - 章节编辑/新建 Sheet 意图

/// 用 `sheet(item:)` 驱动编辑/新建弹窗，避免 `sheet(isPresented:)` 内容闭包读到旧快照，
/// 导致长按「编辑」时弹窗却按「新建」渲染。
private enum ChapterEditorIntent: Identifiable {
    case create
    case edit(ChapterMeta)

    var id: String {
        switch self {
        case .create: return "create"
        case .edit(let chapter): return "edit-\(chapter.id)"
        }
    }

    /// 编辑时返回目标章节；新建时为 nil。
    var chapter: ChapterMeta? {
        switch self {
        case .create: return nil
        case .edit(let chapter): return chapter
        }
    }
}

// MARK: - 选书 Sheet

private struct NovelPickerSheet: View {
    let options: [AdminNovelSummary]
    let selectedNovelID: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var query = ""
    let onPick: (AdminNovelSummary) -> Void

    private var filtered: [AdminNovelSummary] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return options }
        return options.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed) || $0.author.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading("选择小说", detail: "按书名或作者查找要管理的作品。")
                if filtered.isEmpty {
                    ContentUnavailableView {
                        Label(options.isEmpty ? "暂无小说" : "没有找到小说", systemImage: "magnifyingglass")
                    } description: {
                        Text(options.isEmpty ? "暂无可选择的作品。" : "试试其他关键词。")
                    }
                } else {
                    AdminWorkspaceSection("全库索引（\(filtered.count)）") {
                        ForEach(Array(filtered.enumerated()), id: \.element.id) { index, novel in
                            Button {
                                onPick(novel)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(novel.title)
                                            .font(serifFont(.body, .medium))
                                            .foregroundStyle(ReadingSpace.ink)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text("\(novel.author) · \(novel.chapterCount) 章")
                                            .font(.footnote)
                                            .foregroundStyle(ReadingSpace.profileMuted)
                                    }
                                    Spacer(minLength: 8)
                                    if novel.id == selectedNovelID {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(AppTheme.primary)
                                            .accessibilityHidden(true)
                                    }
                                }
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(novel.id == selectedNovelID ? ReadingSpace.profileFill : Color.clear)
                            .accessibilityAddTraits(novel.id == selectedNovelID ? .isSelected : [])
                            .readingSpaceEntrance(index)
                            .transition(reduceMotion ? .identity : .opacity)
                        }
                    }
                }
            }
            .searchable(text: Binding(get: { query }, set: { value in
                withAnimation(reduceMotion ? nil : AppMotion.micro) { query = value }
            }), prompt: "搜索书名 / 作者")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
    }
}

// MARK: - 章节编辑 Sheet

private struct ChapterEditSheet: View {
    let novel: AdminNovelSummary?
    let chapter: ChapterMeta?
    @Environment(\.dismiss) private var dismiss
    @State private var order = 1
    @State private var title = ""
    @State private var content = ""
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case title, content }
    @State private var detailLoaded = false
    @State private var baseRevision: String?
    @State private var loadingDetail = false
    @State private var saving = false
    @State private var errorMessage: String?
    let onSaved: (ChapterMeta) -> Void

    private var isEditing: Bool { chapter != nil }

    var body: some View {
        NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading(isEditing ? "编辑章节" : "新建章节", detail: novel?.title ?? "")
                AdminWorkspaceSection("基本信息") {
                    Stepper(value: $order, in: 1...100000) {
                        LabeledContent("序号", value: "\(order)")
                    }
                    AccountSettingsField("章节标题（必填）", isFocused: focusedField == .title) {
                        TextField("章节标题 *", text: $title)
                            .focused($focusedField, equals: .title)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .content }
                    }
                }
                AdminWorkspaceSection("正文") {
                    if loadingDetail {
                        AppLoadingState("正在读取正文…", placement: .inline)
                    } else if !isEditing || detailLoaded {
                        AccountSettingsField("章节内容", isFocused: focusedField == .content) {
                            TextEditor(text: $content)
                                .scrollContentBackground(.hidden)
                                .frame(minHeight: 280)
                                .focused($focusedField, equals: .content)
                                .accessibilityLabel("章节正文")
                        }
                    }
                }
                if let errorMessage {
                    AccountSettingsNote(errorMessage, isError: true)
                    if isEditing && !detailLoaded && !loadingDetail {
                        Button("重试读取正文") { loadDetail() }
                            .buttonStyle(.borderless)
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                }
            }
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        focusedField = nil
                        save()
                    } label: {
                        HStack(spacing: 6) {
                            if saving { ProgressView().controlSize(.small).accessibilityHidden(true) }
                            Text(isEditing ? "保存" : "创建")
                        }
                    }
                    .disabled(saving || loadingDetail || (isEditing && !detailLoaded))
                    .accessibilityValue(saving ? "正在保存" : "")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { focusedField = nil }
                }
            }
            .onAppear(perform: seed)
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .interactiveDismissDisabled(saving)
    }

    private func seed() {
        guard let chapter else { return }
        if !title.isEmpty { return }
        order = chapter.order
        title = chapter.title
        loadDetail()
    }

    private func loadDetail() {
        guard let chapter, !loadingDetail else { return }
        errorMessage = nil
        loadingDetail = true
        Task {
            defer { loadingDetail = false }
            do {
                let full = try await AdminAPI.chapterDetail(id: chapter.id)
                guard let revision = full.revision, !revision.isEmpty else {
                    errorMessage = "章节版本缺失，请确认服务端已更新后重试。"
                    return
                }
                title = full.title
                order = full.order
                content = full.content
                baseRevision = revision
                detailLoaded = true
            } catch {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }

    private func save() {
        guard !saving, !loadingDetail, !isEditing || detailLoaded else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "章节标题不能为空"
            return
        }
        saving = true
        Task {
            defer { saving = false }
            do {
                if let chapter {
                    guard let baseRevision else {
                        errorMessage = "请重新读取章节后再保存。"
                        return
                    }
                    let full = try await AdminAPI.updateChapter(id: chapter.id, baseRevision: baseRevision, ["title": trimmedTitle, "content": content, "order": order])
                    let meta = ChapterMeta(
                        id: full.id, novelId: full.novelId, title: full.title, order: full.order,
                        wordCount: full.wordCount, sourceUrl: full.sourceUrl, createdAt: full.createdAt
                    )
                    onSaved(meta)
                } else {
                    guard let novelId = novel?.id else {
                        errorMessage = "请先选择小说"
                        return
                    }
                    let full = try await AdminAPI.createChapter(["novelId": novelId, "title": trimmedTitle, "content": content, "order": order])
                    let meta = ChapterMeta(
                        id: full.id, novelId: full.novelId, title: full.title, order: full.order,
                        wordCount: full.wordCount, sourceUrl: full.sourceUrl, createdAt: full.createdAt
                    )
                    onSaved(meta)
                }
                dismiss()
            } catch {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }
}
