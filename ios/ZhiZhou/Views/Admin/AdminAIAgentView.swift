import SwiftUI
import ZhiZhouCore

/// Shared by the bottom tab, AI services and the book workspace.
struct AdminAIAgentView: View {
    var initialNovel: Novel? = nil
    var afterChapterID: String? = nil
    var isTabRoot = false
    @Environment(AppState.self) private var appState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedID = ""
    @State private var books: [AdminNovelSummary] = []
    @State private var sessions: [AIAgentSession] = []
    @State private var activeSession: AIAgentSession?
    @State private var showHistory = false
    @State private var sidebarExpanded = true
    @State private var historySearch = ""
    @State private var hasMore = false
    @State private var loadingBooks = false
    @State private var loadingSessions = true
    @State private var error: String?
    @State private var booksError: String?
    @State private var showPicker = false
    @State private var showCreate = false
    @State private var created: AIAgentSession?
    @State private var listRequest = UUID()
    @State private var listNovelID = ""
    @State private var nextSessionOffset = 0
    @State private var filterByBook = false
    @State private var deleteTarget: AIAgentSession?
    @State private var showDelete = false
    @State private var deleting = false
    @State private var deleteError: String?

    private var currentNovelID: String { activeSession?.novelId ?? selectedID }
    private var historyNovelID: String { filterByBook ? currentNovelID : "" }

    private var bookTitle: String {
        books.first(where: { $0.id == selectedID })?.title ?? (initialNovel?.id == selectedID ? initialNovel?.title : nil) ?? "选择小说"
    }

    private var navigationTitle: String {
        guard let activeSession, !activeSession.novelTitle.isEmpty else { return "对话创作" }
        return activeSession.novelTitle
    }

    var body: some View {
        Group {
            if appState.user?.isAdmin == true { workspace }
            else { ContentUnavailableView("需要管理员权限", systemImage: "lock.shield") }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if selectedID.isEmpty, let initialNovel { selectedID = initialNovel.id }
            await loadBooks()
        }
        .task(id: historyNovelID) { await loadSessions() }
        .sheet(isPresented: $showPicker) {
            AdminNovelPickerSheet(options: books, selectedId: selectedID) { selectedID = $0 }
        }
        .sheet(isPresented: $showCreate, onDismiss: {
            if let created {
                openSession(created)
                self.created = nil
                Task { await loadSessions() }
            }
        }) {
            if let token = APIClient.shared.token {
                AdminAIAgentCreateSheet(novelID: selectedID, novelTitle: bookTitle,
                    initialAnchor: initialNovel?.id == selectedID ? (afterChapterID ?? "") : "", token: token) { created = $0 }
            }
        }
    }

