import SwiftUI
import ZhiZhouCore

/// 封面与书目信息并排，简介和目录沿暖纸排版，底部独立呈现阅读操作。
struct NovelDetailView: View {
    let novel: Novel
    var showsCloseButton = false
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var chapterNumberWidth: CGFloat = 24

    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = true
    @State private var inBookshelf = false
    @State private var errorMessage: String?
    @State private var progress: ReadingProgress?
    @State private var isLoadingProgress = false
    @State private var chaptersDescending = false
    @State private var showChapterSearch = false
    @State private var selectedSearchChapter: ChapterMeta?
    @State private var displayNovel: Novel?
    @State private var bookshelfBusy = false
    @State private var showBookshelfError = false
    @State private var showRemoveConfirm = false
    @State private var expandDescription = false
    @State private var synopsisFullHeight: CGFloat = 0
    @State private var synopsisCollapsedHeight: CGFloat = 0
    @State private var interactionFeedback = 0
    @State private var isShowingOffline = false
    @State private var showOfflineOptions = false
    @State private var showAdminWorkspace = false
    @State private var showKeepsakes = false
    @State private var showBodySearch = false
    @State private var bodySearchSnapshot: BookSearchSnapshot?
    @State private var searchLaunch: BookSearchLaunch?
    // 阅读目标属于详情页面，不依附会刷新、复用或离屏的按钮和章节行。
    @State private var readerRequest: DetailReaderRequest?
    @State private var pendingReaderRequest: DetailReaderRequest?
    @State private var isSelectingOffline = false
    @State private var selectedChapterIDs: Set<String> = []
    @State private var selectionRowFrames: [String: CGRect] = [:]
    @State private var selectionDragMode: OfflineSelectionDragMode?
    @State private var selectionDragLastIndex: Int?

