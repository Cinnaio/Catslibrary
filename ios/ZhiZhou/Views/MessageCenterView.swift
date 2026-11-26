import SwiftUI

struct LibraryMessage: Decodable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let createdAt: Double
    let readAt: Double?
}
struct LibraryMessagePage: Decodable { let items: [LibraryMessage]; let unread: Int; let hasMore: Bool }
private struct LibraryMessageDetail: Decodable {
    let item: LibraryMessage
    let text: String
    let href: String
    let linkLabel: String
    let novelId: String
    let taskId: String
}
private struct MessageRead: Encodable { var id: String? = nil; var all: Bool? = nil }

struct MessageCenterView: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        MessageInboxView().id("\(appState.user?.id ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)")
    }
}
private struct MessageInboxView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var items: [LibraryMessage] = []
    @State private var unread = 0
    @State private var onlyUnread = false
    @State private var hasMore = false
    @State private var busy = false
    @State private var generation = 0
    @State private var error: String?
    private var scope: String { "\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    var body: some View {
        List {
            Section {
                Picker("消息筛选", selection: $onlyUnread) { Text("全部").tag(false); Text("未读 \(unread)").tag(true) }.pickerStyle(.segmented)
                NavigationLink { MessageSettingsView() } label: { Label("通知设置", systemImage: "bell.badge") }
            }
            if let error { Section { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } } }
            Section {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    NavigationLink { MessageDetailView(id: item.id) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(item.readAt == nil ? AppTheme.primary : .clear).frame(width: 7, height: 7).padding(.top, 7)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.title).font(.headline)
                                if !item.body.isEmpty { Text(item.body).foregroundStyle(.secondary) }
                                Text(Date(timeIntervalSince1970: item.createdAt / 1000), format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 6)
                    }.accessibilityLabel("\(item.readAt == nil ? "未读，" : "")\(item.title)，\(item.body)")
                        .modifier(MessageRowEntrance(index: index, identity: String(onlyUnread)))
                }
                if items.isEmpty { Text(busy ? "正在读取消息…" : "这里会收下新的评论回复和任务结果。").foregroundStyle(.secondary) }
                if hasMore { Button("加载更多") { Task { await load(more: true) } }.disabled(busy) }
            }
        }
        .navigationTitle("消息中心").readingSpaceNavigation().scrollContentBackground(.hidden).background(ReadingSpace.profilePaper)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("全部已读") { Task { await markAll() } }.disabled(busy || unread == 0) } }
        .refreshable { await load() }
        .task(id: onlyUnread) { await load() }
        .onChange(of: scenePhase) { _, value in if value == .active { Task { await load() } } }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: onlyUnread)
        .onDisappear { generation += 1 }
    }
    private func load(more: Bool = false) async {
        generation += 1; let expected = generation, owner = scope
        busy = true
        defer { if expected == generation { busy = false } }
        var parameters = ["unread": onlyUnread ? "1" : "0"]
        if more, let last = items.last { parameters["before"] = String(Int64(last.createdAt)); parameters["beforeId"] = last.id }
        do {
            let result: LibraryMessagePage = try await APIClient.shared.get("/api/notifications?" + ReaderQuery.encode(parameters), auth: true)
            guard owner == scope, expected == generation, !Task.isCancelled else { return }
            items = more ? items + result.items.filter { next in !items.contains { $0.id == next.id } } : result.items
            unread = result.unread; hasMore = result.hasMore; error = nil
        } catch { if owner == scope, expected == generation, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
    private func markAll() async {
        guard !busy else { return }; busy = true
        let owner = scope
        do {
            try await APIClient.shared.requestVoid("POST", "/api/notifications/read", body: JSONEncoder().encode(MessageRead(all: true)), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            await load()
        } catch { if owner == scope { self.error = AppCopy.friendlyError(error); busy = false } }
    }
}
struct MessageRowEntrance: ViewModifier {
    let index: Int
    let identity: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    func body(content: Content) -> some View {
        content.opacity(reduceMotion || appeared ? 1 : 0).offset(y: reduceMotion || appeared ? 0 : 4)
            .task(id: identity) {
                appeared = false
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18).delay(min(Double(index) * 0.018, 0.22))) { appeared = true }
            }
    }
}
private struct MessageDetailView: View {
    let id: String
    @Environment(AppState.self) private var appState
    @State private var detail: LibraryMessageDetail?
    @State private var error: String?
    @State private var retry = 0
    private var scope: String { "\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)|\(retry)" }
    var body: some View {
        List {
            if let detail {
                Section {
                    Text(detail.item.title).font(serifFont(.title2, .semibold))
                    if !detail.item.body.isEmpty { Text(detail.item.body).foregroundStyle(.secondary) }
                    Text(detail.text).textSelection(.enabled)
                }
                if !detail.taskId.isEmpty {
                    NavigationLink("查看任务详情") { AdminAITasksView(taskID: detail.taskId) }
                }
                if !detail.href.isEmpty { AdminWebLink(title: detail.linkLabel + "（网页）", path: detail.href) }
            } else if error == nil { ProgressView("正在读取消息…") }
            if let error { Text(error).foregroundStyle(.red); Button("重试") { retry += 1 } }
        }.navigationTitle("消息详情").readingSpaceNavigation().task(id: scope) {
            let owner = scope; detail = nil; error = nil
            do {
                let result: LibraryMessageDetail = try await APIClient.shared.get("/api/notifications/" + ReaderMediaAPI.pathSegment(id), auth: true)
                guard owner == scope, !Task.isCancelled else { return }
                detail = result
                try await APIClient.shared.requestVoid("POST", "/api/notifications/read", body: JSONEncoder().encode(MessageRead(id: id)), auth: true)
            } catch { if owner == scope, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
        }
    }
}

struct MessageCenterEntry: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var unread = 0
    private var scope: String { "\(appState.user?.id ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    var body: some View {
        NavigationLink { MessageCenterView() } label: {
            HStack { Label("消息中心", systemImage: "bell"); Spacer(); if unread > 0 { Text("\(unread) 条未读").font(.caption).foregroundStyle(.secondary) }; Image(systemName: "chevron.right").font(.caption) }.padding(.vertical, 10)
        }.task(id: scope) { await refresh() }.onChange(of: scenePhase) { _, value in if value == .active { Task { await refresh() } } }
    }
    private func refresh() async {
        let owner = scope; unread = 0
        guard appState.user != nil else { return }
        if let page: LibraryMessagePage = try? await APIClient.shared.get("/api/notifications?unread=1", auth: true), owner == scope, !Task.isCancelled { unread = page.unread }
    }
}
