import SwiftUI
import ZhiZhouCore
private struct MessageWatchedBook: Decodable, Identifiable {
    let novelId: String
    let title: String
    var enabled: Bool
    let checksEnabled: Bool
    var id: String { novelId }
}
private struct MessageWatchedBooks: Decodable { let items: [MessageWatchedBook]; let hasMore: Bool }
struct MessageBookSubscriptionsView: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        MessageBookSubscriptionsContent()
            .id("\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)")
    }
}
private struct MessageBookSubscriptionsContent: View {
    @Environment(AppState.self) private var appState
    @State private var items: [MessageWatchedBook] = []
    @State private var search = ""
    @State private var offset = 0
    @State private var more = false
    @State private var isUpdating = false
    @State private var requests = ListRequestGuard<Query>()
    @State private var displayedQuery: Query?
    @State private var error: String?
    private var scope: String { "\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    private struct Query: Hashable {
        let scope: String
        let search: String
        let offset: Int
    }
    private var query: Query {
        Query(scope: scope, search: search.trimmingCharacters(in: .whitespacesAndNewlines), offset: offset)
    }
    private var busy: Bool { requests.isLoading || isUpdating }
    private var resultsCurrent: Bool { displayedQuery == query }
    private var canUseResults: Bool { resultsCurrent && !busy }
    var body: some View {
        List {
            Section { Text("仅订阅收藏的书。保存新章节后合并提醒；补录已有章节不通知。目录未知或更换书源时，首次检查只建立记录。").font(.footnote).foregroundStyle(.secondary) }
            if requests.isLoading { ProgressView(items.isEmpty ? "正在读取收藏…" : "正在更新结果…") }
            if displayedQuery != nil && !resultsCurrent {
                Text("当前显示上次载入的收藏，检索成功后可继续操作。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let error { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } }.disabled(busy) }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, book in
                HStack {
                    VStack(alignment: .leading, spacing: 6) { Text(book.title); if !book.checksEnabled { Text("站点尚未开启定时检查").font(.caption).foregroundStyle(.secondary) } }
                    Spacer()
                    Button(book.enabled ? "已订阅" : "订阅更新") { Task { await toggle(book) } }.disabled(!canUseResults)
                        .accessibilityLabel("\(book.enabled ? "取消" : "开启")《\(book.title)》更新提醒")
                }.modifier(MessageRowEntrance(index: index, identity: "\(displayedQuery?.search ?? "")|\(displayedQuery?.offset ?? 0)"))
                    .opacity(resultsCurrent ? 1 : 0.5)
            }
            if items.isEmpty && resultsCurrent && !busy { Text("没有找到收藏的书。").foregroundStyle(.secondary) }
            HStack {
                if offset > 0 { Button("上一页") { offset = max(0, offset - 30) } }
                Spacer()
                if more { Button("下一页") { offset += 30 } }
            }.disabled(!canUseResults)
        }.navigationTitle("书架追更提醒").readingSpaceNavigation()
            .searchable(text: $search, prompt: "搜索我的收藏")
            .onChange(of: search) { _, _ in offset = 0 }
            .task(id: query) { await load(debounce: true) }
            .onDisappear { requests.invalidate() }
    }
    private func load(debounce: Bool = false) async {
        let current = query
        let ticket = requests.begin(current)
        error = nil
        defer { requests.finish(ticket) }
        do {
            if debounce { try await Task.sleep(for: .milliseconds(250)) }
            try Task.checkCancellation()
            let result: MessageWatchedBooks = try await APIClient.shared.get("/api/notifications/watches?" + ReaderQuery.encode(["search": current.search, "offset": String(current.offset)]), auth: true)
            guard requests.accepts(ticket, query: query), !Task.isCancelled else { return }
            items = result.items
            more = result.hasMore
            displayedQuery = current
            requests.finish(ticket, succeeded: true)
        } catch {
            guard requests.accepts(ticket, query: query), !Task.isCancelled else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func toggle(_ book: MessageWatchedBook) async {
        guard canUseResults else { return }
        let owner = scope
        isUpdating = true
        defer { if owner == scope { isUpdating = false } }
        do {
            try await APIClient.shared.requestVoid("PUT", "/api/notifications/watches/" + ReaderMediaAPI.pathSegment(book.id), body: APIClient.shared.jsonBody(["enabled": !book.enabled]), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            if let index = items.firstIndex(where: { $0.id == book.id }) {
                items[index].enabled = !book.enabled
            }
            await load()
        } catch {
            if owner == scope, !Task.isCancelled { self.error = AppCopy.friendlyError(error) }
        }
    }
}
