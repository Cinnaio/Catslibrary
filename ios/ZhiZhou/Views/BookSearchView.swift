import SwiftUI
import UIKit

struct BookSearchHit: Decodable, Identifiable, Hashable {
    let chapterId: String
    let chapterTitle: String
    let chapterOrder: Int
    let snippet: String
    let matchCount: Int
    var id: String { chapterId }
}

private struct BookSearchResponse: Decodable {
    let novelId: String
    let query: String
    let items: [BookSearchHit]
    let scanned: Int
    let nextCursor: String?
}

/// Literal text matches use UTF-16 ranges, matching the native reader's attributed strings.
enum BookTextSearch {
    static func ranges(in text: String, query: String) -> [NSRange] {
        guard !query.isEmpty else { return [] }
        let source = text as NSString
        var result: [NSRange] = [], from = 0
        while from < source.length, result.count < 1000 {
            let range = source.range(of: query, options: [.caseInsensitive, .literal], range: NSRange(location: from, length: source.length - from))
            if range.location == NSNotFound { break }
            result.append(range)
            from = NSMaxRange(range)
        }
        return result
    }

    static func highlight(_ text: NSMutableAttributedString, query: String) {
        for range in ranges(in: text.string, query: query) {
            text.addAttribute(.backgroundColor, value: UIColor(AppTheme.primary).withAlphaComponent(0.22), range: range)
        }
    }
}

/// In-memory results belong to one presenting screen and one authorized book context.
struct BookSearchSnapshot {
    fileprivate let scope: BookSearchScope
    fileprivate let query: String
    fileprivate let searched: String
    fileprivate let items: [BookSearchHit]
    fileprivate let batchStartIndex: Int
    fileprivate let cursor: String?
    fileprivate let scanned: Int
    fileprivate let visibleResultID: String?
    fileprivate let error: String?
    fileprivate let paused: Bool

    @MainActor func hasSearch(for novelID: String) -> Bool {
        scope == BookSearchScope.current(novelID: novelID) && !searched.isEmpty
    }
}

fileprivate struct BookSearchScope: Equatable {
    let novelID: String
    let server: String
    let account: String
    let accessRevision: UUID

    @MainActor static func current(novelID: String) -> Self {
        Self(novelID: novelID, server: ServerConfig.shared.baseURL?.absoluteString ?? "",
             account: APIClient.shared.imageCacheIdentity, accessRevision: ContentAccessStore.shared.revision)
    }
}

/// Online whole-book search; the presenting screen keeps the last query and loaded results.
@MainActor
struct BookSearchView: View {
    let novel: Novel
    let onSelect: (BookSearchHit, String) -> Void
    @Binding private var snapshot: BookSearchSnapshot?
    @Environment(AppState.self) private var appState
    private let onClose: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var queryFocused = false
    @State private var query: String
    @State private var searched: String
    @State private var items: [BookSearchHit]
    @State private var batchStartIndex: Int
    @State private var cursor: String?
    @State private var scanned: Int
    @State private var visibleResultID: String?
    @State private var error: String?
    @State private var paused: Bool
    @State private var scope: BookSearchScope
    @State private var busy = false
    @State private var request: Task<Void, Never>?
    @State private var revision = UUID()

    private static let topAnchorID = "book-search-top"

    init(novel: Novel, state: Binding<BookSearchSnapshot?>, initialQuery: String = "",
         onClose: @escaping () -> Void, onSelect: @escaping (BookSearchHit, String) -> Void) {
        self.novel = novel
        self.onClose = onClose
        self.onSelect = onSelect
        _snapshot = state
        let context = BookSearchScope.current(novelID: novel.id)
        let saved = state.wrappedValue.flatMap { $0.scope == context ? $0 : nil }
        _scope = State(initialValue: context)
        _query = State(initialValue: saved?.query ?? (state.wrappedValue == nil ? initialQuery : ""))
        _searched = State(initialValue: saved?.searched ?? "")
        _items = State(initialValue: saved?.items ?? [])
        _batchStartIndex = State(initialValue: saved?.batchStartIndex ?? 0)
        _cursor = State(initialValue: saved?.cursor)
        _scanned = State(initialValue: saved?.scanned ?? 0)
        _visibleResultID = State(initialValue: saved?.visibleResultID ?? Self.topAnchorID)
        _error = State(initialValue: saved?.error)
        _paused = State(initialValue: saved?.paused ?? false)
    }

    private var currentScope: BookSearchScope { .current(novelID: novel.id) }
    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var queryTooLong: Bool { trimmedQuery.utf16.count > 80 }
    private var canSearch: Bool { !busy && !trimmedQuery.isEmpty && !queryTooLong }
    private var searchAnimation: Animation? { reduceMotion ? nil : AppMotion.micro }

    private func closePanel() {
        queryFocused = false
        onClose()
    }

