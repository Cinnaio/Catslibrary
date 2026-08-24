import SwiftUI

/// 书架页：侧栏书单，详情列接着读或打开详情。
struct BookshelfView: View {
    @State private var response: BookshelfResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var selection: BookshelfRoute?

    var body: some View {
        NavigationSplitView {
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
                    if response.favorites.isEmpty && response.recent.isEmpty {
                        ContentUnavailableView(
                            "书架空空",
                            systemImage: "books.vertical",
                            description: Text("去发现页找一本喜欢的书吧")
                        )
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .frame(maxWidth: .infinity, minHeight: 320)
                    }

                    if !response.recent.isEmpty {
                        Section("最近阅读") {
                            ForEach(response.recent) { item in
                                NavigationLink(value: BookshelfRoute.read(item.asLaunch)) {
                                    recentRow(item)
                                }
                                .contextMenu {
                                    Button {
                                        selection = .detail(item.asNovel)
                                    } label: {
                                        Label("书籍详情", systemImage: "info.circle")
                                    }
                                }
                                .accessibilityHint("打开后接着读")
                            }
                        }
                    }

                    if !response.favorites.isEmpty {
                        Section("我的书架（\(response.favorites.count)）") {
                            ForEach(response.favorites) { favorite in
                                favoriteLink(favorite)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button("移除", role: .destructive) {
                                            Task { await removeFavorite(favorite) }
                                        }
                                    }
                            }
                        }
                    }
                }
            }
            .navigationTitle("书架")
            .navigationBarTitleDisplayMode(.large)
            .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            .scrollContentBackground(.hidden)
            .glassPageBackground()
            .refreshable { await load() }
            .task { await load() }
            .alert("操作未完成", isPresented: Binding(
                get: { actionError != nil },
                set: { if !$0 { actionError = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(actionError ?? "")
            }
            .browseColorScheme()
        } detail: {
            NavigationStack {
                switch selection {
                case .read(let launch):
                    ReaderView(
                        novel: launch.novel,
                        chapterOrder: launch.chapterOrder,
                        preloadedChapters: launch.preloadedChapters
                    )
                case .detail(let novel):
                    NovelDetailView(novel: novel)
                case nil:
                    ContentUnavailableView(
                        "选择一本书",
                        systemImage: "books.vertical",
                        description: Text("点最近阅读即可接着读")
                    )
                    .browseColorScheme()
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private func favoriteLink(_ favorite: FavoriteItem) -> some View {
        if let launch = favorite.asLaunch {
            NavigationLink(value: BookshelfRoute.read(launch)) {
                favoriteRow(favorite)
            }
            .contextMenu {
                Button {
                    selection = .detail(favorite.asNovel)
                } label: {
                    Label("书籍详情", systemImage: "info.circle")
                }
            }
            .accessibilityHint("打开后接着读")
        } else {
            NavigationLink(value: BookshelfRoute.detail(favorite.asNovel)) {
                favoriteRow(favorite)
            }
        }
    }

    private func recentRow(_ item: RecentItem) -> some View {
        HStack {
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
            Text("\(Int(item.scrollPercent * 100))%")
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)
                .accessibilityLabel("阅读进度")
                .accessibilityValue("百分之 \(Int(item.scrollPercent * 100))")
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
                Text("\(Int(percent * 100))%")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
                    .accessibilityLabel("阅读进度")
                    .accessibilityValue("百分之 \(Int(percent * 100))")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        guard APIClient.shared.isAuthenticated else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let r: BookshelfResponse = try await APIClient.shared.get("/api/bookshelf", auth: true)
            response = r
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func removeFavorite(_ favorite: FavoriteItem) async {
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
        } catch {
            actionError = "移出书架失败，请检查网络后重试。"
        }
    }
}
