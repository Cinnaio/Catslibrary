import SwiftUI
import ZhiZhouCore

struct SourceRankingResponse: Decodable {
    struct Ranking: Decodable, Identifiable {
        let id: String
        let sourceId: String
        let sourceName: String
        let label: String
        let refreshedAt: Int64?
    }

    let rankings: [Ranking]
    let selectedId: String?
    let entries: [SourceRankingEntry]

    var selected: Ranking? { rankings.first { $0.id == selectedId } }

    @MainActor
    static func load(rankingID: String? = nil) async throws -> Self {
        let query = rankingID.map { "?" + HomeView.query(["ranking": $0]) } ?? ""
        return try await APIClient.shared.getReader("/api/novels/source-rankings" + query, refresh: true)
    }
}

struct SourceRankingEntry: Decodable, Hashable, Identifiable {
    let rank: Int
    let title: String
    let author: String
    let novelId: String?
    let updatedAt: Int64?
    let sourceUrl: String?
    let description: String?
    let rankingId: String?
    let bookKey: String?

    var id: Int { rank }

    func resourcePath(_ resource: String) -> String? {
        guard let rankingId, let bookKey else { return nil }
        return "/api/novels/source-rankings/\(resource)?" + ReaderQuery.encode(["ranking": rankingId, "book": bookKey])
    }
}

struct SourceRankingsPresentation: Identifiable {
    let id = UUID()
    let rankingID: String
    let entry: SourceRankingEntry?
    let revision: UUID
}

struct SourceRankingPreview: View {
    let response: SourceRankingResponse
    let open: (SourceRankingEntry?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { open(nil) } label: {
                HStack(spacing: 10) {
                    Text("书源榜单")
                        .font(serifFont(.title3, .medium))
                        .foregroundStyle(ReadingSpace.ink)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let ranking = response.selected {
                Text("\(ranking.sourceName) · \(ranking.label)")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .padding(.bottom, 4)
            }
            ForEach(response.entries) { entry in
                Button { open(entry) } label: { SourceRankingRow(entry: entry) }
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
            }
        }
    }
}

struct SourceRankingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var path: [SourceRankingEntry]
    @State private var requestedID: String
    @State private var response: SourceRankingResponse?
    @State private var errorMessage: String?
    @State private var isLoading = true
    @State private var requestID: UUID?
    @State private var attempt = 0

    private struct Request: Equatable {
        let rankingID: String
        let attempt: Int
    }

    init(presentation: SourceRankingsPresentation) {
        _requestedID = State(initialValue: presentation.rankingID)
        _path = State(initialValue: presentation.entry.map { [$0] } ?? [])
    }

