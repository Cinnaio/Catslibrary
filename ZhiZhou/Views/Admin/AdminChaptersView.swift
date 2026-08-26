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
    @State private var editorIntent: ChapterEditorIntent?
    @State private var deleteTarget: ChapterMeta?
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
            Menu {
                Button("编辑", systemImage: "pencil") {
                    editorIntent = .edit(chapter)
                }
                Button("删除", systemImage: "trash", role: .destructive) {
                    deleteTarget = chapter
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("章节操作")
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
                    Button(isEditing ? "保存" : "创建") { save() }
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
