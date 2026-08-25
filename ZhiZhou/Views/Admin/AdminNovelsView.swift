import SwiftUI

/// 小说管理：搜索 / 状态过滤 / 分页列表 / 编辑 / 新建 / 删除 / 增量更新。
/// 对齐 Web 端 admin NovelsTab（管理维护用 /api/novels 系列接口）。
struct AdminNovelsView: View {
    @State private var novels: [Novel] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var statusFilter = "all"
    @State private var page = 1
    @State private var hasMore = false
    @State private var loadedTotal = 0
    @State private var showEditor = false
    @State private var editingNovel: Novel?
    @State private var deleteTarget: Novel?
    @State private var actionError: String?
    @State private var busyNovelId: String?
    @State private var updatingNovelId: String?

    var body: some View {
        List {
            Section {
                Picker("状态", selection: $statusFilter) {
                    Text("全部").tag("all")
                    Text("连载").tag("ongoing")
                    Text("完结").tag("completed")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            }

            if isLoading && novels.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, novels.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await reload() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                ForEach(novels) { novel in
                    novelRow(novel)
                }
                if hasMore {
                    Button {
                        Task { await loadMore() }
                    } label: {
                        HStack {
                            Spacer()
                            Text("加载更多（\(novels.count)/\(loadedTotal)）")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.primary)
                            Spacer()
                        }
                    }
                    .listRowBackground(Color.clear)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("小说管理")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $searchText, prompt: "搜索书名 / 作者")
        .refreshable { await reload() }
        .task(id: searchText) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await reload()
        }
        .onChange(of: statusFilter) { _, _ in
            Task { await reload() }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editingNovel = nil
                    showEditor = true
                } label: {
                    Label("新建小说", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showEditor) {
            NovelEditSheet(novel: editingNovel) { saved in
                if editingNovel == nil {
                    novels.insert(saved, at: 0)
                    loadedTotal += 1
                } else if let idx = novels.firstIndex(where: { $0.id == saved.id }) {
                    novels[idx] = saved
                }
            }
        }
        .confirmationDialog(
            "删除小说",
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
            Text("将级联删除该书全部章节，不可恢复。")
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 行

    private func novelRow(_ novel: Novel) -> some View {
        HStack(spacing: 10) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt),
                targetSize: CGSize(width: 56, height: 72)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(AppTheme.surface.opacity(0.6))
                    Image(systemName: "book")
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
            .frame(width: 56, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(novel.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(1)
                    if novel.hasUpdate {
                        Text("有更新")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppTheme.primary.opacity(0.15), in: Capsule())
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                Text(novel.author)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text("\(novel.chapterCount) 章")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                    if novel.remoteChapterCount > novel.chapterCount {
                        Text("远端 \(novel.remoteChapterCount)")
                            .font(.caption2)
                            .foregroundStyle(AppTheme.primary)
                    }
                    if let label = novel.statusLabel {
                        Text(label)
                            .font(.caption2)
                            .foregroundStyle(AppTheme.textMuted)
                    }
                }
            }
            Spacer()
            if updatingNovelId == novel.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .contextMenu {
            Button("编辑", systemImage: "pencil") {
                editingNovel = novel
                showEditor = true
            }
            Button("增量更新", systemImage: "arrow.triangle.2.circlepath") {
                Task { await scrapeUpdate(novel) }
            }
            Button("删除", systemImage: "trash", role: .destructive) {
                deleteTarget = novel
            }
        }
    }

    // MARK: - 数据

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            let status = statusFilter == "all" ? "" : statusFilter
            let r = try await AdminAPI.novels(search: trimmed, status: status, page: 1, limit: 20)
            novels = r.novels
            page = r.page
            hasMore = r.hasMore
            loadedTotal = r.total
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        do {
            let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            let status = statusFilter == "all" ? "" : statusFilter
            let r = try await AdminAPI.novels(search: trimmed, status: status, page: page + 1, limit: 20)
            novels.append(contentsOf: r.novels)
            page = r.page
            hasMore = r.hasMore
            loadedTotal = r.total
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func scrapeUpdate(_ novel: Novel) async {
        guard updatingNovelId == nil else { return }
        updatingNovelId = novel.id
        defer { updatingNovelId = nil }
        do {
            _ = try await AdminAPI.scrapeAction("update", novelId: novel.id)
            await reload()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func delete(_ novel: Novel) async {
        guard busyNovelId == nil else { return }
        busyNovelId = novel.id
        defer { busyNovelId = nil }
        do {
            try await AdminAPI.deleteNovel(id: novel.id)
            novels.removeAll { $0.id == novel.id }
            loadedTotal = max(0, loadedTotal - 1)
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

// MARK: - 编辑 / 新建 Sheet

private struct NovelEditSheet: View {
    let novel: Novel?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var author = ""
    @State private var status = "ongoing"
    @State private var descriptionText = ""
    @State private var coverUrl = ""
    @State private var categories = ""
    @State private var sourceUrl = ""
    @State private var saving = false
    @State private var errorMessage: String?
    let onSaved: (Novel) -> Void

    private var isEditing: Bool { novel != nil }

    var body: some View {
        NavigationStack {
            List {
                Section("基本信息") {
                    TextField("书名 *", text: $title)
                    TextField("作者 *", text: $author)
                    Picker("状态", selection: $status) {
                        Text("连载").tag("ongoing")
                        Text("完结").tag("completed")
                    }
                    .pickerStyle(.menu)
                }
                Section("详情") {
                    TextField("分类（逗号分隔）", text: $categories)
                    TextField("封面 URL", text: $coverUrl)
                    TextField("源站 URL", text: $sourceUrl)
                }
                Section("简介") {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 120)
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
            .navigationTitle(isEditing ? "编辑小说" : "新建小说")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "保存" : "创建") { save() }
                        .disabled(saving)
                }
            }
            .onAppear(perform: seed)
        }
    }

    private func seed() {
        guard let novel, title.isEmpty else { return }
        title = novel.title
        author = novel.author
        status = novel.status
        descriptionText = novel.description
        coverUrl = novel.coverUrl
        categories = novel.categories.joined(separator: "，")
        sourceUrl = novel.sourceUrl
    }

    private func save() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAuthor = author.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedAuthor.isEmpty else {
            errorMessage = "书名和作者不能为空"
            return
        }
        saving = true
        Task {
            defer { saving = false }
            do {
                let fields: [String: Any] = [
                    "title": trimmedTitle,
                    "author": trimmedAuthor,
                    "status": status,
                    "description": descriptionText,
                    "coverUrl": coverUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                    "categories": AdminFormat.parseCategories(categories),
                    "sourceUrl": sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                ]
                let saved: Novel
                if let novel {
                    saved = try await AdminAPI.updateNovel(id: novel.id, fields)
                } else {
                    saved = try await AdminAPI.createNovel(fields)
                }
                onSaved(saved)
                dismiss()
            } catch {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }
}