    var body: some View {
        let isRestricted = currentNovel.isRestricted
        GeometryReader { geometry in
            let sideInset = max(22, AppLayout.readableInset(for: geometry.size.width))
            ScrollViewReader { proxy in
                detailList(sideInset: sideInset, contentWidth: geometry.size.width - sideInset * 2)
                    .accessibilityIdentifier("detail.chapters")
                    .onChange(of: isSelectingOffline) { _, isSelecting in
                        if isSelecting, let chapter = downloadableChapters.first {
                            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                                proxy.scrollTo(chapter.id, anchor: .top)
                            }
                        }
                    }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                bottomBar(sideInset: sideInset)
            }
        }
        .onPreferenceChange(OfflineChapterFramePreferenceKey.self) { frames in
            selectionRowFrames = frames
        }
        .background { ReadingSpace.profilePaper.ignoresSafeArea() }
        .refreshable { await load(refresh: true) }
        .readingSpaceNavigation()
        .toolbar(ReadingSpaceWindowLayout.usesIPadLayout || horizontalSizeClass != .regular ? .hidden : .visible, for: .tabBar)
        .toolbarBackground(ReadingSpace.profilePaper, for: .navigationBar)
        .toolbarBackground(ReadingSpaceWindowLayout.usesIPadLayout ? .visible : .hidden, for: .navigationBar)
        .toolbar {
            if appState.user != nil && !isShowingOffline {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("合上书以后", systemImage: "book.closed") { showKeepsakes = true }
                        .labelStyle(.iconOnly)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("正文搜索", systemImage: "text.magnifyingglass") { showBodySearch = true }
                    .labelStyle(.iconOnly)
            }
            if appState.user?.isAdmin == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("管理这本书", systemImage: "slider.horizontal.3") { showAdminWorkspace = true }
                        .labelStyle(.iconOnly)
                        .accessibilityIdentifier("detail.manage")
                }
            }
            if showsCloseButton {
                ToolbarItem(placement: .cancellationAction) {
                    NovelDetailCloseButton()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("离线下载", systemImage: "arrow.down.circle") {
                    showOfflineOptions = true
                }
                .labelStyle(.iconOnly)
                .disabled(chapters.isEmpty || isSelectingOffline || currentNovel.isRestricted)
                .help(currentNovel.isRestricted ? "限制级作品暂不提供离线下载" : "离线下载")
            }
        }
        .sheet(isPresented: $showKeepsakes) {
            ReadingKeepsakesView(novelId: currentNovel.id)
        }
        .sheet(isPresented: $showBodySearch, onDismiss: presentPendingReader) {
            BookSearchView(novel: currentNovel, state: $bodySearchSnapshot) { hit, query in
                if ReadingSpaceWindowLayout.usesIPadLayout {
                    pendingReaderRequest = DetailReaderRequest(
                        launch: ReaderLaunch(novel: currentNovel, chapterOrder: hit.chapterOrder),
                        searchQuery: query, initialChapterID: hit.chapterId,
                        searchSnapshot: bodySearchSnapshot
                    )
                    showBodySearch = false
                } else {
                    searchLaunch = BookSearchLaunch(hit: hit, query: query)
                }
            }
        }
        .navigationDestination(item: $searchLaunch) { launch in
            ReaderView(novel: currentNovel, chapterOrder: launch.hit.chapterOrder, searchQuery: launch.query,
                       initialChapterID: launch.hit.chapterId, searchSnapshot: bodySearchSnapshot)
        }
        .sheet(isPresented: $showChapterSearch, onDismiss: presentPendingReader) {
            ChapterListView(
                novel: currentNovel,
                currentOrder: chapters.first { $0.id == progress?.chapterId }?.order,
                initialChapters: chapters,
                offlineOnly: isShowingOffline,
                directorySort: $chaptersDescending
            ) { order in
                guard let chapter = chapters.first(where: { $0.order == order }) else { return }
                if ReadingSpaceWindowLayout.usesIPadLayout {
                    pendingReaderRequest = DetailReaderRequest(
                        launch: ReaderLaunch(novel: currentNovel, chapterOrder: chapter.order, preloadedChapters: chapters)
                    )
                    showChapterSearch = false
                } else {
                    selectedSearchChapter = chapter
                }
            }
        }
        .navigationDestination(item: $selectedSearchChapter) { chapter in
            ReaderView(novel: currentNovel, chapterOrder: chapter.order, preloadedChapters: chapters)
        }
        .sheet(isPresented: $showOfflineOptions) {
            offlineDownloadSheet
        }
        .sheet(isPresented: $showAdminWorkspace, onDismiss: { Task { await load(refresh: true) } }) {
            AdminNovelWorkspaceSheet(novel: currentNovel)
        }
        .task(id: "\(novel.id):\(ContentAccessStore.shared.mode)") {
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
                get: { offlineStore.lastError != nil && !showOfflineOptions },
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
        .readerContentAccess(isRestricted: currentNovel.isRestricted)
        .toolbar(ReadingSpaceWindowLayout.usesIPadLayout ? .visible : .automatic, for: .navigationBar)
        // 注册在完整页面外层，异步详情更新或内容门禁切换都不会移除目的地注册。
        // 同时应用最新作品分级，详情异步补全不能绕过门禁；返回时由系统清除请求。
        .navigationDestination(item: $readerRequest) { request in
            DetailReaderDestination(request: request)
                .readerContentAccess(isRestricted: isRestricted)
        }
    }

    private func presentPendingReader() {
        guard let request = pendingReaderRequest else { return }
        pendingReaderRequest = nil
        readerRequest = request
    }

    private func openReader(_ chapter: ChapterMeta) {
        readerRequest = DetailReaderRequest(
            launch: ReaderLaunch(novel: currentNovel, chapterOrder: chapter.order, preloadedChapters: chapters)
        )
    }

    private func detailList(sideInset: CGFloat, contentWidth: CGFloat) -> some View {
        List {
            bookHeader(availableWidth: contentWidth)
                .padding(.horizontal, sideInset)
                .padding(.top, 24)
                .padding(.bottom, 28)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            if !currentNovel.description.isEmpty {
                synopsisBlock
                    .listRowInsets(EdgeInsets(top: 0, leading: sideInset, bottom: 24, trailing: sideInset))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            Section {
                ReaderCatchupEntry(novelID: currentNovel.id, progress: progress)
                    .listRowSeparator(.hidden)
                if currentNovel.isRestricted {
                    Label("限制级作品 · 支持阅读缓存", systemImage: "network")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)
                        .listRowSeparator(.hidden)
                }
                if offlineStore.batchNovelID == currentNovel.id {
                    downloadStatusRow
                        .listRowSeparator(.hidden)
                }
                if isShowingOffline {
                    Label("当前显示已下载的章节", systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)
                        .listRowSeparator(.hidden)
                }
                if chapters.isEmpty {
                    chapterEmptyState
                        .listRowSeparator(.hidden)
                }
                ForEach(visibleChapters) { chapter in
                    chapterRow(chapter)
                        .id(chapter.id)
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        .listRowSeparatorTint(ReadingSpace.profileLine)
                }
            } header: {
                chapterSectionHeader
                    .textCase(nil)
                    .listRowInsets(EdgeInsets(top: 8, leading: sideInset, bottom: 8, trailing: sideInset))
            }
            .listRowInsets(EdgeInsets(top: 10, leading: sideInset, bottom: 10, trailing: sideInset))
            .listRowBackground(Color.clear)
        }
        .modifier(ReadingSpaceRoomListStyle())
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectStyle(.soft, for: .bottom)
    }

    @ViewBuilder
    private var chapterEmptyState: some View {
        if isLoading {
            ProgressView("正在加载章节")
                .frame(maxWidth: .infinity, minHeight: 88)
        } else if let errorMessage {
            ContentUnavailableView {
                Label("章节加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
            }
        } else {
            ContentUnavailableView("暂无章节", systemImage: "text.book.closed")
        }
    }

    private var currentNovel: Novel { displayNovel ?? novel }

    private var visibleChapters: [ChapterMeta] {
        chaptersDescending && !isSelectingOffline ? Array(chapters.reversed()) : chapters
    }

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
        guard !currentNovel.isRestricted else { return [] }
        return chapters.filter { !offlineStore.isDownloaded($0.id) }
    }

    private var selectedDownloadChapters: [ChapterMeta] {
        downloadableChapters.filter { selectedChapterIDs.contains($0.id) }
    }

    private var isAllDownloadableSelected: Bool {
        let downloadableIDs = Set(downloadableChapters.map(\.id))
        return !downloadableIDs.isEmpty && downloadableIDs.isSubset(of: selectedChapterIDs)
    }

    private var offlineDownloadSheet: some View {
        NavigationStack {
            ReaderPanelPage {
                ReaderPanelHeading("离线下载", detail: currentNovel.title)
                ReaderPanelSection("已保存章节") {
                    let layout = dynamicTypeSize >= .xxxLarge
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                    layout {
                        Text(offlineStore.downloadedCount(for: currentNovel.id), format: .number)
                            .font(serifFont(.largeTitle, .medium)).monospacedDigit()
                            .foregroundStyle(ReadingSpace.ink)
                        Text("/ \(chapters.count) 章")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("已保存章节")
                    .accessibilityValue("\(offlineStore.downloadedCount(for: currentNovel.id)) / \(chapters.count) 章")
                }
                if offlineStore.batchNovelID == currentNovel.id {
                    ReaderPanelSection("下载进度") {
                        ProgressView(value: offlineStore.batchProgress)
                            .tint(AppTheme.primary)
                            .accessibilityLabel("下载进度")
                            .accessibilityValue("已处理 \(offlineStore.batchCompleted) / \(offlineStore.batchTotal) 章")
                        ReaderPanelFact(title: "已处理", value: "\(offlineStore.batchCompleted) / \(offlineStore.batchTotal) 章")
                        ReaderPanelNote("已保存 \(offlineStore.batchCompleted - offlineStore.batchFailed) 章 · 失败 \(offlineStore.batchFailed) 章")
                        Button("停止下载", systemImage: "stop.circle") {
                            offlineStore.cancelBatch()
                        }
                        .buttonStyle(ReaderPanelButtonStyle())
                    }
                } else if downloadableChapters.isEmpty {
                    Label("全部章节已保存", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(AppTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Button("下载全部章节", systemImage: "arrow.down.circle") {
                            showOfflineOptions = false
                            startAllDownload()
                        }
                        .buttonStyle(ReaderPanelButtonStyle(prominent: true))
                        .disabled(offlineStore.isBatchDownloading)

                        Button("选择章节", systemImage: "checklist") {
                            showOfflineOptions = false
                            enterOfflineSelection()
                        }
                        .buttonStyle(ReaderPanelButtonStyle())
                        .disabled(offlineStore.isBatchDownloading)

                        if offlineStore.isBatchDownloading {
                            ReaderPanelNote("另一本书正在下载")
                        }
                    }
                }
                if let failed = offlineStore.failedBatch, failed.novel.id == currentNovel.id, !offlineStore.isBatchDownloading {
                    Button("重试失败的 \(failed.chapters.count) 章", systemImage: "arrow.clockwise") {
                        Task { await offlineStore.retryFailed() }
                    }
                    .buttonStyle(ReaderPanelButtonStyle())
                }
                if let error = offlineStore.lastError {
                    VStack(alignment: .leading, spacing: 12) {
                        ReaderPanelNote(error, color: AppTheme.danger)
                        Button("好") { offlineStore.clearError() }
                            .buttonStyle(ReaderPanelButtonStyle())
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭", systemImage: "xmark") { showOfflineOptions = false }
                        .labelStyle(.iconOnly)
                        .help("关闭下载面板")
                }
            }
        }
        .tint(AppTheme.primary)
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var downloadStatusRow: some View {
        Button {
            showOfflineOptions = true
        } label: {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                Text("正在下载 · \(offlineStore.batchCompleted)/\(offlineStore.batchTotal)")
                    .font(.footnote)
                    .contentTransition(.numericText())
                    .monospacedDigit()
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(AppTheme.textSecondary)
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityHint("查看下载进度或停止下载")
    }

    @ViewBuilder
    private func chapterRow(_ chapter: ChapterMeta) -> some View {
        if isSelectingOffline {
            Button {
                toggleOfflineSelection(chapter)
            } label: {
                chapterRowLabel(chapter, selectionMode: true)
            }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: OfflineChapterFramePreferenceKey.self,
                        value: [
                                chapter.id: proxy.frame(in: .global)
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
            .accessibilityHint("点按选择或取消选择")
        } else {
            let entryIndex = chaptersDescending
                ? (chapters.last?.order ?? chapter.order) - chapter.order
                : chapter.order - (chapters.first?.order ?? chapter.order)
            if ReadingSpaceWindowLayout.usesIPadLayout {
                Button { openReader(chapter) } label: {
                    chapterRowLabel(chapter, selectionMode: false)
                        .readingSpaceEntrance(max(0, entryIndex))
                        .id(chaptersDescending)
                }
                .buttonStyle(.plain)
                .accessibilityHint("点按进入阅读")
                .accessibilityIdentifier("detail.chapter.\(chapter.order)")
            } else {
                NavigationLink {
                    ReaderView(
                        novel: currentNovel,
                        chapterOrder: chapter.order,
                        preloadedChapters: chapters
                    )
                } label: {
                    chapterRowLabel(chapter, selectionMode: false)
                        .readingSpaceEntrance(max(0, entryIndex))
                        .id(chaptersDescending)
                }
                .navigationLinkIndicatorVisibility(.hidden)
                .accessibilityHint("点按进入阅读")
            }
        }
    }

    private func chapterRowLabel(_ chapter: ChapterMeta, selectionMode: Bool) -> some View {
        let isCurrent = chapter.id == progress?.chapterId
        return HStack(alignment: .center, spacing: selectionMode ? 14 : 10) {
            if selectionMode {
                selectionIndicator(for: chapter)
                    .highPriorityGesture(selectionGesture(for: chapter))
            } else {
                Text(chapter.order, format: .number.grouping(.never))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(isCurrent ? AppTheme.primaryDeep : ReadingSpace.profileMuted)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(minWidth: chapterNumberWidth, alignment: .leading)
                    .accessibilityLabel("第 \(chapter.order) 章")
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(chapter.title)
                    .font(serifFont(.body, .medium))
                    .appTextLineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(isCurrent ? AppTheme.primaryDeep : ReadingSpace.ink)
                AppAdaptiveRow(spacing: 8) {
                    Text("\(chapter.wordCount) 字")
                    if isCurrent {
                        Label("上次读到", systemImage: "bookmark.fill")
                            .foregroundStyle(AppTheme.primaryDeep)
                    }
                }
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
            }

            if !selectionMode && offlineStore.isDownloaded(chapter.id) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.caption)
                    .foregroundStyle(AppTheme.success)
                    .accessibilityLabel("已保存离线内容")
            }
        }
        .frame(minHeight: 44)
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
        .contentTransition(reduceMotion ? .opacity : .symbolEffect(.replace))
        .contentShape(Rectangle())
        .accessibilityHidden(true)
    }

    private func selectionGesture(for chapter: ChapterMeta) -> some Gesture {
        DragGesture(
            minimumDistance: 10,
            coordinateSpace: .global
        )
            .onChanged { drag in
                handleSelectionDrag(drag, startingAt: chapter)
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
        guard isSelectingOffline else { return }

        if selectionDragMode == nil {
            guard !offlineStore.isDownloaded(chapter.id),
                  let startIndex = chapters.firstIndex(where: { $0.id == chapter.id })
            else { return }

            selectionDragMode = selectedChapterIDs.contains(chapter.id) ? .deselect : .select
            selectionDragLastIndex = startIndex
            if selectedChapterIDs.contains(chapter.id) {
                selectedChapterIDs.remove(chapter.id)
            } else {
                selectedChapterIDs.insert(chapter.id)
            }
            interactionFeedback += 1
        }

        guard let mode = selectionDragMode,
              let targetIndex = chapterIndex(at: drag.location)
        else { return }

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

    private func chapterIndex(at location: CGPoint) -> Int? {
        let visibleRows = selectionRowFrames.compactMap { id, frame -> (index: Int, frame: CGRect)? in
            guard let index = chapters.firstIndex(where: { $0.id == id }) else { return nil }
            return (index, frame)
        }
        .sorted { $0.frame.midY < $1.frame.midY }
        guard !visibleRows.isEmpty else { return nil }

        return visibleRows.min {
            abs($0.frame.midY - location.y) < abs($1.frame.midY - location.y)
        }?.index
    }

    private func enterOfflineSelection() {
        withSelectionModeAnimation {
            isSelectingOffline = true
            selectedChapterIDs.removeAll()
            selectionRowFrames.removeAll()
            selectionDragMode = nil
            selectionDragLastIndex = nil
        }
    }

    private func cancelOfflineSelection() {
        withSelectionModeAnimation {
            isSelectingOffline = false
            selectedChapterIDs.removeAll()
            selectionRowFrames.removeAll()
            selectionDragMode = nil
            selectionDragLastIndex = nil
        }
    }

    private func toggleOfflineSelection(_ chapter: ChapterMeta) {
        guard !offlineStore.isDownloaded(chapter.id) else { return }
        withAnimation(reduceMotion ? AppMotion.micro : AppMotion.state) {
            if selectedChapterIDs.contains(chapter.id) {
                selectedChapterIDs.remove(chapter.id)
            } else {
                selectedChapterIDs.insert(chapter.id)
            }
        }
        interactionFeedback += 1
    }

    private func toggleOfflineSelectAll() {
        let downloadableIDs = Set(downloadableChapters.map(\.id))
        withAnimation(reduceMotion ? AppMotion.micro : AppMotion.state) {
            if downloadableIDs.isSubset(of: selectedChapterIDs) {
                selectedChapterIDs.subtract(downloadableIDs)
            } else {
                selectedChapterIDs.formUnion(downloadableIDs)
            }
        }
        interactionFeedback += 1
    }

    private func withSelectionModeAnimation(_ update: () -> Void) {
        withAnimation(reduceMotion ? AppMotion.micro : AppMotion.structural, update)
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
        withSelectionModeAnimation {
            isSelectingOffline = false
            selectedChapterIDs.removeAll()
        }
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

    private func bookHeader(availableWidth: CGFloat) -> some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 20))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 20))
        let coverSize = availableWidth < 320 ? CGSize(width: 92, height: 132) : AppLayout.coverDetail

        return layout {
            bookCover(size: coverSize)
            bookInformation
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func bookCover(size: CGSize) -> some View {
        CachedAsyncImage(
            url: APIClient.shared.coverURL(novelId: currentNovel.id, updatedAt: currentNovel.updatedAt),
            targetSize: size,
            previewTitle: currentNovel.title
        ) { image in
            image.resizable()
                .scaledToFill()
                .frame(width: size.width, height: size.height)
                .clipped()
        } placeholder: {
            ZStack {
                ReadingSpace.paper
                Image(systemName: "book.closed")
                    .font(.largeTitle)
                    .foregroundStyle(AppTheme.primary)
            }
            .accessibilityHidden(true)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: AppTheme.cardShadow, radius: 10, y: 5)
    }

    private var bookInformation: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(currentNovel.title)
                .font(serifFont(.title2, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !currentNovel.author.isEmpty {
                Text(currentNovel.author)
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !bookMetadata.isEmpty {
                Text(bookMetadata)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            AppAdaptiveRow(spacing: 8) {
                if currentNovel.updatedAt > 0 {
                    let date = Date(timeIntervalSince1970: Double(currentNovel.updatedAt) / 1000)
                    Text("更新于 \(date.formatted(.dateTime.year().month().day()))")
                        .fixedSize(horizontal: false, vertical: true)
                }
                if currentNovel.hasUpdate {
                    Text("有更新")
                        .fontWeight(.medium)
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .font(.caption)
            .foregroundStyle(ReadingSpace.profileMuted)
        }
        .multilineTextAlignment(.leading)
    }

    private var bookMetadata: String {
        var parts = Array(currentNovel.categories.prefix(2))
        if let status = currentNovel.statusLabel {
            parts.append(status)
        }
        return parts.joined(separator: " · ")
    }

    private func bottomBar(sideInset: CGFloat) -> some View {
        GlassEffectContainer(spacing: 12) {
            if isSelectingOffline {
                offlineSelectionBar
                    .transition(selectionModeTransition)
            } else {
                readingBar
                    .transition(selectionModeTransition)
            }
        }
        .padding(.horizontal, sideInset)
        .padding(.vertical, isSelectingOffline ? 12 : 8)
        .frame(maxWidth: .infinity)
        .background {
            if isSelectingOffline {
                ReadingSpace.profilePaper
                    .ignoresSafeArea(.container, edges: .bottom)
            }
        }
    }

    private var selectionModeTransition: AnyTransition {
        if reduceMotion {
            return .opacity.animation(AppMotion.micro)
        }
        return .move(edge: .bottom).combined(with: .opacity)
    }

    private var readingBar: some View {
        HStack(spacing: 12) {
            readButton
            bookshelfButton
        }
    }

    private func continueReadingLabel(_ chapter: ChapterMeta) -> some View {
        readingActionLabel(
            continueTitle,
            subtitle: isLoadingProgress ? "正在读取阅读位置…" : readingSubtitle(for: chapter),
            enabled: !isLoadingProgress
        )
    }

    private func readingSubtitle(for chapter: ChapterMeta) -> String {
        let chapterLabel = "第 \(chapter.order) 章"
        guard let progress, progress.chapterId == chapter.id, progress.scrollPercent.isFinite else {
            return chapterLabel
        }
        let value = min(max(progress.scrollPercent, 0), 1)
        return "\(chapterLabel) · 本章已读 \(Int((value * 100).rounded()))%"
    }

    @ViewBuilder
    private var readButton: some View {
        if let chapter = continueChapter {
            Group {
                if ReadingSpaceWindowLayout.usesIPadLayout {
                    Button { openReader(chapter) } label: {
                        continueReadingLabel(chapter)
                    }
                } else {
                    NavigationLink {
                        ReaderView(
                            novel: currentNovel,
                            chapterOrder: chapter.order,
                            preloadedChapters: chapters
                        )
                    } label: {
                        continueReadingLabel(chapter)
                    }
                }
            }
            .buttonStyle(ScaleButtonStyle())
            .accessibilityHint("从第 \(chapter.order) 章开始，\(chapter.title)")
            .accessibilityIdentifier("detail.read")
            .disabled(isLoadingProgress)
        } else {
            Button {} label: {
                readingActionLabel(
                    "开始阅读",
                    subtitle: isLoading ? "正在加载章节" : "章节暂不可用",
                    enabled: false
                )
            }
            .buttonStyle(.plain)
            .disabled(true)
        }
    }

    private func readingActionLabel(_ title: String, subtitle: String, enabled: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(enabled ? ReadingSpace.onSummary : ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(enabled ? ReadingSpace.summarySecondary : ReadingSpace.profileMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if enabled && !dynamicTypeSize.isAccessibilitySize {
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ReadingSpace.onSummary)
                    .accessibilityHidden(true)
            }
        }
        .multilineTextAlignment(.leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .background(enabled ? ReadingSpace.summary : ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 18))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }

    private var bookshelfButton: some View {
        Button {
            if inBookshelf {
                showRemoveConfirm = true
            } else {
                toggleBookshelf()
            }
        } label: {
            Group {
                if bookshelfBusy {
                    ProgressView().tint(AppTheme.primary)
                } else {
                    Image(systemName: inBookshelf ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(AppTheme.primary)
                        .contentTransition(reduceMotion ? .opacity : .symbolEffect(.replace.downUp))
                }
            }
            .frame(width: 52, height: 52)
        }
        .buttonStyle(AppGlassButtonStyle(glass: AppTheme.glass))
        .disabled(bookshelfBusy)
        .accessibilityLabel(inBookshelf ? "已在书架，点按移除" : "加入书架")
        .help(inBookshelf ? "移出书架" : "加入书架")
    }

    private var offlineSelectionBar: some View {
        HStack(spacing: 12) {
            Button {
                cancelOfflineSelection()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 52, height: 52)
            }
            .buttonStyle(AppGlassButtonStyle(glass: AppTheme.glass))
            .accessibilityLabel("取消选择")
            .help("取消选择")

            Button {
                startSelectedDownload()
            } label: {
                primaryActionLabel(
                    "下载",
                    systemImage: "arrow.down",
                    subtitle: "已选 \(selectedDownloadChapters.count) 章"
                )
            }
            .buttonStyle(AppGlassButtonStyle(
                glass: AppTheme.glassProminent,
                fallback: AppTheme.primaryLight
            ))
            .disabled(selectedDownloadChapters.isEmpty || offlineStore.isBatchDownloading)

            Button {
                toggleOfflineSelectAll()
            } label: {
                Image(systemName: isAllDownloadableSelected ? "checkmark.circle.fill" : "checkmark.circle")
                    .font(.system(size: 22, weight: .medium))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 52, height: 52)
            }
            .buttonStyle(AppGlassButtonStyle(glass: AppTheme.glass))
            .disabled(downloadableChapters.isEmpty)
            .accessibilityLabel(isAllDownloadableSelected ? "取消全选" : "全选可下载章节")
            .help(isAllDownloadableSelected ? "取消全选" : "全选可下载章节")
        }
        .foregroundStyle(AppTheme.primary)
    }

    private func primaryActionLabel(_ title: String, systemImage: String, subtitle: String) -> some View {
        VStack(spacing: 2) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.primary)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
                .monospacedDigit()
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 52)
        .accessibilityElement(children: .combine)
    }

    private var synopsisBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("简介")
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            synopsisContent

            if expandDescription || synopsisFullHeight > synopsisCollapsedHeight + 1 {
                Button {
                    interactionFeedback += 1
                    withAnimation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1)) {
                        expandDescription.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(expandDescription ? "收起简介" : "展开简介")
                            .contentTransition(.opacity)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: expandDescription)
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.semibold))
                            .rotationEffect(.degrees(expandDescription ? 180 : 0))
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.primary)
                .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                .accessibilityIdentifier("detail.synopsis.toggle")
            }
        }
    }

    private var synopsisContent: some View {
        // Keep both text layouts stable and animate only the clipped viewport.
        synopsisText
            .lineLimit(4)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { geometry in
                geometry.size.height
            } action: { height in
                synopsisCollapsedHeight = height
            }
            .hidden()
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: synopsisVisibleHeight, alignment: .topLeading)
            .overlay(alignment: .topLeading) {
                ZStack(alignment: .topLeading) {
                    synopsisText
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onGeometryChange(for: CGFloat.self) { geometry in
                            geometry.size.height
                        } action: { height in
                            synopsisFullHeight = height
                        }
                        .opacity(reduceMotion && !expandDescription ? 0 : 1)

                    synopsisText
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(ReadingSpace.profilePaper)
                        .opacity(expandDescription ? 0 : 1)
                }
                .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: expandDescription)
                .allowsHitTesting(false)
            }
            .clipped()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(currentNovel.description)
            .accessibilityIdentifier("detail.synopsis")
    }

    private var synopsisVisibleHeight: CGFloat? {
        let height = expandDescription ? synopsisFullHeight : synopsisCollapsedHeight
        return height > 0 ? height : nil
    }

    private var synopsisText: some View {
        Text(currentNovel.description)
            .font(.body)
            .foregroundStyle(ReadingSpace.ink)
            .lineSpacing(6)
    }

    private var chapterSectionHeader: some View {
        let headerLayout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))

        return headerLayout {
            HStack(spacing: 8) {
                Text(isSelectingOffline ? "选择章节" : "目录")
                    .font(serifFont(.title3, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(isLoading && chapters.isEmpty ? "加载中" : "\(chapters.count) 章")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            HStack(spacing: 4) {
                if !isSelectingOffline {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
                            chaptersDescending.toggle()
                        }
                    } label: {
                        Label(chaptersDescending ? "倒序" : "正序", systemImage: chaptersDescending ? "arrow.up" : "arrow.down")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(chaptersDescending ? "目录倒序，点按改为正序" : "目录正序，点按改为倒序")

                    if !chapters.isEmpty {
                        Button {
                            showChapterSearch = true
                        } label: {
                            Label("搜索目录", systemImage: "magnifyingglass")
                                .labelStyle(.iconOnly)
                                .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .accessibilityHint("按章名或章号查找")
                        .accessibilityIdentifier("detail.chapterSearch")
                    }
                }
            }
            .font(.subheadline.weight(.medium))
            .tint(AppTheme.primaryDeep)
            .frame(maxWidth: .infinity, alignment: dynamicTypeSize >= .xxxLarge ? .leading : .trailing)
        }
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
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } else {
                    let body = try APIClient.shared.jsonBody(["novelId": novel.id])
                    let _: OkEnvelope = try await APIClient.shared.post(
                        "/api/bookshelf", body: body, auth: true
                    )
                    inBookshelf = true
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                }
                interactionFeedback += 1
                AppFeedback.success(addingToBookshelf ? "已加入书架" : "已移出书架")
            } catch {
                AppFeedback.error()
                showBookshelfError = true
            }
        }
    }

    private func load(refresh: Bool = false) async {
        isLoading = true
        isLoadingProgress = appState.user != nil
        defer { isLoading = false }
        // 核心数据并行加载；详情失败静默回退列表数据
        async let detailRequest: Void = loadDetail()
        async let chaptersRequest: Void = loadChapters(refresh: refresh)
        // Load progress alongside content so the continue action settles sooner.
        if appState.user != nil {
            async let progressRequest: Void = loadProgress()
            async let bookshelfRequest: Void = loadBookshelf()
            _ = await (progressRequest, bookshelfRequest)
        }
        _ = await (detailRequest, chaptersRequest)
    }

    private func loadDetail() async {
        if let d: NovelDetailResponse = try? await APIClient.shared.getReader(
            "/api/novels/\(novel.id)"
        ) {
            displayNovel = d.novel
        }
    }

    private func loadChapters(refresh: Bool = false) async {
        do {
            let r: ChaptersResponse = try await APIClient.shared.getReader(
                "/api/chapters?novelId=\(novel.id)", refresh: refresh
            )
            chapters = r.chapters
            isSelectingOffline = false
            selectedChapterIDs.removeAll()
            isShowingOffline = false
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            let saved = ContentAccessStore.shared.mode == "adult" || novel.isRestricted ? [] : offlineStore.chapters(for: novel.id)
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
        let sessionID = ReaderProgressStore.shared.sessionID
        defer { isLoadingProgress = false }
        if let p: ProgressResponse = try? await APIClient.shared.get(
            "/api/progress?novelId=\(novel.id)", auth: true
        ) {
            guard !Task.isCancelled, ReaderProgressStore.shared.sessionID == sessionID else { return }
            ReaderProgressStore.shared.rememberRemote(p, novelID: novel.id, chapters: chapters, pageMode: "scroll")
            progress = p.progress
        }
        guard !Task.isCancelled, ReaderProgressStore.shared.sessionID == sessionID else { return }
        if let latest = ReaderProgressStore.shared.latestBody(for: novel.id) {
            progress = ReadingProgress(novelId: novel.id, chapterId: latest.chapterId,
                                       scrollPercent: latest.scrollPercent, updatedAt: latest.clientUpdatedAt)
        } else {
            progress = nil
        }
    }

    private func loadBookshelf() async {
        if let b: BookshelfResponse = try? await APIClient.shared.getReader(
                "/api/bookshelf?" + ReaderQuery.encode(["novelId": novel.id, "limit": "1"]), auth: true
        ) {
            inBookshelf = b.favorites.contains { $0.novelId == novel.id }
        }
    }
}

