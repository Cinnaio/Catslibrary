import SwiftUI
import ZhiZhouCore

/// Shared by the bottom tab, AI services and the book workspace.
struct AdminAIAgentView: View {
    var initialNovel: Novel? = nil
    var afterChapterID: String? = nil
    @Environment(AppState.self) private var appState
    @State private var selectedID = ""
    @State private var books: [AdminNovelSummary] = []
    @State private var sessions: [AIAgentSession] = []
    @State private var hasMore = false
    @State private var loadingBooks = false
    @State private var loadingSessions = true
    @State private var error: String?
    @State private var booksError: String?
    @State private var showPicker = false
    @State private var showCreate = false
    @State private var showCreated = false
    @State private var created: AIAgentSession?
    @State private var listRequest = UUID()
    @State private var listNovelID = ""
    @State private var nextSessionOffset = 0
    @State private var filterByBook = false
    @State private var deleteTarget: AIAgentSession?
    @State private var showDelete = false
    @State private var deleting = false
    @State private var deleteError: String?

    private var historyNovelID: String { filterByBook ? selectedID : "" }

    private var bookTitle: String {
        books.first(where: { $0.id == selectedID })?.title ?? (initialNovel?.id == selectedID ? initialNovel?.title : nil) ?? "选择小说"
    }

    var body: some View {
        Group {
            if appState.user?.isAdmin == true { workspace }
            else { ContentUnavailableView("需要管理员权限", systemImage: "lock.shield") }
        }
        .navigationTitle("对话创作")
        .navigationBarTitleDisplayMode(.large)
        .task {
            if selectedID.isEmpty, let initialNovel { selectedID = initialNovel.id }
            await loadBooks()
        }
        .task(id: historyNovelID) { await loadSessions() }
        .sheet(isPresented: $showPicker) {
            AdminNovelPickerSheet(options: books, selectedId: selectedID) { selectedID = $0 }
        }
        .sheet(isPresented: $showCreate, onDismiss: {
            if created != nil {
                showCreated = true
                Task { await loadSessions() }
            }
        }) {
            if let token = APIClient.shared.token {
                AdminAIAgentCreateSheet(novelID: selectedID, novelTitle: bookTitle,
                    initialAnchor: initialNovel?.id == selectedID ? (afterChapterID ?? "") : "", token: token) { created = $0 }
            }
        }
        .navigationDestination(isPresented: $showCreated) {
            if let created, let user = appState.user, let token = APIClient.shared.token {
                AdminAIAgentConversationView(session: created, userID: user.id, token: token)
                    .onDisappear { Task { await loadSessions() } }
            }
        }
    }

