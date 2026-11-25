import SwiftUI
import ZhiZhouCore

/// 发现页以封面浏览和分类检索组织书库，宽屏保留书单与详情分栏。
struct HomeView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var novels: [Novel] = []
    @State private var categories: [String] = []
    @State private var selectedCategory: String?
    @State private var selectedStatus = ""
    @State private var selectedSort = "updated_at"
    @State private var selectedNovel: Novel?
    @State private var selectedReaderLaunch: ReaderLaunch?
    @State private var navigationPath: [HomeRoute] = []
    @State private var search = ""
    @State private var isSearchPresented = false
    @FocusState private var searchFocused: Bool
    @State private var searchScope: SearchScope = .catalog
    @State private var searchSources: [SourceSearchOptions.Source] = []
    @State private var sourceSearchSubmission: UUID?
    @State private var sourceSearchBook: SourceSearchBookPresentation?
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
    @State private var displayedQuery: [String]?
    @State private var interactionFeedback = 0
    @State private var rankingPreview: SourceRankingResponse?
    @State private var rankingPreviewRevision: UUID?
    @State private var rankingPreviewRequest: UUID?
    @State private var rankingsPresentation: SourceRankingsPresentation?
    @Namespace private var categoryNamespace

    private enum HomeRoute: Hashable {
        case novel(Novel)
        case reader(ReaderLaunch)
    }

    private enum SearchScope: Hashable { case catalog, sources }

    private var searchTerm: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var showsSearchScopes: Bool { !searchSources.isEmpty && (isSearchPresented || !searchTerm.isEmpty) }
    private var isSearchingSources: Bool { showsSearchScopes && searchScope == .sources }

    private var recentReading: RecentItem? {
        bookshelf?.recent.first { ContentAccessStore.shared.mode == "adult" || !$0.asNovel.isRestricted }
    }

    private var catalogQuery: [String] {
        [searchTerm, selectedCategory ?? "", selectedStatus, selectedSort]
    }

    private var usesCoverGrid: Bool {
        horizontalSizeClass != .regular && dynamicTypeSize < .xxxLarge
    }

    private var isFilteringCatalog: Bool {
        !catalogQuery[0].isEmpty || selectedCategory != nil || !selectedStatus.isEmpty
    }

    private var visibleNovels: [Novel] {
        novels.filter { ContentAccessStore.shared.mode == "adult" || !$0.isRestricted }
    }

    private var catalogTitle: String {
        if !catalogQuery[0].isEmpty { return "搜索结果" }
        switch selectedSort {
        case "title": return "按书名浏览"
        case "chapter_count": return "章节最多"
        default: return "最近更新"
        }
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
            // 标签栏属于发现页根层；进入详情或阅读器后让内容获得完整高度。
            .toolbar(navigationPath.isEmpty ? .visible : .hidden, for: .tabBar)
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
                        .id("reader:\(selectedReaderLaunch.novel.id):\(selectedReaderLaunch.chapterOrder)")
                    } else if let selectedNovel {
                        NovelDetailView(novel: selectedNovel)
                            .id(selectedNovel.id)
                    } else {
                        ContentUnavailableView(
                            "选择一本书",
                            systemImage: "book.closed",
                            description: Text("从书单打开详情，或从继续阅读接着读")
                        )
                    }
                }
                .id(splitDestinationID)
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var splitDestinationID: String {
        if let launch = selectedReaderLaunch {
            return "reader:\(launch.novel.id):\(launch.chapterOrder)"
        }
        return "detail:\(selectedNovel?.id ?? "none")"
    }

    private var homeList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if horizontalSizeClass != .regular {
                    Text("发现")
                        .font(serifFont(.largeTitle, .medium))
                        .foregroundStyle(ReadingSpace.ink)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.bottom, 20)
                }
                if showsSearchScopes {
                    Picker("搜索范围", selection: $searchScope) {
                        Text("书库").tag(SearchScope.catalog)
                        Text("书源").tag(SearchScope.sources)
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 18)
                }

                if isSearchingSources {
                    SourceSearchResults(sources: searchSources, query: searchTerm, submission: sourceSearchSubmission, onSubmit: {
                        searchFocused = false
                    }) { entry in
                        sourceSearchBook = SourceSearchBookPresentation(entry: entry, revision: ContentAccessStore.shared.revision)
                    }
                } else {
                    catalogSections
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.always, axes: .vertical)
        // Liquid Glass TabBar floats over the scroll content on iOS 26;
        // reserve a small tail so the final row can rest clear of the bar.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear
                .frame(height: 24)
        }
        .background(ReadingSpace.profilePaper)
        .navigationTitle(horizontalSizeClass == .regular ? "发现" : "")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, isPresented: $isSearchPresented, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "搜索书名或作者")
        .searchFocused($searchFocused)
        .onSubmit(of: .search) {
            if isSearchingSources { sourceSearchSubmission = UUID() }
        }
        .toolbar {
            if !isSearchingSources {
                ToolbarItem(placement: .navigationBarTrailing) {
                    categoryMenu
                }
            }
        }
        .refreshable {
            if isSearchingSources {
                sourceSearchSubmission = UUID()
            } else {
                async let rankings: Void = loadRankingPreview()
                async let sources: Void = loadSearchSources()
                await reload()
                await loadReadingContext()
                await rankings
                await sources
            }
        }
        .task { await loadSearchSources() }
        .task(id: ContentAccessStore.shared.revision) { await loadRankingPreview() }
        .onChange(of: ContentAccessStore.shared.revision) { _, _ in
            rankingsPresentation = nil
            sourceSearchBook = nil
        }
        .sheet(item: $sourceSearchBook) { presentation in
            if presentation.revision == ContentAccessStore.shared.revision {
                NavigationStack {
                    SourceRankingDetail(entry: presentation.entry) {
                        sourceSearchBook = nil
                        sourceSearchSubmission = UUID()
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("关闭") { sourceSearchBook = nil }
                        }
                    }
                }
            }
        }
        .sheet(item: $rankingsPresentation, onDismiss: {
            Task { await loadRankingPreview() }
        }) { presentation in
            if presentation.revision == ContentAccessStore.shared.revision {
                SourceRankingsView(presentation: presentation) { preview in
                    guard presentation.revision == ContentAccessStore.shared.revision else { return }
                    rankingPreviewRequest = nil
                    rankingPreview = preview
                    rankingPreviewRevision = presentation.revision
                }
            }
        }
        .task(id: ContentAccessStore.shared.mode) {
            if ContentAccessStore.shared.mode == "safe" {
                novels.removeAll { $0.isRestricted }
                bookshelf = nil
            }
            async let readingContext: Void = loadReadingContext()
            await reload()
            await readingContext
        }
        .onChange(of: searchTerm) { _, _ in
            if !isSearchingSources { scheduleReload() }
        }
        .onChange(of: isSearchingSources) { _, searchesSources in
            if searchesSources { reloadTask?.cancel() }
            else if catalogQuery != displayedQuery { scheduleReload() }
        }
        .onChange(of: isSearchPresented) { _, isPresented in
            if !isPresented && searchTerm.isEmpty { searchScope = .catalog }
        }
        .onChange(of: selectedCategory) { _, _ in
            scheduleReload()
        }
        .onChange(of: selectedStatus) { _, _ in scheduleReload() }
        .onChange(of: selectedSort) { _, _ in scheduleReload() }
        .onChange(of: navigationPath) { _, newPath in
            guard newPath.isEmpty else { return }
            Task { await loadReadingContext() }
        }
        .sensoryFeedback(.selection, trigger: interactionFeedback)
    }

    @ViewBuilder
    private var catalogSections: some View {
        if !isFilteringCatalog, let recentReading {
            continueReadingHero(recentReading)
                .padding(.bottom, 24)
                .transition(readingContextTransition)
        }

        if !isFilteringCatalog,
           rankingPreviewRevision == ContentAccessStore.shared.revision,
           let rankingPreview, let rankingID = rankingPreview.selectedId {
            SourceRankingPreview(response: rankingPreview) { entry in
                rankingsPresentation = SourceRankingsPresentation(rankingID: rankingID, entry: entry,
                    revision: ContentAccessStore.shared.revision)
            }
            .padding(.bottom, 24)
        }

        if !categories.isEmpty {
            categoryChipsBar
                .padding(.bottom, 18)
        }

        sectionHeader(catalogTitle, trailing: displayedQuery == catalogQuery ? "\(totalNovelCount) 本" : nil)
            .padding(.bottom, 16)

        catalogContent
    }

    private var readingContextTransition: AnyTransition {
        if reduceMotion {
            return .opacity.animation(.easeOut(duration: 0.16))
        }
        return .offset(y: 8).combined(with: .opacity)
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
                if isLoading && (displayedQuery != catalogQuery || errorMessage != nil) {
                    ProgressView(errorMessage == nil ? "正在载入结果…" : "正在重试…")
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 16)
                }
                Group {
                    if usesCoverGrid {
                        LazyVGrid(columns: [
                            GridItem(.flexible(minimum: 0), spacing: 20, alignment: .top),
                            GridItem(.flexible(minimum: 0), alignment: .top)
                        ], spacing: 26) {
                            catalogItems
                        }
                    } else {
                        LazyVStack(spacing: 0) {
                            catalogItems
                        }
                    }
                }
                .id(displayedQuery)
                .opacity(displayedQuery != catalogQuery ? 0.45 : 1)
                .disabled(isLoading || displayedQuery != catalogQuery)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: displayedQuery != catalogQuery)

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

    private var catalogItems: some View {
        ForEach(Array(visibleNovels.enumerated()), id: \.element.id) { index, novel in
            novelRow(novel)
                .readingSpaceEntrance(index)
                .onAppear {
                    if novel.id == visibleNovels.last?.id { loadMoreIfNeeded() }
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
                isSelected: horizontalSizeClass == .regular && selectedNovel?.id == novel.id,
                isCoverLayout: usesCoverGrid
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
        } else if selectedCategory != nil || !selectedStatus.isEmpty {
            ContentUnavailableView(
                "没有匹配的作品",
                systemImage: "tray",
                description: Text("换个分类或状态试试")
            )
        } else {
            ContentUnavailableView(
                "暂时没有作品",
                systemImage: "books.vertical"
            )
        }
    }

    private func sectionHeader(_ title: String, trailing: String? = nil) -> some View {
        AppAdaptiveRow(spacing: 8) {
            Text(title)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let trailing {
                Text(trailing)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
        }
    }

    private func continueReadingHero(_ item: RecentItem) -> some View {
        let progress = item.scrollPercent.isFinite ? min(max(item.scrollPercent, 0), 1) : 0
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
        return Button {
            openRecent(item)
        } label: {
            layout {
                NovelCoverView(
                    novel: item.asNovel,
                    size: CGSize(width: 72, height: 104)
                )
                .shadow(color: AppTheme.cardShadow, radius: 8, y: 4)

                VStack(alignment: .leading, spacing: 7) {
                    Text("继续阅读")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.summarySecondary)
                    Text(item.novelTitle)
                        .font(serifFont(.headline, .medium))
                        .foregroundStyle(ReadingSpace.onSummary)
                        .appTextLineLimit(2)

                    if let chapterTitle = continueReadingChapterTitle(item) {
                        Text(chapterTitle)
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.summarySecondary)
                            .appTextLineLimit(1)
                    }

                    ProgressView(value: progress, total: 1)
                        .tint(ReadingSpace.profileToday)
                        .accessibilityHidden(true)

                    Text("第 \(item.chapterOrder) 章 · 本章已读 \(Int((progress * 100).rounded()))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(ReadingSpace.summarySecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
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

    private var categoryChipsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                categoryChip(title: "全部", category: nil)
                ForEach(categories, id: \.self) { cat in
                    categoryChip(title: cat, category: cat)
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 4)
        }
        .padding(.horizontal, -22)
    }

    private func categoryChip(title: String, category: String?) -> some View {
        let isSelected = (selectedCategory == category)
        return Button {
            withAnimation(reduceMotion ? nil : AppMotion.structural) {
                setCategory(category)
            }
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            Text(title)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? ReadingSpace.ink : ReadingSpace.profileMuted)
                .padding(.horizontal, 14)
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .background {
                    if isSelected {
                        Capsule()
                            .fill(ReadingSpace.profileFill)
                            .matchedGeometryEffect(id: "activeCategoryPill", in: categoryNamespace)
                    } else {
                        Capsule()
                            .fill(Color.clear)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var categoryMenu: some View {
        Menu {
            Picker("状态", selection: $selectedStatus) {
                Text("全部状态").tag("")
                Text("连载中").tag("ongoing")
                Text("已完结").tag("completed")
            }
            Picker("排序", selection: $selectedSort) {
                Text("最近更新").tag("updated_at")
                Text("书名 A–Z").tag("title")
                Text("章节最多").tag("chapter_count")
            }
            Divider()
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
            Image(systemName: selectedCategory == nil && selectedStatus.isEmpty && selectedSort == "updated_at"
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill")
                .contentTransition(reduceMotion ? .opacity : .symbolEffect(.replace))
        }
        .accessibilityLabel("筛选与排序")
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
            let response: BookshelfResponse = try await APIClient.shared.getReader(
                "/api/bookshelf",
                auth: true
            )
            guard !Task.isCancelled else { return }
            // Animate structural changes only; progress refreshes keep the existing entrance in place.
            let changesLayout = bookshelf == nil || bookshelf?.recent.isEmpty != response.recent.isEmpty
            if changesLayout {
                withAnimation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1)) {
                    bookshelf = response
                }
            } else {
                bookshelf = response
            }
        } catch {
            // 阅读入口不是发现页的阻塞条件，书架请求失败时继续展示目录。
        }
    }

    private func loadRankingPreview() async {
        let revision = ContentAccessStore.shared.revision
        let rankingID = rankingPreviewRevision == revision ? rankingPreview?.selectedId : nil
        let request = UUID()
        rankingPreviewRequest = request
        do {
            var response = try await SourceRankingResponse.load(rankingID: rankingID)
            guard !Task.isCancelled, request == rankingPreviewRequest,
                  revision == ContentAccessStore.shared.revision else { return }
            if rankingID != nil, response.selectedId == nil {
                response = try await SourceRankingResponse.load()
                guard !Task.isCancelled, request == rankingPreviewRequest,
                      revision == ContentAccessStore.shared.revision else { return }
            }
            rankingPreview = response.preview()
            rankingPreviewRevision = revision
        } catch {
            // The discovery catalog remains available on older servers and during ranking failures.
        }
    }

    private func loadSearchSources() async {
        do {
            let options = try await SourceSearchOptions.load()
            guard !Task.isCancelled else { return }
            searchSources = options.sources
        } catch {
            // The discovery catalog still works with a server that has no source search endpoint.
        }
    }

    private func loadMoreIfNeeded() {
        guard !isLoading, !isLoadingMore, displayedQuery == catalogQuery, errorMessage == nil, page < totalPages,
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
                "sort": ticket.query[3],
                "order": ticket.query[3] == "title" ? "asc" : "desc",
                "contentMode": ContentAccessStore.shared.mode,
            ]
            let trimmed = ticket.query[0]
            if !trimmed.isEmpty { params["search"] = trimmed }
            if !ticket.query[1].isEmpty { params["category"] = ticket.query[1] }
            if !ticket.query[2].isEmpty { params["status"] = ticket.query[2] }

            let r: NovelListResponse = try await APIClient.shared.getReader("/api/novels?" + Self.query(params))
            guard !Task.isCancelled, requests.accepts(ticket, query: catalogQuery) else { return }
            if append {
                let existing = Set(novels.map(\.id))
                novels += r.novels.filter { !existing.contains($0.id) }
            } else {
                novels = r.novels
                categories = r.availableCategories
                totalNovelCount = r.total
                displayedQuery = ticket.query
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
