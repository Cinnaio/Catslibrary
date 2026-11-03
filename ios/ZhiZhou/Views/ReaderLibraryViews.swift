import SwiftUI

/// Saved entries resolve current chapter metadata instead of trusting an old chapter order.
struct SavedChapterDestination: View {
    let novelID: String
    let chapterID: String
    @State private var launch: ReaderLaunch?
    @State private var error: String?
    @State private var attempt = 0
    private struct Detail: Decodable { let novel: Novel }

    var body: some View {
        Group {
            if let launch {
                ReaderView(novel: launch.novel, chapterOrder: launch.chapterOrder, preloadedChapters: launch.preloadedChapters)
            } else if let error {
                ContentUnavailableView {
                    Label("无法打开章节", systemImage: "book.closed")
                } description: { Text(error) } actions: {
                    Button("重试") { attempt += 1 }
                }
            } else { ProgressView("打开章节…") }
        }
        .task(id: "\(ContentAccessStore.shared.revision):\(attempt)") {
            launch = nil
            error = nil
            let revision = ContentAccessStore.shared.revision
            do {
                async let detail: Detail = APIClient.shared.getReader("/api/novels/\(novelID)")
                async let list: ChaptersResponse = APIClient.shared.getReader("/api/chapters?" + HomeView.query(["novelId": novelID]))
                let (book, chapters) = try await (detail, list)
                guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
                guard let chapter = chapters.chapters.first(where: { $0.id == chapterID }) else {
                    error = "该章节已移除或暂不可访问。"
                    return
                }
                launch = ReaderLaunch(novel: book.novel, chapterOrder: chapter.order, preloadedChapters: chapters.chapters)
            } catch {
                guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
                self.error = AppCopy.friendlyError(error)
            }
        }
    }
}

struct ReaderBookmarksView: View {
    @State private var items: [ReaderBookmark] = []
    @State private var loading = false
    @State private var error: String?
    @State private var editing: ReaderBookmark?
    @State private var attempt = 0
    @State private var requestID = UUID()

