import SwiftUI
import ZhiZhouCore

/// 小说详情页：继续阅读为主操作，目录为次要入口。
struct NovelDetailView: View {
    let novel: Novel
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore

    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var inBookshelf = false
    @State private var errorMessage: String?
    @State private var progress: ReadingProgress?
    @State private var displayNovel: Novel?
    @State private var bookshelfBusy = false
    @State private var showBookshelfError = false
    @State private var showRemoveConfirm = false
    @State private var expandDescription = false
    @State private var interactionFeedback = 0
    @State private var isShowingOffline = false
    @State private var isSelectingOffline = false
    @State private var selectedChapterIDs: Set<String> = []
    @State private var selectionRowFrames: [String: CGRect] = [:]
    @State private var selectionDragMode: OfflineSelectionDragMode?
    @State private var selectionDragLastIndex: Int?

    var body: some View {
        List {
            Section {
                headerCard
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section {
                if !chapters.isEmpty {
                    offlineSummary
                }
                if isLoading && chapters.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                if let errorMessage, chapters.isEmpty {
                    ContentUnavailableView {
                        Label("章节加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                            .tint(AppTheme.primary)
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(chapters) { chapter in
                    chapterRow(chapter)
                }
            } header: {
                Text("章节（\(chapters.count)）")
            }
            .frostedRowBackground()
        }
        .coordinateSpace(name: "offlineChapterList")
        .onPreferenceChange(OfflineChapterFramePreferenceKey.self) { frames in
            selectionRowFrames = frames
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle(currentNovel.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await offlineStore.refresh()
            await load()
        }
        .alert("操作未完成", isPresented: $showBookshelfError) {
            Button("好", role: .cancel) {}
        } message: {
            Text(inBookshelf ? "移出书架失败，请检查网络后重试。" : "加入书架失败，请检查网络后重试。")
        }
        .confirmationDialog("从书架移除这本书？", isPresented: $showRemoveConfirm, titleVisibility: .visible) {
            Button("移除", role: .destructive) { toggleBookshelf() }
            Button("取消", role: .cancel) {}
        }
        .alert(
            "离线下载未完成",
            isPresented: Binding(
                get: { offlineStore.lastError != nil },
                set: { if !$0 { offlineStore.clearError() } }
            )
        ) {
            Button("好", role: .cancel) {
                offlineStore.clearError()
            }
        } message: {
            Text(offlineStore.lastError ?? "")
        }
        .sensoryFeedback(.selection, trigger: interactionFeedback)
    }

    private var currentNovel: Novel { displayNovel ?? novel }

    private var continueChapter: ChapterMeta? {
        if let progress, let match = chapters.first(where: { $0.id == progress.chapterId }) {
            return match
        }
        return chapters.first
    }

    private var continueTitle: String {
        guard let chapter = continueChapter else { return "开始阅读" }
        if progress?.chapterId == chapter.id {
            return "继续阅读"
        }
        return "开始阅读"
    }

    private var downloadableChapters: [ChapterMeta] {
        chapters.filter { !offlineStore.isDownloaded($0.id) }
    }

    private var selectedDownloadChapters: [ChapterMeta] {
        downloadableChapters.filter { selectedChapterIDs.contains($0.id) }
    }

    private var isAllDownloadableSelected: Bool {
        let downloadableIDs = Set(downloadableChapters.map(\.id))
        return !downloadableIDs.isEmpty && downloadableIDs.isSubset(of: selectedChapterIDs)
    }

    private var offlineSummary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Label("离线章节", systemImage: "arrow.down.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("\(offlineStore.downloadedCount(for: currentNovel.id))/\(chapters.count)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            if offlineStore.batchNovelID == currentNovel.id {
                HStack(spacing: 10) {
                    ProgressView(value: offlineStore.batchProgress)
                        .tint(AppTheme.primary)
                    Button("停止") {
                        offlineStore.cancelBatch()
                    }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.borderless)
                }
                Text("正在保存第 \(min(offlineStore.batchCompleted + 1, offlineStore.batchTotal))/\(offlineStore.batchTotal) 章")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            } else if isSelectingOffline {
                HStack {
                    Button("取消") {
                        cancelOfflineSelection()
                    }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)

                    Spacer()

                    Button(isAllDownloadableSelected ? "取消全选" : "全选") {
                        toggleOfflineSelectAll()
                    }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                }

                HStack(spacing: 10) {
                    Text("已选 \(selectedDownloadChapters.count) 章")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                    Spacer()
                    Button {
                        startSelectedDownload()
                    } label: {
                        Label("下载已选章节", systemImage: "arrow.down.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                    .controlSize(.small)
                    .frame(minHeight: 44)
                    .disabled(selectedDownloadChapters.isEmpty || offlineStore.isBatchDownloading)
                }

                Text("点按左侧圆圈选择，长按后拖动可连续选择")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                if downloadableChapters.isEmpty {
                    Label("全部章节已保存", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(AppTheme.success)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    HStack(spacing: 10) {
                        Button {
                            startAllDownload()
                        } label: {
                            Label("下载全部章节", systemImage: "arrow.down.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.primary)
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .disabled(offlineStore.isBatchDownloading)

                        Button {
                            enterOfflineSelection()
                        } label: {
                            Label("选择章节", systemImage: "checklist")
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.primary)
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .disabled(offlineStore.isBatchDownloading)
                    }
                }
            }

            if isShowingOffline {
                Label("当前显示已下载的章节目录", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func chapterRow(_ chapter: ChapterMeta) -> some View {
        if isSelectingOffline {
            Button {
                toggleOfflineSelection(chapter)
            } label: {
                chapterRowLabel(chapter, selectionMode: true)
            }
            .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: OfflineChapterFramePreferenceKey.self,
                        value: [
                            chapter.id: proxy.frame(in: .named("offlineChapterList"))
                        ]
                    )
                }
            )
            .disabled(offlineStore.isDownloaded(chapter.id))
            .accessibilityLabel("第 \(chapter.order) 章，\(chapter.title)")
            .accessibilityValue(
                offlineStore.isDownloaded(chapter.id)
                    ? "已下载"
                    : selectedChapterIDs.contains(chapter.id) ? "已选择" : "未选择"
            )
        } else {
            NavigationLink {
                ReaderView(
                    novel: currentNovel,
                    chapterOrder: chapter.order,
                    preloadedChapters: chapters
                )
            } label: {
                chapterRowLabel(chapter, selectionMode: false)
            }
            .accessibilityHint("点按进入阅读")
        }
    }

    private func chapterRowLabel(_ chapter: ChapterMeta, selectionMode: Bool) -> some View {
        HStack {
            if selectionMode {
                selectionIndicator(for: chapter)
            }

            Text(chapter.title)
                .lineLimit(2)
            Spacer()
            if chapter.id == progress?.chapterId {
                Image(systemName: "bookmark.fill")
                    .font(.caption)
                    .foregroundStyle(AppTheme.seal)
                    .accessibilityLabel("上次读到这里")
            }
            Text("\(chapter.wordCount) 字")
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)

            if !selectionMode && offlineStore.isDownloaded(chapter.id) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.caption)
                    .foregroundStyle(AppTheme.success)
                    .accessibilityLabel("已保存离线内容")
            }
        }
        .contentShape(Rectangle())
    }

    private func selectionIndicator(for chapter: ChapterMeta) -> some View {
        Image(
            systemName: selectedChapterIDs.contains(chapter.id)
                ? "checkmark.circle.fill"
                : offlineStore.isDownloaded(chapter.id)
                    ? "arrow.down.circle.fill"
                    : "circle"
        )
        .font(.title3)
        .foregroundStyle(
            offlineStore.isDownloaded(chapter.id)
                ? AppTheme.success
                : selectedChapterIDs.contains(chapter.id)
                    ? AppTheme.primary
                    : AppTheme.textMuted
        )
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
        .simultaneousGesture(selectionGesture(for: chapter))
        .accessibilityHidden(true)
    }

    private func selectionGesture(for chapter: ChapterMeta) -> some Gesture {
        LongPressGesture(minimumDuration: 0.25, maximumDistance: 8)
            .sequenced(
                before: DragGesture(
                    minimumDistance: 8,
                    coordinateSpace: .named("offlineChapterList")
                )
            )
            .onChanged { value in
                switch value {
                case .second(true, let drag):
                    guard let drag else { return }
                    handleSelectionDrag(drag, startingAt: chapter)
                default:
                    break
                }
            }
            .onEnded { _ in
                selectionDragMode = nil
                selectionDragLastIndex = nil
            }
    }

    private func handleSelectionDrag(
        _ drag: DragGesture.Value,
        startingAt chapter: ChapterMeta
    ) {
        guard isSelectingOffline, !offlineStore.isDownloaded(chapter.id) else { return }

        if selectionDragMode == nil {
            selectionDragMode = selectedChapterIDs.contains(chapter.id) ? .deselect : .select
            selectionDragLastIndex = chapters.firstIndex { $0.id == chapter.id }
            if selectedChapterIDs.contains(chapter.id) {
                selectedChapterIDs.remove(chapter.id)
            } else {
                selectedChapterIDs.insert(chapter.id)
            }
            interactionFeedback += 1
        }

        let targetIndex = selectionRowFrames
            .first(where: { $0.value.contains(drag.location) })
            .flatMap { hit in chapters.firstIndex { $0.id == hit.key } }
            ?? (selectionDragLastIndex == nil ? chapters.firstIndex { $0.id == chapter.id } : nil)
        guard let targetIndex, let mode = selectionDragMode else { return }

        let previousIndex = selectionDragLastIndex ?? targetIndex
        let range = min(previousIndex, targetIndex)...max(previousIndex, targetIndex)
        for chapter in chapters[range] where !offlineStore.isDownloaded(chapter.id) {
            switch mode {
            case .select:
                selectedChapterIDs.insert(chapter.id)
            case .deselect:
                selectedChapterIDs.remove(chapter.id)
            }
        }
        selectionDragLastIndex = targetIndex
    }

    private func enterOfflineSelection() {
        isSelectingOffline = true
        selectedChapterIDs.removeAll()
        selectionDragMode = nil
        selectionDragLastIndex = nil
    }

    private func cancelOfflineSelection() {
        isSelectingOffline = false
        selectedChapterIDs.removeAll()
        selectionDragMode = nil
        selectionDragLastIndex = nil
    }

    private func toggleOfflineSelection(_ chapter: ChapterMeta) {
        guard !offlineStore.isDownloaded(chapter.id) else { return }
        if selectedChapterIDs.contains(chapter.id) {
            selectedChapterIDs.remove(chapter.id)
        } else {
            selectedChapterIDs.insert(chapter.id)
        }
        interactionFeedback += 1
    }

    private func toggleOfflineSelectAll() {
        let downloadableIDs = Set(downloadableChapters.map(\.id))
        if downloadableIDs.isSubset(of: selectedChapterIDs) {
            selectedChapterIDs.subtract(downloadableIDs)
        } else {
            selectedChapterIDs.formUnion(downloadableIDs)
        }
        interactionFeedback += 1
    }

    private func startAllDownload() {
        let chaptersToDownload = downloadableChapters
        guard !chaptersToDownload.isEmpty, !offlineStore.isBatchDownloading else { return }
        let novelToDownload = currentNovel
        Task {
            await offlineStore.downloadAll(novel: novelToDownload, chapters: chaptersToDownload)
            if offlineStore.lastBatchWasCancelled {
                AppFeedback.warning("下载已停止")
            } else if offlineStore.lastError == nil {
                AppFeedback.success("章节已保存到本机")
            } else {
                AppFeedback.error()
            }
        }
    }

    private func startSelectedDownload() {
        let chaptersToDownload = selectedDownloadChapters
        guard !chaptersToDownload.isEmpty, !offlineStore.isBatchDownloading else { return }
        let novelToDownload = currentNovel
        isSelectingOffline = false
        selectedChapterIDs.removeAll()
        Task {
            await offlineStore.downloadAll(novel: novelToDownload, chapters: chaptersToDownload)
            if offlineStore.lastBatchWasCancelled {
                AppFeedback.warning("下载已停止")
            } else if offlineStore.lastError == nil {
                AppFeedback.success("所选章节已保存到本机")
            } else {
                AppFeedback.error()
            }
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                CachedAsyncImage(
                    url: APIClient.shared.coverURL(novelId: currentNovel.id, updatedAt: currentNovel.updatedAt),
                    targetSize: CGSize(width: 88, height: 126)
                ) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack {
                        AppTheme.primaryLight
                        Image(systemName: "book.closed")
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                .frame(width: 88, height: 126)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .accessibilityLabel("\(currentNovel.title) 封面")

                VStack(alignment: .leading, spacing: 6) {
                    Text(currentNovel.title)
                        .font(serifFont(.title3, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(currentNovel.author)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), alignment: .leading)], alignment: .leading, spacing: 6) {
                        if let status = currentNovel.statusLabel {
                            Text(status).modifier(ThemeTagModifier())
                        }
                        if currentNovel.hasUpdate {
                            Text("有更新").modifier(ThemeTagModifier(emphasized: true))
                        }
                        ForEach(currentNovel.categories.prefix(2), id: \.self) { category in
                            Text(category).modifier(ThemeTagModifier())
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            if !currentNovel.description.isEmpty {
                Text(currentNovel.description)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(expandDescription ? nil : 4)
                if currentNovel.description.count > 80 {
                    Button(expandDescription ? "收起" : "展开简介") {
                        interactionFeedback += 1
                        withAnimation(.easeInOut(duration: 0.2)) {
                            expandDescription.toggle()
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.primary)
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                    .frame(minHeight: 44, alignment: .leading)
                }
            }

            HStack(spacing: 10) {
                if let chapter = continueChapter {
                    NavigationLink {
                        ReaderView(
                            novel: currentNovel,
                            chapterOrder: chapter.order,
                            preloadedChapters: chapters
                        )
                    } label: {
                        VStack(spacing: 2) {
                            Label(continueTitle, systemImage: "book.fill")
                                .font(.subheadline.weight(.semibold))
                            Text(chapter.title)
                                .font(.caption2)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                    .accessibilityHint("从第 \(chapter.order) 章开始")
                } else {
                    Button {
                        // 章节尚未加载完成，禁用占位
                    } label: {
                        Label("开始阅读", systemImage: "book.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
                    .disabled(true)
                }

                Button {
                    if inBookshelf {
                        showRemoveConfirm = true
                    } else {
                        toggleBookshelf()
                    }
                } label: {
                    Group {
                        if bookshelfBusy {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: inBookshelf ? "bookmark.fill" : "bookmark")
                        }
                    }
                    .frame(width: 44, height: 44)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .disabled(bookshelfBusy)
                .accessibilityLabel(inBookshelf ? "已在书架，点按移除" : "加入书架")
            }
        }
        .padding(16)
        .paperCard(cornerRadius: 22)
    }

    private func toggleBookshelf() {
        guard !bookshelfBusy else { return }
        bookshelfBusy = true
        Task {
            defer { bookshelfBusy = false }
            do {
                let addingToBookshelf = !inBookshelf
                if inBookshelf {
                    let _: OkEnvelope = try await APIClient.shared.delete(
                        "/api/bookshelf?novelId=\(novel.id)", auth: true
                    )
                    inBookshelf = false
                } else {
                    let body = try APIClient.shared.jsonBody(["novelId": novel.id])
                    let _: OkEnvelope = try await APIClient.shared.post(
                        "/api/bookshelf", body: body, auth: true
                    )
                    inBookshelf = true
                }
                interactionFeedback += 1
                AppFeedback.success(addingToBookshelf ? "已加入书架" : "已移出书架")
            } catch {
                AppFeedback.error()
                showBookshelfError = true
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        // 核心数据并行加载；详情失败静默回退列表数据
        async let detailRequest: Void = loadDetail()
        async let chaptersRequest: Void = loadChapters()
        _ = await (detailRequest, chaptersRequest)
        // 进度/收藏状态为次要数据，失败不影响章节展示
        if appState.user != nil {
            async let progressRequest: Void = loadProgress()
            async let bookshelfRequest: Void = loadBookshelf()
            _ = await (progressRequest, bookshelfRequest)
        }
    }

    private func loadDetail() async {
        if let d: NovelDetailResponse = try? await APIClient.shared.get(
            ContentPolicy.safePath("/api/novels/\(novel.id)")
        ) {
            displayNovel = d.novel
        }
    }

    private func loadChapters() async {
        do {
            let r: ChaptersResponse = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/chapters?novelId=\(novel.id)")
            )
            chapters = r.chapters
            isSelectingOffline = false
            selectedChapterIDs.removeAll()
            isShowingOffline = false
            errorMessage = nil
        } catch {
            let saved = offlineStore.chapters(for: novel.id)
            if !saved.isEmpty {
                chapters = saved
                isSelectingOffline = false
                selectedChapterIDs.removeAll()
                isShowingOffline = true
                errorMessage = nil
            } else {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }

    private func loadProgress() async {
        if let p: ProgressResponse = try? await APIClient.shared.get(
            "/api/progress?novelId=\(novel.id)", auth: true
        ) {
            progress = p.progress
        }
    }

    private func loadBookshelf() async {
        if let b: BookshelfResponse = try? await APIClient.shared.get(
            ContentPolicy.safePath("/api/bookshelf"), auth: true
        ) {
            inBookshelf = b.favorites.contains { $0.novelId == novel.id }
        }
    }
}

private struct NovelDetailResponse: Decodable {
    let novel: Novel
}

private enum OfflineSelectionDragMode {
    case select
    case deselect
}

private struct OfflineChapterFramePreferenceKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]

    static func reduce(
        value: inout [String: CGRect],
        nextValue: () -> [String: CGRect]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}
