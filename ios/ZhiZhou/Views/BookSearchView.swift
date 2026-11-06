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
    @State private var query = ""
    @State private var searched = ""
    @State private var items: [BookSearchHit] = []
    @State private var cursor: String?
    @State private var scanned = 0
    @State private var busy = false
    @State private var error: String?
    @State private var request: Task<Void, Never>?
    @State private var revision = UUID()

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("搜索《\(novel.title)》已入库正文，关键词按字面匹配。")
                        .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                    Button("搜索正文", systemImage: "magnifyingglass") { search() }
                        .disabled(busy || trimmedQuery.isEmpty || trimmedQuery.utf16.count > 80)
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(.red)
                        Button("重试") { search(more: searched == trimmedQuery && cursor != nil) }
                    }
                }
                if searched.isEmpty || searched != trimmedQuery {
                    ContentUnavailableView("在这本书中查找正文", systemImage: "magnifyingglass", description: Text("输入 1–80 字的关键词并搜索。"))
                } else {
                    Section {
                        if busy { ProgressView("正在检索正文…") }
                        Text("已找到 \(items.count) 个匹配章节 · 已检索 \(scanned) 章\(cursor == nil ? "" : "，后续章节尚待检索")")
                            .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                        if items.isEmpty && !busy && error == nil {
                            ContentUnavailableView(cursor == nil ? "没有找到匹配正文" : "已检索的章节中没有匹配", systemImage: "text.magnifyingglass",
                                description: Text(cursor == nil ? "可以缩短关键词或换一种写法。" : "可继续检索后续章节。"))
                        }
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, hit in
                            Button {
                                onSelect(hit, searched)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(hit.chapterTitle).font(.headline)
                                        Spacer()
                                        Text("本章 \(hit.matchCount) 处").font(.caption).foregroundStyle(AppTheme.textSecondary)
                                    }
                                    excerpt(hit.snippet).font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                            }
                            .buttonStyle(.plain)
                            .transition(.opacity)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.18).delay(Double(min(index, 12)) * 0.02), value: items.count)
                        }
                        if cursor != nil {
                            Button("继续检索后续章节") { search(more: true) }.disabled(busy)
                        }
                    }
                }
            }
            .appListStyle(.browsing)
            .navigationTitle("书内正文搜索")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "输入人物、句子或关键词")
            .onSubmit(of: .search) { search() }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .onChange(of: query) { _, _ in invalidate(clear: false) }
            .onChange(of: appState.user?.id) { _, _ in invalidate(clear: true) }
            .onChange(of: ContentAccessStore.shared.revision) { _, _ in invalidate(clear: true) }
            .onDisappear { invalidate(clear: false) }
        }
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private func excerpt(_ text: String) -> Text {
        let attributed = NSMutableAttributedString(string: text)
        BookTextSearch.highlight(attributed, query: searched)
        return Text(AttributedString(attributed))
    }

    private func invalidate(clear: Bool) {
        revision = UUID(); request?.cancel(); request = nil; busy = false; error = nil
        if clear { items = []; searched = ""; cursor = nil; scanned = 0 }
    }

    private func search(more: Bool = false) {
        let q = trimmedQuery
        guard !busy, !q.isEmpty, q.utf16.count <= 80 else { return }
        request?.cancel()
        let seq = UUID(), identity = APIClient.shared.imageCacheIdentity
        let mode = ContentAccessStore.shared.mode, accessRevision = ContentAccessStore.shared.revision
        revision = seq; busy = true; error = nil
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "novelId", value: novel.id), URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "contentMode", value: mode), URLQueryItem(name: "cursor", value: more ? cursor : nil)]
        let encodedQuery = (components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        if !more { items = []; scanned = 0; cursor = nil; searched = q }
        request = Task { @MainActor in
            defer { if revision == seq { busy = false } }
            do {
                let response: BookSearchResponse = try await APIClient.shared.get("/api/chapters/search?\(encodedQuery)", auth: true)
                guard !Task.isCancelled, seq == revision, identity == APIClient.shared.imageCacheIdentity,
                      accessRevision == ContentAccessStore.shared.revision, response.novelId == novel.id, response.query == q else { return }
                let ids = Set(items.map(\.chapterId))
                items += response.items.filter { !ids.contains($0.chapterId) }
                scanned += response.scanned; cursor = response.nextCursor
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