/// 一次点击保存一份不可变阅读参数，列表与详情刷新不改变已打开的阅读目标。
private struct DetailReaderRequest: Hashable {
    let id = UUID()
    let launch: ReaderLaunch
    let searchQuery: String
    let initialChapterID: String
    let searchSnapshot: BookSearchSnapshot?

    init(launch: ReaderLaunch, searchQuery: String = "", initialChapterID: String = "", searchSnapshot: BookSearchSnapshot? = nil) {
        self.launch = launch
        self.searchQuery = searchQuery
        self.initialChapterID = initialChapterID
        self.searchSnapshot = searchSnapshot
    }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// 目的地仅接收打开时的参数，不捕获详情页面的状态或 dismiss 环境。
private struct DetailReaderDestination: View {
    let request: DetailReaderRequest

    var body: some View {
        ReaderView(
            novel: request.launch.novel,
            chapterOrder: request.launch.chapterOrder,
            preloadedChapters: request.launch.preloadedChapters,
            searchQuery: request.searchQuery,
            initialChapterID: request.initialChapterID,
            searchSnapshot: request.searchSnapshot
        )
    }
}

private struct NovelDetailCloseButton: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button("关闭", systemImage: "xmark") { dismiss() }
            .labelStyle(.iconOnly)
            .help("关闭详情")
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
