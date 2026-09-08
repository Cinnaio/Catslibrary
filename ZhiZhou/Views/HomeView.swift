import SwiftUI
import ZhiZhouCore

/// 发现页：以继续阅读为首要入口，紧凑宽度使用单列导航，宽屏保留书单与详情列。
struct HomeView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var novels: [Novel] = []
    @State private var categories: [String] = []
    @State private var selectedCategory: String?
    @State private var selectedNovel: Novel?
    @State private var selectedReaderLaunch: ReaderLaunch?
    @State private var navigationPath: [HomeRoute] = []
    @State private var search = ""
    @State private var page = 1
    @State private var totalPages = 1
    @State private var totalNovelCount = 0
    @State private var bookshelf: BookshelfResponse?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var loadMoreError: String?
    @State private var reloadTask: Task<Void, Never>?
    @State private var requests = ListRequestGuard<[String]>()
    @State private var interactionFeedback = 0

    private enum HomeRoute: Hashable {
        case novel(Novel)
        case reader(ReaderLaunch)
    }

    private var recentReading: RecentItem? {
        bookshelf?.recent.first
    }

    private var catalogQuery: [String] {
        [search.trimmingCharacters(in: .whitespacesAndNewlines), selectedCategory ?? ""]
    }

    var body: some View {
        if horizontalSizeClass != .regular {
            NavigationStack(path: $navigationPath) {
                homeList
                    .navigationDestination(for: HomeRoute.self) { route in
                        switch route {
                        case .novel(let novel):
                            NovelDetailView(novel: novel)
                        case .reader(let launch):
                            ReaderView(
                                novel: launch.novel,
                                chapterOrder: launch.chapterOrder,
                                preloadedChapters: launch.preloadedChapters
                            )
                        }
                    }
            }
        } else {
            NavigationSplitView {
                homeList
                    .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            } detail: {
                NavigationStack {
                    if let selectedReaderLaunch {
                        ReaderView(
                            novel: selectedReaderLaunch.novel,
                            chapterOrder: selectedReaderLaunch.chapterOrder,
                            preloadedChapters: selectedReaderLaunch.preloadedChapters
                        )
                    } else if let selectedNovel {
                        NovelDetailView(novel: selectedNovel)
                    } else {
                        ContentUnavailableView(
                            "选择一本书",
                            systemImage: "book.closed",
                            description: Text("从书单打开详情，或从继续阅读接着读")
                        )
                    }
                }
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var homeList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let recentReading {
                    sectionHeader("继续阅读")
                        .padding(.top, 16)
                        .padding(.bottom, 12)
                    continueReadingHero(recentReading)
                        .padding(.bottom, 28)
                } else if bookshelf != nil {
                    startExploringHint
                        .padding(.top, 16)
                        .padding(.bottom, 22)
                }

                sectionHeader(
                    "最近更新",
                    trailing: totalNovelCount > 0 ? "\(totalNovelCount) 本" : nil
                )
                .padding(.bottom, 12)

                catalogContent
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.always, axes: .vertical)
        // Liquid Glass TabBar floats over the scroll content on iOS 26;
        // reserve a small tail so the final row can rest clear of the bar.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear
                .frame(height: 24)
        }
        .pageBackground(.browsing)
        .navigationTitle("发现")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "搜索书名或作者")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                categoryMenu
            }
        }
        .refreshable {
            await reload()
            await loadReadingContext()
        }
        .task {
            await reload()
            await loadReadingContext()
        }
        .onChange(of: search) { _, _ in
            scheduleReload()
        }
        .onChange(of: selectedCategory) { _, _ in
            scheduleReload()
        }
        .onChange(of: navigationPath) { _, newPath in
            guard newPath.isEmpty else { return }
            Task { await loadReadingContext() }
        }
        .sensoryFeedback(.selection, trigger: interactionFeedback)
    }

    @ViewBuilder
    private var catalogContent: some View {
        if isLoading && novels.isEmpty {
            ProgressView("加载中…")
                .frame(maxWidth: .infinity, minHeight: 220)
        } else if let errorMessage, novels.isEmpty {
            ContentUnavailableView {
                Label("加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await reload() } }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
            }
            .frame(maxWidth: .infinity, minHeight: 220)
        } else if novels.isEmpty {
            emptyState
                .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await reload() }
                    }
                }
                ForEach(novels) { novel in
                    novelRow(novel)
                        .onAppear {
                            if novel.id == novels.last?.id { loadMoreIfNeeded() }
                        }
                    if novel.id != novels.last?.id {
                        Divider()
                            .padding(.leading, 76)
                    }
                }

                if isLoadingMore {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else if let loadMoreError {
                    Button(loadMoreError) { loadMoreIfNeeded() }
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AppTheme.danger)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
                }
            }
        }
    }

    /// 紧凑宽度直接持有导航目标；宽屏则更新分栏详情选择。
    @ViewBuilder
    private func novelRow(_ novel: Novel) -> some View {
        Button {
            selectedReaderLaunch = nil
            if horizontalSizeClass != .regular {
                navigationPath.append(.novel(novel))
            } else {
                selectedNovel = novel
            }
        } label: {
            NovelCardView(
                novel: novel,
                isSelected: horizontalSizeClass == .regular && selectedNovel?.id == novel.id
            )
        }
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
        .contentShape(Rectangle())
        .accessibilityIdentifier("catalog.\(novel.id)")
    }

    @ViewBuilder
    private var emptyState: some View {
        let trimmed = search.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            ContentUnavailableView.search(text: trimmed)
        } else if selectedCategory != nil {
            ContentUnavailableView(
                "没有作品",
                systemImage: "tray",
                description: Text("换个分类试试")
            )
        } else {
            ContentUnavailableView(
                "暂时没有作品",
                systemImage: "books.vertical"
            )
        }
    }

    private func sectionHeader(_ title: String, trailing: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Spacer(minLength: 12)
            if let trailing {
                Text(trailing)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private func continueReadingHero(_ item: RecentItem) -> some View {
        let progress = min(max(item.scrollPercent, 0), 1)
        return Button {
            openRecent(item)
        } label: {
            HStack(alignment: .top, spacing: 16) {
                NovelCoverView(
                    novel: item.asNovel,
                    size: CGSize(width: 88, height: 124)
                )
                .shadow(color: AppTheme.cardShadow, radius: 8, y: 4)

                VStack(alignment: .leading, spacing: 9) {
                    Text(item.novelTitle)
                        .font(serifFont(.title3, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .appTextLineLimit(2)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("第 \(item.chapterOrder) 章")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                        if let chapterTitle = continueReadingChapterTitle(item) {
                            Text(chapterTitle)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(AppTheme.textSecondary)
                                .appTextLineLimit(2)
                        }
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        progressLayout {
                            Text("本章进度")
                            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                            Text("已读 \(Int((progress * 100).rounded()))%")
                                .monospacedDigit()
                        }
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)

                        ProgressView(value: progress, total: 1)
                            .tint(AppTheme.primary)
                    }

                    Label("继续阅读", systemImage: "arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
        .accessibilityLabel("继续阅读《\(item.novelTitle)》")
        .accessibilityValue("第 \(item.chapterOrder) 章，本章已读 \(Int((progress * 100).rounded()))%")
        .accessibilityHint("打开并从上次位置继续")
    }

    private func continueReadingChapterTitle(_ item: RecentItem) -> String? {
        let title = item.chapterTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }

        let normalizedTitle = title.components(separatedBy: .whitespacesAndNewlines).joined()
        let normalizedOrder = "第\(item.chapterOrder)章"
        return normalizedTitle == normalizedOrder ? nil : title
    }

    private var progressLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout())
    }

    private var startExploringHint: some View {
        Label("从最近更新里挑一本开始阅读", systemImage: "sparkles")
            .font(.subheadline)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var categoryMenu: some View {
        Menu {
            Button {
                setCategory(nil)
            } label: {
                if selectedCategory == nil {
                    Label("全部", systemImage: "checkmark")
                } else {
                    Text("全部")
                }
            }

            if !categories.isEmpty {
                Divider()
                ForEach(categories, id: \.self) { category in
                    Button {
                        setCategory(category)
                    } label: {
                        if selectedCategory == category {
                            Label(category, systemImage: "checkmark")
                        } else {
                            Text(category)
                        }
                    }
                }
            }
        } label: {
            Image(systemName: selectedCategory == nil
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityLabel(selectedCategory.map { "筛选：\($0)" } ?? "筛选分类")
    }

    private func setCategory(_ category: String?) {
        guard selectedCategory != category else { return }
        selectedCategory = category
        interactionFeedback &+= 1
    }

    private func openRecent(_ item: RecentItem) {
        let launch = item.asLaunch
        selectedNovel = nil
        if horizontalSizeClass != .regular {
            navigationPath.append(.reader(launch))
        } else {
            selectedReaderLaunch = launch
        }
    }

    /// 搜索与分类共用同一条防抖加载通道，避免并发 reload 竞态。
    private func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await reload()
        }
    }

    func reload() async {
        loadMoreError = nil
        let ticket = requests.begin(catalogQuery)
        isLoading = true
        isLoadingMore = false
        await fetchPage(1, append: false, ticket: ticket)
    }

    private func loadReadingContext() async {
        guard APIClient.shared.isAuthenticated else { return }
        do {
            bookshelf = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/bookshelf"),
                auth: true
            )
        } catch {
            // 阅读入口不是发现页的阻塞条件，书架请求失败时继续展示目录。
        }
    }

    private func loadMoreIfNeeded() {
        guard !isLoading, !isLoadingMore, errorMessage == nil, page < totalPages,
              let ticket = requests.beginNext(catalogQuery) else { return }
        isLoadingMore = true
        let target = page + 1
        Task { await fetchPage(target, append: true, ticket: ticket) }
    }

    private func fetchPage(_ target: Int, append: Bool, ticket: ListRequestGuard<[String]>.Ticket) async {
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
                isLoadingMore = false
            }
        }
        do {
            var params: [String: String] = [
                "page": String(target),
                "limit": "20",
                "sort": "updated_at",
                "order": "desc",
                "contentMode": ContentPolicy.clientMode,
            ]
            let trimmed = ticket.query[0]
            if !trimmed.isEmpty { params["search"] = trimmed }
            if !ticket.query[1].isEmpty { params["category"] = ticket.query[1] }

            let r: NovelListResponse = try await APIClient.shared.get("/api/novels?" + Self.query(params))
            guard !Task.isCancelled, requests.accepts(ticket, query: catalogQuery) else { return }
            if append {
                let existing = Set(novels.map(\.id))
                novels += r.novels.filter { !existing.contains($0.id) }
            } else {
                novels = r.novels
                categories = r.availableCategories
                totalNovelCount = r.total
            }
            page = r.page
            totalPages = r.totalPages
            errorMessage = nil
            loadMoreError = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
            isLoadingMore = false
            await CoverPrefetcher.shared.prefetch(r.novels)
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: catalogQuery) else { return }
            AppObservability.shared.capture(error: error, context: append ? "home.load_more" : "home.load")
            let message = AppCopy.friendlyError(error)
            if append {
                loadMoreError = "加载失败，点按重试"
            } else {
                errorMessage = message
            }
        }
    }

    static func query(_ params: [String: String]) -> String {
        ReaderQuery.encode(params)
    }
}
