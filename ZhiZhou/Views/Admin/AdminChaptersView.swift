import SwiftUI

/// 章节管理：选择小说 → 章节列表（搜索 / 编辑 / 新建 / 删除）。
/// 对齐 Web 端 admin ChaptersTab（/api/chapters 系列接口）。
struct AdminChaptersView: View {
    @State private var novelOptions: [AdminNovelSummary] = []
    @State private var selectedNovel: AdminNovelSummary?
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
        List {
            if let selectedNovel {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "book.closed.fill")
                            .foregroundStyle(AppTheme.primary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(selectedNovel.title)
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundStyle(AppTheme.textPrimary)
                                .lineLimit(1)
                            Text("\(selectedNovel.author) · \(selectedNovel.chapterCount) 章")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Spacer()
                        Button("换一本") { showNovelPicker = true }
                            .font(.subheadline)
                    }
                    .listRowBackground(Color.clear)
                }
            }

            if isLoading && chapters.isEmpty {
                Section {
                    ProgressView(selectedNovel == nil ? "加载中…" : "加载章节…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, chapters.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await loadChapters() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if selectedNovel == nil {
                Section {
                    ContentUnavailableView {
                        Label("未选择小说", systemImage: "book.closed")
                    } description: {
                        Text("先选择要管理章节的小说。")
                    } actions: {
                        Button("选择小说") { showNovelPicker = true }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if filteredChapters.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("暂无章节", systemImage: "doc.text")
                        } description: {
                            Text(chapterSearch.isEmpty ? "这本书还没有章节，点右上角 + 新建。" : "没有匹配「\(chapterSearch)」的章节。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else {
                    Section("章节（\(filteredChapters.count)）") {
                        ForEach(filteredChapters) { chapter in
                            chapterRow(chapter)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("章节管理")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $chapterSearch, prompt: "搜索章节标题")
        .refreshable { await loadChapters() }
        .task { await loadChapters() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("选择小说", systemImage: "book.closed") { showNovelPicker = true }
                    Button("从源站融合", systemImage: "arrow.triangle.2.circlepath") {
                        showSourceSync = true
                    }
                    .disabled(selectedNovel == nil)
                    Button("新建章节", systemImage: "plus") {
                        editorIntent = .create
                    }
                    .disabled(selectedNovel == nil)
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showNovelPicker) {
            NovelPickerSheet(options: novelOptions) { novel in
                selectedNovel = novel
                Task { await loadChapters() }
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

    private var filteredChapters: [ChapterMeta] {
        let trimmed = chapterSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return chapters }
        return chapters.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

    private func chapterRow(_ chapter: ChapterMeta) -> some View {
        HStack(spacing: 10) {
            Text("\(chapter.order)")
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)
                .frame(width: 34, alignment: .center)
                .padding(.vertical, 3)
                .background(AppTheme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 5))
            VStack(alignment: .leading, spacing: 3) {
                Text(chapter.title)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Text("\(chapter.wordCount) 字 · \(AdminFormat.relativeTime(chapter.createdAt))")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
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
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
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
        guard let selectedNovel else {
            if novelOptions.isEmpty {
                isLoading = true
                defer { isLoading = false }
                do {
                    let index = try await AdminAPI.novelIndex(limit: 2000)
                    novelOptions = index.novels
                    errorMessage = nil
                } catch {
                    errorMessage = AppCopy.friendlyError(error)
                }
            }
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            chapters = try await AdminAPI.chapters(novelId: selectedNovel.id)
            errorMessage = nil
        } catch {
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
            Form {
                Section {
                    TextField("书名", text: $searchTitle)
                    TextField("作者（可选）", text: $searchAuthor)
                    Button {
                        Task { await searchSources() }
                    } label: {
                        if isSearching {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("搜索晋江与 POPO", systemImage: "magnifyingglass")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isLoading || isSearching || (searchTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && searchAuthor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                } header: {
                    Text("搜索原作者源站")
                } footer: {
                    Text("先选择准确的作品，再读取详情和章节目录。每个源站默认显示前 5 条结果，展开后可查看全部。POPO 详情页需要已配置账号或 Cookie。")
                }

                if let sourceSearch {
                    sourceCandidates(siteKey: "jjwxc", title: "晋江", bucket: sourceSearch.sources.jjwxc)
                    sourceCandidates(siteKey: "po18tw", title: "POPO", bucket: sourceSearch.sources.po18tw)
                }

                Section {
                    TextField("原作者源站 URL", text: $sourceURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        Task { await loadPreview() }
                    } label: {
                        if isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("读取源站并预览", systemImage: "arrow.down.circle")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isLoading || sourceURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: {
                    Text("原作者源站")
                } footer: {
                    Text("支持晋江和 POPO。这里只读取小说信息和章节目录，不抓取正文；无法访问时请继续使用 Web 端的手动粘贴方式。")
                }

                if let preview {
                    Section {
                        LabeledContent("源站", value: siteName(preview.site))
                        LabeledContent("目录章节", value: "\(preview.sourceChapterCount) 章")
                        LabeledContent("本地内容", value: "\(preview.localChapterCount) 节")
                        LabeledContent("已匹配", value: "\(preview.matchedSourceCount) 章")
                        if preview.splitLocalChapterCount > 0 {
                            LabeledContent("拆分节", value: "\(preview.splitLocalChapterCount) 节")
                        }
                        if !preview.unmatchedSource.isEmpty || !preview.unmatchedLocal.isEmpty {
                            Text("未匹配：源站 \(preview.unmatchedSource.count) 章，本地 \(preview.unmatchedLocal.count) 节")
                                .foregroundStyle(.orange)
                        }
                        ForEach(preview.warnings, id: \.self) { warning in
                            Text(warning).foregroundStyle(.orange)
                        }
                    } header: {
                        Text("同步预览")
                    }

                    Section {
                        ForEach(Array(metadataLabels.enumerated()), id: \.offset) { item in
                            let key = item.element.0
                            let label = item.element.1
                            Toggle(isOn: Binding(
                                get: { metadataFields.contains(key) },
                                set: { enabled in
                                    if enabled { metadataFields.insert(key) } else { metadataFields.remove(key) }
                                }
                            )) {
                                HStack {
                                    Text(label)
                                    Spacer()
                                    Text(metadataValue(key, preview: preview).isEmpty ? "未识别" : metadataValue(key, preview: preview))
                                        .foregroundStyle(AppTheme.textSecondary)
                                        .lineLimit(1)
                                }
                            }
                            .disabled(metadataValue(key, preview: preview).isEmpty)
                        }
                        Toggle("覆盖已有小说信息", isOn: $replaceMetadata)
                    } header: {
                        Text("小说信息")
                    } footer: {
                        Text("默认只补全本地为空的字段；开启覆盖后才会替换已有标题、作者、简介等信息。")
                    }

                    if !preview.mappings.filter({ $0.relation == "split" }).isEmpty {
                        Section("拆分章节映射") {
                            ForEach(preview.mappings.filter { $0.relation == "split" }.prefix(30)) { mapping in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("源站第 \(mapping.sourceOrder) 章「\(mapping.sourceTitle)」")
                                    Text("→ 本地 \(mapping.localChapterIds.count) 节 · \(confidenceName(mapping.confidence))")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                        }
                    }

                    let automaticChanges = preview.changes.filter(\.eligible)
                    let manualChanges = preview.changes.filter { !$0.eligible }
                    let confirmedManualCount = manualChanges.filter { confirmedChangeIds.contains($0.id) }.count

                    Section {
                        if preview.changes.isEmpty {
                            Text("没有需要变更的章节名")
                                .foregroundStyle(AppTheme.textSecondary)
                        } else {
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(AppTheme.success)
                                Text("自动应用 \(automaticChanges.count) 项")
                                    .font(.footnote)
                                    .foregroundStyle(AppTheme.textSecondary)
                                Spacer(minLength: 8)
                                if !manualChanges.isEmpty {
                                    Text("已确认 \(confirmedManualCount)/\(manualChanges.count) 项")
                                        .font(.footnote)
                                        .foregroundStyle(confirmedManualCount > 0 ? AppTheme.primary : AppTheme.textSecondary)
                                }
                            }

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
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }

                            ForEach(preview.changes.prefix(80)) { change in
                                sourceSyncChangeRow(change)
                            }
                            if preview.changes.count > 80 {
                                Text("另有 \(preview.changes.count - 80) 项未显示")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("章节名变更")
                            Spacer()
                            Text("\(preview.changes.count) 项")
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    } footer: {
                        if manualChanges.isEmpty {
                            Text("点击右上角“应用同步”后，将自动应用这些章节名变更。")
                        } else {
                            Text("高置信度变更会自动应用；低置信度变更需要先打开右侧开关确认，未确认的项目不会修改。")
                        }
                    }
                }
            }
            .navigationTitle("源站同步")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("应用同步") {
                        requestApplyPreview()
                    }
                    .disabled(preview == nil || isLoading)
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
    }

    private func sourceSyncChangeRow(_ change: SourceSyncChange) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(change.localOrder).")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(AppTheme.textMuted)
                .frame(width: 30, alignment: .trailing)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top, spacing: 6) {
                    Text("本地")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(change.oldTitle)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(2)
                }

                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "arrow.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                        .frame(width: 16)
                    Text(change.newTitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(2)
                }

                if change.partCount > 1 {
                    Text("拆分 \(change.partIndex)/\(change.partCount) · \(confidenceName(change.confidence))")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                } else if change.eligible {
                    Text("高置信度 · 将自动应用")
                        .font(.caption)
                        .foregroundStyle(AppTheme.success)
                } else {
                    Text("低置信度 · 请确认后应用")
                        .font(.caption)
                        .foregroundStyle(.orange)
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

        Section {
            if let error = bucket.error, !error.isEmpty {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            if bucket.results.isEmpty {
                Text(bucket.ok ? "没有结果" : "搜索不可用")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(visibleResults) { candidate in
                    sourceCandidateRow(candidate)
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
        } header: {
            HStack {
                Text(title)
                Spacer()
                Text(bucket.results.isEmpty ? (bucket.ok ? "没有结果" : "搜索不可用") : "\(bucket.results.count) 个结果")
                    .foregroundStyle(AppTheme.textSecondary)
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
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .lineLimit(2)
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
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
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
        guard let preview else { return }
        isLoading = true
        defer { isLoading = false }
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
        case "po18tw": return "POPO"
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
    @Environment(\.dismiss) private var dismiss
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
            List {
                if filtered.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("没有找到小说", systemImage: "magnifyingglass")
                        } description: {
                            Text("试试其他关键词。")
                        }
                    }
                } else {
                    Section("全库索引（\(filtered.count)）") {
                        ForEach(filtered) { novel in
                            Button {
                                onPick(novel)
                                dismiss()
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(novel.title)
                                            .font(.subheadline)
                                            .foregroundStyle(AppTheme.textPrimary)
                                            .lineLimit(1)
                                        Text("\(novel.author) · \(novel.chapterCount) 章")
                                            .font(.caption)
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textMuted)
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle("选择小说")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "搜索书名 / 作者")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
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
    @State private var loadingDetail = false
    @State private var saving = false
    @State private var errorMessage: String?
    let onSaved: (ChapterMeta) -> Void

    private var isEditing: Bool { chapter != nil }

    var body: some View {
        NavigationStack {
            List {
                Section("基本信息") {
                    Stepper(value: $order, in: 1...100000) {
                        HStack {
                            Text("序号")
                            Spacer()
                            Text("\(order)")
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    TextField("章节标题 *", text: $title)
                }
                Section("正文") {
                    if loadingDetail {
                        ProgressView("加载正文…")
                            .frame(maxWidth: .infinity, minHeight: 80)
                    } else {
                        TextEditor(text: $content)
                            .frame(minHeight: 260)
                    }
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle(isEditing ? "编辑章节" : "新建章节")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        save()
                    } label: {
                        if saving {
                            ProgressView()
                        } else {
                            Text(isEditing ? "保存" : "创建")
                        }
                    }
                        .disabled(saving || loadingDetail)
                }
            }
            .onAppear(perform: seed)
        }
    }

    private func seed() {
        guard let chapter else { return }
        if !title.isEmpty { return }
        order = chapter.order
        title = chapter.title
        loadingDetail = true
        Task {
            defer { loadingDetail = false }
            do {
                let full = try await AdminAPI.chapterDetail(id: chapter.id)
                content = full.content
            } catch {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }

    private func save() {
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
                    let full = try await AdminAPI.updateChapter(id: chapter.id, ["title": trimmedTitle, "content": content, "order": order])
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
