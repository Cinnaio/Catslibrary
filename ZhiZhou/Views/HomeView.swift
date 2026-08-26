import SwiftUI

/// 发现页：紧凑宽度使用单列导航，宽屏保留侧栏书单与详情列。
struct HomeView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var novels: [Novel] = []
    @State private var categories: [String] = []
    @State private var selectedCategory: String?
    @State private var selectedNovel: Novel?
    @State private var search = ""
    @State private var page = 1
    @State private var totalPages = 1
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var loadMoreError: String?
    @State private var reloadTask: Task<Void, Never>?
    /// 请求序号：丢弃过期响应（搜索/分类竞态守卫）
    @State private var requestSeq = 0

    var body: some View {
        if horizontalSizeClass == .compact {
            NavigationStack {
                homeList
                    .navigationDestination(item: $selectedNovel) { novel in
                        NovelDetailView(novel: novel)
                    }
            }
        } else {
            NavigationSplitView {
                homeList
                    .navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 520)
            } detail: {
                NavigationStack {
                    if let selectedNovel {
                        NovelDetailView(novel: selectedNovel)
                    } else {
                        ContentUnavailableView(
                            "选择一本书",
                            systemImage: "book.closed",
                            description: Text("从书单打开详情，或到书架接着读")
                        )
                    }
                }
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    private var homeList: some View {
        List(selection: $selectedNovel) {
            Text("书海里，遇见好故事")
                .font(serifFont(.title2, .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 18, leading: 16, bottom: 8, trailing: 16))

            searchField
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))

            categoryChips
                .padding(.vertical, 2)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 10, trailing: 16))

            if isLoading && novels.isEmpty {
                ProgressView("加载中…")
                    .frame(maxWidth: .infinity, minHeight: 200)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
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
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            } else if novels.isEmpty {
                emptyState
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(novels) { novel in
                    Button {
                        selectedNovel = novel
                    } label: {
                        NovelCardView(novel: novel)
                    }
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
                    .tag(novel)
                    .contentShape(Rectangle())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
                    .onAppear {
                        if novel.id == novels.last?.id { loadMoreIfNeeded() }
                    }
                }
                if isLoadingMore {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                } else if let loadMoreError {
                    Button(loadMoreError) { loadMoreIfNeeded() }
                        .font(.footnote)
                        .foregroundStyle(AppTheme.danger)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("知舟")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isLoading && !novels.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView()
                        .tint(AppTheme.primary)
                        .accessibilityLabel("正在搜索")
                }
            }
        }
        .refreshable { await reload() }
        .task { await reload() }
        .onChange(of: search) { _, _ in
            scheduleReload()
        }
        .onChange(of: selectedCategory) { _, _ in
            scheduleReload()
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AppTheme.textSecondary)
            TextField("搜索书名 / 作者", text: $search)
                .textFieldStyle(.plain)
                .foregroundStyle(AppTheme.textPrimary)
                .tint(AppTheme.primary)
            if !search.isEmpty {
                Button {
                    search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.textMuted)
                }
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(Color(.secondarySystemFill), in: Capsule())
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
            selectedCategory = value
        } label: {
            Text(label)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .foregroundStyle(selected ? Color.white : AppTheme.textSecondary)
                .background(selected ? AppTheme.primary : AppTheme.surface, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(selected ? Color.clear : AppTheme.border, lineWidth: 1)
                )
        }
        .buttonStyle(ScaleButtonStyle())
        .contentShape(Capsule())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
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
        page = 1
        loadMoreError = nil
        await fetchPage(1, append: false)
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
            }
            page = r.page
            totalPages = r.totalPages
            errorMessage = nil
            loadMoreError = nil
            await CoverPrefetcher.shared.prefetch(r.novels)
        } catch {
            guard seq == requestSeq else { return }
            let message = AppCopy.friendlyError(error)
            if append || !novels.isEmpty {
                loadMoreError = "加载失败，点按重试"
            } else {
                errorMessage = message
            }
        }
    }

    static func query(_ params: [String: String]) -> String {
        params.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value)"
        }
        .joined(separator: "&")
    }
}
