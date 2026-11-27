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

    private let onClose: (() -> Void)?
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
        onClose: (() -> Void)? = nil,
        onSelect: @escaping (Int) -> Void
    ) {
        self.novel = novel
        self.currentOrder = currentOrder
        self.initialChapters = initialChapters
        self.offlineOnly = offlineOnly
        self.directorySort = directorySort
        self.onClose = onClose
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

    private var currentChapter: ChapterMeta? {
        availableChapters.first { $0.order == currentOrder }
    }

    private func closePanel() {
        if let onClose { onClose() }
        else { dismiss() }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && availableChapters.isEmpty {
                    AppLoadingState("正在读取目录…")
                        .frame(maxHeight: .infinity)
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
                        Group {
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
                        .toolbar {
                            if currentChapter != nil {
                                ToolbarItem(placement: .topBarLeading) {
                                    Button {
                                        search = ""
                                        searchPresented = false
                                        hasScrolledToCurrent = false
                                        scrollToCurrent(proxy)
                                    } label: {
                                        Label("定位当前章", systemImage: "bookmark")
                                    }
                                    .labelStyle(.iconOnly)
                                    .accessibilityIdentifier("reader.contents.current")
                                }
                            }
                        }
                    }
                }
            }
            .background(ReadingSpace.profilePaper)
            .safeAreaInset(edge: .bottom) {
                if let errorMessage, !chapters.isEmpty, !isShowingOffline {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load(refresh: true) }
                    }
                    .padding()
                    .background(ReadingSpace.profilePaper)
                }
            }
            .readingSpaceNavigation()
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button(directorySort == nil ? "完成" : "关闭") { closePanel() }
                }
            }
            .task(id: ContentAccessStore.shared.mode) {
                if directorySort == nil { await load() }
            }
            .alert("跳转章节", isPresented: $showJump) {
                TextField("章号", text: $jumpOrder).keyboardType(.numberPad)
                Button("开始阅读") {
                    guard let chapter = jumpTarget else { return }
                    closePanel()
                    onSelect(chapter.order)
                }
                .disabled(jumpTarget == nil)
                Button("取消", role: .cancel) {}
            } message: {
                Text("输入目录中已有的章号，直接打开该章节。")
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDragIndicator(.visible)
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private var chapterList: some View {
        let matches = visibleChapters

        return List {
            VStack(alignment: .leading, spacing: 8) {
                Text(novel.title)
                    .font(serifFont(.title2, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(query.isEmpty ? "共 \(availableChapters.count) 章" : "\(matches.count) 章匹配")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                if showsOfflineCatalog {
                    Label("离线目录", systemImage: "wifi.slash")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .padding(.vertical, 12)
            .listRowInsets(EdgeInsets(top: 12, leading: 22, bottom: 12, trailing: 22))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            if isLoading {
                AppLoadingState("正在更新目录…", placement: .inline)
                    .listRowInsets(EdgeInsets(top: 12, leading: 22, bottom: 12, trailing: 22))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if matches.isEmpty {
                ContentUnavailableView.search(text: query)
                    .listRowInsets(EdgeInsets(top: 12, leading: 22, bottom: 12, trailing: 22))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(Array(matches.enumerated()), id: \.element.id) { index, chapter in
                    chapterButton(chapter)
                        .id(chapter.id)
                        .readingSpaceEntrance(index)
                        .listRowInsets(EdgeInsets(top: 12, leading: 22, bottom: 12, trailing: 22))
                        .listRowSeparatorTint(ReadingSpace.profileLine)
                        .listRowBackground(chapter.order == currentOrder ? ReadingSpace.profileFill : .clear)
                }
                .id([query, String(sortOrder.wrappedValue)])
            }
        }
        .modifier(ReadingSpaceRoomListStyle())
        .scrollDismissesKeyboard(.interactively)
    }

    private func chapterButton(_ chapter: ChapterMeta) -> some View {
        let isCurrent = chapter.order == currentOrder

        return Button {
            closePanel()
            onSelect(chapter.order)
        } label: {
            HStack(spacing: 14) {
                Text(chapter.order, format: .number.grouping(.never))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .frame(minWidth: 28, alignment: .trailing)
                VStack(alignment: .leading, spacing: 6) {
                    Text(chapter.title)
                        .font(serifFont(.body, .medium))
                        .foregroundStyle(isCurrent ? AppTheme.primaryDeep : ReadingSpace.ink)
                        .appTextLineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    AppAdaptiveRow(spacing: 8) {
                        Text("\(chapter.wordCount) 字")
                        if isCurrent {
                            Text(directorySort == nil ? "正在阅读" : "上次读到")
                                .foregroundStyle(AppTheme.primaryDeep)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
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
