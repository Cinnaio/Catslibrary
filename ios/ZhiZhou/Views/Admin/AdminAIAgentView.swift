import SwiftUI
import ZhiZhouCore

/// Shared by the bottom tab, AI services and the book workspace.
struct AdminAIAgentView: View {
    var initialNovel: Novel? = nil
    var afterChapterID: String? = nil
    var isTabRoot = false
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
    @State private var showDiscovery = false
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
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(isTabRoot ? .hidden : .visible, for: .navigationBar)
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
        .navigationDestination(isPresented: $showDiscovery) {
            if let token = APIClient.shared.token {
                AdminAgentBookDiscoveryView(token: token)
                    .toolbar(.visible, for: .navigationBar)
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
            if isTabRoot {
                Text("对话创作")
                    .font(serifFont(.largeTitle, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .accessibilityAddTraits(.isHeader)
                    .listRowInsets(EdgeInsets(top: 28, leading: 22, bottom: 20, trailing: 22))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            creationControls
                .listRowInsets(EdgeInsets(top: isTabRoot ? 0 : 16, leading: 22, bottom: 22, trailing: 22))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .readingSpaceEntrance()
            Section {
                if !selectedID.isEmpty && (!sessions.isEmpty || filterByBook) {
                    Picker("对话范围", selection: $filterByBook) {
                        Text("全部作品").tag(false)
                        Text("当前作品").tag(true)
                    }
                    .accessibleSegmentedPicker()
                    .listRowSeparator(.hidden)
                }
                if let error {
                    LoadErrorNotice(message: error, isLoading: loadingSessions) { Task { await loadSessions() } }
                        .listRowSeparator(.hidden)
                }
                if loadingSessions && !sessions.isEmpty {
                    ProgressView("正在更新对话…").font(.footnote)
                        .listRowSeparator(.hidden)
                }
                if let deleteError {
                    Text(deleteError).font(.footnote).foregroundStyle(.red)
                        .listRowSeparator(.hidden)
                }
                if sessions.isEmpty {
                    Group {
                        if loadingSessions { ProgressView().frame(maxWidth: .infinity).padding() }
                        else if error == nil {
                            ContentUnavailableView(historyNovelID.isEmpty ? "还没有对话" : "这本书还没有对话",
                                systemImage: "bubble.left.and.bubble.right",
                                description: Text("选择一本小说即可开始新对话。"))
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                    if let user = appState.user, let token = APIClient.shared.token {
                        NavigationLink {
                            AdminAIAgentConversationView(session: session, userID: user.id, token: token)
                                .onDisappear { Task { await loadSessions() } }
                        } label: { sessionRow(session) }
                        .listRowSeparator(.visible, edges: .bottom)
                        .listRowSeparatorTint(ReadingSpace.profileLine)
                        .readingSpaceEntrance(index)
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
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                        .disabled(loadingSessions)
                        .listRowSeparator(.hidden)
                }
            } header: {
                Text("最近对话")
                    .font(serifFont(.title3, .semibold))
                    .foregroundStyle(ReadingSpace.ink)
                    .textCase(nil)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                    .accessibilityAddTraits(.isHeader)
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 22, bottom: 0, trailing: 22))
            .listRowBackground(Color.clear)
            .listSectionSeparator(.hidden)
        }
        .modifier(ReadingSpaceRoomListStyle())
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(ReadingSpace.profilePaper)
        .refreshable { await loadSessions() }
        .alert("删除对话？", isPresented: $showDelete, presenting: deleteTarget) { session in
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { Task { await remove(session) } }
        } message: { session in
            Text("将永久删除「\(session.title)」的消息和摘要。已生成的产出和作品记忆会保留。")
        }
    }

    private var creationControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            creationDesk
            if let booksError {
                LoadErrorNotice(message: booksError, isLoading: loadingBooks) { Task { await loadBooks() } }
            }
            if APIClient.shared.token != nil {
                Button { showDiscovery = true } label: {
                    HStack(spacing: 8) {
                        Label("找书入库", systemImage: "magnifyingglass")
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.right").accessibilityHidden(true)
                    }
                    .font(.subheadline).foregroundStyle(AppTheme.primary)
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var creationDesk: some View {
        VStack(alignment: .leading, spacing: 20) {
            bookSelection
            Button {
                created = nil
                showCreate = true
            } label: {
                HStack(spacing: 12) {
                    Text("新建对话")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "arrow.right")
                        .accessibilityHidden(true)
                }
                .font(.body.weight(.medium))
                .foregroundStyle(selectedID.isEmpty ? ReadingSpace.profileMuted : ReadingSpace.onSummary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(selectedID.isEmpty ? ReadingSpace.profileFill : ReadingSpace.summary,
                            in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(selectedID.isEmpty)
            .accessibilityIdentifier("agent.create")
        }
        .padding(20)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        .overlay {
            RoundedRectangle(cornerRadius: ReadingSpace.panelRadius)
                .strokeBorder(ReadingSpace.profileLine, lineWidth: 0.8)
                .allowsHitTesting(false)
        }
    }

    private var bookSelection: some View {
        Button { showPicker = true } label: {
            HStack(spacing: 12) {
                selectedBookCover
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedID.isEmpty ? "先选一本作品" : "创作作品")
                        .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                    Text(bookTitle)
                        .font(serifFont(.headline, .medium)).foregroundStyle(ReadingSpace.ink)
                        .multilineTextAlignment(.leading)
                        .appTextLineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if loadingBooks {
                    ProgressView()
                        .tint(ReadingSpace.ink)
                        .accessibilityLabel("正在加载作品")
                } else {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(loadingBooks || books.isEmpty)
        .accessibilityIdentifier("agent.novelPicker")
    }

    private var selectedBookCover: some View {
        let book = books.first(where: { $0.id == selectedID })
        let updatedAt = book?.updatedAt ?? initialNovel?.updatedAt ?? 0
        return CachedAsyncImage(
            url: selectedID.isEmpty ? nil : APIClient.shared.coverURL(novelId: selectedID, updatedAt: updatedAt),
            targetSize: CGSize(width: 42, height: 60),
            showsRetry: false
        ) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                ReadingSpace.profileFill
                Image(systemName: "book.closed")
                    .font(.system(size: 21, weight: .light))
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: 42, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func sessionRow(_ session: AIAgentSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session.title.isEmpty ? "新的对话" : session.title)
                .font(serifFont(.headline, .semibold)).foregroundStyle(ReadingSpace.ink).appTextLineLimit(2)
            if historyNovelID.isEmpty && !session.novelTitle.isEmpty {
                Text(session.novelTitle).font(.subheadline).foregroundStyle(AppTheme.textSecondary).appTextLineLimit(1)
            }
            AppAdaptiveRow(spacing: 8) {
                Text(session.anchorTitle.isEmpty ? "从头创作" : "续写起点 · \(session.anchorTitle)")
                    .appTextLineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Text(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000), format: .dateTime.month().day())
                    .accessibilityLabel("更新于 \(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000).formatted(.dateTime.year().month().day()))")
            }
            .font(.caption).foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.vertical, 16)
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

struct AdminAgentBookDiscoveryView: View {
    let token: String
    @Environment(AppState.self) private var appState
    @State private var query = ""
    @State private var author = ""
    @State private var result: AgentBookDiscoveryResult?
    @State private var busy = false
    @State private var error: String?
    @State private var session: AIAgentSession?
    @State private var showConversation = false

    private var title: String {
        let quoted = query.range(of: #"《[^》]+》|「[^」]+」|『[^』]+』"#, options: .regularExpression)
        return (quoted.map { String(query[$0].dropFirst().dropLast()) } ?? query)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var candidates: [AgentBookDiscoveryResult.Source] {
        var seen = Set<String>()
        return (result?.sources.values.flatMap(\.results) ?? [])
            .sorted { ($0.matchScore ?? 0) > ($1.matchScore ?? 0) }
            .filter { seen.insert($0.url).inserted }
    }

    var body: some View {
        Form {
            Section {
                TextField("书名，或帮我找《书名》", text: $query)
                    .submitLabel(.search).onSubmit { Task { await search() } }
                TextField("作者（可选）", text: $author)
                Button("找书", systemImage: "magnifyingglass") { Task { await search() } }
                    .disabled(busy || title.isEmpty)
                if busy { ProgressView("正在处理…") }
                if let error { Text(verbatim: error).foregroundStyle(AppTheme.danger) }
            }
            if let result, !result.local.isEmpty {
                Section("书库已有作品") {
                    ForEach(result.local) { book in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(verbatim: book.title).font(.headline)
                            Text("\(book.author) · \(book.chapterCount) 章").foregroundStyle(.secondary)
                            Button("开始对话") { Task { await open(book.id) } }
                                .disabled(busy || book.chapterCount == 0)
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                        }
                    }
                }
            } else if let result {
                Section("书源候选") {
                    ForEach(candidates) { item in
                        NavigationLink {
                            AdminBookImportView(discoverySourceURL: item.url, discoveryToken: token)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(verbatim: item.title).font(.headline)
                                Text("\(item.author) · \(item.siteName)").foregroundStyle(.secondary)
                            }
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                        }
                    }
                    if candidates.isEmpty {
                        Text(result.sources.values.contains(where: \.ok)
                             ? "已查完的书源没有匹配结果。" : "当前没有可完成搜索的书源。")
                    }
                    let unavailable = result.sources.values.filter { !$0.ok }.compactMap(\.siteName).sorted()
                    if !unavailable.isEmpty { Text("暂未查完的书源：\(unavailable.joined(separator: "、"))").foregroundStyle(.secondary) }
                }
            }
        }
        .appListStyle(.settings)
        .navigationTitle("找书入库")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showConversation) {
            if let session, let user = appState.user, APIClient.shared.token == token {
                AdminAIAgentConversationView(session: session, userID: user.id, token: token)
            }
        }
        .onChange(of: ContentAccessStore.shared.accountRevision) { _, _ in
            query = ""; author = ""; result = nil; session = nil; error = nil; showConversation = false
        }
    }

    private func search() async {
        guard !title.isEmpty, !busy, APIClient.shared.token == token else { return }
        result = nil; error = nil; busy = true
        defer { busy = false }
        do {
            let found = try await AdminAgentAPI(token: token).discoverBook(title: title, author: author)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            result = found
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func open(_ novelID: String) async {
        guard !busy, APIClient.shared.token == token else { return }
        error = nil; busy = true
        defer { busy = false }
        do {
            let opened = try await AdminAgentAPI(token: token).startBookConversation(novelID)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            session = opened; showConversation = true
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
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
