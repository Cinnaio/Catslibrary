import SwiftUI
import ZhiZhouCore

/// 阅读器目录与作品详情的原生目录搜索共用筛选和章节选择。
struct ChapterListView: View {
    let novel: Novel
    let currentOrder: Int?
    let initialChapters: [ChapterMeta]
    let offlineOnly: Bool
    let directorySort: Binding<Bool>?
    let onSelect: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(OfflineReadingStore.self) private var offlineStore
    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasScrolledToCurrent = false
    @State private var isShowingOffline = false
    @State private var search = ""
    @State private var searchPresented: Bool
    @State private var descending = false
    @State private var showJump = false
    @State private var jumpOrder = ""

    init(
        novel: Novel,
        currentOrder: Int?,
        initialChapters: [ChapterMeta] = [],
        offlineOnly: Bool = false,
        directorySort: Binding<Bool>? = nil,
        onSelect: @escaping (Int) -> Void
    ) {
        self.novel = novel
        self.currentOrder = currentOrder
        self.initialChapters = initialChapters
        self.offlineOnly = offlineOnly
        self.directorySort = directorySort
        self.onSelect = onSelect
        _searchPresented = State(initialValue: directorySort != nil)
    }

    private var availableChapters: [ChapterMeta] { directorySort == nil ? chapters : initialChapters }
    private var showsOfflineCatalog: Bool { directorySort == nil ? isShowingOffline : offlineOnly }
    private var sortOrder: Binding<Bool> { directorySort ?? $descending }
    private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var visibleChapters: [ChapterMeta] {
        let matches = query.isEmpty ? availableChapters : availableChapters.filter {
            $0.title.localizedStandardContains(query) || String($0.order) == query
        }
        return sortOrder.wrappedValue ? Array(matches.reversed()) : matches
    }

    private var jumpTarget: ChapterMeta? {
        guard let order = Int(jumpOrder) else { return nil }
        return availableChapters.first { $0.order == order }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && availableChapters.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, availableChapters.isEmpty {
                    ContentUnavailableView {
                        Label("目录加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                            .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
                    }
                } else if availableChapters.isEmpty {
                    ContentUnavailableView("暂无章节", systemImage: "list.bullet", description: Text("这本书尚未发布章节"))
                } else {
                    ScrollViewReader { proxy in
                        if directorySort == nil {
                            chapterList
                                .refreshable { await load(refresh: true) }
                                .onAppear { scrollToCurrent(proxy) }
                                .onChange(of: chapters) { _, _ in
                                    hasScrolledToCurrent = false
                                    scrollToCurrent(proxy)
                                }
                        } else {
                            chapterList
                        }
                    }
                }
            }
            .pageBackground(.browsing)
            .safeAreaInset(edge: .bottom) {
                if let errorMessage, !chapters.isEmpty, !isShowingOffline {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load(refresh: true) }
                    }
                    .padding()
                    .background(AppTheme.canvas)
                }
            }
            .navigationTitle(directorySort == nil ? "目录" : "章节目录")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: Binding(get: { search }, set: { value in
                withAnimation(reduceMotion ? nil : AppMotion.micro) { search = value }
            }), isPresented: $searchPresented, prompt: "搜索章名或章号")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle("倒序排列", isOn: sortOrder)
                        Button("跳转章节", systemImage: "number") {
                            jumpOrder = ""
                            showJump = true
                        }
                    } label: {
                        Label("目录选项", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .disabled(availableChapters.isEmpty)
                }
                if showsOfflineCatalog {
                    ToolbarItem(placement: .topBarLeading) {
                        Label("离线", systemImage: "wifi.slash")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(directorySort == nil ? "完成" : "关闭") { dismiss() }
                }
            }
            .task(id: ContentAccessStore.shared.mode) {
                if directorySort == nil { await load() }
            }
            .alert("跳转章节", isPresented: $showJump) {
                TextField("章号", text: $jumpOrder).keyboardType(.numberPad)
                Button("开始阅读") {
                    guard let chapter = jumpTarget else { return }
                    dismiss()
                    onSelect(chapter.order)
                }
                .disabled(jumpTarget == nil)
                Button("取消", role: .cancel) {}
            } message: {
                Text("输入目录中已有的章号，直接打开该章节。")
            }
        }
        .presentationBackground(AppTheme.canvas)
        .presentationDragIndicator(.visible)
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private var chapterList: some View {
        let matches = visibleChapters

        return List {
            if matches.isEmpty {
                ContentUnavailableView.search(text: query)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, chapter in
                        chapterButton(chapter)
                            .id(chapter.id)
                            .transition(reduceMotion ? .identity : .asymmetric(
                                insertion: .opacity.animation(AppMotion.micro.delay(Double(min(index, 12)) * 0.008)),
                                removal: .opacity
                            ))
                    }
                } header: {
                    if !query.isEmpty { Text("\(matches.count) 章匹配") }
                }
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.interactively)
    }

    private func chapterButton(_ chapter: ChapterMeta) -> some View {
        let isCurrent = chapter.order == currentOrder

        return Button {
            dismiss()
            onSelect(chapter.order)
        } label: {
            HStack(spacing: 12) {
                Text(chapter.order, format: .number.grouping(.never))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 28, alignment: .trailing)
                VStack(alignment: .leading, spacing: 3) {
                    Text(chapter.title)
                        .chapterTitleStyle()
                    if directorySort != nil {
                        Text("\(chapter.wordCount) 字")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if isCurrent {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: AppLayout.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isCurrent ? [.isSelected] : [])
    }

    private func load(refresh: Bool = false) async {
        guard !isLoading else { return }
        if offlineOnly {
            await offlineStore.refresh()
            chapters = offlineStore.chapters(for: novel.id)
            isShowingOffline = true
            errorMessage = nil
            return
        }
        if !refresh, chapters.isEmpty, !initialChapters.isEmpty {
            chapters = initialChapters
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let r: ChaptersResponse = try await APIClient.shared.getReader(
                "/api/chapters?novelId=\(novel.id)", refresh: refresh
            )
            chapters = r.chapters
            isShowingOffline = false
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            let saved = ContentAccessStore.shared.mode == "adult" || novel.isRestricted ? [] : offlineStore.chapters(for: novel.id)
            if !saved.isEmpty {
                chapters = saved
                isShowingOffline = true
                errorMessage = nil
            } else {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }

    private func scrollToCurrent(_ proxy: ScrollViewProxy) {
        guard !hasScrolledToCurrent, let currentOrder,
              let current = chapters.first(where: { $0.order == currentOrder }) else { return }
        hasScrolledToCurrent = true
        // 等一次 runloop，让 List 完成数据更新后的布局
        DispatchQueue.main.async {
            if reduceMotion {
                proxy.scrollTo(current.id, anchor: .center)
            } else {
                withAnimation(.easeOut(duration: 0.22)) {
                    proxy.scrollTo(current.id, anchor: .center)
                }
            }
        }
    }
}
