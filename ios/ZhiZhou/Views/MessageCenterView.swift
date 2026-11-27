import SwiftUI
import ZhiZhouCore

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
        MessageInboxView().id("\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)")
    }
}
private struct MessageInboxView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var items: [LibraryMessage] = []
    @State private var unread = 0
    @State private var onlyUnread = false
    @State private var hasMore = false
    @State private var requests = ListRequestGuard<Query>()
    @State private var displayedQuery: Query?
    @State private var isUpdating = false
    @State private var error: String?
    private var scope: String { "\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    private struct Query: Hashable {
        let scope: String
        let onlyUnread: Bool
    }
    private var query: Query { Query(scope: scope, onlyUnread: onlyUnread) }
    private var busy: Bool { requests.isLoading || isUpdating }
    private var resultsCurrent: Bool { displayedQuery == query }
    private var canUseResults: Bool { resultsCurrent && !busy }
    var body: some View {
        AccountSettingsList {
            AccountSettingsHeading("消息中心", detail: "评论回复、追更与任务进展，都收在这里。")
                .padding(.bottom, 24)
                .readingSpaceEntrance(0)
            Section {
                Picker("消息筛选", selection: $onlyUnread) { Text("全部").tag(false); Text("未读 \(unread)").tag(true) }.accessibleSegmentedPicker().padding(.bottom, 12).accessibilityIdentifier("messages.filter")
                NavigationLink { MessageSettingsView() } label: {
                    AccountSettingsActionLabel(title: "通知设置", symbol: "bell.badge")
                }
                .padding(.bottom, 16)
                .accessibilityIdentifier("messages.settings.entry")
            }
            if requests.isLoading { ProgressView(items.isEmpty ? "正在读取消息…" : "正在更新消息…") }
            if !items.isEmpty && !resultsCurrent {
                Text("当前显示上次载入的消息，筛选成功后可继续操作。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("messages.stale")
            }
            if let error {
                AccountSettingsNote(error, isError: true)
                Button { Task { await load() } } label: {
                    AccountSettingsActionLabel(title: "重试", symbol: "arrow.clockwise")
                }
                .disabled(busy).accessibilityIdentifier("messages.retry")
            }
            Section {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    NavigationLink { MessageDetailView(id: item.id) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(item.readAt == nil ? AppTheme.primary : .clear).frame(width: 7, height: 7).padding(.top, 7)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.title).font(serifFont(.headline, .medium)).foregroundStyle(ReadingSpace.ink)
                                if !item.body.isEmpty { Text(item.body).foregroundStyle(.secondary) }
                                Text(Date(timeIntervalSince1970: item.createdAt / 1000), format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 16)
                            .overlay(alignment: .bottom) {
                                ReadingSpace.profileLine.frame(height: 0.5).accessibilityHidden(true)
                            }
                    }.accessibilityLabel("\(item.readAt == nil ? "未读，" : "")\(item.title)，\(item.body)")
                        .modifier(MessageRowEntrance(index: index, identity: String(displayedQuery?.onlyUnread ?? false)))
                        .opacity(resultsCurrent ? 1 : 0.5)
                        .disabled(!canUseResults)
                        .accessibilityIdentifier("messages.row.\(item.id)")
                }
                if items.isEmpty && resultsCurrent && !busy {
                    Text(onlyUnread ? "暂时没有未读消息。" : "这里会收下新的评论回复和任务结果。")
                        .foregroundStyle(.secondary)
                }
                if hasMore {
                    Button { Task { await load(more: true) } } label: {
                        AccountSettingsActionLabel(title: "加载更多", symbol: "arrow.down")
                    }
                    .disabled(!canUseResults).accessibilityIdentifier("messages.more")
                }
            }
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("全部已读") { Task { await markAll() } }.disabled(busy || unread == 0) } }
        .refreshable { await load() }
        .task(id: query) { await load() }
        .onChange(of: scenePhase) { _, value in if value == .active { Task { await load() } } }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: onlyUnread)
        .onDisappear { requests.invalidate() }
    }
    private func load(more: Bool = false) async {
        let current = query
        let ticket: ListRequestGuard<Query>.Ticket
        if more {
            guard canUseResults, hasMore, let next = requests.beginNext(current) else { return }
            ticket = next
        } else {
            ticket = requests.begin(current)
        }
        error = nil
        defer { requests.finish(ticket) }
        var parameters = ["unread": current.onlyUnread ? "1" : "0"]
        if more, let last = items.last {
            parameters["before"] = String(Int64(last.createdAt))
            parameters["beforeId"] = last.id
        }
        do {
            let result: LibraryMessagePage = try await APIClient.shared.get("/api/notifications?" + ReaderQuery.encode(parameters), auth: true)
            guard requests.accepts(ticket, query: query), !Task.isCancelled else { return }
            items = more ? items + result.items.filter { next in !items.contains { $0.id == next.id } } : result.items
            unread = result.unread
            hasMore = result.hasMore
            displayedQuery = current
            requests.finish(ticket, succeeded: true)
        } catch {
            guard requests.accepts(ticket, query: query), !Task.isCancelled else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func markAll() async {
        guard !busy else { return }
        let owner = scope
        isUpdating = true
        defer { if owner == scope { isUpdating = false } }
        do {
            try await APIClient.shared.requestVoid("POST", "/api/notifications/read", body: JSONEncoder().encode(MessageRead(all: true)), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            unread = 0
            displayedQuery = nil
            await load()
        } catch {
            if owner == scope, !Task.isCancelled { self.error = AppCopy.friendlyError(error) }
        }
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
        AccountSettingsPage {
            if let detail {
                AccountSettingsHeading(detail.item.title, detail: detail.item.body)
                Text(detail.text).foregroundStyle(ReadingSpace.ink).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !detail.taskId.isEmpty {
                    NavigationLink { AdminAITasksView(taskID: detail.taskId) } label: {
                        AccountSettingsActionLabel(title: "查看任务详情", symbol: "list.bullet.rectangle")
                    }
                }
                if !detail.href.isEmpty {
                    AdminWebLink(title: detail.linkLabel + "（网页）", path: detail.href)
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                }
            } else {
                AccountSettingsHeading("消息详情")
                if error == nil { ProgressView("正在读取消息…") }
            }
            if let error {
                AccountSettingsNote(error, isError: true)
                Button { retry += 1 } label: {
                    AccountSettingsActionLabel(title: "重试", symbol: "arrow.clockwise")
                }
            }
        }.task(id: scope) {
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

struct MessageCenterEntry<RowLabel: View>: View {
    @ViewBuilder let label: (Int) -> RowLabel
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var unread = 0
    private var scope: String { "\(appState.user?.id ?? "")|\(ServerConfig.serverURL)|\(ContentAccessStore.shared.mode)" }
    var body: some View {
        NavigationLink(value: ProfileRoute.messages) { label(unread) }
            .accessibilityIdentifier("messages.entry")
            .task(id: scope) { await refresh() }
            .onChange(of: scenePhase) { _, value in
                if value == .active { Task { await refresh() } }
            }
    }
    private func refresh() async {
        let owner = scope; unread = 0
        guard appState.user != nil else { return }
        if let page: LibraryMessagePage = try? await APIClient.shared.get("/api/notifications?unread=1", auth: true), owner == scope, !Task.isCancelled { unread = page.unread }
    }
}
