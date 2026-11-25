import SwiftUI
import ZhiZhouCore

struct SourceSearchOptions: Decodable {
    struct Source: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
    }

    let sources: [Source]

    @MainActor
    static func load() async throws -> Self {
        try await APIClient.shared.getReader("/api/novels/source-search/sources", auth: true, refresh: true)
    }
}

struct SourceSearchBookPresentation: Identifiable {
    let id = UUID()
    let entry: SourceRankingEntry
    let revision: UUID
}

struct SourceSearchResults: View {
    let sources: [SourceSearchOptions.Source]
    let query: String
    let submission: UUID?
    let onSubmit: () -> Void
    let openBook: (SourceRankingEntry) -> Void

    @State private var sourceID = ""
    @State private var searchType: SearchType = .title
    @State private var run: SearchRun?
    @State private var sections: [String: SectionResults] = [:]

    private enum SearchType: String, CaseIterable, Sendable {
        case title, author
        var label: String { self == .title ? "书名" : "作者" }
    }

    private struct SearchRun: Equatable, Sendable {
        let id = UUID()
        let query: String
        let type: SearchType
        let sourceID: String
        let sources: [String]
        let revision: UUID
    }

    private struct Page: Decodable, Sendable {
        let entries: [SourceRankingEntry]
        let hasMore: Bool
    }

    private struct PageResult: Sendable {
        let source: String
        let result: Result<Page, Error>
    }

    private struct SectionResults {
        var entries: [SourceRankingEntry] = []
        var page = 0
        var hasMore = false
        var isLoading = false
        var error: String?
    }

    private var selectedSources: [SourceSearchOptions.Source] {
        sources.filter { sourceID.isEmpty || $0.id == sourceID }
    }

    private var activeRun: SearchRun? {
        guard let run, run.query == query, run.type == searchType, run.sourceID == sourceID,
              run.revision == ContentAccessStore.shared.revision else { return nil }
        return run
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AppAdaptiveRow(spacing: 12) {
                Picker("书源", selection: $sourceID) {
                    Text("全部书源").tag("")
                    ForEach(sources) { source in Text(source.name).tag(source.id) }
                }
                .pickerStyle(.menu)
                Picker("搜索方式", selection: $searchType) {
                    ForEach(SearchType.allCases, id: \.self) { type in Text("按\(type.label)").tag(type) }
                }
                .pickerStyle(.menu)
            }
            if let activeRun {
                ForEach(selectedSources) { source in
                    resultSection(source, run: activeRun)
                }
            } else if !query.isEmpty {
                if query.utf16.count > 100 {
                    ReaderPanelNote("搜索词最多 100 个字符。")
                } else {
                    Button("搜索书源", systemImage: "magnifyingglass") { submit() }
                        .buttonStyle(ReaderPanelButtonStyle())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: submission) { _, _ in submit() }
        .onChange(of: query) { _, _ in clearSearch() }
        .onChange(of: sourceID) { _, _ in clearSearch() }
        .onChange(of: searchType) { _, _ in clearSearch() }
        .onChange(of: ContentAccessStore.shared.revision) { _, _ in clearSearch() }
        .onChange(of: sources.map(\.id)) { _, ids in
            if !sourceID.isEmpty && !ids.contains(sourceID) { sourceID = "" }
            clearSearch()
        }
        .task(id: activeRun) {
            guard let run = activeRun else { return }
            await loadInitial(run)
        }
    }

    private func resultSection(_ source: SourceSearchOptions.Source, run: SearchRun) -> some View {
        let result = sections[source.id] ?? SectionResults(isLoading: true)
        return VStack(alignment: .leading, spacing: 8) {
            Text(source.name)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(result.entries.enumerated()), id: \.offset) { index, entry in
                Button { openBook(entry) } label: { SourceRankingRow(entry: entry, showsRank: false) }
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
                    .readingSpaceEntrance(index)
            }
            if result.isLoading {
                ProgressView(result.page == 0 ? "正在搜索…" : "正在加载…")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            } else if let error = result.error {
                LoadErrorNotice(message: error, isLoading: false) { loadNext(source.id, run: run) }
            } else {
                if result.entries.isEmpty { ReaderPanelNote("这页没有可显示的作品。") }
                if result.hasMore {
                    Button("加载更多") { loadNext(source.id, run: run) }
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                }
            }
        }
        .padding(.bottom, 10)
    }

    private func clearSearch() {
        run = nil
        sections = [:]
    }

    private func submit() {
        guard !query.isEmpty, query.utf16.count <= 100, !selectedSources.isEmpty else { return }
        let ids = selectedSources.map(\.id)
        sections = Dictionary(uniqueKeysWithValues: ids.map { ($0, SectionResults(isLoading: true)) })
        run = SearchRun(query: query, type: searchType, sourceID: sourceID, sources: ids, revision: ContentAccessStore.shared.revision)
        onSubmit()
    }

    private func loadInitial(_ run: SearchRun) async {
        await withTaskGroup(of: PageResult.self) { group in
            for source in run.sources where sections[source]?.page == 0 && sections[source]?.isLoading == true {
                group.addTask { PageResult(source: source, result: await Self.fetch(source, run: run, page: 1)) }
            }
            for await outcome in group {
                guard !Task.isCancelled, run == activeRun else { return }
                apply(outcome.result, source: outcome.source, page: 1)
            }
        }
    }

    private func loadNext(_ source: String, run: SearchRun) {
        guard run == activeRun, var section = sections[source], !section.isLoading else { return }
        let page = section.page + 1
        section.isLoading = true
        section.error = nil
        sections[source] = section
        Task {
            let result = await Self.fetch(source, run: run, page: page)
            guard !Task.isCancelled, run == activeRun else { return }
            apply(result, source: source, page: page)
        }
    }

    private static func fetch(_ source: String, run: SearchRun, page: Int) async -> Result<Page, Error> {
        let query = ReaderQuery.encode(["source": source, "q": run.query, "type": run.type.rawValue, "page": String(page)])
        do {
            let response: Page = try await APIClient.shared.getReader("/api/novels/source-search?" + query, auth: true, refresh: true)
            return .success(response)
        } catch {
            return .failure(error)
        }
    }

    private func apply(_ result: Result<Page, Error>, source: String, page: Int) {
        guard var section = sections[source] else { return }
        section.isLoading = false
        switch result {
        case .success(let response):
            var seen = Set(section.entries.compactMap { $0.novelId ?? $0.sourceUrl })
            for entry in response.entries {
                guard let id = entry.novelId ?? entry.sourceUrl, seen.insert(id).inserted else { continue }
                section.entries.append(entry)
            }
            section.page = page
            section.hasMore = response.hasMore
            section.error = nil
        case .failure(let error):
            section.error = AppCopy.friendlyError(error)
        }
        sections[source] = section
    }
}
