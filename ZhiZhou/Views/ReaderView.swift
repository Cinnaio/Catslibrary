import SwiftUI
import UIKit

private final class ReaderPercentBox {
    var value: Double = 0
}

/// 阅读器：滚动阅读、夜间主题、点按隐铬、按段落恢复进度。
struct ReaderView: View {
    let novel: Novel
    let preloadedChapters: [ChapterMeta]
    @State var chapterOrder: Int

    @EnvironmentObject private var settings: ReaderSettingsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var appearance = SystemAppearance.shared

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
    @State private var saveTask: Task<Void, Never>?
    @State private var percentBox = ReaderPercentBox()
    @State private var suppressPercent = false

    init(novel: Novel, chapterOrder: Int, preloadedChapters: [ChapterMeta] = []) {
        self.novel = novel
        self.preloadedChapters = preloadedChapters
        _chapterOrder = State(initialValue: chapterOrder)
    }

    var totalOrderCount: Int {
        max(chapterCount, novel.chapterCount, chapterMetas.count)
    }

    private var systemIsDark: Bool { appearance.isDark }
    private var paper: Color { settings.backgroundColor(systemDark: systemIsDark) }
    private var ink: Color { settings.textColor(systemDark: systemIsDark) }
    private var scheme: ColorScheme { settings.colorSchemeOverride(systemDark: systemIsDark) }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: settings.lineSpacing) {
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
                        ForEach(Array(paragraphs(of: chapter).enumerated()), id: \.offset) { index, paragraph in
                            Text(paragraph)
                                .font(settings.bodyFont)
                                .lineSpacing(settings.lineSpacing)
                                .foregroundStyle(ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(index)
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, showChrome ? 80 : 28)
                .frame(maxWidth: min(geo.size.width, 720))
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .simultaneousGesture(TapGesture().onEnded { toggleChrome() })
                .scrollTargetLayout()
            }
            .scrollPosition(id: $scrolledParagraph)
            .background(paper)
            .onChange(of: scrolledParagraph) { _, index in
                updatePercent(from: index)
            }
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
            percentBox.value = 0
            scrolledParagraph = nil
            paragraphCount = 0
            Task { await load() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background || phase == .inactive {
                saveProgressNow()
            }
        }
        .onAppear { applyWakeLock() }
        .onChange(of: settings.wakeLockEnabled) { _, _ in applyWakeLock() }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            saveProgressNow()
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

    private func load() async {
        isLoading = true
        defer { isLoading = false }
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

            guard let meta = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                let list: ChaptersResponse = try await APIClient.shared.get(
                    "/api/chapters?novelId=\(novel.id)"
                )
                chapterMetas = list.chapters
                chapterCount = list.chapters.count
                guard let retry = chapterMetas.first(where: { $0.order == chapterOrder }) else {
                    errorMessage = "未找到第 \(chapterOrder) 章"
                    return
                }
                try await loadContent(id: retry.id)
                return
            }

            try await loadContent(id: meta.id)
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadContent(id: String) async throws {
        let r: ChapterResponse = try await APIClient.shared.get("/api/chapters/\(id)")
        chapter = r.chapter
        errorMessage = nil
        let paras = paragraphs(of: r.chapter)
        paragraphCount = paras.count

        var restore: Double = 0
        if APIClient.shared.isAuthenticated {
            let p: ProgressResponse = try await APIClient.shared.get(
                "/api/progress?novelId=\(novel.id)", auth: true
            )
            if let prog = p.progress, prog.chapterId == r.chapter.id, prog.scrollPercent > 0 {
                restore = prog.scrollPercent
            }
        }

        let last = max(paras.count - 1, 0)
        let target = last == 0 ? 0 : min(last, max(0, Int((restore * Double(last)).rounded(.down))))
        percentBox.value = restore
        suppressPercent = true
        try? await Task.sleep(nanoseconds: 80_000_000)
        scrolledParagraph = target
        try? await Task.sleep(nanoseconds: 120_000_000)
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
            try? await APIClient.shared.requestVoid("POST", "/api/progress", body: body, auth: true)
        }
    }

    private func progressBody() -> Data? {
        guard let chapter else { return nil }
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

    private func paragraphs(of chapter: ChapterFull) -> [String] {
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
