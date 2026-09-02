import SwiftUI
import ZhiZhouCore
import UIKit

private final class ReaderPercentBox {
    var value: Double = 0
}

/// Caches the expensive text-to-NSAttributedString conversion for each
/// paragraph. Scroll progress updates the reader chrome frequently, but does
/// not change the paragraph's visual content.
private final class ReaderParagraphTextCache {
    private struct Entry {
        let text: String
        let thoughtsKey: String
        let renderKey: String
        let value: NSAttributedString
    }

    private var entries: [Int: Entry] = [:]

    func value(
        for index: Int,
        text: String,
        thoughtsKey: String,
        renderKey: String,
        make: () -> NSAttributedString
    ) -> NSAttributedString {
        if let entry = entries[index],
           entry.text == text,
           entry.thoughtsKey == thoughtsKey,
           entry.renderKey == renderKey {
            return entry.value
        }

        let value = make()
        entries[index] = Entry(
            text: text,
            thoughtsKey: thoughtsKey,
            renderKey: renderKey,
            value: value
        )
        return value
    }

    func removeAll() {
        entries.removeAll(keepingCapacity: true)
    }
}

/// 中文段首缩进：两个全角空格（U+3000 宽恰为一个汉字，随字号自动缩放）。
let paragraphIndent = "\u{3000}\u{3000}"

/// 阅读器：滚动/翻页双模式、纸面主题、点击翻页开关、边缘滑动翻页、按段/页恢复进度。
///
/// 布局：正文占满阅读区（点击中部可收起/展开阅读控制），顶部为系统导航条
/// （纸面底色），底部安全区保留上一章/下一章/页码控制，避免正文被遮挡。
struct ReaderView: View {
    let novel: Novel
    let preloadedChapters: [ChapterMeta]
    let offlineOnly: Bool
    @State var chapterOrder: Int

    @Environment(AppState.self) private var appState
    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(OfflineReadingStore.self) private var offlineStore
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
    @State private var paragraphTextCache = ReaderParagraphTextCache()
    /// 翻页模式：分页结果、当前页、每页对应的整章字符区间、待恢复的进度百分比。
    @State private var pages: [NSAttributedString] = []
    @State private var pageRanges: [NSRange] = []
    @State private var currentPage = 0
    @State private var pendingRestorePercent: Double?
    @State private var interactionFeedback = 0
    @State private var fontRevision = 0
    @State private var chapterIsSaved = false
    /// 底部控制区的稳定高度；隐藏时仍保留这段安全区，避免正文上下跳动。
    private let readerChromeHeight: CGFloat = 78
    /// Scroll target before the chapter title. Paragraph IDs start at zero.
    private let readerTopScrollID = -1
    @State private var chapterThoughts: [Thought] = []
    @State private var thoughtsLoadTask: Task<Void, Never>?
    @State private var isLoadingThoughts = false
    @State private var thoughtsError: String?
    @State private var activeThoughtParagraph: Int?
    @State private var activeThoughtSelection = ""
    @State private var showThoughtPanel = false

    init(
        novel: Novel,
        chapterOrder: Int,
        preloadedChapters: [ChapterMeta] = [],
        offlineOnly: Bool = false
    ) {
        self.novel = novel
        self.preloadedChapters = preloadedChapters
        self.offlineOnly = offlineOnly
        _chapterOrder = State(initialValue: chapterOrder)
    }

    var totalOrderCount: Int {
        if offlineOnly {
            return max(chapterCount, chapterMetas.map(\.order).max() ?? 0)
        }
        return max(chapterCount, novel.chapterCount, chapterMetas.count)
    }

