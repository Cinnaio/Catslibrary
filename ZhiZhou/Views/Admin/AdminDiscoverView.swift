import SwiftUI
import Combine

/// 爬虫「发现」：PO18 / POPO 搜索（书名/作者）+ 榜单浏览 + 详情建书启动 + 批量抓取。
/// 对齐 Web 端 admin scrape DiscoverView（/api/scrape action=discover / po18-search / popo-search）。
struct AdminDiscoverView: View {
    enum SearchMode: String, CaseIterable, Identifiable {
        case search = "站内搜索"
        case list = "榜单浏览"
        var id: String { rawValue }
    }

    // 搜索
    @State private var mode: SearchMode = .search
    @State private var searchSource: DiscoverSource = .po18
    @State private var query = ""
    @State private var searchType = "articlename"
    @State private var listUrl = ""
    @State private var sitePresetLabel = ""

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

    // 通用
    @State private var actionError: String?

    var body: some View {
        List {
            toolbarSection
            resultsSection
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        // Liquid Glass 标签栏会悬浮在内容上方，给最后一条结果保留可见的滚动终点。
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: 16)
        }
        .navigationTitle("发现小说")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await reloadCurrent() }
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
        Section {
            Picker("模式", selection: $mode) {
                ForEach(SearchMode.allCases) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .onChange(of: mode) { _, _ in
                novels = []
                totalText = nil
                errorMessage = nil
            }

            if mode == .search {
                AdminFilterBar {
                    AdminFilterMenu("来源", value: searchSource.displayName) {
                        Picker("来源", selection: $searchSource) {
                            ForEach(DiscoverSource.allCases) { source in
                                Text(source.displayName).tag(source)
                            }
                        }
                    }
                    AdminFilterMenu(
                        "查找",
                        value: searchType == "author" ? "作者" : "书名"
                    ) {
                        Picker("搜索类型", selection: $searchType) {
                            Text("书名").tag("articlename")
                            Text("作者").tag("author")
                        }
                    }
                }
                .onChange(of: searchSource) { _, _ in
                    novels = []
                    totalText = nil
                    errorMessage = nil
                }
                searchInputRow
            } else {
                AdminFilterBar {
                    AdminFilterMenu(
                        "榜单",
                        value: sitePresetLabel.isEmpty ? "选择来源榜单" : sitePresetLabel
                    ) {
                        Section("PO18 · po18x.vip") {
                            ForEach(DiscoverRankingPreset.allCases.filter { $0.source == .po18 }) { preset in
                                Button(preset.label) {
                                    selectRankingPreset(preset)
                                }
                            }
                        }
                        Section("POPO · po18.tw") {
                            ForEach(DiscoverRankingPreset.allCases.filter { $0.source == .popo }) { preset in
                                Button(preset.label) {
                                    selectRankingPreset(preset)
                                }
                            }
                        }
                    }
                }
                rankingInputRow
            }
        } header: {
            Text(mode == .search ? "按书名或作者搜索外部书源" : "从站点榜单批量发现小说")
        }
    }

    private var searchInputRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AppTheme.textSecondary)
            TextField("搜索书名 / 作者", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.plain)
                .submitLabel(.search)
                .onSubmit { Task { await fetchSearch() } }
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除搜索")
            }
            Button {
                Task { await fetchSearch() }
            } label: {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "magnifyingglass")
                }
            }
            .frame(width: 44, height: 44)
            .background(AppTheme.primary, in: Circle())
            .foregroundStyle(.white)
            .buttonStyle(.plain)
            .disabled(isLoading || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("搜索 \(searchSource.displayName)")
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 52)
        .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var rankingInputRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "link")
                .foregroundStyle(AppTheme.textSecondary)
            TextField("粘贴榜单页面 URL", text: $listUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.plain)
            Button {
                Task { await fetchDiscoverList() }
            } label: {
                if isLoading {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .frame(width: 44, height: 44)
            .background(AppTheme.primary, in: Circle())
            .foregroundStyle(.white)
            .buttonStyle(.plain)
            .disabled(isLoading || listUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("获取榜单")
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 52)
        .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    // MARK: - 结果区

    @ViewBuilder
    private var resultsSection: some View {
        if let errorMessage {
            Section {
                ContentUnavailableView {
                    Label("没有结果", systemImage: "magnifyingglass")
                } description: {
                    Text(errorMessage)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        } else if let totalText, novels.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("没有结果", systemImage: "tray")
                } description: {
                    Text(totalText)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        } else if !novels.isEmpty {
            if !selectedIndices.isEmpty {
                Section {
                    HStack {
                        Text("已选 \(selectedIndices.count) 本")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                        Spacer()
                        Button("全选/反选") { toggleAll() }
                            .font(.subheadline)
                        Button {
                            Task { await batchScrape() }
                        } label: {
                            if let batch, !batch.done {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("抓取选中", systemImage: "play.fill")
                            }
                        }
                        .font(.subheadline)
                        .disabled(batch?.done == false)
                    }
                    .listRowBackground(Color.clear)
                }
            }
            Section("找到 \(novels.count) 本\(totalText.map { " · \($0)" } ?? "")") {
                ForEach(Array(novels.enumerated()), id: \.element.id) { index, novel in
                    discoverRow(novel, index: index)
                }
            }
            if page < totalPages && (mode == .search || !listUrlRef.isEmpty) {
                Button {
                    Task { await goNextPage() }
                } label: {
                    HStack {
                        Spacer()
                        Text("下一页（\(page)/\(totalPages)）")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.primary)
                        Spacer()
                    }
                }
                .listRowBackground(Color.clear)
            }
        } else {
            Section {
                ContentUnavailableView {
                    Label("发现小说", systemImage: "scope")
                } description: {
                    Text(mode == .search ? "选择 PO18 或 POPO 搜索，或切到「榜单浏览」选择来源榜单。" : "选择来源榜单，或粘贴榜单 URL。")
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .frame(maxWidth: .infinity, minHeight: 220)
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
                    .foregroundStyle(selectedIndices.contains(index) ? AppTheme.primary : AppTheme.textMuted)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .padding(.top, 14)
            .accessibilityLabel(selectedIndices.contains(index) ? "取消选择\(novel.title)" : "选择\(novel.title)")
            .accessibilityValue(selectedIndices.contains(index) ? "已选择" : "未选择")
            Button {
                Task { await openDetail(novel) }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    coverThumb(novel)
                    discoverInfo(novel)
                    Spacer(minLength: 0)
                }
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
                .font(.body.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Text("\(novel.author?.isEmpty == false ? novel.author! : "佚名")\(novel.chapterCount.map { " · \($0) 章" } ?? "")")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(1)

            HStack(spacing: 6) {
                if let source = sourceForNovel(novel) {
                    AdminStatusBadge(
                        source.displayName,
                        tint: source == .popo ? AppTheme.warning : AppTheme.primary,
                        systemImage: "globe"
                    )
                }
                if novel.isCollected {
                    AdminStatusBadge("已收录", tint: AppTheme.success, systemImage: "checkmark")
                }
            }
            .fixedSize(horizontal: true, vertical: false)

            if let desc = novel.description, !desc.isEmpty {
                Text(desc)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func coverThumb(_ novel: DiscoverNovel) -> some View {
        let size = CGSize(width: 60, height: 80)
        if let url = novel.coverUrl, !url.isEmpty, let remote = URL(string: url) {
            CachedAsyncImage(url: remote, targetSize: size) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                coverPlaceholder
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        } else {
            coverPlaceholder
        }
    }

    private var coverPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(AppTheme.surface.opacity(0.6))
            Image(systemName: "book")
                .foregroundStyle(AppTheme.textMuted)
        }
        .frame(width: 60, height: 80)
    }

    // MARK: - 数据

    private func fetchSearch() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        listUrlRef = ""
        page = 1
        totalPages = 1
        await renderDiscover {
            try await searchDiscover(query: q, page: 1)
        }
    }

    private func searchDiscover(query: String, page: Int) async throws -> DiscoverResponse {
        if searchSource == .popo {
            let type = searchType == "author" ? "author" : "book"
            return try await AdminAPI.scrapePopoSearch(query: query, searchType: type, page: page)
        }
        return try await AdminAPI.scrapePo18Search(query: query, searchType: searchType, page: page)
    }

    private func fetchDiscoverList() async {
        let u = listUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        listUrlRef = u
        page = 1
        totalPages = 1
        await renderDiscover {
            try await AdminAPI.scrapeDiscover(listUrl: u)
        }
    }

    private func goNextPage() async {
        let next = page + 1
        if mode == .search {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !q.isEmpty else { return }
            page = next
            await renderDiscover {
                try await searchDiscover(query: q, page: next)
            }
            return
        }
        guard !listUrlRef.isEmpty else { return }
        // 榜单 URL 形如 .../top/xxx_1/，翻页把页码段替换为下一页
        let replaced = listUrlRef.replacingOccurrences(
            of: #"_([0-9]+)/$"#,
            with: "_\(next)/",
            options: .regularExpression
        )
        listUrlRef = replaced
        listUrl = replaced
        page = next
        await renderDiscover {
            try await AdminAPI.scrapeDiscover(listUrl: replaced)
        }
    }

    private func renderDiscover(_ operation: () async throws -> DiscoverResponse) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let r = try await operation()
            novels = r.novels
            selectedIndices = []
            let sourceText = displaySourceLabel(r.site) ?? r.novels.compactMap { sourceForNovel($0)?.displayName }.first
            if r.novels.isEmpty {
                totalText = sourceText.map { "来源：\($0)" } ?? "没有找到小说"
            } else {
                totalText = sourceText.map { "来源：\($0)" }
            }
            if let tp = r.totalPages, tp > 1 { totalPages = tp }
            errorMessage = nil
        } catch {
            novels = []
            totalText = nil
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func reloadCurrent() async {
        if mode == .search, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            await fetchSearch()
        } else if !listUrlRef.isEmpty {
            await fetchDiscoverList()
        }
    }

    private func selectRankingPreset(_ preset: DiscoverRankingPreset) {
        sitePresetLabel = preset.label
        listUrl = preset.url
        Task { await fetchDiscoverList() }
    }

    private func sourceForNovel(_ novel: DiscoverNovel) -> DiscoverSource? {
        if novel.source == "po18tw" || novel.sourceName == "POPO" { return .popo }
        if novel.source == "po18" || novel.sourceName == "PO18" { return .po18 }
        guard let host = URL(string: novel.url)?.host?.lowercased() else { return nil }
        if host == "po18.tw" || host.hasSuffix(".po18.tw") { return .popo }
        if host == "po18x.vip" || host.hasSuffix(".po18x.vip") { return .po18 }
        return nil
    }

    private func displaySourceLabel(_ site: String?) -> String? {
        guard let site, !site.isEmpty else { return nil }
        let normalized = site.lowercased()
        if normalized.contains("po18.tw") || normalized.contains("popo") || normalized == "po18tw" {
            return "POPO（po18.tw）"
        }
        if normalized.contains("po18") || normalized == "po18x" {
            return "PO18（po18x.vip）"
        }
        return site
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
        let indices = selectedIndices.sorted()
        guard !indices.isEmpty else { return }
        let state = BatchState(title: "批量抓取", total: indices.count)
        batch = state
        for index in indices {
            guard index < novels.count else { continue }
            let novel = novels[index]
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

private enum DiscoverSource: String, CaseIterable, Identifiable {
    case po18
    case popo

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .po18: return "PO18"
        case .popo: return "POPO"
        }
    }
}

private enum DiscoverRankingPreset: String, CaseIterable, Identifiable {
    case po18DayVisit = "日点击榜"
    case po18WeekVisit = "周点击榜"
    case po18MonthVisit = "月点击榜"
    case po18AllVisit = "总点击榜"
    case po18DayVote = "日推荐榜"
    case po18WeekVote = "周推荐榜"
    case po18MonthVote = "月推荐榜"
    case po18AllVote = "总推荐榜"
    case po18GoodNum = "总收藏榜"
    case po18Size = "字数排行"
    case po18Postdate = "最新入库"
    case po18Lastupdate = "最近更新"
    case popoRank = "综合排行榜"

    var id: String { rawValue }

    var source: DiscoverSource {
        self == .popoRank ? .popo : .po18
    }

    var label: String {
        "\(source.displayName) · \(rawValue)"
    }

    var url: String {
        switch self {
        case .po18DayVisit: return "https://wap.po18x.vip/top/dayvisit_1/"
        case .po18WeekVisit: return "https://wap.po18x.vip/top/weekvisit_1/"
        case .po18MonthVisit: return "https://wap.po18x.vip/top/monthvisit_1/"
        case .po18AllVisit: return "https://wap.po18x.vip/top/allvisit_1/"
        case .po18DayVote: return "https://wap.po18x.vip/top/dayvote_1/"
        case .po18WeekVote: return "https://wap.po18x.vip/top/weekvote_1/"
        case .po18MonthVote: return "https://wap.po18x.vip/top/monthvote_1/"
        case .po18AllVote: return "https://wap.po18x.vip/top/allvote_1/"
        case .po18GoodNum: return "https://wap.po18x.vip/top/goodnum_1/"
        case .po18Size: return "https://wap.po18x.vip/top/size_1/"
        case .po18Postdate: return "https://wap.po18x.vip/top/postdate_1/"
        case .po18Lastupdate: return "https://wap.po18x.vip/top/lastupdate_1/"
        case .popoRank: return "https://www.po18.tw/rank/index"
        }
    }
}

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

private struct DiscoverDetailSheet: View {
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
    @State private var editTitle = ""
    @State private var editAuthor = ""
    @State private var editCategories = ""
    @State private var editStatus = "ongoing"

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    Section {
                        ProgressView("正在翻阅书籍资料…")
                            .frame(maxWidth: .infinity, minHeight: 140)
                            .listRowBackground(Color.clear)
                    }
                } else if let error {
                    Section {
                        ContentUnavailableView {
                            Label("获取详情失败", systemImage: "wifi.slash")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("重试") { Task { await loadDetail() } }
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else if let meta {
                    Section("书籍信息") {
                        TextField("书名", text: $editTitle)
                        TextField("作者", text: $editAuthor)
                        TextField("分类（顿号或逗号分隔）", text: $editCategories)
                        Picker("状态", selection: $editStatus) {
                            Text("连载中").tag("ongoing")
                            Text("已完结").tag("completed")
                        }
                        .pickerStyle(.menu)
                        if let desc = meta.novel?.description, !desc.isEmpty {
                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    if let chapters, !chapters.isEmpty {
                        Section("章节目录（共 \(chapterCount ?? chapters.count) 章）") {
                            ForEach(Array(chapters.prefix(20).enumerated()), id: \.offset) { index, link in
                                HStack(spacing: 8) {
                                    Text("\(index + 1)")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textMuted)
                                        .frame(width: 26, alignment: .center)
                                    Text(link.text ?? link.href ?? "—")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .lineLimit(1)
                                }
                            }
                            if chapters.count > 20 {
                                Text("等共 \(chapters.count) 章…")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textMuted)
                            }
                        }
                    } else if let count = chapterCount, count > 0 {
                        Section("章节目录") {
                            Text("章节数：\(count)")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    if scraping {
                        Section {
                            ProgressView("正在创建小说并启动抓取…")
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .listRowBackground(Color.clear)
                        }
                    } else {
                        Section {
                            Button {
                                Task { await startScrape(meta: meta) }
                            } label: {
                                Label(item.isCollected ? "重新抓取" : "创建小说并启动抓取", systemImage: "play.fill")
                            }
                        } footer: {
                            Text("将使用检测到的选择器创建小说并启动后台抓取任务。")
                        }
                    }
                    if let actionError {
                        Section {
                            Text(actionError)
                                .font(.caption)
                                .foregroundStyle(AppTheme.danger)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle(item.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onClose(false) }
                }
            }
        }
        .presentationDetents([.large])
        .task {
            if autoStart {
                await autoScrape()
            } else {
                await loadDetail()
            }
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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("共", value: "\(state.total) 本")
                    LabeledContent("成功", value: "\(state.success)")
                    LabeledContent("失败", value: "\(state.fail)")
                } header: {
                    Text("进度\(state.done ? "（完成）" : "（进行中）")")
                }
                Section("明细") {
                    ForEach(state.entries) { entry in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: icon(for: entry.type))
                                .font(.caption)
                                .foregroundStyle(color(for: entry.type))
                                .frame(width: 18)
                            Text(entry.text)
                                .font(.caption)
                                .foregroundStyle(AppTheme.textPrimary)
                                .lineLimit(2)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle(state.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
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
