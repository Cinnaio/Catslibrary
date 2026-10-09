import SwiftUI

/// Shared pagination for new read-only admin records. Offset follows raw server rows, not deduped UI count.
struct AdminRecordList<Item: Decodable & Identifiable, Row: View>: View where Item.ID: Hashable {
    let title: String
    var query = ""
    let fetch: (Int) async throws -> AdminRecordPage<Item>
    let row: (Item) -> Row
    @State private var items: [Item] = []
    @State private var total = 0
    @State private var offset = 0
    @State private var loading = false
    @State private var error: String?
    @State private var requestID = UUID()
    @State private var exhausted = false
    @State private var retryMore = false

    var body: some View {
        List {
            if let error {
                LoadErrorNotice(message: error, isLoading: loading) { Task { await load(more: retryMore) } }
            }
            if loading && items.isEmpty { ProgressView("加载中…") }
            if !loading && error == nil && items.isEmpty {
                ContentUnavailableView("暂无记录", systemImage: "tray")
                    .listRowBackground(Color.clear)
            }
            ForEach(items) { row($0) }
            if !exhausted && offset < total {
                Button(loading ? "加载中…" : "加载更多（\(items.count)/\(total)）") {
                    Task { await load(more: true) }
                }
                .disabled(loading)
                .accessibilityIdentifier("admin.records.more")
            }
        }
        .appListStyle(.settings)
        .navigationTitle(title)
        .refreshable { await load(more: false) }
        .task(id: query + ContentAccessStore.shared.accountRevision.uuidString) {
            items = []; offset = 0; total = 0; error = nil
            await load(more: false)
        }
    }

    private func load(more: Bool) async {
        if more && loading { return }
        let id = UUID()
        requestID = id
        let token = APIClient.shared.token
        let account = ContentAccessStore.shared.accountRevision
        let next = more ? offset : 0
        retryMore = more
        loading = true
        defer { if requestID == id { loading = false } }
        do {
            let page = try await fetch(next)
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token,
                  account == ContentAccessStore.shared.accountRevision else { return }
            var existing: Set<Item.ID> = more ? Set(items.map(\.id)) : []
            let rows = page.items.filter { existing.insert($0.id).inserted }
            items = more ? items + rows : rows
            offset = next + page.items.count
            total = page.total
            exhausted = page.items.isEmpty
            error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token,
                  account == ContentAccessStore.shared.accountRevision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

/// Web authentication stays in the browser; never put App tokens in URLs.
struct AdminWebLink: View {
    let title: String
    let path: String
    var body: some View {
        if let base = ServerConfig.shared.baseURL, let url = URL(string: path, relativeTo: base)?.absoluteURL {
            Link(destination: url) { Label(title, systemImage: "safari") }
                .accessibilityIdentifier("admin.web.\(path)")
        }
    }
}

enum AdminParityCopy {
    static func state(_ value: String) -> String {
        switch value {
        case "pending", "queued": return "等待中"
        case "running": return "运行中"
        case "success", "completed": return "成功"
        case "failure", "failed": return "失败"
        case "partial": return "部分完成"
        case "interrupted": return "已中断"
        case "preview": return "待提交预览"
        case "applied": return "已导入"
        case "rolled_back": return "已撤回"
        case "new": return "新增"
        case "changed": return "有改动"
        case "unchanged": return "无变化"
        case "conflict": return "冲突"
        default: return value
        }
    }
}