    /// 系统深色：跟随 @Environment 而非 UIScreen.main（多窗口/iPad 更准，且实时响应外观切换）。
    private var systemIsDark: Bool { systemScheme == .dark }
    private var paper: Color { settings.backgroundColor(systemDark: systemIsDark) }
    private var ink: Color { settings.textColor(systemDark: systemIsDark) }
    private var inkUIColor: UIColor { UIColor(ink) }
    private var scheme: ColorScheme? { settings.colorSchemeOverride(systemDark: systemIsDark) }
    private var readerTitleFont: Font { settings.titleFont(for: dynamicTypeSize) }
    private var readerBodyUIFont: UIFont { settings.bodyUIFont(for: dynamicTypeSize) }
    private var readerTitleUIFont: UIFont { settings.titleUIFont(for: dynamicTypeSize) }
    private var readerLineSpacing: CGFloat { settings.lineSpacing(for: dynamicTypeSize) }
    private var readerParagraphSpacing: CGFloat { settings.paragraphSpacing(for: dynamicTypeSize) }

    private var thoughtsByParagraph: [Int: [Thought]] {
        Dictionary(grouping: chapterThoughts) { $0.paragraphIndex }
    }

    private var currentDisplayName: String {
        guard let user = appState.user else { return "" }
        return user.displayName.isEmpty ? user.username : user.displayName
    }

    private var percentText: String {
        "已读 \(Int((progressPercent * 100).rounded()))%"
    }

    private var atChapterEnd: Bool {
        settings.pageMode == "page"
            && !pages.isEmpty
            && currentPage == pages.count - 1
            && hasNextChapter
    }

    private var hasPreviousChapter: Bool {
        offlineOnly
            ? chapterMetas.contains { $0.order == chapterOrder - 1 }
            : chapterOrder > 1
    }

    private var hasNextChapter: Bool {
        offlineOnly
            ? chapterMetas.contains { $0.order == chapterOrder + 1 }
            : chapterOrder < totalOrderCount
    }

