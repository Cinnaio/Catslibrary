import SwiftUI
import ZhiZhouCore

/// 书架页：侧栏书单，详情列接着读或打开详情。
struct BookshelfView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var response: BookshelfResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var isPerformingAction = false
    @State private var selection: BookshelfRoute?
    @State private var pendingRemove: FavoriteItem?
    @State private var pendingRecentRemove: RecentItem?

    @ViewBuilder
    var body: some View {
        if horizontalSizeClass != .regular {
            NavigationStack {
                bookshelfList
            }
        } else {
            NavigationSplitView {
                bookshelfList
            } detail: {
                NavigationStack {
                    bookshelfDetail
                }
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var bookshelfList: some View {
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
                } else if let response {
                    if !response.recent.isEmpty {
                        Section("最近阅读") {
                            ForEach(response.recent) { item in
                                recentLink(item)
                                    .swipeActions(edge: .trailing) {
                                        Button("删除记录", role: .destructive) {
                                            pendingRecentRemove = item
                                        }
                                    }
                            }
                            .onDelete { offsets in
                                guard let index = offsets.first,
                                      response.recent.indices.contains(index)
                                else { return }
                                pendingRecentRemove = response.recent[index]
                            }
                        }
                    }

                    if !response.favorites.isEmpty {
                        Section("我的书架（\(response.favorites.count)）") {
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
                        }
                    }
                }
            }
            .navigationTitle("书架")
            .navigationBarTitleDisplayMode(.large)
            .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            .scrollContentBackground(.hidden)
            .pageBackground()
            .toolbar {
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
            .overlay {
                if let response, response.favorites.isEmpty && response.recent.isEmpty {
                    ContentUnavailableView(
                        "书架空空",
                        systemImage: "books.vertical",
                        description: Text("去发现页找一本喜欢的书吧")
                    )
                    .padding(.bottom, 72)
                }
            }
            .refreshable { await load() }
            .task { await load() }
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
        case .detail(let novel):
            NovelDetailView(novel: novel)
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
                targetSize: CGSize(width: 40, height: 56)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                AppTheme.primaryLight
            }
            .frame(width: 40, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(item.novelTitle)
                    .font(serifFont(.subheadline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text(item.chapterTitle)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(Self.percentText(item.scrollPercent))
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)
                .accessibilityLabel("阅读进度")
                .accessibilityValue("百分之 \(Self.percentValue(item.scrollPercent))")
        }
        .accessibilityElement(children: .combine)
    }

    private func favoriteRow(_ favorite: FavoriteItem) -> some View {
        HStack(spacing: 10) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: favorite.novelId, updatedAt: favorite.novelUpdatedAt),
                targetSize: CGSize(width: 40, height: 56)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                AppTheme.primaryLight
            }
            .frame(width: 40, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(favorite.title)
                    .font(serifFont(.subheadline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text(favorite.author)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                if let title = favorite.chapterTitle, !title.isEmpty {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer()
            if let percent = favorite.scrollPercent, percent > 0 {
                Text(Self.percentText(percent))
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
                    .accessibilityLabel("阅读进度")
                    .accessibilityValue("百分之 \(Self.percentValue(percent))")
            }
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

    private func load() async {
        guard APIClient.shared.isAuthenticated else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let r: BookshelfResponse = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/bookshelf"), auth: true
            )
            response = r
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
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
            await load()
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
        await load()
        AppFeedback.success("已删除阅读记录")
    }
}
