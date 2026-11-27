import SwiftUI
import Combine
import ZhiZhouCore

struct AdminDiscoverView: View {
    enum SearchMode: String, CaseIterable, Identifiable {
        case search = "站内搜索"
        case list = "榜单浏览"
        var id: String { rawValue }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case search, ranking }

    // 搜索
    @State private var mode: SearchMode = .list
    @State private var sources: [ScrapeSourceCapability] = []
    @State private var isLoadingCapabilities = false
    @State private var hasLoadedCapabilities = false
    @State private var capabilityError: String?
    @State private var searchSourceId = ""
    private var searchSources: [ScrapeSourceCapability] { sources.filter(\.search) }
    private var searchSource: ScrapeSourceCapability? {
        searchSources.first { $0.id == searchSourceId } ?? searchSources.first
    }
    @State private var query = ""
    @State private var searchType = "articlename"
    @State private var listUrl = ""
    @State private var selectedRanking: ScrapeSourceRanking?
    @State private var hasEditedRankingURL = false

    // 结果
    @State private var novels: [DiscoverNovel] = []
    @State private var totalText: String?
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var selectedIndices = Set<Int>()
    @State private var page = 1
    @State private var totalPages = 1
    @State private var listUrlRef = ""

    // 详情
    @State private var detailItem: DiscoverNovel?
    @State private var detailAutoStart = false
    // 批量
    @State private var batch: BatchState?
    @State private var activeBatch: BatchState?

    // 通用
    @State private var actionError: String?
    @State private var requests = ListRequestGuard<[String]>()