    var body: some View {
        NavigationStack(path: $path) {
            ReaderPanelPage {
                ReaderPanelHeading("书源榜单")
                if let response, !response.rankings.isEmpty {
                    rankingMenu(response.rankings)
                }
                rankingContent
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .navigationDestination(for: SourceRankingEntry.self) { entry in
                SourceRankingDetail(entry: entry) {
                    if !path.isEmpty { path.removeLast() }
                    attempt += 1
                }
            }
            .refreshable { await load() }
        }
        .task(id: Request(rankingID: requestedID, attempt: attempt)) { await load() }
    }

    private func rankingMenu(_ rankings: [SourceRankingResponse.Ranking]) -> some View {
        let sources = Dictionary(grouping: rankings, by: \.sourceId)
        let sourceIDs = rankings.map(\.sourceId).reduce(into: [String]()) { result, id in
            if !result.contains(id) { result.append(id) }
        }
        let selected = rankings.first { $0.id == requestedID }
        return Menu {
            ForEach(sourceIDs, id: \.self) { id in
                if let boards = sources[id], let source = boards.first {
                    Section(source.sourceName) {
                        ForEach(boards) { board in
                            Button {
                                requestedID = board.id
                            } label: {
                                if board.id == selected?.id {
                                    Label(board.label, systemImage: "checkmark")
                                } else {
                                    Text(board.label)
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            Label(selected.map { "\($0.sourceName) · \($0.label)" } ?? "选择书源和榜单", systemImage: "chevron.up.chevron.down")
                .font(.subheadline.weight(.medium))
                .frame(minHeight: AppLayout.minimumTouchTarget)
        }
        .accessibilityHint("切换书源或榜单")
    }

    @ViewBuilder
    private var rankingContent: some View {
        let selected = response?.selected
        let matches = requestedID == selected?.id
        if let errorMessage {
            LoadErrorNotice(message: errorMessage, isLoading: isLoading) { attempt += 1 }
        }
        if let response, !response.entries.isEmpty, let selected {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let time = selected.refreshedAt {
                    let date = Date(timeIntervalSince1970: Double(time) / 1000)
                    Text("更新于 \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .padding(.bottom, 8)
                }
                ForEach(Array(response.entries.enumerated()), id: \.element.id) { index, entry in
                    NavigationLink(value: entry) { SourceRankingRow(entry: entry) }
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
                        .readingSpaceEntrance(index)
                }
            }
            .id(selected.id)
            .opacity(matches ? 1 : 0.4)
            .disabled(!matches)
        } else if !isLoading, errorMessage == nil {
            ContentUnavailableView(
                selected?.refreshedAt == nil && selected != nil ? "榜单等待更新" : "暂无可展示的上榜作品",
                systemImage: "list.number"
            )
            .frame(maxWidth: .infinity)
        }
        if isLoading && (response?.entries.isEmpty != false || !matches) {
            ProgressView("正在读取榜单…")
                .frame(maxWidth: .infinity, minHeight: 80)
        }
    }

    private func load() async {
        let id = requestedID
        let ticket = UUID()
        requestID = ticket
        isLoading = true
        errorMessage = nil
        defer { if requestID == ticket { isLoading = false } }
        do {
            let result = try await SourceRankingResponse.load(rankingID: id)
            guard !Task.isCancelled, ticket == requestID, id == requestedID else { return }
            response = result
        } catch {
            guard !Task.isCancelled, ticket == requestID, id == requestedID else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}

private struct SourceRankingRow: View {
    let entry: SourceRankingEntry

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text("\(entry.rank)")
                .font(.footnote.weight(.semibold).monospacedDigit())
                .foregroundStyle(entry.rank <= 3 ? AppTheme.primary : ReadingSpace.profileMuted)
                .frame(minWidth: 24, alignment: .leading)
                .accessibilityLabel("第 \(entry.rank) 名")
            if let novelID = entry.novelId {
                NovelCoverView(novelID: novelID, updatedAt: entry.updatedAt ?? 0, size: CGSize(width: 34, height: 48))
            } else {
                SourceRankingCover(entry: entry, size: CGSize(width: 34, height: 48))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title)
                    .font(serifFont(.subheadline, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if !entry.author.isEmpty || entry.novelId == nil {
                    Text([entry.author, entry.novelId == nil ? "未收录" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct SourceRankingCover: View {
    let entry: SourceRankingEntry
    let size: CGSize

    private var url: URL? {
        guard ContentAccessStore.shared.mode == "adult",
              let path = entry.resourcePath("cover"), let base = ServerConfig.shared.baseURL else { return nil }
        return APIRequestURL.resolve(ContentPolicy.readerPath(path, mode: "adult"), relativeTo: base)
    }

    var body: some View {
        CachedAsyncImage(url: url, targetSize: size, showsRetry: false) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                ReadingSpace.profileFill
                Image(systemName: "book.closed")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }
}

private struct SourceRankingBookInfo: Decodable {
    struct Directory: Decodable {
        struct Chapter: Decodable {
            let title: String
            let `protected`: Bool
        }

        let count: Int
        let chapters: [Chapter]
    }

    let description: String
    let directory: Directory?
}

private struct SourceRankingDetail: View {
    let entry: SourceRankingEntry
    let didImport: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var chapterNumberWidth: CGFloat = 24
    @State private var novel: Novel?
    @State private var bookInfo: SourceRankingBookInfo?
    @State private var isLoadingInfo = false
    @State private var errorMessage: String?
    @State private var importItem: DiscoverNovel?
    @State private var attempt = 0
    @State private var showsAllChapters = false

    private enum SectionAnchor: Hashable { case synopsis, directory }

    private var description: String {
        (bookInfo?.description ?? entry.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Group {
            if let novel {
                NovelDetailView(novel: novel)
            } else if entry.novelId != nil {
                ReaderPanelPage {
                    if let errorMessage {
                        LoadErrorNotice(message: errorMessage, isLoading: false) { attempt += 1 }
                    } else {
                        ProgressView("正在打开作品…")
                    }
                }
            } else {
                uncollectedDetail
            }
        }
        .sheet(item: $importItem) { item in
            DiscoverDetailSheet(item: item, autoStart: false) { imported in
                importItem = nil
                if imported { didImport() }
            }
        }
        .task(id: attempt) { await load() }
    }

    private var uncollectedDetail: some View {
        ScrollViewReader { scroll in
            ReaderPanelPage {
                bookHeader
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoadingInfo) { attempt += 1 }
                } else if isLoadingInfo, bookInfo == nil {
                    ProgressView("正在读取源站简介和目录…")
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
                if !description.isEmpty || bookInfo != nil {
                    SourceRankingSynopsis(text: description) {
                        scroll.scrollTo(SectionAnchor.synopsis, anchor: .top)
                    }
                    .id(SectionAnchor.synopsis)
                }
                if let bookInfo {
                    directorySection(bookInfo.directory) {
                        scroll.scrollTo(SectionAnchor.directory, anchor: .top)
                    }
                    .id(SectionAnchor.directory)
                }
            }
        }
    }

    private var bookHeader: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 17))
        return layout {
            SourceRankingCover(entry: entry, size: CGSize(width: 88, height: 124))
                .shadow(color: AppTheme.cardShadow, radius: 7, y: 4)
            VStack(alignment: .leading, spacing: 8) {
                Text(entry.title)
                    .font(serifFont(.title2, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if !entry.author.isEmpty {
                    Text(entry.author)
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
                Text("未收录")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                if AppState.shared.user?.isAdmin == true,
                   ContentAccessStore.shared.mode == "adult", let url = entry.sourceUrl {
                    Button {
                        importItem = DiscoverNovel(bookId: nil, title: entry.title, author: entry.author,
                            coverUrl: nil, url: url, existing: false, description: description,
                            chapterCount: bookInfo?.directory?.count, status: nil, source: nil, sourceName: nil)
                    } label: {
                        Label("导入作品", systemImage: "square.and.arrow.down")
                            .font(.footnote.weight(.semibold))
                            .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .foregroundStyle(AppTheme.primary)
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReadingSpace.profileFill.opacity(0.55), in: RoundedRectangle(cornerRadius: 18))
    }

    private func directorySection(_ directory: SourceRankingBookInfo.Directory?, onCollapse: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            AppAdaptiveRow {
                Text("目录预览")
                    .font(serifFont(.title3, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .accessibilityAddTraits(.isHeader)
                if let directory, directory.count > 0 {
                    if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                    Text("已识别 \(directory.count) 章")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            if let directory, !directory.chapters.isEmpty {
                let visibleChapters = directory.chapters.prefix(showsAllChapters ? directory.chapters.count : 5)
                VStack(spacing: 0) {
                    ForEach(Array(visibleChapters.enumerated()), id: \.offset) { index, chapter in
                        Rectangle()
                            .fill(ReadingSpace.profileLine)
                            .frame(height: 1)
                            .accessibilityHidden(true)
                        chapterRow(chapter, number: index + 1)
                    }
                }
                if directory.chapters.count > 5 {
                    SourceRankingDisclosure(title: showsAllChapters ? "收起目录" : "查看前 \(directory.chapters.count) 章",
                                            isExpanded: showsAllChapters) {
                        withAnimation(reduceMotion ? nil : AppMotion.structural) {
                            showsAllChapters.toggle()
                            if !showsAllChapters { onCollapse() }
                        }
                    }
                }
            } else if directory == nil {
                ReaderPanelNote("暂时无法读取源站目录。")
                Button(isLoadingInfo ? "正在读取目录…" : "重试读取目录") { attempt += 1 }
                    .font(.subheadline.weight(.medium))
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                    .disabled(isLoadingInfo)
            } else {
                ReaderPanelNote("源站目录没有可显示的章节。")
            }
        }
    }

    private func chapterRow(_ chapter: SourceRankingBookInfo.Directory.Chapter, number: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(minWidth: chapterNumberWidth, alignment: .leading)
                .accessibilityLabel("第 \(number) 项")
            AppAdaptiveRow(spacing: 8) {
                Text(chapter.title.isEmpty ? "未命名章节" : chapter.title)
                    .font(serifFont(.subheadline))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if chapter.protected {
                    if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                    Label("受限", systemImage: "lock")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        errorMessage = nil
        do {
            if let id = entry.novelId {
                let response: NovelResponse = try await APIClient.shared.getReader(
                    "/api/novels/\(ReaderMediaAPI.pathSegment(id))", refresh: true
                )
                if !Task.isCancelled { novel = response.novel }
            } else if let path = entry.resourcePath("detail") {
                isLoadingInfo = true
                defer { isLoadingInfo = false }
                let response: SourceRankingBookInfo = try await APIClient.shared.getReader(path, refresh: true)
                if !Task.isCancelled { bookInfo = response }
            }
        } catch {
            if !Task.isCancelled { errorMessage = AppCopy.friendlyError(error) }
        }
    }
}

private struct SourceRankingSynopsis: View {
    let text: String
    let onCollapse: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false
    @State private var fullHeight: CGFloat = 0
    @State private var previewHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("作品简介")
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            if text.isEmpty {
                ReaderPanelNote("源站暂未提供简介。")
            } else {
                synopsisText
                    .lineLimit(isExpanded ? nil : 4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(alignment: .topLeading) {
                        if !isExpanded {
                            synopsisText
                                .fixedSize(horizontal: false, vertical: true)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
                                .hidden()
                                .accessibilityHidden(true)
                        }
                    }
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        if !isExpanded { previewHeight = $0 }
                    }
                if isExpanded || (previewHeight > 0 && fullHeight > previewHeight + 1) {
                    SourceRankingDisclosure(title: isExpanded ? "收起简介" : "展开简介", isExpanded: isExpanded) {
                        withAnimation(reduceMotion ? nil : AppMotion.structural) {
                            isExpanded.toggle()
                            if !isExpanded { onCollapse() }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var synopsisText: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(ReadingSpace.ink)
            .lineSpacing(6)
    }
}

private struct SourceRankingDisclosure: View {
    let title: String
    let isExpanded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Text(title)
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(AppTheme.primary)
            .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