    private var workspace: some View {
        List {
            Section {
                Button { showPicker = true } label: {
                    HStack {
                        Label(bookTitle, systemImage: "book.closed")
                        Spacer()
                        if loadingBooks { ProgressView() }
                        else { Image(systemName: "chevron.up.chevron.down").font(.caption) }
                    }
                    .frame(minHeight: 44)
                }
                .disabled(loadingBooks || books.isEmpty)
                .accessibilityIdentifier("agent.novelPicker")
                if let booksError {
                    LoadErrorNotice(message: booksError, isLoading: loadingBooks) { Task { await loadBooks() } }
                }
                Button("新建对话", systemImage: "square.and.pencil") {
                    created = nil
                    showCreate = true
                }
                .disabled(selectedID.isEmpty)
                .accessibilityIdentifier("agent.create")
            } footer: {
                Text("围绕这本小说讨论情节、调整草稿或生成封面。采纳前会先展示预览。")
            }
            Section("最近对话") {
                if !selectedID.isEmpty && (!sessions.isEmpty || filterByBook) {
                    Picker("对话范围", selection: $filterByBook) {
                        Text("全部作品").tag(false)
                        Text("当前作品").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
                if let error {
                    LoadErrorNotice(message: error, isLoading: loadingSessions) { Task { await loadSessions() } }
                }
                if let deleteError {
                    Text(deleteError).font(.footnote).foregroundStyle(.red)
                }
                if sessions.isEmpty {
                    if loadingSessions { ProgressView().frame(maxWidth: .infinity).padding() }
                    else if error == nil {
                        ContentUnavailableView(historyNovelID.isEmpty ? "还没有对话" : "这本书还没有对话",
                            systemImage: "bubble.left.and.bubble.right",
                            description: Text("选择一本小说即可开始新对话。"))
                    }
                }
                ForEach(sessions) { session in
                    if let user = appState.user, let token = APIClient.shared.token {
                        NavigationLink {
                            AdminAIAgentConversationView(session: session, userID: user.id, token: token)
                                .onDisappear { Task { await loadSessions() } }
                        } label: { sessionRow(session) }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("删除", systemImage: "trash", role: .destructive) {
                                deleteTarget = session
                                showDelete = true
                            }
                            .disabled(deleting)
                        }
                    }
                }
                if hasMore {
                    Button("加载更多对话") { Task { await loadSessions(more: true) } }
                        .disabled(loadingSessions)
                }
            }
        }
        .appListStyle(.settings)
        .refreshable { await loadSessions() }
        .alert("删除对话？", isPresented: $showDelete, presenting: deleteTarget) { session in
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { Task { await remove(session) } }
        } message: { session in
            Text("将永久删除「\(session.title)」的消息和摘要。已生成的产出和作品记忆会保留。")
        }
    }

    private func sessionRow(_ session: AIAgentSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.title.isEmpty ? "新的对话" : session.title).font(.headline).lineLimit(2)
            if historyNovelID.isEmpty && !session.novelTitle.isEmpty {
                Text(session.novelTitle).font(.subheadline).foregroundStyle(AppTheme.textSecondary).lineLimit(1)
            }
            Text(session.anchorTitle.isEmpty ? "从头创作" : "续写起点 · \(session.anchorTitle)")
                .font(.caption).foregroundStyle(AppTheme.textSecondary).lineLimit(2)
            Text(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000), style: .relative)
                .font(.caption2).foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.vertical, 4)
    }

    private func loadBooks() async {
        guard !loadingBooks, appState.user?.isAdmin == true, let token = APIClient.shared.token else { return }
        loadingBooks = true
        defer { loadingBooks = false }
        do {
            var all: [AdminNovelSummary] = []
            var offset = 0
            while true {
                let page: AgentNovelIndexPage = try await AdminAPI.parityRequest("GET",
                    "/api/admin/novel-index?limit=100&offset=\(offset)", token: token)
                guard !Task.isCancelled, APIClient.shared.token == token else { return }
                all.append(contentsOf: page.novels)
                if !page.hasMore { break }
                guard !page.novels.isEmpty else { throw APIError.invalidResponse }
                offset += page.novels.count
            }
            var seen = Set<String>()
            books = all.filter { seen.insert($0.id).inserted }
            booksError = nil
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            booksError = AppCopy.friendlyError(error)
        }
    }

    private func loadSessions(more: Bool = false) async {
        let novelID = historyNovelID
        let ticket = UUID()
        if more && loadingSessions { return }
        listRequest = ticket
        if listNovelID != novelID {
            sessions = []; hasMore = false; nextSessionOffset = 0; error = nil
            listNovelID = novelID
        }
        guard appState.user?.isAdmin == true, let token = APIClient.shared.token else {
            loadingSessions = false
            return
        }
        loadingSessions = true
        defer { if listRequest == ticket { loadingSessions = false } }
        do {
            let offset = more ? nextSessionOffset : 0
            let result = try await AdminAgentAPI(token: token).sessions(novelID: novelID, offset: offset)
            guard !Task.isCancelled, listRequest == ticket, historyNovelID == novelID, APIClient.shared.token == token else { return }
            let old = more ? sessions : []
            var seen = Set(old.map(\.id))
            sessions = old + result.sessions.filter { seen.insert($0.id).inserted }
            hasMore = result.hasMore
            nextSessionOffset = offset + result.sessions.count
            error = nil
        } catch {
            guard !Task.isCancelled, listRequest == ticket, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func remove(_ session: AIAgentSession) async {
        guard !deleting, let user = appState.user, user.isAdmin, let token = APIClient.shared.token else { return }
        let site = ServerConfig.shared.baseURL?.absoluteString ?? ""
        deleting = true
        deleteError = nil
        defer { deleting = false; deleteTarget = nil }
        do {
            try await AdminAgentAPI(token: token).remove(session.id)
            AIAgentDraftStore().remove(site: site, userID: user.id, sessionID: session.id)
            guard APIClient.shared.token == token else { return }
            sessions.removeAll { $0.id == session.id }
            await loadSessions()
        } catch {
            if APIClient.shared.token == token { deleteError = AppCopy.friendlyError(error) }
        }
    }
}

private struct AgentNovelIndexPage: Decodable {
    let novels: [AdminNovelSummary]
    let hasMore: Bool
}

private struct AdminAIAgentCreateSheet: View {
    let novelID: String
    let novelTitle: String
    let initialAnchor: String
    let token: String
    let onCreated: (AIAgentSession) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var anchor = ""
    @State private var chapters: [ChapterMeta] = []
    @State private var loaded = false
    @State private var loading = false
    @State private var creating = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(novelTitle).font(.headline)
                    if loading { ProgressView("读取章节…") }
                    Picker("续写起点", selection: $anchor) {
                        Text(chapters.isEmpty ? "从头创作" : "最新正式章节").tag("")
                        ForEach(chapters) { chapter in Text(chapter.title).tag(chapter.id) }
                    }
                    .disabled(!loaded || creating)
                } footer: { Text("此起点用于本次对话取材；生成结果先保存为草稿。") }
                if let error { Text(error).foregroundStyle(.red) }
                if !loaded && !loading { Button("重试读取章节") { Task { await load() } } }
                Section {
                    Button { Task { await create() } } label: {
                        HStack { Text("开始对话"); Spacer(); if creating { ProgressView() } }
                    }
                    .disabled(!loaded || creating || (!anchor.isEmpty && !chapters.contains { $0.id == anchor }))
                }
            }
            .appListStyle(.settings)
            .navigationTitle("新建对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(creating) } }
            .task { anchor = initialAnchor; await load() }
            .interactiveDismissDisabled(creating)
        }
    }

    private func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let value: ChaptersResponse = try await AdminAPI.parityRequest("GET",
                "/api/chapters?" + HomeView.query(["novelId": novelID]), token: token)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            chapters = value.chapters
            loaded = true
            error = !anchor.isEmpty && !chapters.contains { $0.id == anchor } ? "原章节已不在目录中，请重新选择续写起点。" : nil
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func create() async {
        guard !creating else { return }
        creating = true
        defer { creating = false }
        do {
            let value = try await AdminAgentAPI(token: token).create(novelID: novelID, afterChapterID: anchor)
            guard APIClient.shared.token == token else { return }
            onCreated(value)
            dismiss()
        } catch { if APIClient.shared.token == token { self.error = AppCopy.friendlyError(error) } }
    }
}
