import SwiftUI
import ZhiZhouCore

private struct WidgetResolvedItem: Decodable { let item: LibraryWidgetItem }
private struct WidgetNovelResponse: Decodable { let novel: Novel }

struct LibraryWidgetDestination: View {
    let route: LibraryWidgetRoute
    @Environment(\.dismiss) private var dismiss
    @State private var target: LibraryWidgetItem?
    @State private var novel: Novel?
    @State private var error: String?
    @State private var retry = 0

    var body: some View {
        NavigationStack {
            Group {
                if let novel, let target {
                    ReaderView(novel: novel, chapterOrder: target.chapterOrder,
                               searchQuery: route.kind == "quote" ? target.text : "", initialChapterID: target.chapterId)
                } else if let error {
                    ContentUnavailableView {
                        Label("暂时无法打开", systemImage: "book.closed")
                    } description: { Text(error) } actions: {
                        Button("重试") { retry += 1 }
                        Button("回到书房") { dismiss() }
                    }
                } else {
                    AppLoadingState("正在翻到那一页…")
                        .frame(maxHeight: .infinity)
                        .background(ReadingSpace.profilePaper)
                }
            }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("返回书房", systemImage: "chevron.down") { dismiss() } } }
            .task(id: retry) { await resolve() }
        }
    }
    private func resolve() async {
        let token = APIClient.shared.token
        guard route.scope == LibraryWidgetStore.shared.scope, token != nil else { dismiss(); return }
        error = nil
        do {
            let query = ReaderQuery.encode(["kind": route.kind, "id": route.itemID])
            let result: WidgetResolvedItem = try await APIClient.shared.get("/api/bookshelf/widgets/open?" + query, auth: true)
            guard token == APIClient.shared.token, route.scope == LibraryWidgetStore.shared.scope, !Task.isCancelled else { return }
            let detail: WidgetNovelResponse = try await APIClient.shared.getReader("/api/novels/" + ReaderMediaAPI.pathSegment(result.item.novelId), auth: true)
            guard token == APIClient.shared.token, route.scope == LibraryWidgetStore.shared.scope, !Task.isCancelled else { return }
            guard detail.novel.contentRating != "restricted" else { throw APIError.http(status: 403, message: "这本书暂不可从小组件打开") }
            target = result.item; novel = detail.novel
        } catch {
            guard token == APIClient.shared.token, route.scope == LibraryWidgetStore.shared.scope, !Task.isCancelled else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