    private var rankingSources: [ScrapeSourceCapability] { sources.filter { !$0.rankings.isEmpty } }
    private var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var rankingURL: String { listUrl.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var requestQuery: [String] {
        switch mode {
        case .search: return [mode.rawValue, searchSource?.id ?? "", searchTerm, searchType]
        case .list: return [mode.rawValue, rankingURL, selectedRanking?.id ?? ""]
        }
    }

    private var nextRankingURL: String? {
        guard !listUrlRef.isEmpty, selectedRanking?.rankingKind == nil, selectedRanking?.rankingType == nil else { return nil }
        let nextURL = listUrlRef.replacingOccurrences(
            of: #"_([0-9]+)/$"#, with: "_\(page + 1)/", options: .regularExpression
        )
        return nextURL == listUrlRef ? nil : nextURL
    }

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("发现小说")
            toolbarSection
            resultsSection
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = nil }
            }
        }
        .refreshable { await refreshAvailableSources(reloadResults: true) }
        .task { await refreshAvailableSources() }
        .onChange(of: mode) { _, selected in
            focusedField = nil
            resetDiscoveryResults()
            if selected == .list {
                Task { await openRanking() }
            }
        }
        .onChange(of: searchSourceId) { _, _ in
            if mode == .search { resetDiscoveryResults() }
        }
        .onChange(of: searchType) { _, _ in
            if mode == .search { resetDiscoveryResults() }
        }
        .sheet(item: $detailItem) { item in
            DiscoverDetailSheet(item: item, autoStart: detailAutoStart) { refresh in
                detailItem = nil
                detailAutoStart = false
                if refresh { Task { await reloadCurrent() } }
            }
        }
        .sheet(item: $batch) { state in
            BatchProgressSheet(state: state)
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 搜索区

    private var toolbarSection: some View {
        AdminWorkspaceSection(mode == .search ? "搜索书源" : "浏览榜单") {
            if !searchSources.isEmpty {
                Picker("模式", selection: $mode) {
                    ForEach(SearchMode.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .accessibleSegmentedPicker()
            }

            if let capabilityError {
                LoadErrorNotice(message: capabilityError, isLoading: isLoadingCapabilities) {
                    Task { await refreshAvailableSources() }
                }
            } else if !hasLoadedCapabilities || (isLoadingCapabilities && sources.isEmpty) {
                AppLoadingState("正在读取书源…", placement: .inline)
            }

            if mode == .search {
                Picker("来源", selection: $searchSourceId) {
                    ForEach(searchSources) { source in
                        Text(source.name).tag(source.id)
                    }
                }
                .pickerStyle(.menu)
                Picker("查找方式", selection: $searchType) {
                    Text("书名").tag("articlename")
                    Text("作者").tag("author")
                }
                .pickerStyle(.menu)
                searchInputRow
            } else {
                if !rankingSources.isEmpty {
                    rankingMenu
                } else if hasLoadedCapabilities && capabilityError == nil {
                    Text("当前服务器未提供预设榜单。可粘贴榜单页面 URL 继续。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                rankingInputRow
            }
        }
    }

    private var rankingMenu: some View {
        Menu {
            ForEach(rankingSources) { source in
                Section(source.name) {
                    ForEach(source.rankings) { ranking in
                        Button {
                            selectRankingPreset(ranking)
                        } label: {
                            if ranking.id == selectedRanking?.id {
                                Label(ranking.label, systemImage: "checkmark")
                            } else {
                                Text(ranking.label)
                            }
                        }
                    }
                }
            }
        } label: {
            LabeledContent("来源榜单") {
                Text(selectedRanking?.label ?? "选择榜单")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        .accessibilityIdentifier("admin.discover.ranking")
    }

    private var searchInputRow: some View {
        AccountSettingsField("搜索书名或作者", isFocused: focusedField == .search) {
            HStack(spacing: 8) {
                TextField("搜索书名或作者", text: Binding(get: { query }, set: { value in
                    guard query != value else { return }
                    query = value
                    resetDiscoveryResults()
                }))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: .search)
                .submitLabel(.search)
                .onSubmit { submitSearch() }

                Button(action: submitSearch) {
                    Label("搜索书源", systemImage: "magnifyingglass")
                        .labelStyle(.iconOnly)
                        .frame(width: AppLayout.minimumTouchTarget, height: AppLayout.minimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .disabled(isLoading || searchTerm.isEmpty || searchSource == nil)
            }
        }
    }

    private var rankingInputRow: some View {
        AccountSettingsField("榜单地址", isFocused: focusedField == .ranking) {
            HStack(spacing: 8) {
                TextField("粘贴榜单页面 URL", text: Binding(get: { listUrl }, set: { value in
                    guard listUrl != value else { return }
                    listUrl = value
                    selectedRanking = nil
                    hasEditedRankingURL = true
                    resetDiscoveryResults()
                }))
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: .ranking)
                .submitLabel(.go)
                .onSubmit { submitRanking() }

                Button(action: submitRanking) {
                    Label("获取榜单", systemImage: "arrow.clockwise")
                        .labelStyle(.iconOnly)
                        .frame(width: AppLayout.minimumTouchTarget, height: AppLayout.minimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .disabled(isLoading || rankingURL.isEmpty)
            }
        }
    }

    private func submitSearch() {
        focusedField = nil
        Task { await fetchSearch() }
    }

    private func submitRanking() {
        focusedField = nil
        Task { await fetchDiscoverList() }
    }

    // MARK: - 结果区

    @ViewBuilder
    private var resultsSection: some View {
        if isLoading {
            AppLoadingState(mode == .list ? "正在读取榜单…" : "正在搜索书源…", placement: .inline)
        }
        if let errorMessage {
            LoadErrorNotice(
                message: mode == .list ? "无法读取榜单：\(errorMessage)" : "搜索失败：\(errorMessage)",
                isLoading: isLoading
            ) {
                Task { await reloadCurrent() }
            }
        }
        if let activeBatch {
            Button("查看批量进度", systemImage: "list.bullet.rectangle") { batch = activeBatch }
                .buttonStyle(.borderless)
                .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        }
        if let totalText, novels.isEmpty && !isLoading && errorMessage == nil {
            ContentUnavailableView("没有结果", systemImage: "tray", description: Text(totalText))
        } else if !novels.isEmpty {
            if !selectedIndices.isEmpty {
                AppAdaptiveRow(spacing: 12) {
                    Text("已选 \(selectedIndices.count) 本")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Spacer(minLength: 8)
                    Button("全选/反选") { toggleAll() }
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                    Button {
                        Task { await batchScrape() }
                    } label: {
                        Label("抓取选中", systemImage: "play.fill")
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                    .disabled(activeBatch != nil)
                }
                .buttonStyle(.borderless)
                .disabled(isLoading)
            }
            AdminWorkspaceSection("找到 \(novels.count) 本") {
                if let totalText { AccountSettingsNote(totalText) }
                ForEach(Array(novels.enumerated()), id: \.element.id) { index, novel in
                    discoverRow(novel, index: index)
                        .readingSpaceEntrance(index)
                        .transition(reduceMotion ? .identity : .opacity)
                }
            }
            .opacity(isLoading ? 0.45 : 1)
            .disabled(isLoading)

            if page < totalPages && (mode == .search || nextRankingURL != nil) {
                Button {
                    Task { await goNextPage() }
                } label: {
                    Text("下一页（\(page)/\(totalPages)）")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.borderless)
                .disabled(isLoading)
            }
        }
    }

    private func discoverRow(_ novel: DiscoverNovel, index: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                toggleSelect(index)
            } label: {
                Image(systemName: selectedIndices.contains(index) ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selectedIndices.contains(index) ? AppTheme.primary : AppTheme.textSecondary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .padding(.top, 14)
            .accessibilityLabel(selectedIndices.contains(index) ? "取消选择\(novel.title)" : "选择\(novel.title)")
            .accessibilityValue(selectedIndices.contains(index) ? "已选择" : "未选择")
            .accessibilityAddTraits(selectedIndices.contains(index) ? .isSelected : [])
            Button {
                Task { await openDetail(novel) }
            } label: {
                let layout = dynamicTypeSize >= .xxxLarge
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
                layout {
                    coverThumb(novel)
                    discoverInfo(novel)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("查看\(novel.title)")
            .accessibilityHint("打开作品详情")
            Menu {
                Button("查看详情") { Task { await openDetail(novel) } }
                Button("抓取这本") { Task { await scrapeSingle(novel) } }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body.weight(.medium))
                    .foregroundStyle(AppTheme.primary)
                    .frame(width: 44, height: 44)
            }
            .padding(.top, 14)
            .accessibilityLabel("作品操作")
        }
        // 让每条结果有明确的上下呼吸空间，避免封面、文字和操作按钮挤成一条线。
        .padding(.vertical, 10)
        .contextMenu {
            Button("查看详情") { Task { await openDetail(novel) } }
            Button("抓取这本") { Task { await scrapeSingle(novel) } }
        }
    }

    private func discoverInfo(_ novel: DiscoverNovel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(novel.title)
                .font(serifFont(.body, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .appTextLineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Text("\(novel.author?.isEmpty == false ? novel.author! : "佚名")\(novel.chapterCount.map { " · \($0) 章" } ?? "")")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .appTextLineLimit(1)

            if let source = novel.sourceName ?? novel.source {
                Text(source)
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if novel.isCollected {
                AdminStatusBadge("已收录", tint: AppTheme.success, systemImage: "checkmark")
            }

            if let desc = novel.description, !desc.isEmpty {
                Text(desc)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func coverThumb(_ novel: DiscoverNovel) -> some View {
        let size = AppLayout.coverDiscoverThumbnail
        if let url = novel.coverUrl, !url.isEmpty, let remote = URL(string: url) {
            CachedAsyncImage(url: remote, targetSize: size) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                coverPlaceholder
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius))
        } else {
            coverPlaceholder
        }
    }

    private var coverPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                .fill(AppTheme.surface.opacity(0.6))
            Image(systemName: "book")
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(width: AppLayout.coverDiscoverThumbnail.width, height: AppLayout.coverDiscoverThumbnail.height)
    }

    // MARK: - 数据

    private func refreshAvailableSources(reloadResults: Bool = false) async {
        guard !isLoadingCapabilities else { return }
        let token = APIClient.shared.token
        await loadCapabilities()
        guard !Task.isCancelled, APIClient.shared.token == token else { return }

        if mode == .list && rankingURL.isEmpty && !hasEditedRankingURL {
            await openRanking()
        } else if reloadResults {
            await reloadCurrent()
        }
    }

    private func loadCapabilities() async {
        let token = APIClient.shared.token
        isLoadingCapabilities = true
        defer { isLoadingCapabilities = false }

        do {
            let capabilities = try await AdminAPI.scrapeSourceCapabilities()
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            sources = capabilities.sources
            hasLoadedCapabilities = true
            capabilityError = nil
            if !searchSources.contains(where: { $0.id == searchSourceId }) {
                searchSourceId = searchSources.first?.id ?? ""
            }
            if let selectedRanking, !rankingSources.contains(where: { source in
                source.rankings.contains { $0.id == selectedRanking.id }
            }) {
                self.selectedRanking = nil
                listUrl = ""
                if mode == .list { resetDiscoveryResults() }
            }
            if searchSources.isEmpty && mode == .search { mode = .list }
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            capabilityError = "无法读取书源：\(AppCopy.friendlyError(error))"
        }
    }

    private func openRanking() async {
        guard mode == .list else { return }
        if rankingURL.isEmpty, !hasEditedRankingURL, let first = rankingSources.first?.rankings.first {
            applyRankingPreset(first)
        }
        await fetchDiscoverList()
    }

    private func fetchSearch(page targetPage: Int = 1) async {
        let term = searchTerm
        let type = searchType
        guard mode == .search, !term.isEmpty, let source = searchSource, !isLoading else { return }
        await renderDiscover(page: targetPage) {
            try await AdminAPI.scrapeSourceSearch(sourceId: source.id, query: term, searchType: type, page: targetPage)
        }
    }

    private func fetchDiscoverList(page targetPage: Int = 1, url: String? = nil) async {
        let targetURL = url ?? rankingURL
        let preset = selectedRanking
        guard mode == .list, !targetURL.isEmpty, !isLoading else { return }
        await renderDiscover(page: targetPage, listPageURL: targetURL) {
            try await AdminAPI.scrapeDiscover(listUrl: targetURL, rankingKind: preset?.rankingKind, rankingType: preset?.rankingType)
        }
    }

    private func goNextPage() async {
        guard page < totalPages else { return }
        if mode == .search {
            await fetchSearch(page: page + 1)
        } else if let nextRankingURL {
            await fetchDiscoverList(page: page + 1, url: nextRankingURL)
        }
    }

    private func renderDiscover(
        page targetPage: Int, listPageURL: String? = nil, operation: () async throws -> DiscoverResponse
    ) async {
        let ticket = requests.begin(requestQuery)
        let token = APIClient.shared.token
        isLoading = true
        errorMessage = nil
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            let result = try await operation()
            guard !Task.isCancelled, APIClient.shared.token == token, requests.accepts(ticket, query: requestQuery) else { return }
            let source = (result.site ?? result.novels.compactMap(\.sourceName).first)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let sourceText: String? = source.flatMap { $0.isEmpty ? nil : "来源：\($0)" }
            withAnimation(reduceMotion ? nil : AppMotion.micro) {
                novels = result.novels
                selectedIndices = []
                page = targetPage
                totalPages = max(1, result.totalPages ?? 1)
                listUrlRef = listPageURL ?? ""
                if novels.isEmpty {
                    let empty = listPageURL == nil ? "没有找到匹配的小说。" : "这个榜单没有返回小说。"
                    totalText = sourceText.map { "\(empty)\n\($0)" } ?? empty
                } else {
                    totalText = sourceText
                }
            }
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token, requests.accepts(ticket, query: requestQuery) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func reloadCurrent() async {
        if mode == .search {
            await fetchSearch()
        } else {
            await fetchDiscoverList()
        }
    }

    private func selectRankingPreset(_ preset: ScrapeSourceRanking) {
        applyRankingPreset(preset)
        Task { await fetchDiscoverList() }
    }

    private func applyRankingPreset(_ preset: ScrapeSourceRanking) {
        selectedRanking = preset
        listUrl = preset.listUrl
        hasEditedRankingURL = false
        resetDiscoveryResults()
    }

    private func resetDiscoveryResults() {
        // Invalidate the in-flight generation even if the user returns to the same query.
        let cancelled = requests.begin(requestQuery)
        requests.finish(cancelled)
        isLoading = false
        novels = []
        selectedIndices = []
        totalText = nil
        errorMessage = nil
        page = 1
        totalPages = 1
        listUrlRef = ""
    }

    // MARK: - 选择 / 批量

    private func toggleSelect(_ index: Int) {
        if selectedIndices.contains(index) {
            selectedIndices.remove(index)
        } else {
            selectedIndices.insert(index)
        }
    }

    private func toggleAll() {
        let all = Set(0..<novels.count)
        selectedIndices = selectedIndices == all ? [] : all
    }

    private func scrapeSingle(_ novel: DiscoverNovel) {
        detailAutoStart = true
        detailItem = novel
    }

    private func openDetail(_ novel: DiscoverNovel) {
        detailAutoStart = false
        detailItem = novel
    }

    /// 创建小说（必要时）并启动抓取任务，返回 novelId。
    private func createAndScrape(novel: DiscoverNovel, meta: ScrapeDetectedMeta) async throws -> String {
        let info = meta.novel
        let createResult: Novel = try await AdminAPI.createNovel([
            "title": info?.title ?? novel.title,
            "author": info?.author ?? novel.author ?? "佚名",
            "description": info?.description ?? "",
            "coverUrl": info?.coverUrl ?? novel.coverUrl ?? "",
            "categories": info?.categories ?? (info?.category.map { [$0] } ?? []),
            "status": info?.status ?? "ongoing",
            "sourceUrl": info?.sourceUrl ?? novel.url,
        ])
        let novelId = createResult.id
        let selectors = meta.selectors
        if let list = selectors?.chapterList, !list.isEmpty {
            _ = try await AdminAPI.scrapeStart(
                novelId: novelId,
                sourceUrl: meta.chapterListUrl ?? novel.url,
                encoding: meta.encoding ?? "",
                selectors: selectors ?? ScrapeSelectors(chapterList: nil, chapterTitle: nil, chapterContent: nil, nextPage: nil)
            )
        }
        return novelId
    }

    private func batchScrape() async {
        guard !isLoading, activeBatch == nil else { return }
        let selected = selectedIndices.sorted().compactMap { novels.indices.contains($0) ? novels[$0] : nil }
        guard !selected.isEmpty else { return }
        let state = BatchState(title: "批量抓取", total: selected.count)
        activeBatch = state
        batch = state
        for novel in selected {
            state.addEntry(BatchEntry(type: .novel, text: novel.title))
            if novel.isCollected {
                state.addEntry(BatchEntry(type: .skip, text: "已在书库中，跳过"))
            } else {
                do {
                    let meta = try await AdminAPI.scrapeDetectMeta(sourceUrl: novel.url)
                    guard meta.novel != nil else {
                        throw ScrapeError.message(meta.error ?? "检测失败")
                    }
                    _ = try await createAndScrape(novel: novel, meta: meta)
                    state.addEntry(BatchEntry(type: .ok, text: "已创建并启动抓取"))
                    state.success += 1
                } catch {
                    state.addEntry(BatchEntry(type: .err, text: AppCopy.friendlyError(error)))
                    state.fail += 1
                }
            }
        }
        state.done = true
        activeBatch = nil
        selectedIndices = []
        if state.success > 0 {
            await reloadCurrent()
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - 发现来源 / 榜单预设

// MARK: - 详情 / 批量状态

private enum BatchEntryType {
    case novel, ok, skip, err
}

private struct BatchEntry: Identifiable {
    let id = UUID()
    let type: BatchEntryType
    let text: String
}

/// 批量抓取进度：ObservableObject，父视图驱动，进度 Sheet 观察同一实例。
private final class BatchState: ObservableObject, Identifiable {
    let id = UUID()
    let title: String
    let total: Int
    @Published var entries: [BatchEntry] = []
    @Published var success = 0
    @Published var fail = 0
    @Published var done = false

    init(title: String, total: Int) {
        self.title = title
        self.total = total
    }

    func addEntry(_ entry: BatchEntry) {
        entries.append(entry)
    }
}

private enum ScrapeError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

// MARK: - 详情 Sheet（自加载：翻书 → 章节目录预览 → 建书抓取）

struct DiscoverDetailSheet: View {
    let item: DiscoverNovel
    let autoStart: Bool
    let onClose: (Bool) -> Void

    @State private var loading = true
    @State private var error: String?
    @State private var meta: ScrapeDetectedMeta?
    @State private var chapters: [ScrapeTestLink]?
    @State private var chapterCount: Int?
    @State private var scraping = false
    @State private var actionError: String?

    // 可编辑的书籍信息（在建书前允许用户修正书名/作者/分类/状态）
    @FocusState private var focusedField: String?
    @State private var editTitle = ""
    @State private var editAuthor = ""
    @State private var editCategories = ""
    @State private var editStatus = "ongoing"

    var body: some View {
        NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading(item.title, detail: item.author ?? "")
                if item.isCollected {
                    AdminStatusBadge("已收录", tint: AppTheme.success, systemImage: "checkmark")
                }
                if loading {
                    AppLoadingState("正在读取书籍资料…", placement: .inline)
                } else if let error {
                    ContentUnavailableView {
                        Label("获取详情失败", systemImage: "wifi.slash")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("重试") { Task { await loadDetail() } }
                    }
                } else if let meta {
                    bookSection(meta)
                    directorySection
                    startSection(meta)
                }
            }
            .buttonStyle(.borderless)
            .disabled(scraping)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onClose(false) }.disabled(scraping)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { focusedField = nil }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents([.large])
        .interactiveDismissDisabled(scraping)
        .task {
            if autoStart {
                await autoScrape()
            } else {
                await loadDetail()
            }
        }
    }

    private func bookSection(_ meta: ScrapeDetectedMeta) -> some View {
        AdminWorkspaceSection("书籍信息") {
            editableField("书名", placeholder: "请输入书名", text: $editTitle)
            editableField("作者", placeholder: "请输入作者", text: $editAuthor)
            editableField("分类", placeholder: "顿号或逗号分隔", text: $editCategories)
            Picker("状态", selection: $editStatus) {
                Text("连载中").tag("ongoing")
                Text("已完结").tag("completed")
            }
            .pickerStyle(.menu)
            if let desc = meta.novel?.description, !desc.isEmpty {
                DisclosureGroup("作品简介") {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .padding(.top, 8)
                }
            }
        }
    }

    @ViewBuilder
    private var directorySection: some View {
        if let chapters, !chapters.isEmpty {
            AdminWorkspaceSection("章节目录（共 \(chapterCount ?? chapters.count) 章）") {
                ForEach(Array(chapters.prefix(20).enumerated()), id: \.offset) { index, link in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .frame(minWidth: 24, alignment: .leading)
                        Text(link.text ?? link.href ?? "—")
                            .font(.subheadline)
                            .appTextLineLimit(2)
                    }
                }
                if chapters.count > 20 {
                    AccountSettingsNote("预览前 20 章，共 \(chapters.count) 章。")
                }
            }
        } else if let count = chapterCount, count > 0 {
            AdminWorkspaceSection("章节目录") {
                AccountSettingsNote("检测到 \(count) 章，暂未取得章节标题。")
            }
        }
    }

    private func startSection(_ meta: ScrapeDetectedMeta) -> some View {
        AdminWorkspaceSection("抓取作品") {
            if let actionError { AccountSettingsNote(actionError, isError: true) }
            Button {
                focusedField = nil
                Task { await startScrape(meta: meta) }
            } label: {
                HStack(spacing: 8) {
                    if scraping { ProgressView().controlSize(.small).accessibilityHidden(true) }
                    Label(item.isCollected ? "重新抓取" : "创建小说并启动抓取", systemImage: "play.fill")
                }
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true))
            .disabled(scraping)
            .accessibilityValue(scraping ? "正在处理" : "")
            AccountSettingsNote("使用检测到的配置启动后台任务。")
        }
    }

    private func editableField(_ label: String, placeholder: String, text: Binding<String>) -> some View {
        AccountSettingsField(label, isFocused: focusedField == label) {
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: label)
        }
    }

    private func loadDetail() async {
        loading = true
        error = nil
        do {
            let meta = try await AdminAPI.scrapeDetectMeta(sourceUrl: item.url)
            guard meta.novel != nil else {
                error = meta.error ?? "获取详情失败"
                loading = false
                return
            }
            self.meta = meta
            seedEditable(meta.novel)
            var preview: [ScrapeTestLink]? = nil
            var count = meta.chapterCount
            if let listUrl = meta.chapterListUrl, !listUrl.isEmpty,
               let selectors = meta.selectors?.chapterList, !selectors.isEmpty,
               let test = try? await AdminAPI.scrapeTest(
                   sourceUrl: listUrl,
                   encoding: meta.encoding ?? "",
                   selectors: meta.selectors ?? ScrapeSelectors(chapterList: nil, chapterTitle: nil, chapterContent: nil, nextPage: nil)
               ),
               let links = test.links, !links.isEmpty {
                preview = links
                count = links.count
            }
            chapters = preview
            chapterCount = count
            loading = false
        } catch let err {
            error = AppCopy.friendlyError(err)
            loading = false
        }
    }

    /// 「抓取这本」快捷路径：翻书 → 建书抓取 → 关闭。
    private func autoScrape() async {
        do {
            let meta = try await AdminAPI.scrapeDetectMeta(sourceUrl: item.url)
            guard meta.novel != nil else {
                error = meta.error ?? "获取详情失败"
                loading = false
                return
            }
            self.meta = meta
            seedEditable(meta.novel)
            loading = false
            await startScrape(meta: meta)
        } catch let err {
            error = AppCopy.friendlyError(err)
            loading = false
        }
    }

    private func startScrape(meta: ScrapeDetectedMeta) async {
        // 标题/作者不得为空；否则回退到检测值或条目标题/佚名
        let trimmedTitle = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAuthor = editAuthor.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmedTitle.isEmpty ? (meta.novel?.title ?? item.title) : trimmedTitle
        let author = trimmedAuthor.isEmpty ? (meta.novel?.author ?? item.author ?? "佚名") : trimmedAuthor
        let categories = AdminFormat.parseCategories(editCategories)
        let categoriesFinal = categories.isEmpty
            ? (meta.novel?.categories ?? (meta.novel?.category.map { [$0] } ?? []))
            : categories
        scraping = true
        actionError = nil
        do {
            let info = meta.novel
            let createResult: Novel = try await AdminAPI.createNovel([
                "title": title,
                "author": author,
                "description": info?.description ?? "",
                "coverUrl": info?.coverUrl ?? item.coverUrl ?? "",
                "categories": categoriesFinal,
                "status": editStatus,
                "sourceUrl": info?.sourceUrl ?? item.url,
            ])
            let selectors = meta.selectors
            if let list = selectors?.chapterList, !list.isEmpty {
                _ = try await AdminAPI.scrapeStart(
                    novelId: createResult.id,
                    sourceUrl: meta.chapterListUrl ?? item.url,
                    encoding: meta.encoding ?? "",
                    selectors: selectors ?? ScrapeSelectors(chapterList: nil, chapterTitle: nil, chapterContent: nil, nextPage: nil)
                )
            }
            onClose(true)
        } catch {
            actionError = AppCopy.friendlyError(error)
            scraping = false
        }
    }

    /// 用检测到的书籍信息填充可编辑字段；标题为空时回退到条目标题。
    private func seedEditable(_ info: ScrapeDetectedNovel?) {
        editTitle = (info?.title ?? item.title).trimmingCharacters(in: .whitespacesAndNewlines)
        editAuthor = (info?.author ?? "佚名").trimmingCharacters(in: .whitespacesAndNewlines)
        editCategories = (info?.categories ?? (info?.category.map { [$0] } ?? [])).joined(separator: "、")
        editStatus = info?.status == "completed" ? "completed" : "ongoing"
    }
}

// MARK: - 批量进度 Sheet

private struct BatchProgressSheet: View {
    @ObservedObject var state: BatchState
    @Environment(\.dismiss) private var dismiss

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let skipped = state.entries.filter { entry in
            if case .skip = entry.type { return true }
            return false
        }.count
        let processed = state.success + state.fail + skipped
        return NavigationStack {
            AdminWorkspaceList {
                AdminWorkspaceHeading(state.title, detail: state.done ? "已完成" : "正在处理")
                ProgressView(value: Double(processed), total: Double(max(state.total, 1))) {
                    Text("已处理 \(processed)/\(state.total) 本")
                }
                .tint(AppTheme.primary)
                AppAdaptiveRow(spacing: 12) {
                    Text("成功 \(state.success)")
                    Text("跳过 \(skipped)")
                    Text("失败 \(state.fail)")
                }
                .font(.subheadline.monospacedDigit())
                AdminWorkspaceSection("逐本结果") {
                    ForEach(Array(state.entries.enumerated()), id: \.element.id) { index, entry in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: icon(for: entry.type))
                                .font(.footnote)
                                .foregroundStyle(color(for: entry.type))
                                .frame(width: 18)
                                .accessibilityHidden(true)
                            Text(entry.text)
                                .font(entryFont(for: entry.type))
                                .foregroundStyle(ReadingSpace.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .readingSpaceEntrance(index)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(state.done ? "完成" : "关闭") { dismiss() }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
    }

    private func entryFont(for type: BatchEntryType) -> Font {
        if case .novel = type { return serifFont(.body, .medium) }
        return .footnote
    }

    private func icon(for type: BatchEntryType) -> String {
        switch type {
        case .novel: return "book"
        case .ok: return "checkmark.circle.fill"
        case .skip: return "forward.fill"
        case .err: return "xmark.octagon.fill"
        }
    }

    private func color(for type: BatchEntryType) -> Color {
        switch type {
        case .novel: return AppTheme.textSecondary
        case .ok: return AppTheme.success
        case .skip: return AppTheme.warning
        case .err: return AppTheme.danger
        }
    }
}
