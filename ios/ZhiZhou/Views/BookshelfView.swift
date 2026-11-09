import SwiftUI
import ZhiZhouCore

/// 书架页：侧栏书单，详情列接着读或打开详情。
struct BookshelfView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var response: BookshelfResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var isPerformingAction = false
    @State private var selection: BookshelfRoute?
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

    private var shelfQuery: [String] {
        [search.trimmingCharacters(in: .whitespacesAndNewlines), sort, reading, ContentAccessStore.shared.mode]
    }

    @ViewBuilder
    var body: some View {
        if horizontalSizeClass != .regular {
            NavigationStack {
                bookshelfList
            }
            .sheet(item: $compactDetailNovel) { novel in
                NavigationStack {
                    NovelDetailView(novel: novel, showsCloseButton: true)
                }
            }
        } else {
            NavigationSplitView {
                bookshelfList
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

    private var bookshelfList: some View {
        bookshelfContent
            .appListStyle(.browsing)
            .navigationTitle("书架")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $search, prompt: "搜索收藏的书名或作者")
            .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            .toolbar { bookshelfToolbar }
            .refreshable { await load() }
            .onChange(of: ContentAccessStore.shared.mode) { _, mode in
                if mode == "safe" { response = nil }
            }
            .task(id: shelfQuery) {
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
    private var bookshelfContent: some View {
        List(selection: $selection) {
            if isLoading && response == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 160)
                    .listRowBackground(Color.clear)
            } else if let errorMessage, response == nil {
                ContentUnavailableView {
                    Label("加载失败", systemImage: "wifi.slash")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else if let response = visibleResponse {
                loadedContent(response)
            }
        }
    }

    @ViewBuilder
    private func loadedContent(_ response: BookshelfResponse) -> some View {
        if response.favorites.isEmpty && (response.recent.isEmpty || !search.isEmpty || !reading.isEmpty) && errorMessage == nil {
            ContentUnavailableView(
                search.isEmpty && reading.isEmpty ? "书架空空" : "没有匹配的收藏",
                systemImage: "books.vertical",
                description: Text(search.isEmpty && reading.isEmpty ? "去发现页找一本喜欢的书吧" : "换个关键词或筛选条件试试")
            )
                .listRowBackground(Color.clear)
        }
        if let errorMessage {
            LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                Task { await load() }
            }
        }
        if search.isEmpty && reading.isEmpty && !response.recent.isEmpty {
            recentSection(response.recent)
        }

        if !response.favorites.isEmpty {
            favoritesSection(response)
        }
    }

    private func recentSection(_ recent: [RecentItem]) -> some View {
        Section("最近阅读") {
            ForEach(recent) { item in
                recentLink(item)
                    .swipeActions(edge: .trailing) {
                        Button("删除记录", role: .destructive) {
                            pendingRecentRemove = item
                        }
                    }
            }
            .onDelete { offsets in
                guard let index = offsets.first,
                      recent.indices.contains(index)
                else { return }
                pendingRecentRemove = recent[index]
            }
        }
    }

    private func favoritesSection(_ response: BookshelfResponse) -> some View {
        Section("我的书架（\(response.totals?.favorites ?? response.favorites.count)）") {
            ForEach(response.favorites) { favorite in
                favoriteLink(favorite)
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
            if hasMore {
                loadMoreButton
            }
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
        if response?.favorites.isEmpty == false || response?.recent.isEmpty == false {
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
            destination(for: selection)
        } else {
            ContentUnavailableView(
                "选择一本书",
                systemImage: "books.vertical",
                description: Text("点最近阅读即可接着读")
            )
        }
    }

    @ViewBuilder
    private func destination(for route: BookshelfRoute) -> some View {
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
    private func recentLink(_ item: RecentItem) -> some View {
        let route = BookshelfRoute.read(item.asLaunch)
        if horizontalSizeClass != .regular {
            NavigationLink {
                destination(for: route)
            } label: {
                recentRow(item)
            }
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
                recentRow(item)
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
    private func favoriteLink(_ favorite: FavoriteItem) -> some View {
        let route = favorite.asLaunch.map { BookshelfRoute.read($0) } ?? .detail(favorite.asNovel)
        if horizontalSizeClass != .regular {
            NavigationLink {
                destination(for: route)
            } label: {
                favoriteRow(favorite)
            }
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
            .accessibilityHint("打开后接着读")
        } else {
            Button {
                selection = route
            } label: {
                favoriteRow(favorite)
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

    private func recentRow(_ item: RecentItem) -> some View {
        HStack(spacing: 10) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: item.novelId, updatedAt: item.updatedAt),
                targetSize: CGSize(width: 60, height: 86)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                AppTheme.primaryLight
            }
            .frame(width: 60, height: 86)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(item.novelTitle)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(2)
                Text(item.chapterTitle)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
                Text(Self.percentText(item.scrollPercent))
                    .font(.caption.monospacedDigit())
                    .contentTransition(.numericText())
                    .foregroundStyle(AppTheme.textSecondary)
                    .accessibilityLabel("阅读进度")
                    .accessibilityValue("百分之 \(Self.percentValue(item.scrollPercent))")
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
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
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius))
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
        min(100, max(0, Int((raw * 100).rounded())))
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
            AppFeedback.success("已移出书架")
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
        AppFeedback.success("已删除阅读记录")
    }
}
