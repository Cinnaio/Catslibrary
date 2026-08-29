import SwiftUI
import ZhiZhouCore
import UIKit

private final class ReaderPercentBox {
    var value: Double = 0
}

/// 中文段首缩进：两个全角空格（U+3000 宽恰为一个汉字，随字号自动缩放）。
let paragraphIndent = "\u{3000}\u{3000}"

/// 阅读器：滚动/翻页双模式、纸面主题、点击翻页开关、边缘滑动翻页、按段/页恢复进度。
///
/// 布局：正文占满全屏（点击中部可收起/展开底部浮层），顶部为系统导航条
/// （纸面底色），底部浮层放进度条与上一章/下一章/页码。沉浸时不遮挡正文。
struct ReaderView: View {
    let novel: Novel
    let preloadedChapters: [ChapterMeta]
    @State var chapterOrder: Int

    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.dismiss) private var dismiss

    @State private var chapter: ChapterFull?
    @State private var chapterMetas: [ChapterMeta] = []
    @State private var chapterCount = 0
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showTOC = false
    @State private var showSettings = false
    @State private var showChrome = true
    @State private var scrolledParagraph: Int?
    @State private var pendingScrollRestore: Int?
    @State private var paragraphCount = 0
    /// 章节正文一次性切分缓存，避免滚动时反复 split 整章字符串。
    @State private var paragraphs: [String] = []
    @State private var saveTask: Task<Void, Never>?
    @State private var percentBox = ReaderPercentBox()
    /// 展示用百分比（@Observable 之外的可变参考 → 派生为可观察 State，驱动 Chrome 刷新）。
    @State private var progressPercent = 0.0
    @State private var suppressPercent = false
    /// 翻页模式：分页结果、当前页、每页对应的整章字符区间、待恢复的进度百分比。
    @State private var pages: [AttributedString] = []
    @State private var pageRanges: [NSRange] = []
    @State private var currentPage = 0
    @State private var pendingRestorePercent: Double?
    @State private var interactionFeedback = 0
    @State private var fontRevision = 0
    @State private var chapterIsSaved = false

    init(novel: Novel, chapterOrder: Int, preloadedChapters: [ChapterMeta] = []) {
        self.novel = novel
        self.preloadedChapters = preloadedChapters
        _chapterOrder = State(initialValue: chapterOrder)
    }

    var totalOrderCount: Int {
        max(chapterCount, novel.chapterCount, chapterMetas.count)
    }

    /// 系统深色：跟随 @Environment 而非 UIScreen.main（多窗口/iPad 更准，且实时响应外观切换）。
    private var systemIsDark: Bool { systemScheme == .dark }
    private var paper: Color { settings.backgroundColor(systemDark: systemIsDark) }
    private var ink: Color { settings.textColor(systemDark: systemIsDark) }
    private var scheme: ColorScheme? { settings.colorSchemeOverride(systemDark: systemIsDark) }

    private var percentText: String {
        "已读 \(Int((progressPercent * 100).rounded()))%"
    }

    private var atChapterEnd: Bool {
        settings.pageMode == "page"
            && !pages.isEmpty
            && currentPage == pages.count - 1
            && chapterOrder < totalOrderCount
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                if settings.pageMode == "page" {
                    pagedReader(geo: geo)
                } else {
                    readerScroll(geo: geo)
                }
                // 底部浮层浮在正文之上，隐铬时整体淡出并停止响应点击。
                readerChrome
            }
        }
        .background(paper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(chapter?.title ?? "阅读")
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar(showChrome ? .visible : .hidden, for: .navigationBar)
        .toolbar(.hidden, for: .bottomBar)
        .toolbar(.hidden, for: .tabBar)
        .statusBarHidden(!showChrome)
        .persistentSystemOverlays(showChrome ? .automatic : .hidden)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                readerToolbarGroup
            }
        }
        .sensoryFeedback(.selection, trigger: chapterOrder)
        .sensoryFeedback(.selection, trigger: currentPage)
        .sensoryFeedback(.selection, trigger: interactionFeedback)
        .sheet(isPresented: $showTOC) {
            ChapterListView(
                novel: novel,
                currentOrder: chapterOrder,
                initialChapters: chapterMetas
            ) { order in
                go(to: order)
            }
            .preferredColorScheme(scheme)
            .presentationBackground(paper)
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showSettings) {
            ReaderSettingsView()
                .preferredColorScheme(scheme)
                .presentationBackground(paper)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .preferredColorScheme(scheme)
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .zhiZhouFontStoreDidChange)) { _ in
            fontRevision &+= 1
        }
        .onChange(of: chapterOrder) { _, _ in
            resetForNewChapter()
            Task { await load() }
        }
        .onChange(of: settings.pageMode) { _, mode in
            prepareForModeChange(to: mode)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background || phase == .inactive {
                saveProgressNow()
            } else if phase == .active {
                flushProgress()
            }
        }
        .onAppear { applyWakeLock() }
        .onChange(of: settings.wakeLockEnabled) { _, _ in applyWakeLock() }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            saveTask?.cancel()
            saveProgressNow()
        }
    }

    /// 阅读区内容：加载中 / 加载失败 / 章节正文（居中标题 + 带首行缩进的段落）。
    @ViewBuilder
    private var readingContent: some View {
        if isLoading && chapter == nil {
            ProgressView("加载中…")
                .tint(ink)
                .frame(maxWidth: .infinity, minHeight: 300)
        } else if let errorMessage, chapter == nil {
            ContentUnavailableView {
                Label("无法打开这一章", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await load() } }
            }
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 300)
        } else if let chapter {
            Text(chapter.title)
                .font(settings.titleFont)
                .multilineTextAlignment(.center)
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 14)
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                Text(paragraphIndent + paragraph)
                    .font(settings.bodyFont)
                    .lineSpacing(settings.lineSpacing)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(index)
            }
            if chapterOrder < totalOrderCount {
                nextChapterButton
            }
        }
    }

    /// 滚动区。独立成子表达式，避免 body 表达式过复杂导致 Release 下类型检查超时。
    /// 水平安全区在横屏（灵动岛/刘海）下左右不相等，若交给 ScrollView 自动处理，
    /// 正文左右留白会被压得一宽一窄。这里关掉自动水平安全区，
    /// 自己按“两侧取较大值”补一份对称留白，任何方向都左右等宽。
    private func readerScroll(geo: GeometryProxy) -> some View {
        let sideInset = max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: settings.paragraphSpacing) {
                readingContent
            }
            .padding(.horizontal, sideInset + 22)
            .padding(.top, 18)
            // 工具栏只是覆盖层，正文底部始终保留相同的安全距离，避免隐铬时整页跳动。
            .padding(.bottom, 132)
            .frame(maxWidth: min(geo.size.width, 720))
            .frame(maxWidth: .infinity)
            .scrollTargetLayout()
        }
        .ignoresSafeArea(edges: .horizontal)
        .scrollPosition(id: $scrolledParagraph)
        .background(paper)
        .contentShape(Rectangle())
        .accessibilityAction(named: showChrome ? "隐藏阅读控制" : "显示阅读控制") {
            toggleChrome()
        }
        // 点按热区覆盖整个 ScrollView，包括短章节下面的空白区域。
        .simultaneousGesture(
            SpatialTapGesture().onEnded { value in
                handleScrollTap(x: value.location.x, width: geo.size.width)
            }
        )
        // 仅识别从屏幕最外侧开始的横向滑动，避免普通上下滚动被误判为翻页。
        .simultaneousGesture(
            DragGesture(minimumDistance: 18).onEnded { value in
                handleEdgeSwipe(value, width: geo.size.width)
            }
        )
        .onScrollGeometryChange(for: CGSize.self) { geometry in
            geometry.contentSize
        } action: { _, contentSize in
            restoreScrollIfReady(contentSize: contentSize)
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            let scrollableHeight = max(geometry.contentSize.height - geometry.containerSize.height, 1)
            return min(1, max(0, geometry.contentOffset.y / scrollableHeight))
        } action: { _, value in
            updatePercent(fromScrollOffset: value)
        }
        // 拖动正文时自动收起浮层，轻点恢复。
        .onScrollPhaseChange { _, newPhase in
            if newPhase == .interacting { hideChrome() }
        }
    }

    /// 翻页阅读区（TabView 负责左右滑动，点按左右区域可选）。水平安全区同样用两侧较大值做对称留白。
    private func pagedReader(geo: GeometryProxy) -> some View {
        let sideInset = max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing) + 22
        // 与滚动模式一致：内容总宽上限 720，再扣对称留白，宽屏下正文不无脑拉满。
        let contentWidth = max(40, min(geo.size.width, 720) - sideInset * 2)
        // 页面高度固定；工具栏是覆盖层，切换显示状态不应触发整章重新分页和页面跳动。
        let contentHeight = max(120, geo.size.height - 8 - 78)
        let pageSize = CGSize(width: contentWidth, height: contentHeight)
        let key = "\(chapter?.id ?? "-"):\(Int(contentWidth)):\(Int(contentHeight)):\(settings.fontSizeIndex):\(settings.lineHeight):\(settings.paragraphSpacing):\(settings.useSerif):\(dynamicTypeSize):\(fontRevision)"

        return Group {
            if isLoading && chapter == nil {
                ProgressView("加载中…")
                    .tint(ink)
                    .frame(maxWidth: .infinity, minHeight: 300)
            } else if let errorMessage, chapter == nil {
                ContentUnavailableView {
                    Label("无法打开这一章", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity, minHeight: 300)
            } else if pages.isEmpty {
                ProgressView("正在排版…")
                    .tint(ink)
                    .frame(maxWidth: .infinity, minHeight: 300)
            } else {
                TabView(selection: $currentPage) {
                    ForEach(pages.indices, id: \.self) { index in
                        pagedPage(
                            pages[index],
                            width: contentWidth,
                            height: contentHeight,
                            showsNextChapter: atChapterEnd && index == pages.count - 1
                        )
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .accessibilityAction(named: showChrome ? "隐藏阅读控制" : "显示阅读控制") {
                    toggleChrome()
                }
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        handlePageTap(x: value.location.x, width: geo.size.width)
                    }
                )
            }
        }
        .task(id: key) { await rebuildPages(size: pageSize) }
        .onChange(of: currentPage) { _, page in
            updatePageProgress(page)
        }
    }

    /// 单页内容：按排版尺寸顶对齐展示；若个别页因测量误差超出一行，内部可纵向滚动兜底。
    private func pagedPage(
        _ text: AttributedString,
        width: CGFloat,
        height: CGFloat,
        showsNextChapter: Bool
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(text)
                    .foregroundStyle(ink)
                    .frame(width: width, alignment: .topLeading)
                if showsNextChapter {
                    nextChapterButton
                        .frame(width: width)
                        .padding(.top, 20)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: width, height: height, alignment: .top)
    }

    private func handlePageTap(x: CGFloat, width: CGFloat) {
        guard !pages.isEmpty else { return }
        guard settings.clickPagingEnabled else {
            toggleChrome()
            return
        }
        let third = width / 3
        if x < third {
            goPage(currentPage - 1)
        } else if x > width - third {
            goPage(currentPage + 1)
        } else {
            toggleChrome()
        }
    }

    private func handleScrollTap(x: CGFloat, width: CGFloat) {
        guard settings.clickPagingEnabled else {
            toggleChrome()
            return
        }
        let edge = width * 0.26
        if x < edge {
            go(to: chapterOrder - 1)
        } else if x > width - edge {
            go(to: chapterOrder + 1)
        } else {
            toggleChrome()
        }
    }

    private func handleEdgeSwipe(_ value: DragGesture.Value, width: CGFloat) {
        let horizontal = value.translation.width
        let vertical = value.translation.height
        let edgeWidth = min(72, max(44, width * 0.08))
        let startsAtLeft = value.startLocation.x <= edgeWidth
        let startsAtRight = value.startLocation.x >= width - edgeWidth

        guard (startsAtLeft || startsAtRight),
              abs(horizontal) >= 72,
              abs(horizontal) >= abs(vertical) * 1.35
        else { return }

        if startsAtLeft, horizontal > 0 {
            go(to: chapterOrder - 1)
        } else if startsAtRight, horizontal < 0 {
            go(to: chapterOrder + 1)
        }
    }

    private func goPage(_ page: Int) {
        guard !pages.isEmpty else { return }
        let target = max(0, min(page, pages.count - 1))
        guard target != currentPage else { return }
        currentPage = target
    }

    /// 底部浮层：进度条 + 上一章/页码/下一章。翻页到章末时变为居中的“下一章”按钮。
    private var readerChrome: some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 14) {
                ReaderProgressBar(
                    fraction: progressPercent,
                    tint: AppTheme.primary,
                    track: AppTheme.primary.opacity(0.18)
                )

                if atChapterEnd {
                    Button {
                        interactionFeedback += 1
                        go(to: chapterOrder + 1)
                    } label: {
                        Label("下一章", systemImage: "arrow.forward")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 22)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.glass(AppTheme.glassProminent))
                    .tint(AppTheme.primary)
                    .accessibilityLabel("下一章")
                } else {
                    GlassEffectContainer(spacing: 8) {
                        HStack(spacing: 8) {
                            chromeSegmentButton(systemName: "chevron.left", label: "上一章", isEnabled: chapterOrder > 1) {
                                go(to: chapterOrder - 1)
                            }
                            readerStatusPill
                            chromeSegmentButton(systemName: "chevron.right", label: "下一章", isEnabled: chapterOrder < totalOrderCount) {
                                go(to: chapterOrder + 1)
                            }
                        }
                    }
                    .frame(height: 52)
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.top, 14)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .opacity(showChrome ? 1 : 0)
        .allowsHitTesting(showChrome)
        .accessibilityHidden(!showChrome)
    }

    private var readerStatusPill: some View {
        VStack(spacing: 2) {
            Text("第 \(chapterOrder)/\(totalOrderCount) 章")
                .font(.footnote.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(AppTheme.primary.opacity(0.92))
            HStack(spacing: 4) {
                Text(percentText)
                    .monospacedDigit()
                Image(systemName: chapterIsSaved ? "arrow.down.circle.fill" : "icloud.slash")
                    .accessibilityHidden(true)
                Text(chapterIsSaved ? "离线可读" : "未缓存")
            }
            .font(.caption2)
            .foregroundStyle(AppTheme.primary.opacity(0.7))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .glassEffect(AppTheme.glassClear, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("第 \(chapterOrder) / \(totalOrderCount) 章，\(percentText)，\(chapterIsSaved ? "离线可读" : "未缓存")")
    }

    private var nextChapterButton: some View {
        Button {
            interactionFeedback += 1
            go(to: chapterOrder + 1)
        } label: {
            Label("下一章", systemImage: "arrow.forward")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
        }
        .foregroundStyle(AppTheme.primary)
        .buttonStyle(.glass(AppTheme.glassProminent))
        .accessibilityLabel("下一章")
    }

    /// 顶部操作组：只保留图标与 44pt 点按区，不再叠加玻璃容器和按钮底板。
    private var readerToolbarGroup: some View {
        HStack(spacing: 10) {
            Button {
                showTOC = true
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("目录")

            Button {
                showSettings = true
            } label: {
                Image(systemName: "textformat.size")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("阅读设置")
        }
        .buttonStyle(.plain)
        .foregroundStyle(ink.opacity(0.82))
        .fixedSize()
    }

    /// 底部阅读控制组：上一章、章节进度、下一章共享一块轻量分段表面。
    private func chromeSegmentButton(
        systemName: String,
        label: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 44, height: 44)
        }
        .foregroundStyle(AppTheme.primary.opacity(isEnabled ? 0.95 : 0.28))
        .disabled(!isEnabled)
        .buttonStyle(.glass(AppTheme.glassClear))
        .accessibilityLabel(label)
    }

    /// 重新排版：按当前字号/行距/视口把章节切成多页，并尽量保持阅读位置不漂移。
    /// 若此前已有分页（用户改了字号/行距），则按“上一页起始字符”在新分页里重新定位，
    /// 而不是按百分比——百分比在文本重排后无法对齐同一段落，会产生正文偏移。
    private func rebuildPages(size: CGSize) async {
        guard let chapter, size.width > 40, size.height > 60 else { return }
        guard paragraphs.count > 0 || !chapter.title.isEmpty else { return }
        // 锚点 = 重排前当前页的起始字符。只有 pageRanges 与当前页有效时才使用。
        let anchorChar: Int? = currentPage < pageRanges.count ? pageRanges[currentPage].location : nil
        let spec = ChapterPaginator.Spec(
            bodyFont: settings.bodyUIFont,
            titleFont: settings.titleUIFont,
            lineSpacing: settings.lineSpacing,
            paragraphSpacing: settings.paragraphSpacing,
            title: chapter.title,
            paragraphs: paragraphs
        )
        let result = await Task.detached(priority: .userInitiated) {
            guard !Task.isCancelled else { return [ChapterPaginator.Page]() }
            let attr = ChapterPaginator.attributedString(for: spec)
            return ChapterPaginator.pages(
                of: attr,
                pageSize: size,
                isCancelled: { Task.isCancelled }
            )
        }.value
        guard !Task.isCancelled else { return }
        guard chapter.id == self.chapter?.id else { return }
        guard !result.isEmpty else { pages = []; pageRanges = []; return }
        pages = result.map { AttributedString($0.attributed) }
        pageRanges = result.map { $0.range }
        let lastPage = max(result.count - 1, 0)
        if let anchorChar {
            // 起点 ≤ 锚点的最后一页：该页起点最贴近锚点且不越过它，
            // 锚点字符落在页首而非页身中部——避免露出过多旧文本导致“正文偏移”的观感。
            if let idx = result.lastIndex(where: { $0.range.location <= anchorChar }) {
                currentPage = idx
            } else {
                currentPage = 0
            }
        } else if let restore = pendingRestorePercent, restore > 0, lastPage > 0 {
            // 首次排版（进章或首次进入翻页模式）：用章内保存的进度百分比定位。
            currentPage = min(lastPage, Int((restore * Double(lastPage)).rounded()))
            pendingRestorePercent = nil
        } else if lastPage > 0 {
            let target = Int((percentBox.value * Double(lastPage)).rounded())
            currentPage = max(0, min(lastPage, target))
        } else {
            currentPage = 0
        }
    }

    private func updatePageProgress(_ page: Int) {
        guard pages.count > 1 else { return }
        let value = min(1, max(0, Double(page) / Double(pages.count - 1)))
        setProgress(value)
        pendingRestorePercent = value
        debounceSaveProgress()
    }

    private func toggleChrome() {
        interactionFeedback += 1
        if reduceMotion {
            showChrome.toggle()
        } else {
            withAnimation(.easeInOut(duration: 0.22)) { showChrome.toggle() }
        }
    }

    private func hideChrome() {
        guard showChrome else { return }
        if reduceMotion {
            showChrome = false
        } else {
            withAnimation(.easeOut(duration: 0.2)) { showChrome = false }
        }
    }

    private func setProgress(_ value: Double) {
        let clamped = min(1, max(0, value))
        percentBox.value = clamped
        progressPercent = clamped
    }

    private func prepareForModeChange(to mode: String) {
        if mode == "page" {
            pages = []
            pageRanges = []
            currentPage = 0
            pendingRestorePercent = progressPercent
        } else {
            let last = max(paragraphs.count - 1, 0)
            let target = last == 0
                ? 0
                : min(last, max(0, Int((progressPercent * Double(last)).rounded(.down))))
            suppressPercent = true
            scrolledParagraph = nil
            pendingScrollRestore = target
        }
    }

    private func applyWakeLock() {
        UIApplication.shared.isIdleTimerDisabled = settings.wakeLockEnabled
    }

    /// 切章前清空旧正文，避免失败时静默显示上一章内容。
    private func resetForNewChapter() {
        saveTask?.cancel()
        chapter = nil
        paragraphs = []
        paragraphCount = 0
        setProgress(0)
        scrolledParagraph = nil
        suppressPercent = false
        errorMessage = nil
        pages = []
        pageRanges = []
        currentPage = 0
        pendingRestorePercent = nil
        pendingScrollRestore = nil
        chapterIsSaved = false
    }

    private func load() async {
        isLoading = true
        let order = chapterOrder // 快照：防止慢响应覆盖新章状态
        defer {
            // 仅当前章节仍为目标时清除 loading，避免旧请求把新章节的加载态提前关掉
            if order == chapterOrder { isLoading = false }
        }
        do {
            if chapterMetas.isEmpty {
                if !preloadedChapters.isEmpty {
                    chapterMetas = preloadedChapters
                } else {
                    let list: ChaptersResponse = try await APIClient.shared.get(
                        ContentPolicy.safePath("/api/chapters?novelId=\(novel.id)")
                    )
                    chapterMetas = list.chapters
                }
            }
            chapterCount = chapterMetas.count

            guard chapterOrder == order else { return } // 用户已切章，丢弃过期结果

            guard let meta = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                let list: ChaptersResponse = try await APIClient.shared.get(
                    ContentPolicy.safePath("/api/chapters?novelId=\(novel.id)")
                )
                chapterMetas = list.chapters
                chapterCount = list.chapters.count
                guard chapterOrder == order else { return }
                guard let retry = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                    errorMessage = "未找到第 \(chapterOrder) 章"
                    return
                }
                try await loadContent(id: retry.id)
                return
            }

            try await loadContent(id: meta.id)
        } catch {
            // 仅当前章节仍为目标时显示错误，避免切章后旧错误串台
            guard chapterOrder == order else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadContent(id: String) async throws {
        let order = chapterOrder
        let r: ChapterResponse = try await APIClient.shared.get(
            ContentPolicy.safePath("/api/chapters/\(id)")
        )
        guard chapterOrder == order else { return }
        chapter = r.chapter
        errorMessage = nil
        paragraphs = Self.paragraphs(of: r.chapter)
        paragraphCount = paragraphs.count
        chapterIsSaved = await APIClient.shared.hasCachedChapter(id: r.chapter.id)
        guard chapterOrder == order else { return }

        var restore: Double = 0
        if APIClient.shared.isAuthenticated {
            do {
                let p: ProgressResponse = try await APIClient.shared.get(
                    "/api/progress?novelId=\(novel.id)", auth: true
                )
                guard chapterOrder == order else { return }
                if let prog = p.progress, prog.chapterId == r.chapter.id, prog.scrollPercent > 0 {
                    restore = prog.scrollPercent
                }
            } catch {
                // 正文已经可以从磁盘缓存离线打开；进度失败不应遮挡当前章节。
                guard chapterOrder == order else { return }
            }
        }
        // 网络返回旧快照时，优先使用本地尚未上传的同章进度，避免弱网下回退到旧位置。
        if let pending = ReaderProgressStore.shared.pendingBody(for: novel.id),
           pending.chapterId == r.chapter.id {
            restore = pending.scrollPercent
        }

        let last = max(paragraphs.count - 1, 0)
        let target = last == 0 ? 0 : min(last, max(0, Int((restore * Double(last)).rounded(.down))))
        setProgress(restore)
        pendingRestorePercent = restore > 0 ? restore : nil
        suppressPercent = true
        scrolledParagraph = nil
        // 等 ScrollView 报告真实 contentSize 后再定位，避免仅靠 Task.yield 猜测 layout 时序。
        pendingScrollRestore = target
        prefetchNextChapter()
    }

    private func updatePercent(from index: Int?) {
        guard !suppressPercent, let index, paragraphCount > 1 else { return }
        let value = min(1, max(0, Double(index) / Double(paragraphCount - 1)))
        setProgress(value)
        pendingRestorePercent = value
        debounceSaveProgress()
    }

    private func updatePercent(fromScrollOffset value: CGFloat) {
        guard !suppressPercent else { return }
        let next = min(1, max(0, Double(value)))
        guard abs(next - percentBox.value) > 0.005 else { return }
        setProgress(next)
        pendingRestorePercent = next
        debounceSaveProgress()
    }

    private func restoreScrollIfReady(contentSize: CGSize) {
        guard let target = pendingScrollRestore, contentSize.height > 0 else { return }
        pendingScrollRestore = nil
        scrolledParagraph = target
        Task { @MainActor in
            await Task.yield()
            suppressPercent = false
        }
    }

    private func debounceSaveProgress() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard !Task.isCancelled, APIClient.shared.isAuthenticated else { return }
            saveProgressNow()
        }
    }

    private func saveProgressNow() {
        guard APIClient.shared.isAuthenticated, let body = progressBody() else { return }
        ReaderProgressStore.shared.enqueue(body)
        flushProgress()
    }

    private func flushProgress() {
        Task { @MainActor in await ReaderProgressStore.shared.flush() }
    }

    private func prefetchNextChapter() {
        guard let next = chapterMetas.first(where: { $0.order == chapterOrder + 1 }) else { return }
        let nextID = next.id
        Task {
            await APIClient.shared.prefetchChapter(id: nextID)
        }
    }

    /// 进度体与当前展示章节强一致：切章失败/错位时不写脏数据。
    private func progressBody() -> SaveProgressBody? {
        guard let chapter, chapter.order == chapterOrder else { return nil }
        return SaveProgressBody(
            novelId: novel.id,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            chapterOrder: chapter.order,
            scrollPercent: percentBox.value,
            pageMode: settings.pageMode,
            clientUpdatedAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }

    private func go(to order: Int) {
        guard order >= 1, order <= totalOrderCount else { return }
        guard order != chapterOrder else { return }
        // 必须在修改 chapterOrder 前捕获旧章节进度，否则 resetForNewChapter
        // 会清空 chapter，旧章节就没有可保存的快照了。
        saveTask?.cancel()
        saveProgressNow()
        chapterOrder = order
    }

    /// 章节段落切分：静态纯函数，仅在加载时执行一次。
    nonisolated private static func paragraphs(of chapter: ChapterFull) -> [String] {
        let byBlankLine = chapter.content
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if byBlankLine.count > 1 { return byBlankLine }
        return chapter.content
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

/// 底部阅读进度细线：纸面环境下明显的柔色进度轨道 + 黛青填充。
private struct ReaderProgressBar: View {
    var fraction: Double
    var tint: Color
    var track: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(track)
                    .frame(height: 4)
                Capsule()
                    .fill(tint)
                    .frame(width: max(6, geo.size.width * min(1, max(0, fraction))), height: 4)
            }
            .padding(.vertical, 4)
            .glassEffect(AppTheme.glassClear, in: Capsule())
        }
        .frame(height: 12)
        .padding(.horizontal, 18)
        .accessibilityHidden(true)
    }
}
