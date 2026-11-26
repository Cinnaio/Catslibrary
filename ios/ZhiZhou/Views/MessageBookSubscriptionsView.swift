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
    @State private var items: [MessageWatchedBook] = []
    @State private var search = ""
    @State private var offset = 0
    @State private var more = false
    @State private var busy = false
    @State private var error: String?
    @State private var generation = 0
    private var scope: String { "\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    var body: some View {
        List {
            Section { Text("仅订阅收藏的书。保存新章节后合并提醒；补录已有章节不通知。目录未知或更换书源时，首次检查只建立记录。").font(.footnote).foregroundStyle(.secondary) }
            if let error { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, book in
                HStack {
                    VStack(alignment: .leading, spacing: 6) { Text(book.title); if !book.checksEnabled { Text("站点尚未开启定时检查").font(.caption).foregroundStyle(.secondary) } }
                    Spacer()
                    Button(book.enabled ? "已订阅" : "订阅更新") { Task { await toggle(book) } }.disabled(busy)
                        .accessibilityLabel("\(book.enabled ? "取消" : "开启")《\(book.title)》更新提醒")
                }.modifier(MessageRowEntrance(index: index, identity: "\(search)|\(offset)"))
            }
            if items.isEmpty { Text(busy ? "正在读取收藏…" : "没有找到收藏的书。").foregroundStyle(.secondary) }
            HStack {
                if offset > 0 { Button("上一页") { offset = max(0, offset - 30) } }
                Spacer()
                if more { Button("下一页") { offset += 30 } }
            }.disabled(busy)
        }.navigationTitle("书架追更提醒").readingSpaceNavigation()
            .searchable(text: $search, prompt: "搜索我的收藏")
            .onChange(of: search) { _, _ in offset = 0 }
            .task(id: "\(scope)|\(search)|\(offset)") { await load() }
            .onDisappear { generation += 1 }
    }
    private func load() async {
        generation += 1; let seq = generation, owner = scope; busy = true
        defer { if seq == generation { busy = false } }
        do {
            let result: MessageWatchedBooks = try await APIClient.shared.get("/api/notifications/watches?" + ReaderQuery.encode(["search": search, "offset": String(offset)]), auth: true)
            guard owner == scope, seq == generation, !Task.isCancelled else { return }
            items = result.items; more = result.hasMore; error = nil
        } catch { if owner == scope, seq == generation, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
    private func toggle(_ book: MessageWatchedBook) async {
        guard !busy else { return }; let owner = scope, seq = generation; busy = true
        defer { if seq == generation { busy = false } }
        do {
            try await APIClient.shared.requestVoid("PUT", "/api/notifications/watches/" + ReaderMediaAPI.pathSegment(book.id), body: APIClient.shared.jsonBody(["enabled": !book.enabled]), auth: true)
            guard owner == scope, seq == generation, !Task.isCancelled else { return }
            if let index = items.firstIndex(where: { $0.id == book.id }) { items[index].enabled.toggle() }; error = nil
        } catch { if owner == scope, seq == generation { self.error = AppCopy.friendlyError(error) } }
    }
}
