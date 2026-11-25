import SwiftUI
import ZhiZhouCore

/// iPhone 保留既有书架；iPad 在同一导航栈中按窗口宽度扩展暖纸封面布局。
struct BookshelfView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var editMode: EditMode = .inactive
    @State private var shelfSection: ShelfSection?
    @State private var displayedQuery: [String]?
    @State private var response: BookshelfResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var isPerformingAction = false
    @State private var actionFeedback = AppFeedbackCenter()
    @State private var selection: BookshelfRoute?
    @State private var navigationPath: [BookshelfRoute] = []
    @State private var compactDetailNovel: Novel?
    @State private var pendingRemove: FavoriteItem?
    @State private var pendingRecentRemove: RecentItem?
    @State private var requests = ListRequestGuard<[String]>()
    @State private var search = ""
    @State private var sort = "added"
    @State private var reading = ""
    @State private var isLoadingMore = false
    @State private var loadMoreError: String?
    @State private var nextOffset = 0
    @State private var hasMore = false
    private let pageSize = 50

    private enum ShelfSection: String, CaseIterable {
        case recent, favorites

        var title: String {
            switch self {
            case .recent: return "在读"
            case .favorites: return "收藏"
            }
        }
    }

    private var usesShelfSections: Bool {
        ReadingSpaceWindowLayout.usesIPadLayout || horizontalSizeClass != .regular
    }

    private var searchTerm: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var filtersFavorites: Bool { !searchTerm.isEmpty || !reading.isEmpty }

    private var visibleSection: ShelfSection {
        if filtersFavorites { return .favorites }
        if let shelfSection { return shelfSection }
        if let response = visibleResponse, response.recent.isEmpty, !response.favorites.isEmpty {
            return .favorites
        }
        return .recent
    }

    private var showsRecent: Bool { !filtersFavorites && (!usesShelfSections || visibleSection == .recent) }
    private var showsFavorites: Bool { !usesShelfSections || visibleSection == .favorites }

    private var hasEditableItems: Bool {
        guard displayedQuery == shelfQuery, let response = visibleResponse else { return false }
        return (showsRecent && !response.recent.isEmpty) || (showsFavorites && !response.favorites.isEmpty)
    }

    private var showsCoverGrid: Bool {
        usesShelfSections && dynamicTypeSize < .xxxLarge && !editMode.isEditing
    }

    private var shelfQuery: [String] {
        [searchTerm, sort, reading, ContentAccessStore.shared.mode]
    }

    @ViewBuilder
    var body: some View {
        if ReadingSpaceWindowLayout.usesIPadLayout {
            adaptiveBookshelf
        } else {
            phoneBookshelf
        }
    }

    @ViewBuilder
    private var phoneBookshelf: some View {
        if usesShelfSections {
            NavigationStack {
                bookshelfList(columns: 2)
            }
            .sheet(item: $compactDetailNovel) { novel in
                NavigationStack {
                    NovelDetailView(novel: novel, showsCloseButton: true)
                }
            }
        } else {
            NavigationSplitView {
                bookshelfList(columns: 2)
            } detail: {
                NavigationStack {
                    bookshelfDetail
                }
                .id(splitDestinationID)
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var splitDestinationID: String {
        switch selection {
        case .read(let launch): return "reader:\(launch.novel.id):\(launch.chapterOrder)"
        case .detail(let novel): return "detail:\(novel.id)"
        case nil: return "none"
        }
    }

    private var adaptiveBookshelf: some View {
        NavigationStack(path: $navigationPath) {
            GeometryReader { geometry in
                bookshelfList(columns: ReadingSpaceWindowLayout.coverColumns(for: geometry.size.width))
                    .frame(maxWidth: ReadingSpaceWindowLayout.bookshelfWidth)
                    .frame(maxWidth: .infinity)
                    .background(ReadingSpace.profilePaper)
            }
            .navigationDestination(for: BookshelfRoute.self) { route in
                Self.destination(for: route)
            }
        }
        .sheet(item: $compactDetailNovel) { novel in
            NavigationStack {
                NovelDetailView(novel: novel, showsCloseButton: true)
            }
        }
        .task(id: shelfQuery) {
            await load(debounce: true)
        }
        .onChange(of: navigationPath) { oldPath, newPath in
            if !oldPath.isEmpty, newPath.isEmpty {
                Task { await load() }
            }
        }
    }

    // Keep data filtering outside the large SwiftUI result builder.
    private var visibleResponse: BookshelfResponse? {
        guard let response else { return nil }
        guard ContentAccessStore.shared.mode != "adult" else { return response }
        return BookshelfResponse(
            favorites: response.favorites.filter { !$0.asNovel.isRestricted },
            recent: response.recent.filter { !$0.asNovel.isRestricted },
            thoughts: response.thoughts,
            totals: response.totals
        )
    }

    private func bookshelfList(columns: Int) -> some View {
        bookshelfContent(columns: columns)
            .modifier(ReadingSpaceRoomListStyle())
            .safeAreaBar(edge: .bottom, spacing: 0) {
                AppFeedbackOverlay(center: actionFeedback, edge: .bottom)
            }
            .navigationTitle(usesShelfSections ? "" : "书架")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "搜索收藏的书名或作者")
            .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            .toolbar { bookshelfToolbar }
            .environment(\.editMode, $editMode)
            .refreshable { await load() }
            .onChange(of: sort) { _, _ in shelfSection = .favorites }
            .onChange(of: ContentAccessStore.shared.mode) { _, mode in
                if mode == "safe" { response = nil }
            }
            .onDisappear { actionFeedback.dismiss() }
            .task(id: shelfQuery) {
                guard !ReadingSpaceWindowLayout.usesIPadLayout else { return }
                await load(debounce: true)
            }
            .onChange(of: selection) { oldSelection, newSelection in
                // 应用内从阅读器返回时 selection 才会归零；scenePhase 不会变化。
                if oldSelection != nil, newSelection == nil {
                    Task { await load() }
                }
            }
            .confirmationDialog(
                "从书架移除这本书？",
                isPresented: Binding(
                    get: { pendingRemove != nil },
                    set: { if !$0 { pendingRemove = nil } }
                ),
                titleVisibility: .visible,
                presenting: pendingRemove
            ) { favorite in
                Button("移除", role: .destructive) {
                    Task { await removeFavorite(favorite) }
                }
                Button("取消", role: .cancel) {}
            } message: { favorite in
                Text("将把《\(favorite.title)》移出书架")
            }
            .confirmationDialog(
                "删除这条阅读记录？",
                isPresented: Binding(
                    get: { pendingRecentRemove != nil },
                    set: { if !$0 { pendingRecentRemove = nil } }
                ),
                titleVisibility: .visible,
                presenting: pendingRecentRemove
            ) { recent in
                Button("删除记录", role: .destructive) {
                    Task { await removeRecent(recent) }
                }
                Button("取消", role: .cancel) {}
            } message: { recent in
                Text("将删除《\(recent.novelTitle)》的最近阅读记录")
            }
            .alert("操作未完成", isPresented: Binding(
                get: { actionError != nil },
                set: { if !$0 { actionError = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(actionError ?? "")
            }
    }

    // Give each section its own type-checking boundary as the list grows.
    private func bookshelfContent(columns: Int) -> some View {
        List(selection: $selection) {
            if usesShelfSections { shelfHeading }
            if isLoading && (response == nil || displayedQuery != shelfQuery || errorMessage != nil) {
                ProgressView(response == nil ? "正在加载书架…" : (errorMessage == nil ? "正在载入结果…" : "正在重试…"))
                    .font(.footnote)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let errorMessage, (response == nil || displayedQuery != shelfQuery), !isLoading {
                ContentUnavailableView {
                    Label("加载失败", systemImage: "wifi.slash")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else if let response = visibleResponse, displayedQuery == shelfQuery {
                loadedContent(response, columns: columns)
            }
        }
    }

    private var shelfHeading: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 20))
        return layout {
            Text("书架")
                .font(serifFont(.largeTitle, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            if !filtersFavorites {
                shelfSectionPicker
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 12)
        .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 8, trailing: 22))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var shelfSectionPicker: some View {
        HStack(spacing: 16) {
            ForEach(ShelfSection.allCases, id: \.self) { section in
                let selected = visibleSection == section
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
                        shelfSection = section
                    }
                } label: {
                    Text(section.title)
                        .font(.subheadline.weight(selected ? .medium : .regular))
                        .foregroundStyle(selected ? ReadingSpace.ink : ReadingSpace.profileMuted)
                        .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                        .background(alignment: .bottom) {
                            Capsule()
                                .fill(selected ? AppTheme.primary : .clear)
                                .frame(height: 2)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityIdentifier("bookshelf.section.\(section.rawValue)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("书架分区")
    }

    @ViewBuilder
    private func loadedContent(_ response: BookshelfResponse, columns: Int) -> some View {
        let hasRecent = showsRecent && !response.recent.isEmpty
        let hasFavorites = showsFavorites && !response.favorites.isEmpty
        if !hasRecent && !hasFavorites && errorMessage == nil && !isLoading {
            shelfEmptyState
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
        if let errorMessage {
            LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                Task { await load() }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
        if hasRecent {
            recentSection(response.recent, columns: columns)
        }

        if hasFavorites || (showsFavorites && hasMore) {
            favoritesSection(response, columns: columns)
        }
    }

    @ViewBuilder
    private var shelfEmptyState: some View {
        if filtersFavorites {
            ContentUnavailableView("没有匹配的收藏", systemImage: "books.vertical",
                                   description: Text("换个关键词或筛选条件试试"))
        } else if usesShelfSections && visibleSection == .recent {
            ContentUnavailableView("还没有阅读记录", systemImage: "book.pages",
                                   description: Text("打开一本书，阅读记录会出现在这里"))
        } else {
            ContentUnavailableView("还没有收藏", systemImage: "books.vertical",
                                   description: Text("去发现页找一本喜欢的书吧"))
        }
    }

    private func recentSection(_ recent: [RecentItem], columns: Int) -> some View {
        Section {
            if ReadingSpaceWindowLayout.usesIPadLayout, showsCoverGrid, columns >= 3, let first = recent.first {
                recentLink(first, featured: true)
                    .readingSpaceEntrance()
                    .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 8, trailing: 22))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .swipeActions(edge: .trailing) {
                        Button("删除记录", role: .destructive) { pendingRecentRemove = first }
                    }
                ReadingSpaceCoverRows(items: Array(recent.dropFirst()), columns: columns) { item in
                    recentLink(item, cover: true)
                }
            } else {
                ForEach(Array(recent.enumerated()), id: \.element.id) { index, item in
                    recentLink(item, featured: showsCoverGrid && index == 0)
                        .readingSpaceEntrance(index)
                        .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 8, trailing: 22))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing) {
                            Button("删除记录", role: .destructive) { pendingRecentRemove = item }
                        }
                }
                .onDelete { offsets in
                    guard let index = offsets.first, recent.indices.contains(index) else { return }
                    pendingRecentRemove = recent[index]
                }
            }
        } header: {
            if !usesShelfSections { Text("最近阅读") }
        }
    }

    private func favoritesSection(_ response: BookshelfResponse, columns: Int) -> some View {
        Section("\(response.totals?.favorites ?? response.favorites.count) 本收藏") {
            if showsCoverGrid && !ReadingSpaceWindowLayout.usesIPadLayout {
                phoneCoverRows(response.favorites)
            } else if showsCoverGrid {
                ReadingSpaceCoverRows(items: response.favorites, columns: columns) { favorite in
                    favoriteLink(favorite, cover: true)
                }
            } else {
                ForEach(Array(response.favorites.enumerated()), id: \.element.id) { index, favorite in
                    favoriteLink(favorite)
                        .readingSpaceEntrance(index)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing) {
                            Button("移出书架", role: .destructive) {
                                pendingRemove = favorite
                            }
                        }
                }
                .onDelete { offsets in
                    guard let index = offsets.first,
                          response.favorites.indices.contains(index)
                    else { return }
                    pendingRemove = response.favorites[index]
                }
            }
            if hasMore {
                loadMoreButton.listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
        }
    }

    // 每行只承载两张封面，让原生 List 继续按需创建长书架的行。
    private func phoneCoverRows(_ favorites: [FavoriteItem]) -> some View {
        ForEach(Array(stride(from: 0, to: favorites.count, by: 2)), id: \.self) { offset in
            HStack(alignment: .top, spacing: 22) {
                favoriteLink(favorites[offset], cover: true)
                    .frame(minWidth: 0, maxWidth: .infinity)
                    .readingSpaceEntrance(offset)
                    .id(favorites[offset].id)
                if offset + 1 < favorites.count {
                    favoriteLink(favorites[offset + 1], cover: true)
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .readingSpaceEntrance(offset + 1)
                        .id(favorites[offset + 1].id)
                } else {
                    Color.clear.frame(maxWidth: .infinity).accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 12)
            .listRowInsets(EdgeInsets(top: 0, leading: 22, bottom: 0, trailing: 22))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    private var loadMoreButton: some View {
        Button {
            loadNextPage()
        } label: {
            HStack {
                if isLoadingMore { ProgressView() }
                Text(loadMoreError ?? "加载更多收藏")
            }
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
        }
        .disabled(isLoading || isLoadingMore)
        .accessibilityIdentifier("bookshelf.loadMore")
    }

    @ToolbarContentBuilder
    private var bookshelfToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Picker("排序", selection: $sort) {
                    Text("收藏时间").tag("added")
                    Text("最近阅读").tag("recent_read")
                    Text("最近更新").tag("updated")
                    Text("书名").tag("title")
                }
                Picker("阅读状态", selection: $reading) {
                    Text("全部").tag("")
                    Text("未开始").tag("unread")
                    Text("已开始").tag("started")
                }
            } label: {
                Label("筛选与排序", systemImage: sort == "added" && reading.isEmpty
                    ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
        }
        if hasEditableItems || editMode.isEditing || isPerformingAction {
            if isPerformingAction {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView()
                        .accessibilityLabel("正在更新书架")
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                }
            }
        }
    }

    @ViewBuilder
    private var bookshelfDetail: some View {
        if let selection {
            Self.destination(for: selection)
        } else {
            ContentUnavailableView(
                "选择一本书",
                systemImage: "books.vertical",
                description: Text("点最近阅读即可接着读")
            )
        }
    }

    // 目的地只依赖路由，避免闭包捕获整个书架及其动态环境和状态。
    @ViewBuilder
    private static func destination(for route: BookshelfRoute) -> some View {
        switch route {
        case .read(let launch):
            ReaderView(
                novel: launch.novel,
                chapterOrder: launch.chapterOrder,
                preloadedChapters: launch.preloadedChapters
            )
            .id("reader:\(launch.novel.id):\(launch.chapterOrder)")
        case .detail(let novel):
            NovelDetailView(novel: novel)
                .id(novel.id)
        }
    }

    @ViewBuilder
    private func recentLink(_ item: RecentItem, featured: Bool = false, cover: Bool = false) -> some View {
        let route = BookshelfRoute.read(item.asLaunch)
        if ReadingSpaceWindowLayout.usesIPadLayout {
            NavigationLink(value: BookshelfRoute.read(item.asLaunch)) {
                if cover { recentCover(item) }
                else { recentRow(item, featured: featured) }
            }
            .navigationLinkIndicatorVisibility(.hidden)
            .contextMenu {
                Button { compactDetailNovel = item.asNovel } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) { pendingRecentRemove = item } label: {
                    Label("删除阅读记录", systemImage: "trash")
                }
            }
            .accessibilityHint("打开后接着读")
            .accessibilityIdentifier("bookshelf.recent.\(item.novelId)")
        } else if horizontalSizeClass != .regular {
            NavigationLink {
                Self.destination(for: route)
            } label: {
                recentRow(item, featured: featured)
            }
            .navigationLinkIndicatorVisibility(.hidden)
            .contextMenu {
                Button {
                    compactDetailNovel = item.asNovel
                } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) {
                    pendingRecentRemove = item
                } label: {
                    Label("删除阅读记录", systemImage: "trash")
                }
            }
            .accessibilityHint("打开后接着读")
        } else {
            Button {
                selection = route
            } label: {
                recentRow(item, featured: featured)
            }
            .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
            .tag(route)
            .contextMenu {
                Button {
                    selection = .detail(item.asNovel)
                } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) {
                    pendingRecentRemove = item
                } label: {
                    Label("删除阅读记录", systemImage: "trash")
                }
            }
            .accessibilityHint("打开后接着读")
        }
    }

    @ViewBuilder
    private func favoriteLink(_ favorite: FavoriteItem, cover: Bool = false) -> some View {
        let route = favorite.asLaunch.map { BookshelfRoute.read($0) } ?? .detail(favorite.asNovel)
        if ReadingSpaceWindowLayout.usesIPadLayout {
            NavigationLink(value: route) {
                favoriteLabel(favorite, cover: cover)
            }
            .navigationLinkIndicatorVisibility(.hidden)
            .contextMenu {
                Button { compactDetailNovel = favorite.asNovel } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) { pendingRemove = favorite } label: {
                    Label("移出书架", systemImage: "trash")
                }
            }
            .accessibilityHint(favorite.asLaunch == nil ? "打开书籍详情" : "打开后接着读")
        } else if horizontalSizeClass != .regular {
            NavigationLink {
                Self.destination(for: route)
            } label: {
                favoriteLabel(favorite, cover: cover)
            }
            .navigationLinkIndicatorVisibility(.hidden)
            .contextMenu {
                Button {
                    compactDetailNovel = favorite.asNovel
                } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) {
                    pendingRemove = favorite
                } label: {
                    Label("移出书架", systemImage: "trash")
                }
            }
            .accessibilityHint(favorite.asLaunch == nil ? "打开书籍详情" : "打开后接着读")
        } else {
            Button {
                selection = route
            } label: {
                favoriteLabel(favorite, cover: cover)
            }
            .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
            .tag(route)
            .contextMenu {
                Button {
                    selection = .detail(favorite.asNovel)
                } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
                Button(role: .destructive) {
                    pendingRemove = favorite
                } label: {
                    Label("移出书架", systemImage: "trash")
                }
            }
        }
    }

    private func recentCover(_ item: RecentItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            bookCover(novelID: item.novelId, updatedAt: item.updatedAt)
            Text(item.novelTitle)
                .font(serifFont(.headline, .semibold))
                .foregroundStyle(ReadingSpace.ink).appTextLineLimit(2)
            Text(item.chapterTitle)
                .font(.caption).foregroundStyle(ReadingSpace.profileMuted).appTextLineLimit(2)
            Text("本章 \(Self.percentValue(item.scrollPercent))%")
                .font(.caption.monospacedDigit()).foregroundStyle(AppTheme.primary)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func recentRow(_ item: RecentItem, featured: Bool = false) -> some View {
        let titleColor = featured ? ReadingSpace.onSummary : ReadingSpace.ink
        let detailColor = featured ? ReadingSpace.summarySecondary : ReadingSpace.profileMuted
        let progress = Self.percentValue(item.scrollPercent)

        return HStack(spacing: featured ? 16 : 12) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: item.novelId, updatedAt: item.updatedAt),
                targetSize: CGSize(width: featured ? 78 : 60, height: featured ? 112 : 86)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                featured ? ReadingSpace.profileReadDay : AppTheme.primaryLight
            }
            .frame(width: featured ? 78 : 60, height: featured ? 112 : 86)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                if featured {
                    Text("继续阅读").font(.caption.weight(.medium)).foregroundStyle(detailColor)
                }
                Text(item.novelTitle)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(titleColor)
                    .appTextLineLimit(2)
                Text(item.chapterTitle)
                    .font(.footnote)
                    .foregroundStyle(detailColor)
                    .appTextLineLimit(1)
                if featured {
                    ProgressView(value: Double(progress), total: 100)
                        .tint(ReadingSpace.profileToday)
                        .accessibilityHidden(true)
                }
                Text("本章 \(progress)%")
                    .font(.caption.monospacedDigit())
                    .contentTransition(.numericText())
                    .foregroundStyle(detailColor)
                    .accessibilityLabel("本章阅读进度")
                    .accessibilityValue("百分之 \(progress)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(featured ? 18 : 0)
        .background {
            if featured { RoundedRectangle(cornerRadius: ReadingSpace.panelRadius).fill(ReadingSpace.summary) }
        }
        .padding(.vertical, featured ? 6 : 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func favoriteLabel(_ favorite: FavoriteItem, cover: Bool) -> some View {
        if cover { favoriteCover(favorite) }
        else { favoriteRow(favorite) }
    }

    private func favoriteCover(_ favorite: FavoriteItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            bookCover(novelID: favorite.novelId, updatedAt: favorite.novelUpdatedAt)
            Text(favorite.title)
                .font(serifFont(.headline, .semibold))
                .foregroundStyle(ReadingSpace.ink).appTextLineLimit(2)
            Text(favorite.author)
                .font(.caption).foregroundStyle(AppTheme.textSecondary).appTextLineLimit(1)
            Text(favoriteProgress(favorite))
                .font(.caption).foregroundStyle(AppTheme.primary)
                .appTextLineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func bookCover(novelID: String, updatedAt: Int64) -> some View {
        Color.clear
            .aspectRatio(0.7, contentMode: .fit)
            .overlay {
                CachedAsyncImage(
                    url: APIClient.shared.coverURL(novelId: novelID, updatedAt: updatedAt),
                    targetSize: CGSize(width: 180, height: 258)
                ) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack {
                        AppTheme.primaryLight
                        Image(systemName: "book.closed").font(.largeTitle).foregroundStyle(AppTheme.primary)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .shadow(color: AppTheme.cardShadow, radius: 8, x: 0, y: 4)
            .accessibilityHidden(true)
    }

    private func favoriteProgress(_ favorite: FavoriteItem) -> String {
        guard favorite.asLaunch != nil else { return "尚未开始" }
        guard let percent = favorite.scrollPercent else { return "接着读" }
        return "接着读 · \(Self.percentText(percent))"
    }

    private func favoriteRow(_ favorite: FavoriteItem) -> some View {
        HStack(spacing: 10) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: favorite.novelId, updatedAt: favorite.novelUpdatedAt),
                targetSize: CGSize(width: 60, height: 86)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                AppTheme.primaryLight
            }
            .frame(width: 60, height: 86)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(favorite.title)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(2)
                Text(favorite.author)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
                if let title = favorite.chapterTitle, !title.isEmpty {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .appTextLineLimit(1)
                }
                if let percent = favorite.scrollPercent, percent > 0 {
                    Text(Self.percentText(percent))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(AppTheme.textSecondary)
                        .accessibilityLabel("阅读进度")
                        .accessibilityValue("百分之 \(Self.percentValue(percent))")
                }
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    /// 进度百分比 clamp 到 0...100，防止服务端异常值显示 >100%。
    private static func percentValue(_ raw: Double) -> Int {
        guard raw.isFinite else { return 0 }
        return Int((min(1, max(0, raw)) * 100).rounded())
    }

    private static func percentText(_ raw: Double) -> String {
        "\(percentValue(raw))%"
    }

    private func load(animate: Bool = false, debounce: Bool = false) async {
        guard APIClient.shared.isAuthenticated else { return }
        let ticket = requests.begin(shelfQuery)
        isLoading = true
        isLoadingMore = false
        if debounce {
            do { try await Task.sleep(nanoseconds: 300_000_000) } catch {
                if requests.accepts(ticket, query: shelfQuery) {
                    requests.finish(ticket)
                    isLoading = false
                }
                return
            }
        }
        await fetchPage(offset: 0, ticket: ticket, animate: animate)
    }

    private func loadNextPage() {
        guard hasMore, !isLoading, !isLoadingMore,
              let ticket = requests.beginNext(shelfQuery) else { return }
        isLoadingMore = true
        Task { await fetchPage(offset: nextOffset, ticket: ticket) }
    }

    private func fetchPage(offset: Int, ticket: ListRequestGuard<[String]>.Ticket, animate: Bool = false) async {
        defer {
            if requests.accepts(ticket, query: shelfQuery) {
                requests.finish(ticket)
                isLoading = false
                isLoadingMore = false
            }
        }
        do {
            let params = ["limit": String(pageSize), "offset": String(offset),
                          "search": ticket.query[0], "sort": ticket.query[1], "reading": ticket.query[2]]
            let r: BookshelfResponse = try await APIClient.shared.getReader(
                "/api/bookshelf?" + ReaderQuery.encode(params), auth: true
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: shelfQuery) else { return }
            let existing = offset == 0 ? [] : (response?.favorites ?? [])
            let ids = Set(existing.map(\.novelId))
            let updated = BookshelfResponse(
                favorites: existing + r.favorites.filter { !ids.contains($0.novelId) },
                recent: r.recent, thoughts: r.thoughts, totals: r.totals
            )
            if animate {
                withAnimation(reduceMotion ? AppMotion.micro : AppMotion.state) {
                    response = updated
                }
            } else {
                response = updated
            }
            displayedQuery = ticket.query
            nextOffset = offset + r.favorites.count
            hasMore = r.favorites.count == pageSize && nextOffset < (r.totals?.favorites ?? Int.max)
            errorMessage = nil
            loadMoreError = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
            isLoadingMore = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: shelfQuery) else { return }
            if offset > 0 { loadMoreError = "加载失败，点按重试" }
            else { errorMessage = AppCopy.friendlyError(error) }
        }
    }

    private func removeFavorite(_ favorite: FavoriteItem) async {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            let _: OkEnvelope = try await APIClient.shared.delete(
                "/api/bookshelf?novelId=\(favorite.novelId)", auth: true
            )
            if case .read(let launch) = selection, launch.novel.id == favorite.novelId {
                selection = nil
            }
            if case .detail(let novel) = selection, novel.id == favorite.novelId {
                selection = nil
            }
            await load(animate: true)
            AppFeedback.success("已移出书架", using: actionFeedback)
        } catch {
            AppFeedback.error()
            actionError = "移出书架失败，请检查网络后重试。"
        }
    }

    private func removeRecent(_ recent: RecentItem) async {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        defer { isPerformingAction = false }
        guard await ReaderProgressStore.shared.delete(novelID: recent.novelId) else {
            AppFeedback.error()
            actionError = "阅读记录删除请求尚未同步，请稍后重试。"
            return
        }
        await load(animate: true)
        AppFeedback.success("已删除阅读记录", using: actionFeedback)
    }
}
