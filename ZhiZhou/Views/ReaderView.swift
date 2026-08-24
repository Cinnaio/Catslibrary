import SwiftUI
import UIKit

private final class ReaderPercentBox {
    var value: Double = 0
}

/// 中文段首缩进：两个全角空格（U+3000 宽恰为一个汉字，随字号自动缩放）。
private let paragraphIndent = "\u{3000}\u{3000}"

/// 阅读器：滚动阅读、夜间主题、点按隐铬、按段落恢复进度。
struct ReaderView: View {
    let novel: Novel
    let preloadedChapters: [ChapterMeta]
    @State var chapterOrder: Int

    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var systemScheme

    @State private var chapter: ChapterFull?
    @State private var chapterMetas: [ChapterMeta] = []
    @State private var chapterCount = 0
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showTOC = false
    @State private var showSettings = false
    @State private var showChrome = true
    @State private var scrolledParagraph: Int?
    @State private var paragraphCount = 0
    /// 章节正文一次性切分缓存，避免滚动时反复 split 整章字符串。
    @State private var paragraphs: [String] = []
    @State private var saveTask: Task<Void, Never>?
    @State private var percentBox = ReaderPercentBox()
    @State private var suppressPercent = false
    /// 保存失败的进度体：下次保存/回前台时重试，避免离线静默丢失。
    @State private var pendingProgressBody: Data?

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

    var body: some View {
        GeometryReader { geo in
            readerScroll(geo: geo)
        }
        .background(paper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(showChrome ? .visible : .hidden, for: .navigationBar)
        .toolbar(showChrome ? .visible : .hidden, for: .bottomBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { showTOC = true } label: {
                    Image(systemName: "list.bullet")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("目录")
                Button { showSettings = true } label: {
                    Image(systemName: "textformat.size")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("阅读设置")
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button { go(to: chapterOrder - 1) } label: {
                    Image(systemName: "chevron.left")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(chapterOrder <= 1)
                .accessibilityLabel("上一章")
                Spacer()
                Text("\(chapterOrder)/\(totalOrderCount)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(ink.opacity(0.7))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel("章节")
                    .accessibilityValue("第 \(chapterOrder) 章，共 \(totalOrderCount) 章")
                Spacer()
                Button { go(to: chapterOrder + 1) } label: {
                    Image(systemName: "chevron.right")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(chapterOrder >= totalOrderCount)
                .accessibilityLabel("下一章")
            }
        }
        .toolbarBackground(paper, for: .navigationBar)
        .toolbarBackground(paper, for: .bottomBar)
        .toolbar(.hidden, for: .tabBar)
        .sensoryFeedback(.selection, trigger: chapterOrder)
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
                .presentationDetents([.medium, .large])
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

    /// 阅读区内容：加载中 / 加载失败 / 章节正文（标题 + 带首行缩进的段落）。
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
                .foregroundStyle(ink)
                .padding(.bottom, 8)
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                Text(paragraphIndent + paragraph)
                    .font(settings.bodyFont)
                    .lineSpacing(settings.lineSpacing)
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(index)
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
            LazyVStack(alignment: .leading, spacing: settings.lineSpacing) {
                readingContent
            }
            .padding(.horizontal, sideInset + 22)
            .padding(.top, 18)
            .padding(.bottom, showChrome ? 80 : 28)
            .frame(maxWidth: min(geo.size.width, 720))
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .simultaneousGesture(TapGesture().onEnded { toggleChrome() })
            .scrollTargetLayout()
        }
        .ignoresSafeArea(.horizontal)
        .scrollPosition(id: $scrolledParagraph)
        .background(paper)
        .onChange(of: scrolledParagraph) { _, index in
            updatePercent(from: index)
        }
    }

    private func toggleChrome() {
        if reduceMotion {
            showChrome.toggle()
        } else {
            withAnimation(.easeOut(duration: 0.2)) { showChrome.toggle() }
        }
    }

    private func applyWakeLock() {
        UIApplication.shared.isIdleTimerDisabled = settings.wakeLockEnabled
    }

    /// 切章前清空旧正文，避免失败时静默显示上一章内容。
    private func resetForNewChapter() {
        chapter = nil
        paragraphs = []
        paragraphCount = 0
        percentBox.value = 0
        scrolledParagraph = nil
        suppressPercent = false
        errorMessage = nil
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
        percentBox.value = restore
        suppressPercent = true
        scrolledParagraph = nil
        // 让 LazyVStack 完成一次布局后再定位；Task.yield 而非固定休眠
        await Task.yield()
        scrolledParagraph = target
        await Task.yield()
        suppressPercent = false
    }

    private func updatePercent(from index: Int?) {
        guard !suppressPercent, let index, paragraphCount > 1 else { return }
        percentBox.value = min(1, max(0, Double(index) / Double(paragraphCount - 1)))
        debounceSaveProgress()
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
            pageMode: "scroll",
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