    var body: some View {
        // 搜索只管理自己的面板与输入框，不在阅读导航中嵌套 NavigationStack 或激活导航栏搜索。
        VStack(spacing: 0) {
            searchHeader
            ScrollView {
                LazyVStack(alignment: .leading, spacing: trimmedQuery.isEmpty ? 12 : 24) {
                    searchContext.id(Self.topAnchorID)
                    if scope == currentScope {
                        searchContent
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .scrollTargetLayout()
            }
            .scrollPosition(id: $visibleResultID, anchor: .top)
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectHidden(true, for: .top)
            .scrollEdgeEffectHidden(true, for: .bottom)
        }
        .background(ReadingSpace.profilePaper)
        .tint(AppTheme.primary)
        .onChange(of: appState.user?.id) { _, _ in resetScope() }
        .onChange(of: currentScope) { _, _ in resetScope() }
        .onDisappear { pauseSearch() }
        .accessibilityIdentifier("bookSearch.panel")
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private var searchHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("书内正文搜索")
                    .font(serifFont(.title3, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button(action: closePanel) {
                    Image(systemName: "xmark")
                        .frame(width: AppLayout.minimumTouchTarget, height: AppLayout.minimumTouchTarget)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .appGlassEffect(.regular, fallback: ReadingSpace.profilePaper, in: Circle())
                .accessibilityLabel("关闭")
                .accessibilityIdentifier("bookSearch.close")
            }
            ReadingSpaceSearchField(
                text: Binding(get: { scope == currentScope ? query : "" }, set: updateQuery),
                isFocused: $queryFocused,
                prompt: "人物、句子或关键词",
                accessibilityID: "bookSearch.query",
                onSubmit: { search() }
            )
        }
        .padding(.horizontal, 22)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
    }

    private var searchContext: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("在《\(novel.title)》中搜索")
                .font(.footnote.weight(.medium))
                .foregroundStyle(ReadingSpace.profileMuted)
                .appTextLineLimit(1)
                .truncationMode(.middle)
            Text("仅搜索已收录正文，按字面匹配。")
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var searchContent: some View {
        if queryTooLong {
            Label("关键词过长，请缩短至 80 个字符以内。", systemImage: "exclamationmark.circle")
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.profileMuted)
        } else if !searched.isEmpty && searched == trimmedQuery {
            results
        } else if trimmedQuery.isEmpty {
            Text("找到后，点选结果即可回到原文。")
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            searchAction(title: "搜索本书正文", systemImage: "magnifyingglass") { search() }
                .disabled(!canSearch)
                .accessibilityIdentifier("bookSearch.submit")
        }
    }

    @ViewBuilder private var results: some View {
        if scanned > 0 || (!busy && error == nil && !paused) {
            VStack(alignment: .leading, spacing: 8) {
                AppAdaptiveRow(spacing: 8) {
                    Text("\(items.count) 章匹配")
                        .font(serifFont(.title3, .medium))
                        .foregroundStyle(ReadingSpace.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                    Text("已检索 \(scanned) 章")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
                if cursor != nil || paused {
                    Text("后续章节尚未检索完成")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
        }
        ForEach(Array(items.enumerated()), id: \.element.id) { index, hit in
            resultRow(hit)
                .id("chapter:\(hit.chapterId)")
                .transition(resultTransition(at: index))
        }
        resultStatus.transition(.opacity)
    }

    private func resultRow(_ hit: BookSearchHit) -> some View {
        Button {
            guard scope == currentScope, searched == trimmedQuery, !searched.isEmpty else { return }
            queryFocused = false
            saveSnapshot()
            onSelect(hit, searched)
            closePanel()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                AppAdaptiveRow(spacing: 8) {
                    Text("第 \(hit.chapterOrder) 章")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(hit.matchCount) 处命中")
                }
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
                .monospacedDigit()
                Text(hit.chapterTitle)
                    .font(serifFont(.headline, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                excerpt(hit.snippet)
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.ink)
                    .lineSpacing(5)
                    .appTextLineLimit(4)
            }
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            .overlay(alignment: .bottom) {
                ReadingSpace.profileLine.frame(height: 0.5).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("第 \(hit.chapterOrder) 章，\(hit.chapterTitle)，\(hit.matchCount) 处命中")
        .accessibilityValue(hit.snippet)
        .accessibilityHint("打开章节并定位首处命中，关键词会高亮")
        .accessibilityIdentifier("bookSearch.hit.\(hit.chapterId)")
    }

    @ViewBuilder private var resultStatus: some View {
        if busy {
            AppLoadingState(cursor == nil ? "正在搜索本书正文…" : "正在检索后续章节…", placement: .inline)
                .accessibilityIdentifier("bookSearch.loading")
        } else if let error {
            LoadErrorNotice(message: error, isLoading: false) { search(more: cursor != nil) }
        } else if paused {
            VStack(alignment: .leading, spacing: 12) {
                Text("上次检索尚未完成")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
                searchAction(title: "继续检索", systemImage: "arrow.clockwise") { search(more: cursor != nil) }
            }
        } else {
            if items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(cursor == nil ? "没有找到匹配的原文" : "已检索章节暂无匹配")
                        .font(serifFont(.headline, .medium))
                        .foregroundStyle(ReadingSpace.ink)
                    Text(cursor == nil ? "试试更短的关键词，或换一段原文。" : "可以继续检索后续章节。")
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            if cursor != nil {
                searchAction(title: "继续检索后续章节", systemImage: "arrow.down") { search(more: true) }
                    .accessibilityIdentifier("bookSearch.more")
            }
        }
    }

    private func searchAction(title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(ReadingSpace.ink)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(ScaleButtonStyle())
        .appGlassEffect(.regular, fallback: ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 16))
    }

    private func resultTransition(at index: Int) -> AnyTransition {
        guard let searchAnimation else { return .identity }
        let delay = Double(min(max(0, index - batchStartIndex), 12)) * 0.012
        return .asymmetric(insertion: .opacity.animation(searchAnimation.delay(delay)), removal: .opacity)
    }

    private func excerpt(_ text: String) -> Text {
        let attributed = NSMutableAttributedString(string: text)
        BookTextSearch.highlight(attributed, query: searched)
        return Text(AttributedString(attributed))
    }

    private func updateQuery(_ value: String) {
        let previousQuery = trimmedQuery
        query = value
        if trimmedQuery != previousQuery { invalidate(clear: true) }
    }

    private func invalidate(clear: Bool) {
        revision = UUID()
        request?.cancel()
        request = nil
        busy = false
        error = nil
        if clear {
            items = []
            searched = ""
            cursor = nil
            scanned = 0
            paused = false
            visibleResultID = Self.topAnchorID
        }
    }

    private func resetScope() {
        invalidate(clear: true)
        query = ""
        scope = currentScope
        snapshot = nil
        queryFocused = false
    }

    private func pauseSearch() {
        let needsResume = busy || paused
        let lastError = error
        invalidate(clear: false)
        paused = needsResume
        error = lastError
        saveSnapshot()
    }

    private func saveSnapshot() {
        guard scope == currentScope else { snapshot = nil; return }
        snapshot = BookSearchSnapshot(scope: scope, query: query, searched: searched, items: items,
            batchStartIndex: batchStartIndex, cursor: cursor, scanned: scanned, visibleResultID: visibleResultID,
            error: error, paused: busy || paused)
    }

    private func search(more: Bool = false) {
        let q = trimmedQuery
        guard scope == currentScope, canSearch, !more || (searched == q && cursor != nil) else { return }
        queryFocused = false
        let requestScope = scope
        request?.cancel()
        let seq = UUID(), identity = APIClient.shared.imageCacheIdentity
        let mode = ContentAccessStore.shared.mode, accessRevision = ContentAccessStore.shared.revision
        revision = seq
        withAnimation(searchAnimation) {
            busy = true
            paused = false
            error = nil
            if !more {
                items = []
                scanned = 0
                cursor = nil
                searched = q
                visibleResultID = Self.topAnchorID
            }
        }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "novelId", value: novel.id), URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "contentMode", value: mode), URLQueryItem(name: "cursor", value: more ? cursor : nil)]
        let encodedQuery = (components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        request = Task { @MainActor in
            defer {
                if revision == seq {
                    request = nil
                    withAnimation(searchAnimation) { busy = false }
                }
            }
            do {
                let response: BookSearchResponse = try await APIClient.shared.get("/api/chapters/search?\(encodedQuery)", auth: true)
                guard !Task.isCancelled, seq == revision, identity == APIClient.shared.imageCacheIdentity,
                      accessRevision == ContentAccessStore.shared.revision, requestScope == currentScope, response.novelId == novel.id, response.query == q else { return }
                let ids = Set(items.map(\.chapterId))
                withAnimation(searchAnimation) {
                    batchStartIndex = items.count
                    items += response.items.filter { !ids.contains($0.chapterId) }
                    scanned += response.scanned
                    cursor = response.nextCursor
                }
            } catch {
                guard !Task.isCancelled, seq == revision, identity == APIClient.shared.imageCacheIdentity,
                      accessRevision == ContentAccessStore.shared.revision, requestScope == currentScope else { return }
                if case APIError.http(let status, _) = error, status == 403 || status == 404 {
                    items = []; cursor = nil; scanned = 0
                }
                if case APIError.http(status: 404, message: _) = error {
                    self.error = "服务器可能尚未支持正文搜索，请更新 API 或确认作品仍可访问。"
                } else { self.error = error.localizedDescription }
            }
        }
    }
}
