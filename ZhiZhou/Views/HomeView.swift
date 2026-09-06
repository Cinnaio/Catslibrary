import SwiftUI
import ZhiZhouCore

/// 发现页：以继续阅读为首要入口，紧凑宽度使用单列导航，宽屏保留书单与详情列。
struct HomeView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
    /// 请求序号：丢弃过期响应（搜索/分类竞态守卫）
    @State private var requestSeq = 0
    @State private var interactionFeedback = 0
    @State private var isFilterPending = false

    private enum HomeRoute: Hashable {
        case novel(Novel)
        case reader(ReaderLaunch)
    }

    private var recentReading: RecentItem? {
        bookshelf?.recent.first
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
                searchField
                    .padding(.top, 8)

                categoryChips
                    .padding(.top, 10)

                if let recentReading {
                    sectionHeader("继续阅读")
                        .padding(.top, 22)
                    continueReadingCard(recentReading)
                        .padding(.bottom, 26)
                } else if bookshelf != nil {
                    startExploringCard
                        .padding(.top, 22)
                        .padding(.bottom, 26)
                }

                sectionHeader(
                    "最近更新",
                    trailing: totalNovelCount > 0 ? "\(totalNovelCount) 本" : nil
                )
                .padding(.bottom, 10)

                catalogContent
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .pageBackground()
        .navigationTitle("发现")
        .navigationBarTitleDisplayMode(.large)
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
            LazyVStack(spacing: 12) {
                ForEach(novels) { novel in
                    novelRow(novel)
                        .onAppear {
                            if novel.id == novels.last?.id { loadMoreIfNeeded() }
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
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AppTheme.textSecondary)
            TextField("搜索书名 / 作者", text: $search)
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(AppTheme.textPrimary)
                .tint(AppTheme.primary)
            if !search.isEmpty {
                Button {
                    search = ""
                    interactionFeedback &+= 1
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.textMuted)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(ScaleButtonStyle(pressedScale: 0.9))
                .accessibilityLabel("清除搜索")
            }
            if isFilterPending || (isLoading && !novels.isEmpty) {
                ProgressView()
                    .controlSize(.small)
                    .tint(AppTheme.primary)
                    .accessibilityLabel("正在更新搜索结果")
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .appMaterialBackground(.thinMaterial, fallback: AppTheme.controlFill, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(AppTheme.border.opacity(0.45), lineWidth: 0.7)
        }
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

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(value: nil, label: "全部")
                ForEach(categories, id: \.self) { category in
                    chip(value: category, label: category)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("分类")
    }

    private func chip(value: String?, label: String) -> some View {
        let selected = selectedCategory == value
        return Button {
            guard selectedCategory != value else { return }
            selectedCategory = value
            interactionFeedback &+= 1
        } label: {
            Text(label)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 14)
                .frame(minHeight: 42)
                .foregroundStyle(selected ? AppTheme.onPrimary : AppTheme.textSecondary)
                .background {
                    if selected {
                        Capsule().fill(AppTheme.primary)
                    } else {
                        Capsule()
                            .fill(.clear)
                            .appMaterialBackground(
                                .thinMaterial,
                                fallback: AppTheme.controlFill,
                                in: Capsule()
                            )
                    }
                }
                .overlay(
                    Capsule().strokeBorder(
                        selected ? Color.clear : AppTheme.border.opacity(0.5),
                        lineWidth: 0.8
                    )
                )
        }
        .buttonStyle(ScaleButtonStyle())
        .contentShape(Capsule())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func sectionHeader(_ title: String, trailing: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(serifFont(.title3, .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Spacer(minLength: 12)
            if let trailing {
                Text(trailing)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
    }

    private func continueReadingCard(_ item: RecentItem) -> some View {
        let progress = min(max(item.scrollPercent, 0), 1)
        return Button {
            openRecent(item)
        } label: {
            HStack(spacing: 14) {
                NovelCoverView(
                    novel: item.asNovel,
                    size: CGSize(width: 64, height: 88)
                )

                VStack(alignment: .leading, spacing: 5) {
                    Text(item.novelTitle)
                        .font(serifFont(.headline, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(2)
                    Text(item.chapterTitle)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                    ProgressView(value: progress, total: 1)
                        .tint(AppTheme.primary)
                        .padding(.top, 3)
                    HStack(spacing: 6) {
                        Text("已读 \(Int((progress * 100).rounded()))%")
                        Text("·")
                        Text("第 \(item.chapterOrder) 章")
                    }
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
                }

                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.primary)
            }
            .padding(14)
            .background(AppTheme.primaryLight.opacity(0.82), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(AppTheme.primary.opacity(0.24), lineWidth: 0.8)
            }
        }
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
        .accessibilityLabel("继续阅读《\(item.novelTitle)》")
        .accessibilityHint("打开第 \(item.chapterOrder) 章")
    }

    private var startExploringCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.title3)
                .foregroundStyle(AppTheme.primary)
                .frame(width: 38, height: 38)
                .background(AppTheme.primaryLight, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text("开始探索")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("从最近更新里挑一本喜欢的书")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(AppTheme.border.opacity(0.7), lineWidth: 0.8)
        }
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
        isFilterPending = true
        reloadTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            isFilterPending = false
            await reload()
        }
    }

    func reload() async {
        isFilterPending = false
        page = 1
        loadMoreError = nil
        await fetchPage(1, append: false)
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
        guard !isLoading, !isLoadingMore, page < totalPages else { return }
        Task { await fetchPage(page + 1, append: true) }
    }

    private func fetchPage(_ target: Int, append: Bool) async {
        let seq = append ? requestSeq : requestSeq + 1
        if !append { requestSeq = seq }
        if target == 1 { isLoading = true } else { isLoadingMore = true }
        defer {
            // 仅当本响应仍是当前请求时才清 loading，避免过期响应干扰新请求的加载态
            if seq == requestSeq {
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
            let trimmed = search.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty { params["search"] = trimmed }
            if let selectedCategory { params["category"] = selectedCategory }

            let r: NovelListResponse = try await APIClient.shared.get("/api/novels?" + Self.query(params))
            guard seq == requestSeq else { return } // 过期响应直接丢弃
            if append {
                novels += r.novels
            } else {
                novels = r.novels
                categories = r.availableCategories
                totalNovelCount = r.total
            }
            page = r.page
            totalPages = r.totalPages
            errorMessage = nil
            loadMoreError = nil
            await CoverPrefetcher.shared.prefetch(r.novels)
        } catch {
            guard seq == requestSeq else { return }
            AppObservability.shared.capture(error: error, context: append ? "home.load_more" : "home.load")
            let message = AppCopy.friendlyError(error)
            if append || !novels.isEmpty {
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