    private var workspace: some View {
        GeometryReader { geometry in
            let isWide = geometry.size.width >= 820 && !dynamicTypeSize.isAccessibilitySize
            let drawerOpen = showHistory && !isWide
            let historyVisible = isWide ? sidebarExpanded : drawerOpen
            let historyWidth = min(340, max(0, geometry.size.width - (dynamicTypeSize.isAccessibilitySize ? 52 : 76)))
            ZStack(alignment: .leading) {
                if !isWide {
                    historySidebar(isPresented: drawerOpen)
                        .frame(width: historyWidth)
                        .opacity(drawerOpen ? 1 : 0)
                        .allowsHitTesting(drawerOpen)
                        .accessibilityHidden(!drawerOpen)
                        .accessibilityAction(.escape) { setHistoryVisible(false) }
                }

                HStack(spacing: 0) {
                    if isWide && sidebarExpanded {
                        historySidebar(isPresented: true)
                            .frame(width: 300)
                            .transition(sidebarTransition)
                    }
                    navigationPane(isWide: isWide, historyVisible: historyVisible, drawerOpen: drawerOpen)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .background(ReadingSpace.profilePaper)
                        .disabled(drawerOpen)
                        .allowsHitTesting(!drawerOpen)
                        .accessibilityHidden(drawerOpen)
                        .animation(nil, value: drawerOpen)
                        .clipShape(UnevenRoundedRectangle(
                            topLeadingRadius: drawerOpen || (isWide && sidebarExpanded) ? 32 : 0,
                            bottomLeadingRadius: drawerOpen || (isWide && sidebarExpanded) ? 32 : 0
                        ))
                        .shadow(color: .black.opacity(drawerOpen ? 0.10 : 0), radius: 12, x: -4, y: 0)
                        .overlay {
                            Button { setHistoryVisible(false) } label: {
                                Color.clear.contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("关闭对话历史")
                            .accessibilityIdentifier("agent.history.dismiss")
                            .allowsHitTesting(drawerOpen)
                            .accessibilityHidden(!drawerOpen)
                        }
                        .offset(x: drawerOpen ? historyWidth : 0)
                }
            }
            .clipped()
            .background {
                (historyVisible ? ReadingSpace.canvas : ReadingSpace.profilePaper)
                    .ignoresSafeArea(.container)
                    .animation(nil, value: historyVisible)
            }
            .toolbar(activeSession != nil || drawerOpen ? .hidden : (isTabRoot ? .visible : .automatic), for: .tabBar)
            .onChange(of: isWide) { _, wide in
                if wide { showHistory = false }
            }
        }
        .alert("删除对话？", isPresented: $showDelete, presenting: deleteTarget) { session in
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { Task { await remove(session) } }
        } message: { session in
            Text("将永久删除「\(session.title)」的消息和摘要。已生成的产出和作品记忆会保留。")
        }
    }

    // The tab owns its navigation inside the moving pane. Pushed entries retain their parent stack and back button.
    @ViewBuilder private func navigationPane(isWide: Bool, historyVisible: Bool, drawerOpen: Bool) -> some View {
        if isTabRoot {
            NavigationStack {
                mainWorkspace(historyPresented: drawerOpen)
                    .background(ReadingSpace.profilePaper)
                    .navigationTitle(navigationTitle)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbarBackground(.hidden, for: .navigationBar)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            historyToggle(isWide: isWide, historyVisible: historyVisible)
                        }
                    }
            }
        } else {
            mainWorkspace(historyPresented: drawerOpen)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        historyToggle(isWide: isWide, historyVisible: historyVisible)
                    }
                }
        }
    }

    private func historyToggle(isWide: Bool, historyVisible: Bool) -> some View {
        Button { toggleHistory(isWide: isWide) } label: {
            Image(systemName: "line.3.horizontal")
        }
        .accessibilityLabel(historyVisible ? "收起对话历史" : "打开对话历史")
        .accessibilityValue(historyVisible ? "已展开" : "已收起")
        .accessibilityIdentifier("agent.history.toggle")
    }

    private var sidebarTransition: AnyTransition {
        reduceMotion ? .identity : .move(edge: .leading).combined(with: .opacity)
    }

    private func historySidebar(isPresented: Bool) -> some View {
        AdminAgentHistorySidebar(
            isPresented: isPresented,
            sessions: listNovelID == historyNovelID ? sessions : [],
            selectedSessionID: activeSession?.id,
            currentNovelTitle: activeSession?.novelTitle ?? bookTitle,
            hasCurrentNovel: !currentNovelID.isEmpty,
            filterByBook: $filterByBook,
            search: $historySearch,
            loading: loadingSessions || listNovelID != historyNovelID,
            hasMore: listNovelID == historyNovelID && hasMore,
            deleting: deleting,
            error: error,
            deleteError: deleteError,
            onNewConversation: beginNewConversation,
            onOpen: openSession,
            onDelete: { session in
                deleteTarget = session
                showDelete = true
            },
            onRefresh: { await loadSessions() },
            onLoadMore: { await loadSessions(more: true) }
        )
    }

    @ViewBuilder private func mainWorkspace(historyPresented: Bool) -> some View {
        if let activeSession, let user = appState.user, let token = APIClient.shared.token {
            AdminAIAgentConversationView(session: activeSession, userID: user.id, token: token,
                                         historyPresented: historyPresented, usesWorkspaceSurface: true)
                .id(activeSession.id)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("继续你的故事")
                            .font(serifFont(.largeTitle, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("聊聊下一幕，或一起推敲文字。")
                            .font(.subheadline)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    creationPanel

                    if let booksError {
                        LoadErrorNotice(message: booksError, isLoading: loadingBooks) { Task { await loadBooks() } }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 32)
                .padding(.bottom, 32)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectHidden(true, for: .top)
            .refreshable { await loadBooks() }
        }
    }

    private var creationPanel: some View {
        VStack(alignment: .leading, spacing: 20) {
            bookSelection

            VStack(alignment: .leading, spacing: 12) {
                Button {
                    if selectedID.isEmpty {
                        showPicker = true
                    } else {
                        created = nil
                        showCreate = true
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text(selectedID.isEmpty ? "选择作品" : "开始对话")
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "arrow.right").accessibilityHidden(true)
                    }
                    .font(.body.weight(.medium))
                    .foregroundStyle(ReadingSpace.onSummary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(ScaleButtonStyle())
                .disabled(selectedID.isEmpty && (loadingBooks || books.isEmpty))
                .opacity(selectedID.isEmpty && (loadingBooks || books.isEmpty) ? 0.5 : 1)
                .accessibilityIdentifier("agent.create")

                Text(initialNovel?.id == selectedID && !(afterChapterID ?? "").isEmpty
                     ? "开始前核对带入的续写起点，生成内容先存为草稿。"
                     : "开始前确认续写起点，生成内容先存为草稿。")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        .overlay {
            RoundedRectangle(cornerRadius: ReadingSpace.panelRadius)
                .strokeBorder(ReadingSpace.profileLine, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }

    private var bookSelection: some View {
        Button { showPicker = true } label: {
            HStack(spacing: 12) {
                selectedBookCover.accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedID.isEmpty ? "创作作品" : "当前作品")
                        .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                    Text(selectedID.isEmpty ? (books.isEmpty && !loadingBooks && booksError == nil
                         ? "还没有可创作的作品" : "选一本想写的书") : bookTitle)
                        .font(serifFont(.title3, .medium)).foregroundStyle(ReadingSpace.ink)
                        .multilineTextAlignment(.leading)
                        .appTextLineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if loadingBooks {
                    ProgressView().tint(ReadingSpace.ink).accessibilityLabel("正在加载作品")
                } else {
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .frame(width: 28, height: 28)
                        .background(ReadingSpace.profileFill, in: Circle())
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
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
            targetSize: CGSize(width: 44, height: 64),
            showsRetry: false
        ) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                ReadingSpace.profileFill
                Image(systemName: "book.closed")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: 44, height: 64)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private func setHistoryVisible(_ visible: Bool) {
        withAnimation(reduceMotion ? nil : AppMotion.structural) { showHistory = visible }
    }

    private func toggleHistory(isWide: Bool) {
        let opens = isWide ? !sidebarExpanded : !showHistory
        withAnimation(reduceMotion ? nil : AppMotion.structural) {
            if isWide { sidebarExpanded = opens }
            else { showHistory = opens }
        }
        if opens { Task { await loadSessions() } }
    }

    private func openSession(_ session: AIAgentSession) {
        guard appState.user?.isAdmin == true, APIClient.shared.token != nil else { return }
        activeSession = session
        setHistoryVisible(false)
    }

    private func beginNewConversation() {
        if let activeSession, books.contains(where: { $0.id == activeSession.novelId }) {
            selectedID = activeSession.novelId
        }
        activeSession = nil
        created = nil
        setHistoryVisible(false)
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
            if activeSession?.id == session.id { activeSession = nil }
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
