import SwiftUI
import UIKit

private final class ReaderPercentBox {
    var value: Double = 0
}

/// 中文段首缩进：两个全角空格（U+3000 宽恰为一个汉字，随字号自动缩放）。
let paragraphIndent = "\u{3000}\u{3000}"

/// 阅读器：滚动/翻页双模式、纸面主题、点按隐铬、按段/页恢复进度。
///
/// 布局：正文占满全屏（点击中部可收起/展开底部浮层），顶部为系统导航条
/// （纸面底色），底部浮层放进度条与上一章/下一章/页码。沉浸时不遮挡正文。
struct ReaderView: View {
    let novel: Novel
    let preloadedChapters: [ChapterMeta]
    @State var chapterOrder: Int

    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
    /// 保存失败的进度体：下次保存/回前台时重试，避免离线静默丢失。
    @State private var pendingProgressBody: Data?
    /// 翻页模式：分页结果、当前页、每页对应的整章字符区间、待恢复的进度百分比。
    @State private var pages: [AttributedString] = []
    @State private var pageRanges: [NSRange] = []
    @State private var currentPage = 0
    @State private var pendingRestorePercent: Double?
    @State private var interactionFeedback = 0

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
        .toolbarBackground(paper, for: .navigationBar)
        .toolbar(showChrome ? .visible : .hidden, for: .navigationBar)
        .toolbar(.hidden, for: .bottomBar)
        .toolbar(.hidden, for: .tabBar)
        .statusBarHidden(!showChrome)
        .persistentSystemOverlays(showChrome ? .automatic : .hidden)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                chromeCircle("list.bullet", label: "目录") { showTOC = true }
                chromeCircle("textformat.size", label: "阅读设置") { showSettings = true }
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
        .onChange(of: chapterOrder) { _, _ in
            resetForNewChapter()
            Task { await load() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background || phase == .inactive {
                saveProgressNow()
            } else if phase == .active {
                flushPendingProgress()
            }
        }
        .onAppear { applyWakeLock() }
        .onChange(of: settings.wakeLockEnabled) { _, _ in applyWakeLock() }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
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
                Text(paragraphAttributed(paragraph))
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(index)
            }
            if chapterOrder < totalOrderCount {
                nextChapterButton
            }
        }
    }

    /// 构造段落富文本：首行缩进 + 两端对齐 + 行距 + 轻微字距。
    private func paragraphAttributed(_ paragraph: String) -> AttributedString {
        let style = NSMutableParagraphStyle()
        style.alignment = .justified
        style.lineSpacing = settings.lineSpacing
        style.lineBreakMode = .byWordWrapping
        let attr = NSAttributedString(string: paragraphIndent + paragraph, attributes: [
            .font: settings.bodyUIFont,
            .paragraphStyle: style,
            .kern: NSNumber(value: 0.4),
        ])
        return AttributedString(attr)
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
            .padding(.bottom, showChrome ? 96 : 44)
            .frame(maxWidth: min(geo.size.width, 720))
            .frame(maxWidth: .infinity)
            .scrollTargetLayout()
        }
        .ignoresSafeArea(edges: .horizontal)
        .scrollPosition(id: $scrolledParagraph)
        .background(paper)
        .contentShape(Rectangle())
        // 点按热区覆盖整个 ScrollView，包括短章节下面的空白区域。
        .simultaneousGesture(
            SpatialTapGesture().onEnded { value in
                handleScrollTap(x: value.location.x, width: geo.size.width)
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

    /// 翻页阅读区（左右滑动 / 点按左右翻页）。水平安全区同样用两侧较大值做对称留白。
    private func pagedReader(geo: GeometryProxy) -> some View {
        let sideInset = max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing) + 22
        // 与滚动模式一致：内容总宽上限 720，再扣对称留白，宽屏下正文不无脑拉满。
        let contentWidth = max(40, min(geo.size.width, 720) - sideInset * 2)
        // 浮层可见时预留其高度，沉浸时正文可以用满屏高。
        let contentHeight = max(120, geo.size.height - 8 - (showChrome ? 78 : 20))
        let pageSize = CGSize(width: contentWidth, height: contentHeight)
        let key = "\(chapter?.id ?? "-"):\(Int(contentWidth)):\(Int(contentHeight)):\(settings.fontSizeIndex):\(settings.lineHeight):\(settings.paragraphSpacing):\(settings.useSerif)"

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
                        pagedPage(pages[index], width: contentWidth, height: contentHeight)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        handlePageTap(x: value.location.x, width: geo.size.width)
                    }
                )
            }
        }
        .task(id: key) { rebuildPages(size: pageSize) }
        .onChange(of: currentPage) { _, page in
            updatePageProgress(page)
        }
    }

    /// 单页内容：按排版尺寸顶对齐展示；若个别页因测量误差超出一行，内部可纵向滚动兜底。
    private func pagedPage(_ text: AttributedString, width: CGFloat, height: CGFloat) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(text)
                    .foregroundStyle(ink)
                    .frame(width: width, alignment: .topLeading)
                if atChapterEnd {
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
        let edge = width * 0.26
        if x < edge {
            go(to: chapterOrder - 1)
        } else if x > width - edge {
            go(to: chapterOrder + 1)
        } else {
            toggleChrome()
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
        VStack(spacing: 0) {
            ReaderProgressBar(fraction: progressPercent, tint: AppTheme.primary, track: ink.opacity(0.15))
            HStack(spacing: 12) {
                if atChapterEnd {
                    Button {
                        go(to: chapterOrder + 1)
                    } label: {
                        Label("下一章", systemImage: "arrow.forward")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 22)
                            .frame(minHeight: 40)
                    }
                    .foregroundStyle(AppTheme.primary)
                    .background(AppTheme.primary.opacity(0.14), in: Capsule())
                    .overlay(Capsule().strokeBorder(AppTheme.primary.opacity(0.35), lineWidth: 1))
                    .buttonStyle(ScaleButtonStyle())
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("下一章")
                } else {
                    chromePill(systemName: "chevron.left", label: "上一章", isEnabled: chapterOrder > 1) {
                        go(to: chapterOrder - 1)
                    }
                    Spacer(minLength: 8)
                    VStack(spacing: 2) {
                        Text("第 \(chapterOrder)/\(totalOrderCount) 章")
                            .font(.footnote.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(ink.opacity(0.92))
                        Text(percentText)
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(ink.opacity(0.55))
                    }
                    Spacer(minLength: 8)
                    chromePill(systemName: "chevron.right", label: "下一章", isEnabled: chapterOrder < totalOrderCount) {
                        go(to: chapterOrder + 1)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background(
                LinearGradient(
                    colors: [paper.opacity(0), paper.opacity(0.96)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .padding(.bottom, 4)
        .opacity(showChrome ? 1 : 0)
        .allowsHitTesting(showChrome)
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
        .background(AppTheme.primary.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(AppTheme.primary.opacity(0.3), lineWidth: 1))
        .buttonStyle(ScaleButtonStyle())
        .accessibilityLabel("下一章")
    }

    /// 顶部导航条圆钮（目录 / 设置）：轻量系统填充，避免阅读页出现厚重卡片感。
    private func chromeCircle(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .background(Color(.secondarySystemFill), in: Circle())
                .overlay(Circle().strokeBorder(ink.opacity(0.14), lineWidth: 1))
        }
        .foregroundStyle(ink)
        .buttonStyle(ScaleButtonStyle())
        .accessibilityLabel(label)
    }

    /// 底部浮层胶囊钮（上一章 / 下一章）：与顶部按钮保持同一套轻量表面。
    private func chromePill(systemName: String, label: String, isEnabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 46, height: 36)
        }
        .foregroundStyle(ink.opacity(isEnabled ? 0.95 : 0.28))
        .background(Color(.secondarySystemFill), in: Capsule())
        .overlay(Capsule().strokeBorder(ink.opacity(isEnabled ? 0.16 : 0.08), lineWidth: 1))
        .disabled(!isEnabled)
        .buttonStyle(ScaleButtonStyle())
        .accessibilityLabel(label)
    }

    /// 重新排版：按当前字号/行距/视口把章节切成多页，并尽量保持阅读位置不漂移。
    /// 若此前已有分页（用户改了字号/行距），则按“上一页起始字符”在新分页里重新定位，
    /// 而不是按百分比——百分比在文本重排后无法对齐同一段落，会产生正文偏移。
    private func rebuildPages(size: CGSize) {
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
        let attr = ChapterPaginator.attributedString(for: spec)
        let result = ChapterPaginator.pages(of: attr, pageSize: size)
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

    private func applyWakeLock() {
        UIApplication.shared.isIdleTimerDisabled = settings.wakeLockEnabled
    }

    /// 切章前清空旧正文，避免失败时静默显示上一章内容。
    private func resetForNewChapter() {
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
                        "/api/chapters?novelId=\(novel.id)"
                    )
                    chapterMetas = list.chapters
                }
            }
            chapterCount = chapterMetas.count

            guard chapterOrder == order else { return } // 用户已切章，丢弃过期结果

            guard let meta = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                let list: ChaptersResponse = try await APIClient.shared.get(
                    "/api/chapters?novelId=\(novel.id)"
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
        let r: ChapterResponse = try await APIClient.shared.get("/api/chapters/\(id)")
        guard chapterOrder == order else { return }
        chapter = r.chapter
        errorMessage = nil
        paragraphs = Self.paragraphs(of: r.chapter)
        paragraphCount = paragraphs.count

        var restore: Double = 0
        if APIClient.shared.isAuthenticated {
            let p: ProgressResponse = try await APIClient.shared.get(
                "/api/progress?novelId=\(novel.id)", auth: true
            )
            guard chapterOrder == order else { return }
            if let prog = p.progress, prog.chapterId == r.chapter.id, prog.scrollPercent > 0 {
                restore = prog.scrollPercent
            }
        }

        let last = max(paragraphs.count - 1, 0)
        let target = last == 0 ? 0 : min(last, max(0, Int((restore * Double(last)).rounded(.down))))
        setProgress(restore)
        pendingRestorePercent = restore > 0 ? restore : nil
        suppressPercent = true
        scrolledParagraph = nil
        // 等 ScrollView 报告真实 contentSize 后再定位，避免仅靠 Task.yield 猜测 layout 时序。
        pendingScrollRestore = target
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
        Task {
            do {
                try await APIClient.shared.requestVoid("POST", "/api/progress", body: body, auth: true)
                pendingProgressBody = nil
            } catch {
                // 离线/失败时保留待传体，回前台或下次保存时重试
                pendingProgressBody = body
            }
        }
    }

    private func flushPendingProgress() {
        guard let pending = pendingProgressBody else { return }
        pendingProgressBody = nil
        Task {
            do {
                try await APIClient.shared.requestVoid("POST", "/api/progress", body: pending, auth: true)
            } catch {
                pendingProgressBody = pending
            }
        }
    }

    /// 进度体与当前展示章节强一致：切章失败/错位时不写脏数据。
    private func progressBody() -> Data? {
        guard let chapter, chapter.order == chapterOrder else { return nil }
        let body = SaveProgressBody(
            novelId: novel.id,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            chapterOrder: chapter.order,
            scrollPercent: percentBox.value,
            pageMode: settings.pageMode,
            clientUpdatedAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        return try? APIClient.shared.jsonBody(body)
    }

    private func go(to order: Int) {
        guard order >= 1, order <= totalOrderCount else { return }
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
                    .frame(height: 3)
                Capsule()
                    .fill(tint)
                    .frame(width: max(6, geo.size.width * min(1, max(0, fraction))), height: 3)
            }
        }
        .frame(height: 4)
        .padding(.horizontal, 18)
        .accessibilityHidden(true)
    }
}