    var body: some View {
        GeometryReader { geo in
            if settings.pageMode == "page" {
                pagedReader(geo: geo)
            } else {
                readerScroll(geo: geo)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if !showChrome {
                readerChromeRevealButton
                    .padding(.trailing, 16)
                    .padding(.bottom, 14)
            }
        }
        .background(paper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(chapter?.title ?? "阅读")
        // 阅读控制收起时同步隐藏顶部系统区域，把整屏留给正文。
        .toolbarBackground(paper, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
        .sheet(isPresented: $showThoughtPanel, onDismiss: {
            activeThoughtParagraph = nil
            activeThoughtSelection = ""
        }) {
            if let index = activeThoughtParagraph,
               paragraphs.indices.contains(index),
               let chapter {
                ThoughtPanelView(
                    chapterTitle: chapter.title,
                    paragraphExcerpt: paragraphExcerpt(for: paragraphs[index]),
                    selectedText: activeThoughtSelection,
                    thoughts: thoughtsByParagraph[index] ?? [],
                    currentUserID: appState.user?.id,
                    defaultDisplayName: currentDisplayName,
                    isLoading: isLoadingThoughts,
                    loadError: thoughtsError,
                    canCompose: !offlineOnly && appState.user != nil,
                    onRetry: { loadThoughts(for: chapter.id) },
                    onSubmit: { text, displayName in
                        try await submitThought(text: text, displayName: displayName)
                    },
                    onDelete: { id in
                        try await deleteThought(id: id)
                    }
                )
                .preferredColorScheme(scheme)
                .presentationBackground(paper)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            } else {
                Color.clear
            }
        }
        .preferredColorScheme(scheme)
        .task(id: chapterOrder) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .zhiZhouFontStoreDidChange)) { _ in
            fontRevision &+= 1
        }
        .onChange(of: chapterOrder) { _, _ in
            resetForNewChapter()
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
            thoughtsLoadTask?.cancel()
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
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
            }
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 300)
        } else if let chapter {
            let paragraphThoughts = thoughtsByParagraph
            let renderKey = paragraphRenderKey
            Color.clear
                .frame(height: 1)
                .id(readerTopScrollID)
            Text(chapter.title)
                .font(readerTitleFont)
                .multilineTextAlignment(.center)
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 14)
            ForEach(paragraphs.indices, id: \.self) { index in
                readerParagraph(
                    index: index,
                    text: paragraphs[index],
                    thoughts: paragraphThoughts[index] ?? [],
                    renderKey: renderKey
                )
                    .id(index)
            }
            if hasNextChapter {
                nextChapterButton
            }
        }
    }

    /// 段落级段评入口：正文保持干净，仅在已有段评时显示轻量标记；选中文字可直接引用。
    private func readerParagraph(
        index: Int,
        text: String,
        thoughts: [Thought],
        renderKey: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SelectableTextView(
                attributedText: paragraphAttributedText(
                    index: index,
                    text: text,
                    thoughts: thoughts,
                    renderKey: renderKey
                ),
                textColor: inkUIColor,
                menuTitle: thoughts.isEmpty ? "写段评" : "查看段评",
                isThoughtActionEnabled: !offlineOnly
            ) { selectedText, _ in
                openThoughtPanel(for: index, selectedText: selectedText)
            }
                .frame(maxWidth: .infinity, alignment: .leading)

            if !thoughts.isEmpty {
                HStack {
                    Spacer(minLength: 0)
                    Button {
                        openThoughtPanel(for: index)
                    } label: {
                        Label("\(thoughts.count) 条段评", systemImage: "text.bubble")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                            .padding(.horizontal, 9)
                            .frame(minHeight: 28)
                            .background(AppTheme.primaryLight, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(thoughts.count) 条段评")
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityHint("选中文字后从菜单进入段评")
    }

    private func paragraphAttributedText(
        index: Int,
        text: String,
        thoughts: [Thought],
        renderKey: String
    ) -> NSAttributedString {
        let thoughtsKey = thoughts.isEmpty
            ? ""
            : thoughts.map { "\($0.id):\($0.selectedText)" }.joined(separator: "|")
        return paragraphTextCache.value(
            for: index,
            text: text,
            thoughtsKey: thoughtsKey,
            renderKey: renderKey
        ) {
            let style = NSMutableParagraphStyle()
            style.lineSpacing = readerLineSpacing
            style.alignment = .natural
            let renderedText = NSMutableAttributedString(
                string: paragraphIndent + text,
                attributes: [
                    .font: readerBodyUIFont,
                    .foregroundColor: inkUIColor,
                    .paragraphStyle: style,
                ]
            )
            let indentLength = paragraphIndent.utf16.count
            for range in ReaderTextHighlight.ranges(
                in: text,
                matching: thoughts.map(\.selectedText)
            ) {
                renderedText.addAttributes(
                    thoughtHighlightAttributes,
                    range: NSRange(
                        location: indentLength + range.location,
                        length: range.length
                    )
                )
            }
            return renderedText
        }
    }

    private var paragraphRenderKey: String {
        [
            chapter?.id ?? "loading",
            String(settings.fontSizeIndex),
            "\(settings.lineHeight)",
            "\(readerLineSpacing)",
            "\(readerParagraphSpacing)",
            settings.useSerif ? "serif" : "system",
            String(describing: dynamicTypeSize),
            String(fontRevision),
            settings.themeName,
            systemIsDark ? "dark" : "light",
        ].joined(separator: ":")
    }

    private var thoughtHighlightAttributes: [NSAttributedString.Key: Any] {
        [
            .backgroundColor: UIColor(AppTheme.primary).withAlphaComponent(0.13),
            .underlineColor: UIColor(AppTheme.primary).withAlphaComponent(0.78),
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ]
    }

    /// 滚动区。独立成子表达式，避免 body 表达式过复杂导致 Release 下类型检查超时。
    /// 水平安全区在横屏（灵动岛/刘海）下左右不相等，若交给 ScrollView 自动处理，
    /// 正文左右留白会被压得一宽一窄。这里关掉自动水平安全区，
    /// 自己按“两侧取较大值”补一份对称留白，任何方向都左右等宽。
    private func readerScroll(geo: GeometryProxy) -> some View {
        let sideInset = max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing)
        let scrollIdentity = readerScrollIdentity
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: readerParagraphSpacing) {
                    readingContent
                }
                .padding(.horizontal, sideInset + 22)
                .padding(.top, 18)
                // 固定正文容器宽度，字号变化时只重新排版，不让 SwiftUI 重新猜测横向尺寸。
                .frame(width: min(geo.size.width, 720))
                .frame(maxWidth: .infinity)
                .scrollTargetLayout()
            }
            // A chapter change must create a fresh UIScrollView. Clearing the
            // binding alone leaves the old content offset attached to the reused
            // scroll container while the next chapter is loading.
            .id(scrollIdentity)
            .ignoresSafeArea(edges: .horizontal)
            // 控制区放进 ScrollView 的安全区，滚动到末尾时也不会压住正文。
            .safeAreaInset(edge: .bottom, spacing: 0) {
                readerChrome
            }
            .scrollPosition(id: $scrolledParagraph)
            .background(paper)
            .contentShape(Rectangle())
            .accessibilityHint("轻点中央显示阅读控制；使用顶部和底部按钮切换目录、设置和章节")
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
                guard contentSize.height > 0, let target = pendingScrollRestore else { return }
                restoreScrollTarget(target, using: proxy, identity: scrollIdentity)
            }
            .onChange(of: pendingScrollRestore) { _, target in
                guard let target else { return }
                restoreScrollTarget(target, using: proxy, identity: scrollIdentity)
            }
            // 按段落更新阅读进度，避免滚动过程中每个 offset 变化都让整个阅读器重算。
            .onChange(of: scrolledParagraph) { _, index in
                updatePercent(from: index)
            }
            // 拖动正文时自动收起浮层，轻点恢复。
            .onScrollPhaseChange { _, newPhase in
                if newPhase == .interacting { hideChrome() }
            }
        }
    }

    private var readerScrollIdentity: String {
        if let chapter {
            return "chapter:\(chapter.id)"
        }
        return "loading:\(chapterOrder)"
    }

    /// 翻页阅读区（TabView 负责左右滑动，点按左右区域可选）。水平安全区同样用两侧较大值做对称留白。
    private func pagedReader(geo: GeometryProxy) -> some View {
        let sideInset = max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing) + 22
        // 与滚动模式一致：内容总宽上限 720，再扣对称留白，宽屏下正文不无脑拉满。
        let contentWidth = max(40, min(geo.size.width, 720) - sideInset * 2)
        // 页面高度固定；底部安全区单独给阅读控制，不参与正文分页。
        let contentHeight = max(120, geo.size.height - 8 - readerChromeHeight)
        let pageSize = CGSize(width: contentWidth, height: contentHeight)
        let thoughtIDs = chapterThoughts.map(\.id).joined(separator: ",")
        let key = "\(chapter?.id ?? "-"):\(Int(contentWidth)):\(Int(contentHeight)):\(settings.fontSizeIndex):\(settings.lineHeight):\(readerParagraphSpacing):\(settings.useSerif):\(dynamicTypeSize):\(fontRevision):\(thoughtIDs)"

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
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
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
                            pageIndex: index,
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
        // 与滚动模式一致，控制区占据真实安全区而不是盖在页面上。
        .safeAreaInset(edge: .bottom, spacing: 0) {
            readerChrome
        }
    }

    /// 单页内容：按排版尺寸顶对齐展示；若个别页因测量误差超出一行，内部可纵向滚动兜底。
    private func pagedPage(
        _ text: NSAttributedString,
        pageIndex: Int,
        width: CGFloat,
        height: CGFloat,
        showsNextChapter: Bool
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SelectableTextView(
                    attributedText: text,
                    textColor: inkUIColor,
                    menuTitle: "段评",
                    isThoughtActionEnabled: !offlineOnly
                ) { selectedText, selectedRange in
                    guard pageRanges.indices.contains(pageIndex) else { return }
                    let location = pageRanges[pageIndex].location + selectedRange.location
                    guard let paragraphIndex = paragraphIndex(atCharacterLocation: location) else { return }
                    openThoughtPanel(for: paragraphIndex, selectedText: selectedText)
                }
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
        let startsAtRight = value.startLocation.x >= width - edgeWidth

        // 左缘保留给 NavigationStack 的系统返回手势；阅读器只响应右缘的下一章手势。
        guard startsAtRight,
              abs(horizontal) >= 72,
              abs(horizontal) >= abs(vertical) * 1.35
        else { return }

        if horizontal < 0 {
            go(to: chapterOrder + 1)
        }
    }

    private func goPage(_ page: Int) {
        guard !pages.isEmpty else { return }
        let target = max(0, min(page, pages.count - 1))
        guard target != currentPage else { return }
        currentPage = target
    }

    /// 底部阅读控制：上一章/页码/下一章。翻页到章末时变为居中的“下一章”按钮。
    private var readerChrome: some View {
        GlassEffectContainer(spacing: 12) {
            Group {
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
                            chromeSegmentButton(systemName: "chevron.left", label: "上一章", isEnabled: hasPreviousChapter) {
                                go(to: chapterOrder - 1)
                            }
                            readerStatusPill
                            chromeSegmentButton(systemName: "chevron.right", label: "下一章", isEnabled: hasNextChapter) {
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
        .frame(height: readerChromeHeight, alignment: .bottom)
        .background(paper)
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

    private var readerChromeRevealButton: some View {
        Button {
            toggleChrome()
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glass(AppTheme.glassClear))
        .foregroundStyle(ink.opacity(0.9))
        .accessibilityLabel("显示阅读控制")
        .accessibilityHint("显示目录、阅读设置和章节切换")
    }

    /// 顶部操作组：只保留图标与 44pt 点按区，不再叠加玻璃容器和按钮底板。
    private var readerToolbarGroup: some View {
        HStack(spacing: 10) {
            if !offlineOnly {
                Button {
                    openCurrentThoughtPanel()
                } label: {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 17, weight: .medium))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .disabled(currentReadingParagraphIndex == nil)
                .accessibilityLabel("当前段评")
            }

            Button {
                showTOC = true
                interactionFeedback += 1
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("目录")

            Button {
                showSettings = true
                interactionFeedback += 1
            } label: {
                Image(systemName: "textformat.size")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("阅读设置")
        }
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.92))
        .foregroundStyle(ink.opacity(0.82))
        .fixedSize()
        .opacity(showChrome ? 1 : 0)
        .allowsHitTesting(showChrome)
        .accessibilityHidden(!showChrome)
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
            bodyFont: readerBodyUIFont,
            titleFont: readerTitleUIFont,
            lineSpacing: readerLineSpacing,
            paragraphSpacing: readerParagraphSpacing,
            title: chapter.title,
            paragraphs: paragraphs,
            thoughtSelectionsByParagraph: thoughtsByParagraph.mapValues {
                $0.map(\.selectedText)
            },
            thoughtHighlightColor: UIColor(AppTheme.primary).withAlphaComponent(0.13),
            thoughtUnderlineColor: UIColor(AppTheme.primary).withAlphaComponent(0.78)
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
        pages = result.map(\.attributed)
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
        thoughtsLoadTask?.cancel()
        paragraphTextCache.removeAll()
        chapter = nil
        paragraphs = []
        paragraphCount = 0
        setProgress(0)
        scrolledParagraph = nil
        // Keep geometry callbacks from the old scroll container from writing
        // a new chapter's progress before its restore target is installed.
        suppressPercent = true
        errorMessage = nil
        pages = []
        pageRanges = []
        currentPage = 0
        pendingRestorePercent = nil
        pendingScrollRestore = nil
        chapterIsSaved = false
        chapterThoughts = []
        isLoadingThoughts = false
        thoughtsError = nil
        activeThoughtParagraph = nil
        activeThoughtSelection = ""
        showThoughtPanel = false
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
                    do {
                        let list: ChaptersResponse = try await APIClient.shared.get(
                            ContentPolicy.safePath("/api/chapters?novelId=\(novel.id)")
                        )
                        chapterMetas = list.chapters
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        let saved = offlineStore.chapters(for: novel.id)
                        guard !saved.isEmpty else {
                            guard chapterOrder == order else { return }
                            errorMessage = AppCopy.friendlyError(error)
                            return
                        }
                        chapterMetas = saved
                    }
                }
            }
            chapterCount = chapterMetas.count

            guard chapterOrder == order else { return } // 用户已切章，丢弃过期结果

            guard let meta = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                if offlineOnly {
                    errorMessage = "这一章尚未下载，请联网后在详情页下载。"
                    return
                }
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
        } catch is CancellationError {
            return
        } catch {
            // 仅当前章节仍为目标时显示错误，避免切章后旧错误串台
            guard chapterOrder == order else { return }
            AppObservability.shared.capture(error: error, context: "reader.chapter")
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadContent(id: String) async throws {
        let order = chapterOrder
        let r: ChapterResponse = try await APIClient.shared.get(
            ContentPolicy.safePath("/api/chapters/\(id)")
        )
        guard chapterOrder == order else { return }
        let content = r.chapter.content
        let parsedParagraphs = await Task.detached(priority: .utility) {
            guard !Task.isCancelled else { return [String]() }
            return Self.paragraphs(from: content)
        }.value
        guard chapterOrder == order, !Task.isCancelled else { return }
        paragraphTextCache.removeAll()
        suppressPercent = true
        scrolledParagraph = nil
        pendingScrollRestore = nil
        chapter = r.chapter
        errorMessage = nil
        paragraphs = parsedParagraphs
        paragraphCount = paragraphs.count
        AppObservability.shared.track(
            "reader_chapter_loaded",
            properties: [
                "mode": offlineOnly ? "offline" : "online",
                "readerMode": settings.pageMode,
            ]
        )
        loadThoughts(for: r.chapter.id)

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
            } catch is CancellationError {
                throw CancellationError()
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
        // contentSize 已准备好时由 geometry 回调定位；若进度响应更晚，
        // pendingScrollRestore 的 change 回调会走同一条显式 proxy 路径。
        pendingScrollRestore = target
        prefetchNextChapter()
        let isSaved = await APIClient.shared.hasCachedChapter(id: r.chapter.id)
        guard chapterOrder == order else { return }
        chapterIsSaved = isSaved
    }

    private func openThoughtPanel(for index: Int, selectedText: String = "") {
        guard !offlineOnly, paragraphs.indices.contains(index) else { return }
        activeThoughtParagraph = index
        activeThoughtSelection = String(
            selectedText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)
        )
        showThoughtPanel = true
        interactionFeedback &+= 1
    }

    private func openCurrentThoughtPanel() {
        guard let index = currentReadingParagraphIndex else { return }
        openThoughtPanel(for: index)
    }

    private var currentReadingParagraphIndex: Int? {
        guard !paragraphs.isEmpty else { return nil }
        if settings.pageMode == "page" {
            return paragraphIndex(forPage: currentPage)
        }
        if let scrolledParagraph, paragraphs.indices.contains(scrolledParagraph) {
            return scrolledParagraph
        }
        return paragraphs.indices.first
    }

    /// 翻页模式下，把当前页起始字符映射回正文段落，保证工具栏段评仍然有明确对象。
    private func paragraphIndex(forPage page: Int) -> Int? {
        guard pageRanges.indices.contains(page), !paragraphs.isEmpty else { return nil }
        return paragraphIndex(atCharacterLocation: pageRanges[page].location)
    }

    /// 字符位置使用 TextKit 的 UTF-16 坐标，与 NSRange 和分页结果保持一致。
    private func paragraphIndex(atCharacterLocation location: Int) -> Int? {
        guard !paragraphs.isEmpty else { return nil }
        let titleLength = (chapter?.title ?? "").utf16.count + 1
        var cursor = titleLength

        for (index, paragraph) in paragraphs.enumerated() {
            if index > 0 { cursor += 1 }
            let end = cursor + (paragraphIndent + paragraph).utf16.count
            if location < end { return index }
            cursor = end
        }
        return paragraphs.indices.last
    }

    private func loadThoughts(for chapterID: String) {
        thoughtsLoadTask?.cancel()
        chapterThoughts = []
        thoughtsError = nil

        guard !offlineOnly else {
            isLoadingThoughts = false
            return
        }

        isLoadingThoughts = true
        thoughtsLoadTask = Task { @MainActor in
            do {
                let response: PublicThoughtsResponse = try await ThoughtsAPI.list(
                    chapterID: chapterID
                )
                guard !Task.isCancelled, self.chapter?.id == chapterID else { return }
                self.chapterThoughts = response.thoughts.sorted {
                    if $0.paragraphIndex != $1.paragraphIndex {
                        return $0.paragraphIndex < $1.paragraphIndex
                    }
                    return $0.createdAt < $1.createdAt
                }
                self.thoughtsError = nil
            } catch is CancellationError {
                return
            } catch {
                guard self.chapter?.id == chapterID else { return }
                self.thoughtsError = AppCopy.friendlyError(error)
                AppObservability.shared.capture(error: error, context: "reader.thoughts")
            }

            guard self.chapter?.id == chapterID else { return }
            self.isLoadingThoughts = false
        }
    }

    private func submitThought(text: String, displayName: String) async throws {
        guard let currentChapter = chapter,
              let index = activeThoughtParagraph,
              paragraphs.indices.contains(index)
        else {
            throw APIError.invalidResponse
        }

        thoughtsLoadTask?.cancel()
        isLoadingThoughts = false

        let payload = ThoughtCreatePayload(
            novelId: currentChapter.novelId,
            chapterId: currentChapter.id,
            paragraphIndex: index,
            paragraphHash: Self.paragraphHash(paragraphs[index]),
            selectedText: String(activeThoughtSelection.prefix(200)),
            thoughtText: String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300)),
            displayName: String(displayName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20))
        )
        let thought = try await ThoughtsAPI.create(payload: payload)
        guard self.chapter?.id == currentChapter.id else { return }
        chapterThoughts.removeAll { $0.id == thought.id }
        chapterThoughts.append(thought)
        AppFeedback.success("段评已发布")
    }

    private func deleteThought(id: String) async throws {
        thoughtsLoadTask?.cancel()
        isLoadingThoughts = false
        try await ThoughtsAPI.remove(id: id)
        chapterThoughts.removeAll { $0.id == id }
        AppFeedback.success("段评已删除")
    }

    private func paragraphExcerpt(for text: String) -> String {
        let normalized = Self.normalizedParagraphText(text)
        guard !normalized.isEmpty else { return "这一段暂无文字" }
        return normalized.count > 120
            ? String(normalized.prefix(120)) + "…"
            : normalized
    }

    private func updatePercent(from index: Int?) {
        guard !suppressPercent, let index, paragraphCount > 1 else { return }
        let value = min(1, max(0, Double(index) / Double(paragraphCount - 1)))
        setProgress(value)
        debounceSaveProgress()
    }

    /// A late progress response can install the restore target after the
    /// scroll view has already reported its content size. Use the proxy as a
    /// second, deterministic restore path for that timing window.
    private func restoreScrollTarget(
        _ target: Int,
        using proxy: ScrollViewProxy,
        identity: String
    ) {
        Task { @MainActor in
            await Task.yield()
            guard readerScrollIdentity == identity, pendingScrollRestore == target else { return }
            let scrollID = target == 0 ? readerTopScrollID : target
            proxy.scrollTo(scrollID, anchor: .top)
            scrolledParagraph = scrollID
            pendingScrollRestore = nil
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
        if offlineOnly && !chapterMetas.contains(where: { $0.order == order }) { return }
        guard order != chapterOrder else { return }
        // 必须在修改 chapterOrder 前捕获旧章节进度，否则 resetForNewChapter
        // 会清空 chapter，旧章节就没有可保存的快照了。
        saveTask?.cancel()
        saveProgressNow()
        chapterOrder = order
    }

    /// 章节段落切分：静态纯函数，仅在加载时执行一次。
    nonisolated private static func paragraphs(from content: String) -> [String] {
        let byBlankLine = content
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if byBlankLine.count > 1 { return byBlankLine }
        return content
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    nonisolated private static func normalizedParagraphText(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// 与 Web 段评使用相同的 FNV-1a + base36 段落指纹，方便正文变更时定位段落。
    nonisolated private static func paragraphHash(_ text: String) -> String {
        var hash: UInt32 = 2_166_136_261
        for unit in normalizedParagraphText(text).utf16 {
            hash ^= UInt32(unit)
            hash = hash &* 16_777_619
        }
        return String(hash, radix: 36)
    }
}
