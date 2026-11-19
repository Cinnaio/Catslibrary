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

struct BookSearchLaunch: Hashable {
    let hit: BookSearchHit
    let query: String
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

/// Online whole-book search. Each request scans a bounded part of the book; a cursor continues it.
struct BookSearchView: View {
    let novel: Novel
    let onSelect: (BookSearchHit, String) -> Void
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var queryFocused: Bool
    @State private var searchPresented = true
    @State private var query = ""
    @State private var searched = ""
    @State private var items: [BookSearchHit] = []
    @State private var batchStartIndex = 0
    @State private var cursor: String?
    @State private var scanned = 0
    @State private var busy = false
    @State private var error: String?
    @State private var request: Task<Void, Never>?
    @State private var revision = UUID()

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var queryTooLong: Bool { trimmedQuery.utf16.count > 80 }
    private var canSearch: Bool { !busy && !trimmedQuery.isEmpty && !queryTooLong }
    private var searchAnimation: Animation? { reduceMotion ? nil : AppMotion.micro }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(novel.title)
                        .font(.headline)
                        .appTextLineLimit(2)
                        .accessibilityAddTraits(.isHeader)
                } footer: {
                    Text("仅检索本书已收录的正文，按字面匹配。")
                }

                if queryTooLong {
                    Label("关键词过长，请缩短至 80 个字符以内。", systemImage: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                } else if !searched.isEmpty && searched == trimmedQuery {
                    results
                }
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("书内正文搜索")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: Binding(get: { query }, set: updateQuery),
                isPresented: $searchPresented,
                prompt: "人物、句子或关键词"
            )
            .searchFocused($queryFocused)
            .onSubmit(of: .search) { search() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                }
            }
            .onChange(of: appState.user?.id) { _, _ in invalidate(clear: true) }
            .onChange(of: ContentAccessStore.shared.revision) { _, _ in invalidate(clear: true) }
            .onDisappear { invalidate(clear: false) }
        }
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private var results: some View {
        Section {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, hit in
                resultRow(hit)
                    .transition(resultTransition(at: index))
            }
            resultStatus
                .transition(.opacity)
        } header: {
            if scanned > 0 || (!busy && error == nil) {
                Text("\(items.count) 章匹配")
                    .monospacedDigit()
            }
        } footer: {
            if scanned > 0 || (!busy && error == nil) {
                Text(cursor == nil ? "已检索 \(scanned) 章" : "已检索 \(scanned) 章 · 后续章节待检索")
                    .monospacedDigit()
            }
        }
    }

    private func resultRow(_ hit: BookSearchHit) -> some View {
        Button {
            onSelect(hit, searched)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(hit.chapterTitle)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("本章 \(hit.matchCount) 处命中")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    excerpt(hit.snippet)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.forward")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 4)
            .frame(minHeight: AppLayout.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var resultStatus: some View {
        if busy {
            ProgressView(cursor == nil ? "正在搜索本书正文…" : "正在检索后续章节…")
        } else if let error {
            LoadErrorNotice(message: error, isLoading: false) { search(more: cursor != nil) }
        } else {
            if items.isEmpty {
                Text(cursor == nil ? "试试更短的关键词，或换一段原文。" : "已检索的章节没有匹配，可以继续查找。")
                    .foregroundStyle(.secondary)
            }
            if cursor != nil {
                Button("继续检索后续章节", systemImage: "arrow.down") { search(more: true) }
            }
        }
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
        }
    }

    private func search(more: Bool = false) {
        let q = trimmedQuery
        guard canSearch, !more || (searched == q && cursor != nil) else { return }
        queryFocused = false
        request?.cancel()
        let seq = UUID(), identity = APIClient.shared.imageCacheIdentity
        let mode = ContentAccessStore.shared.mode, accessRevision = ContentAccessStore.shared.revision
        revision = seq
        withAnimation(searchAnimation) {
            busy = true
            error = nil
            if !more {
                items = []
                scanned = 0
                cursor = nil
                searched = q
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
                      accessRevision == ContentAccessStore.shared.revision, response.novelId == novel.id, response.query == q else { return }
                let ids = Set(items.map(\.chapterId))
                withAnimation(searchAnimation) {
                    batchStartIndex = items.count
                    items += response.items.filter { !ids.contains($0.chapterId) }
                    scanned += response.scanned
                    cursor = response.nextCursor
                }
            } catch {
                guard !Task.isCancelled, seq == revision, identity == APIClient.shared.imageCacheIdentity,
                      accessRevision == ContentAccessStore.shared.revision else { return }
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
