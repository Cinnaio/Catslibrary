import SwiftUI
import ZhiZhouCore

/// The book is the immutable navigation context; children never need to select it again.
struct AdminNovelWorkspaceView: View {
    let novel: Novel
    var afterChapterID: String? = nil
    @Environment(AppState.self) private var appState
    @State private var current: Novel?
    @State private var showEditor = false
    @State private var updating = false
    @State private var error: String?
    @State private var notice: String?
    @State private var ownerID: String?
    private var book: Novel { current ?? novel }

    var body: some View {
        Group {
            if appState.user?.isAdmin == true { workspace }
            else { ContentUnavailableView("需要管理员权限", systemImage: "lock.shield") }
        }
        .navigationTitle("管理这本书")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ContentAccessStore.shared.accountRevision) { await refresh() }
        .sheet(isPresented: $showEditor) {
            NovelEditSheet(novel: book) { updated in
                current = updated
                recordRecent(updated)
            }
        }
    }

    private var workspace: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(book.title).font(serifFont(.title2, .semibold))
                    Text("\(book.author) · \(book.chapterCount) 章").foregroundStyle(AppTheme.textSecondary)
                }
                .padding(.vertical, 8)
                .accessibilityIdentifier("admin.workspace.book")
            }
            if let error { LoadErrorNotice(message: error, isLoading: updating) { Task { await refresh() } } }
            if let notice { Text(notice).foregroundStyle(AppTheme.success) }
            Section("作品与章节") {
                Button("修改作品资料", systemImage: "pencil") { showEditor = true }
                NavigationLink { AdminChaptersView(initialNovel: book) } label: {
                    Label("管理章节", systemImage: "doc.text")
                }
                NavigationLink { AdminFollowupView(novel: book) } label: {
                    Label("追更设置", systemImage: "clock.arrow.circlepath")
                }
                Button {
                    Task { await updateChapters() }
                } label: {
                    HStack {
                        Label("检查并更新章节", systemImage: "arrow.triangle.2.circlepath")
                        if updating { Spacer(); ProgressView() }
                    }
                }
                .disabled(updating)
                .accessibilityIdentifier("admin.workspace.update")
            }
            Section("创作与封面") {
                NavigationLink {
                    AdminAIWritingView(initialNovel: book, afterChapterID: afterChapterID)
                } label: { Label(afterChapterID == nil ? "创作与续写" : "从当前章节续写", systemImage: "pencil.and.outline") }
                .accessibilityIdentifier("admin.workspace.writing")
                NavigationLink { AdminAICoverView(initialNovel: book) } label: {
                    Label("生成与管理封面", systemImage: "photo.on.rectangle.angled")
                }
                .accessibilityIdentifier("admin.workspace.cover")
                NavigationLink { AdminAIGenerationsView(novelID: book.id) } label: {
                    Label("本书草稿与发布记录", systemImage: "doc.text.magnifyingglass")
                }
                .accessibilityIdentifier("admin.workspace.generations")
            }
            Section {
                NavigationLink { AdminTaskInboxView(novelID: book.id) } label: {
                    Label("本书任务", systemImage: "shippingbox")
                }
            }
        }
        .appListStyle(.settings)
        .refreshable { await refresh() }
    }

    private func recordRecent(_ novel: Novel) {
        guard let user = appState.user, user.isAdmin, user.id == ownerID else { return }
        AdminWorkspaceLocalStore().record(AdminRecentBook(id: novel.id, title: novel.title, author: novel.author,
            visitedAt: Int64(Date().timeIntervalSince1970 * 1000)), userID: user.id)
    }

    private func refresh() async {
        guard appState.user?.isAdmin == true, let token = APIClient.shared.token else { return }
        ownerID = appState.user?.id
        do {
            let response: NovelResponse = try await AdminAPI.parityRequest("GET", "/api/novels/\(ReaderMediaAPI.pathSegment(novel.id))", token: token)
            guard !Task.isCancelled, APIClient.shared.token == token, response.novel.id == novel.id else { return }
            current = response.novel
            recordRecent(response.novel)
            error = nil
        } catch is CancellationError { return }
        catch { if APIClient.shared.token == token { self.error = AppCopy.friendlyError(error) } }
    }

    private func updateChapters() async {
        guard !updating, let token = APIClient.shared.token else { return }
        updating = true
        defer { updating = false }
        do {
            let _: AdminJobActionResponse = try await AdminAPI.parityRequest("POST", "/api/scrape",
                body: ["action": "update", "novelId": book.id], token: token)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            notice = "更新已提交，可在本书任务中查看进度。"
            error = nil
        } catch { if APIClient.shared.token == token { self.error = AppCopy.friendlyError(error) } }
    }
}

struct AdminNovelWorkspaceSheet: View {
    let novel: Novel
    var afterChapterID: String? = nil
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            AdminNovelWorkspaceView(novel: novel, afterChapterID: afterChapterID)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
        }
    }
}

struct AdminNovelWorkspaceLoader: View {
    let novelID: String
    @State private var novel: Novel?
    @State private var error: String?
    var body: some View {
        Group {
            if let novel { AdminNovelWorkspaceView(novel: novel) }
            else if let error {
                ContentUnavailableView {
                    Label("无法打开作品", systemImage: "book.closed")
                } description: { Text(error) } actions: { Button("重试") { Task { await load() } } }
            } else { ProgressView("正在读取作品…") }
        }
        .task(id: ContentAccessStore.shared.accountRevision) { await load() }
    }
    private func load() async {
        guard let token = APIClient.shared.token else { return }
        do {
            let response: NovelResponse = try await AdminAPI.parityRequest("GET", "/api/novels/\(ReaderMediaAPI.pathSegment(novelID))", token: token)
            guard !Task.isCancelled, APIClient.shared.token == token, response.novel.id == novelID else { return }
            novel = response.novel; error = nil
        } catch { if !Task.isCancelled, APIClient.shared.token == token { self.error = AppCopy.friendlyError(error) } }
    }
}