    var body: some View {
        List {
            if let error { LoadErrorNotice(message: error, isLoading: loading) { attempt += 1 } }
            if loading && items.isEmpty { ProgressView("加载书签…") }
            if !loading && error == nil && items.isEmpty {
                ContentUnavailableView("还没有书签", systemImage: "bookmark", description: Text("阅读时从更多菜单保存当前章节。"))
            }
            ForEach(items) { item in
                NavigationLink {
                    SavedChapterDestination(novelID: item.novelId, chapterID: item.chapterId)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.novelTitle).font(.headline)
                        Text(item.chapterTitle).font(.subheadline).foregroundStyle(.secondary)
                        if !item.note.isEmpty { Text(item.note).font(.footnote).lineLimit(3) }
                    }
                }
                .swipeActions {
                    Button("编辑", systemImage: "pencil") { editing = item }
                }
                .contextMenu { Button("编辑书签", systemImage: "pencil") { editing = item } }
            }
        }
        .appListStyle(.browsing)
        .navigationTitle("我的书签")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(ContentAccessStore.shared.revision):\(attempt)") { await load() }
        .refreshable { await load() }
        .sheet(item: $editing, onDismiss: { attempt += 1 }) { item in
            BookmarkEditorView(novelID: item.novelId, chapterID: item.chapterId, chapterTitle: item.chapterTitle)
        }
    }

    private func load() async {
        let id = UUID()
        requestID = id
        let revision = ContentAccessStore.shared.revision
        items = []
        loading = true
        defer { if requestID == id { loading = false } }
        do {
            let result = try await ReaderLibraryAPI.bookmarks()
            guard !Task.isCancelled, requestID == id, revision == ContentAccessStore.shared.revision else { return }
            items = result
            error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

struct BookmarkEditorView: View {
    let novelID: String
    let chapterID: String
    let chapterTitle: String
    @Environment(\.dismiss) private var dismiss
    @State private var existing: ReaderBookmark?
    @State private var note = ""
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var attempt = 0
    @State private var loadedRevision: UUID?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(chapterTitle)
                    TextField("为这个章节写一条备注", text: $note, axis: .vertical)
                        .lineLimit(3...8)
                        .disabled(!loaded || busy)
                        .accessibilityIdentifier("bookmark.note")
                    Text("\(note.utf16.count)/300").font(.caption).foregroundStyle(.secondary)
                } footer: { Text("每章保留一个书签，打开时进入该章节。备注会在 Web 与 iOS 之间同步。") }
                if let error {
                    Section {
                        Text(error).foregroundStyle(AppTheme.danger)
                        if !loaded { Button("重新加载") { attempt += 1 } }
                    }
                }
                if !loaded && error == nil { ProgressView("加载书签…") }
                if existing != nil {
                    Section {
                        Button("删除书签", role: .destructive) { confirmDelete = true }
                            .disabled(busy)
                            .accessibilityIdentifier("bookmark.delete")
                    }
                }
            }
            .navigationTitle(existing == nil ? "添加书签" : "编辑书签")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await write(remove: false) } }
                        .disabled(!loaded || busy || note.utf16.count > 300 || loadedRevision != ContentAccessStore.shared.revision)
                }
            }
            .interactiveDismissDisabled(busy)
            .task(id: "\(ContentAccessStore.shared.revision):\(attempt)") { await load() }
            .confirmationDialog("删除这个章节的书签？", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("删除书签", role: .destructive) { Task { await write(remove: true) } }
                Button("取消", role: .cancel) {}
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func load() async {
        loaded = false
        existing = nil
        note = ""
        error = nil
        let revision = ContentAccessStore.shared.revision
        do {
            let items = try await ReaderLibraryAPI.bookmarks()
            guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
            existing = items.first { $0.novelId == novelID && $0.chapterId == chapterID }
            note = existing?.note ?? ""
            loadedRevision = revision
            loaded = true
        } catch {
            guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func write(remove: Bool) async {
        guard loaded, !busy, loadedRevision == ContentAccessStore.shared.revision else { return }
        let revision = ContentAccessStore.shared.revision
        busy = true
        defer { busy = false }
        do {
            if remove { try await ReaderLibraryAPI.remove(novelID: novelID, chapterID: chapterID) }
            else { _ = try await ReaderLibraryAPI.save(novelID: novelID, chapterID: chapterID, note: note) }
            guard revision == ContentAccessStore.shared.revision else { return }
            dismiss()
        } catch {
            guard revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

struct MyThoughtsView: View {
    @State private var items: [ThoughtItem] = []
    @State private var offset = 0
    @State private var hasMore = true
    @State private var loading = false
    @State private var error: String?
    @State private var requestID = UUID()

    var body: some View {
        List {
            if let error {
                LoadErrorNotice(message: error, isLoading: loading) { Task { await load(reset: items.isEmpty) } }
            }
            if !loading && error == nil && items.isEmpty {
                ContentUnavailableView("还没有想法", systemImage: "text.bubble", description: Text("阅读中写下的段评会汇总在这里。"))
            }
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 12) {
                NavigationLink {
                    SavedChapterDestination(novelID: item.novelId, chapterID: item.chapterId)
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.novelTitle ?? "作品").font(.headline)
                        Text(item.chapterTitle ?? "章节").font(.subheadline).foregroundStyle(.secondary)
                        if !item.selectedText.isEmpty {
                            Text(item.selectedText).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                        }
                        Text(item.thoughtText).lineLimit(6)
                        Text(Date(timeIntervalSince1970: Double(item.createdAt) / 1000), style: .date)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if item.imageUrl != nil {
                    ReaderMediaView(path: "/api/thoughts/image/" + ReaderMediaAPI.pathSegment(item.id),
                                    caption: "想法配图", aspectRatio: 4 / 3, maximumHeight: 260)
                }
                }
            }
            if loading { ProgressView("加载想法…") }
            else if hasMore && error == nil {
                Button("加载更多") { Task { await load(reset: false) } }
            }
        }
        .appListStyle(.browsing)
        .navigationTitle("我的想法")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ContentAccessStore.shared.revision) { await load(reset: true) }
        .refreshable { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        if !reset && loading { return }
        if reset { items = []; offset = 0; hasMore = true }
        let id = UUID()
        requestID = id
        let revision = ContentAccessStore.shared.revision
        let requestedOffset = offset
        loading = true
        defer { if requestID == id { loading = false } }
        do {
            let result: BookshelfResponse = try await APIClient.shared.getReader(
                "/api/bookshelf?" + HomeView.query(["limit": "50", "offset": String(requestedOffset)]), auth: true
            )
            guard !Task.isCancelled, requestID == id, revision == ContentAccessStore.shared.revision else { return }
            let existing = Set(items.map(\.id))
            items += result.thoughts.filter { !existing.contains($0.id) }
            offset = requestedOffset + result.thoughts.count
            hasMore = result.totals.map { offset < $0.thoughts } ?? (result.thoughts.count == 50)
            if result.thoughts.isEmpty { hasMore = false }
            error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
