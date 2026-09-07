import SwiftUI
import ZhiZhouCore

/// 小说详情页：书籍信息与目录平铺，阅读操作固定在底部，离线管理按需展开。
struct NovelDetailView: View {
    let novel: Novel
    var showsCloseButton = false
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .title2) private var bookTitleSize: CGFloat = 24

    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = true
    @State private var inBookshelf = false
    @State private var errorMessage: String?
    @State private var progress: ReadingProgress?
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
    @State private var isSelectingOffline = false
    @State private var selectedChapterIDs: Set<String> = []
    @State private var selectionRowFrames: [String: CGRect] = [:]
    @State private var selectionDragMode: OfflineSelectionDragMode?
    @State private var selectionDragLastIndex: Int?

    var body: some View {
        GeometryReader { geometry in
            let sideInset = max(20, (geometry.size.width - 640) / 2)
            ScrollViewReader { proxy in
                detailList(sideInset: sideInset, compactHeader: geometry.size.height < 640)
                    .onChange(of: isSelectingOffline) { _, isSelecting in
                        if isSelecting, let chapter = downloadableChapters.first {
                            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                                proxy.scrollTo(chapter.id, anchor: .top)
                            }
                        }
                    }
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                bottomBar
            }
        }
        .onPreferenceChange(OfflineChapterFramePreferenceKey.self) { frames in
            selectionRowFrames = frames
        }
        .pageBackground()
        .navigationTitle(currentNovel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(horizontalSizeClass == .regular ? .visible : .hidden, for: .tabBar)
        .toolbar {
            if showsCloseButton {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .help("关闭详情")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("离线下载", systemImage: "arrow.down.circle") {
                    showOfflineOptions = true
                }
                .labelStyle(.iconOnly)
                .disabled(chapters.isEmpty || isSelectingOffline)
                .help("离线下载")
            }
        }
        .sheet(isPresented: $showOfflineOptions) {
            offlineDownloadSheet
        }
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
    }

    private func detailList(sideInset: CGFloat, compactHeader: Bool) -> some View {
        List {
            bookHeader(compact: compactHeader)
                .listRowInsets(EdgeInsets(top: 16, leading: sideInset, bottom: 24, trailing: sideInset))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            if !currentNovel.description.isEmpty {
                synopsisBlock
                    .listRowInsets(EdgeInsets(top: 0, leading: sideInset, bottom: 24, trailing: sideInset))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            Section {
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
                ForEach(chapters) { chapter in
                    chapterRow(chapter)
                        .id(chapter.id)
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
            } header: {
                chapterSectionHeader
                    .textCase(nil)
                    .listRowInsets(EdgeInsets(top: 8, leading: sideInset, bottom: 8, trailing: sideInset))
            }
            .listRowInsets(EdgeInsets(top: 10, leading: sideInset, bottom: 10, trailing: sideInset))
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
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

    private var offlineDownloadSheet: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("已保存章节") {
                        Text("\(offlineStore.downloadedCount(for: currentNovel.id)) / \(chapters.count)")
                            .monospacedDigit()
                    }
                    if offlineStore.batchNovelID == currentNovel.id {
                        VStack(alignment: .leading, spacing: 10) {
                            ProgressView(value: offlineStore.batchProgress)
                                .tint(AppTheme.primary)
                            Text("已处理 \(offlineStore.batchCompleted) / \(offlineStore.batchTotal) 章")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Button("停止下载", systemImage: "stop.circle") {
                            offlineStore.cancelBatch()
                        }
                    } else if downloadableChapters.isEmpty {
                        Label("全部章节已保存", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(AppTheme.success)
                    } else {
                        Button("下载全部章节", systemImage: "arrow.down.circle") {
                            showOfflineOptions = false
                            startAllDownload()
                        }
                        .disabled(offlineStore.isBatchDownloading)

                        Button("选择章节", systemImage: "checklist") {
                            showOfflineOptions = false
                            enterOfflineSelection()
                        }
                        .disabled(offlineStore.isBatchDownloading)

                        if offlineStore.isBatchDownloading {
                            Text("另一本书正在下载")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                } header: {
                    Text(currentNovel.title)
                        .textCase(nil)
                }
                if let error = offlineStore.lastError {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .foregroundStyle(AppTheme.danger)
                        Button("好") { offlineStore.clearError() }
                    }
                }
            }
            .navigationTitle("离线下载")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭", systemImage: "xmark") { showOfflineOptions = false }
                        .labelStyle(.iconOnly)
                        .help("关闭下载面板")
                }
            }
        }
        .tint(AppTheme.primary)
        .presentationDetents([.medium, .large])
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
        HStack(alignment: .center, spacing: 12) {
            if selectionMode {
                selectionIndicator(for: chapter)
                    .highPriorityGesture(selectionGesture(for: chapter))
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(chapter.title)
                    .font(.body)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                HStack(spacing: 8) {
                    Text("\(chapter.wordCount) 字")
                    if chapter.id == progress?.chapterId {
                        Label("上次读到", systemImage: "bookmark.fill")
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer(minLength: 0)

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
        isSelectingOffline = true
        selectedChapterIDs.removeAll()
        selectionRowFrames.removeAll()
        selectionDragMode = nil
        selectionDragLastIndex = nil
    }

    private func cancelOfflineSelection() {
        isSelectingOffline = false
        selectedChapterIDs.removeAll()
        selectionRowFrames.removeAll()
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

    private func bookHeader(compact: Bool) -> some View {
        Group {
            if compact && !dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .center, spacing: 20) {
                    bookCover(size: CGSize(width: 88, height: 126))
                    bookInformation(centered: false)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(spacing: 18) {
                    bookCover(size: dynamicTypeSize.isAccessibilitySize
                        ? CGSize(width: 88, height: 126)
                        : CGSize(width: 128, height: 184))
                    bookInformation(centered: true)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func bookCover(size: CGSize) -> some View {
        CachedAsyncImage(
            url: APIClient.shared.coverURL(novelId: currentNovel.id, updatedAt: currentNovel.updatedAt),
            targetSize: size
        ) { image in
            image.resizable().scaledToFit()
        } placeholder: {
            ZStack {
                AppTheme.surfaceSecondary
                Image(systemName: "book.closed")
                    .font(.largeTitle)
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: AppTheme.cardShadow, radius: 10, y: 5)
        .accessibilityHidden(true)
    }

    private func bookInformation(centered: Bool) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 8) {
            Text(currentNovel.title)
                .font(SongtiFont.font(size: bookTitleSize, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(currentNovel.author)
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !bookMetadata.isEmpty {
                Text(bookMetadata)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if currentNovel.hasUpdate {
                Text("有更新")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.seal)
            }
        }
        .multilineTextAlignment(centered ? .center : .leading)
    }

    private var bookMetadata: String {
        var parts = Array(currentNovel.categories.prefix(2))
        if let status = currentNovel.statusLabel {
            parts.append(status)
        }
        return parts.joined(separator: " · ")
    }

    private var bottomBar: some View {
        GlassEffectContainer(spacing: 12) {
            if isSelectingOffline {
                offlineSelectionBar
            } else {
                readingBar
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }

    private var readingBar: some View {
        HStack(spacing: 12) {
            readButton
            bookshelfButton
        }
    }

    private func readingSubtitle(for chapter: ChapterMeta) -> String {
        let chapterLabel = "第 \(chapter.order) 章"
        if let progress, progress.chapterId == chapter.id {
            let value = min(max(progress.scrollPercent, 0), 1)
            return "\(chapterLabel) · 本章已读 \(Int((value * 100).rounded()))%"
        }
        return chapterLabel
    }

    @ViewBuilder
    private var readButton: some View {
        if let chapter = continueChapter {
            NavigationLink {
                ReaderView(
                    novel: currentNovel,
                    chapterOrder: chapter.order,
                    preloadedChapters: chapters
                )
            } label: {
                primaryActionLabel(
                    continueTitle,
                    systemImage: "book.fill",
                    subtitle: readingSubtitle(for: chapter)
                )
            }
            .buttonStyle(AppGlassButtonStyle(
                glass: AppTheme.glassProminent,
                fallback: AppTheme.primaryLight
            ))
            .accessibilityHint("从第 \(chapter.order) 章开始，\(chapter.title)")
        } else {
            Button {} label: {
                primaryActionLabel(
                    "开始阅读",
                    systemImage: "book.fill",
                    subtitle: isLoading ? "正在加载章节" : "章节暂不可用"
                )
            }
            .buttonStyle(AppGlassButtonStyle(
                glass: AppTheme.glassProminent,
                fallback: AppTheme.primaryLight
            ))
            .disabled(true)
        }
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
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            synopsisText
                .lineLimit(expandDescription ? nil : 4)
                .fixedSize(horizontal: false, vertical: true)
                .background(alignment: .topLeading) {
                    // Measure both variants at the same width, including while expanded.
                    ZStack(alignment: .topLeading) {
                        synopsisText
                            .lineLimit(4)
                            .fixedSize(horizontal: false, vertical: true)
                            .onGeometryChange(for: CGFloat.self) { geometry in
                                geometry.size.height
                            } action: { height in
                                synopsisCollapsedHeight = height
                            }
                        synopsisText
                            .fixedSize(horizontal: false, vertical: true)
                            .onGeometryChange(for: CGFloat.self) { geometry in
                                geometry.size.height
                            } action: { height in
                                synopsisFullHeight = height
                            }
                    }
                    .hidden()
                    .accessibilityHidden(true)
                }

            if expandDescription || synopsisFullHeight > synopsisCollapsedHeight + 1 {
                Button(expandDescription ? "收起简介" : "展开简介") {
                    interactionFeedback += 1
                    if reduceMotion {
                        expandDescription.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            expandDescription.toggle()
                        }
                    }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.primary)
                .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                .frame(minHeight: 44, alignment: .leading)
            }
        }
    }

    private var synopsisText: some View {
        Text(currentNovel.description)
            .font(.body)
            .foregroundStyle(AppTheme.textSecondary)
            .lineSpacing(4)
    }

    private var chapterSectionHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(isSelectingOffline ? "选择章节" : "目录")
                .font(.headline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            Text(isLoading && chapters.isEmpty ? "加载中" : "\(chapters.count) 章")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
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
