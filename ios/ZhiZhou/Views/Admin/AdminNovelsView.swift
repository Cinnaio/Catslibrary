import SwiftUI
import ZhiZhouCore

/// 小说管理：搜索 / 状态过滤 / 分页列表 / 编辑 / 新建 / 删除 / 增量更新。
/// 对齐 Web 端 admin NovelsTab（管理维护用 /api/novels 系列接口）。
struct AdminNovelsView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var novels: [Novel] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var statusFilter = "all"
    @State private var page = 1
    @State private var hasMore = false
    @State private var loadedTotal = 0
    @State private var editorDestination: NovelEditorDestination?
    @State private var followupNovel: Novel?
    @State private var workspaceNovel: Novel?
    @State private var deleteTarget: Novel?
    @State private var actionError: String?
    @State private var busyNovelId: String?
    @State private var updatingNovelId: String?
    @State private var loadingMore = false
    @State private var requests = ListRequestGuard<[String]>()
    @State private var displayedQuery: [String]?

    private var query: [String] {
        [searchText.trimmingCharacters(in: .whitespacesAndNewlines), statusFilter == "all" ? "" : statusFilter]
    }

    private var resultsAreStale: Bool {
        displayedQuery != nil && displayedQuery != query
    }

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("小说管理")
            listContext
            if isLoading && novels.isEmpty {
                Section {
                    AppLoadingState("正在读取作品列表…")
                        .frame(minHeight: 160)
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
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await reload() }
                    }
                }
                if novels.isEmpty {
                    ContentUnavailableView("没有匹配的小说", systemImage: "books.vertical")
                        .listRowBackground(Color.clear)
                }
                ForEach(Array(novels.enumerated()), id: \.element.id) { index, novel in
                    novelRow(novel)
                        .readingSpaceEntrance(index)
                        .opacity(resultsAreStale ? 0.5 : 1)
                        .disabled(resultsAreStale)
                        .transition(reduceMotion ? .identity : .asymmetric(
                            insertion: .opacity.animation(AppMotion.micro.delay(Double(min(index % 20, 10)) * 0.016)),
                            removal: .opacity
                        ))
                }
                if hasMore {
                    Button {
                        Task { await loadMore() }
                    } label: {
                        HStack {
                            Spacer()
                            if loadingMore {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Text("加载更多（\(novels.count)/\(loadedTotal)）")
                                    .font(.subheadline)
                                    .foregroundStyle(.tint)
                            }
                            Spacer()
                        }
                    }
                    .disabled(loadingMore || isLoading || errorMessage != nil || resultsAreStale)
                    .listRowBackground(Color.clear)
                }
            }
        }
        .searchable(text: $searchText, prompt: "搜索书名 / 作者")
        .refreshable { await reload() }
        .task(id: query) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await reload()
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Picker("状态", selection: $statusFilter) {
                        Text("全部状态").tag("all")
                        Text("连载").tag("ongoing")
                        Text("完结").tag("completed")
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("筛选小说", systemImage: statusFilter == "all" ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                        .labelStyle(.iconOnly)
                }
                .accessibilityValue(novelStatusLabel)

                Button("新建小说", systemImage: "plus") {
                    editorDestination = NovelEditorDestination(novel: nil)
                }
                .labelStyle(.iconOnly)
            }
        }
        .sheet(item: $followupNovel) { novel in
            NavigationStack {
                AdminFollowupView(novel: novel)
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { followupNovel = nil }
                    } }
            }
        }
        .sheet(item: $workspaceNovel, onDismiss: { Task { await reload() } }) { novel in
            AdminNovelWorkspaceSheet(novel: novel)
                .presentationBackground(ReadingSpace.profilePaper)
        }
        .sheet(item: $editorDestination) { destination in
            NovelEditSheet(novel: destination.novel) { saved in
                if destination.novel == nil {
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

    private var listContext: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(novelStatusLabel)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                if resultsAreStale {
                    Text(errorMessage == nil ? "正在检索，暂时保留上次结果" : "筛选尚未更新，下方为上次结果")
                        .foregroundStyle(ReadingSpace.profileMuted)
                } else if displayedQuery != nil {
                    Text("已载入 \(novels.count) / \(loadedTotal) 部作品")
                        .monospacedDigit()
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .font(.footnote)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if isLoading && !novels.isEmpty {
                ProgressView().controlSize(.small).accessibilityLabel("正在更新小说列表")
            }
        }
        .padding(.bottom, 6)
    }

    // MARK: - 行

    private var novelStatusLabel: String {
        switch statusFilter {
        case "ongoing": return "连载"
        case "completed": return "完结"
        default: return "全部状态"
        }
    }

    private func novelRow(_ novel: Novel) -> some View {
        let metadata = [
            novel.author.isEmpty ? "佚名" : novel.author,
            "\(novel.chapterCount) 章",
            novel.statusLabel,
        ].compactMap { $0 }.joined(separator: " · ")

        return HStack(alignment: .center, spacing: 8) {
            Button { workspaceNovel = novel } label: {
                HStack(alignment: .top, spacing: 14) {
                    CachedAsyncImage(
                        url: APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt),
                        targetSize: AppLayout.coverListThumbnail
                    ) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        ZStack {
                            Rectangle().fill(ReadingSpace.profileFill)
                            Image(systemName: "book").foregroundStyle(ReadingSpace.profileMuted)
                        }
                    }
                    .frame(width: AppLayout.coverListThumbnail.width, height: AppLayout.coverListThumbnail.height)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(novel.title)
                            .font(serifFont(.headline, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .appTextLineLimit(2)
                        Text(metadata)
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .appTextLineLimit(2)
                        if novel.hasUpdate {
                            Label("可更新至 \(novel.remoteChapterCount) 章", systemImage: "arrow.triangle.2.circlepath")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.primary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("打开本书管理工作台")
            .accessibilityIdentifier("admin.novel.open.\(novel.id)")
            if busyNovelId == novel.id || updatingNovelId == novel.id {
                AdminInlineProgress()
            } else {
                Menu {
                    Button("管理这本书", systemImage: "slider.horizontal.3") { workspaceNovel = novel }
                    Button("编辑", systemImage: "pencil") {
                        editorDestination = NovelEditorDestination(novel: novel)
                    }
                    Button("追更设置", systemImage: "clock.arrow.circlepath") { followupNovel = novel }
                    Button("增量更新", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await scrapeUpdate(novel) }
                    }
                    Button("删除", systemImage: "trash", role: .destructive) {
                        deleteTarget = novel
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 44, height: 44)
                }
                .disabled(busyNovelId != nil || updatingNovelId != nil)
                .accessibilityLabel("小说操作")
            }
        }
        .padding(.vertical, 8)
        .disabled(busyNovelId != nil || updatingNovelId != nil)
        .contextMenu {
            Button("管理这本书", systemImage: "slider.horizontal.3") { workspaceNovel = novel }
            Button("编辑", systemImage: "pencil") {
                editorDestination = NovelEditorDestination(novel: novel)
            }
            Button("追更设置", systemImage: "clock.arrow.circlepath") { followupNovel = novel }
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
        let ticket = requests.begin(query)
        isLoading = true
        loadingMore = false
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            let r = try await AdminAPI.novels(search: ticket.query[0], status: ticket.query[1], page: 1, limit: 20)
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            withAnimation(reduceMotion ? nil : AppMotion.micro) { novels = r.novels }
            page = r.page
            hasMore = r.hasMore
            loadedTotal = r.total
            displayedQuery = ticket.query
            errorMessage = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        guard !loadingMore, !isLoading, errorMessage == nil, hasMore,
              let ticket = requests.beginNext(query) else { return }
        loadingMore = true
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                loadingMore = false
            }
        }
        do {
            let r = try await AdminAPI.novels(search: ticket.query[0], status: ticket.query[1], page: page + 1, limit: 20)
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            let existing = Set(novels.map(\.id))
            withAnimation(reduceMotion ? nil : AppMotion.micro) {
                novels.append(contentsOf: r.novels.filter { !existing.contains($0.id) })
            }
            page = r.page
            hasMore = r.hasMore
            loadedTotal = r.total
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
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

/// Presentation and target travel together, including an explicit create
/// destination. Each opening owns a fresh form and an immutable novel snapshot.
private struct NovelEditorDestination: Identifiable {
    let id = UUID()
    let novel: Novel?
}

struct NovelEditSheet: View {
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
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case title, author, categories, cover, source, description }

    init(novel: Novel?, onSaved: @escaping (Novel) -> Void) {
        self.novel = novel
        self.onSaved = onSaved
        _title = State(initialValue: novel?.title ?? "")
        _author = State(initialValue: novel?.author ?? "")
        _status = State(initialValue: novel?.status ?? "ongoing")
        _descriptionText = State(initialValue: novel?.description ?? "")
        _coverUrl = State(initialValue: novel?.coverUrl ?? "")
        _categories = State(initialValue: novel?.categories.joined(separator: "，") ?? "")
        _sourceUrl = State(initialValue: novel?.sourceUrl ?? "")
    }

    private var isEditing: Bool { novel != nil }

    var body: some View {
        NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading(isEditing ? "编辑小说" : "新建小说")
                AdminWorkspaceSection("基本信息") {
                    AccountSettingsField("书名（必填）", isFocused: focusedField == .title) {
                        TextField("书名 *", text: $title).focused($focusedField, equals: .title)
                    }
                    AccountSettingsField("作者（必填）", isFocused: focusedField == .author) {
                        TextField("作者 *", text: $author).focused($focusedField, equals: .author)
                    }
                    AccountSettingsField("连载状态") {
                        Picker("状态", selection: $status) {
                            Text("连载").tag("ongoing")
                            Text("完结").tag("completed")
                        }
                        .pickerStyle(.menu)
                    }
                }
                AdminWorkspaceSection("分类与来源") {
                    AccountSettingsField("分类", isFocused: focusedField == .categories) {
                        TextField("分类（逗号分隔）", text: $categories).focused($focusedField, equals: .categories)
                    }
                    AccountSettingsField("封面地址", isFocused: focusedField == .cover) {
                        TextField("封面 URL", text: $coverUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .cover)
                    }
                    AccountSettingsField("源站地址", isFocused: focusedField == .source) {
                        TextField("源站 URL", text: $sourceUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .source)
                    }
                }
                AdminWorkspaceSection("简介") {
                    AccountSettingsField("作品简介", isFocused: focusedField == .description) {
                        TextEditor(text: $descriptionText)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 160)
                            .focused($focusedField, equals: .description)
                            .accessibilityLabel("作品简介")
                    }
                }
                if let errorMessage {
                    AccountSettingsNote(errorMessage, isError: true)
                }
            }
            .disabled(saving)
            .scrollDismissesKeyboard(.interactively)
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
                    .disabled(saving)
                    .accessibilityValue(saving ? "正在保存" : "")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { focusedField = nil }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .interactiveDismissDisabled(saving)
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
