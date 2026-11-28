import SwiftUI
import Combine

private struct SourceThoughtText: View {
    let item: SourceThought
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                if let url = URL(string: item.avatarUrl) {
                    CachedAsyncImage(url: url, targetSize: CGSize(width: 28, height: 28), showsRetry: false) { image in
                        image.resizable().scaledToFill()
                    } placeholder: { Color.clear }
                    .frame(width: 28, height: 28).clipShape(Circle()).accessibilityHidden(true)
                }
                Text(item.displayName).font(.subheadline.weight(.medium))
                Text(label).font(.caption2).foregroundStyle(ReadingSpace.profileMuted)
                Spacer(minLength: 4)
            }
            if let name = item.replyToName, !name.isEmpty {
                Text("回复 \(name)").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            }
            Text(item.text).font(.body).textSelection(.enabled)
            if !item.images.isEmpty {
                ForEach(item.images, id: \.self) { value in
                    if let url = URL(string: value) {
                        CachedAsyncImage(url: url, targetSize: CGSize(width: 360, height: 360), previewTitle: "评论配图") { image in
                            image.resizable().scaledToFit().frame(maxHeight: 180)
                        } placeholder: { Label("评论配图", systemImage: "photo").frame(minHeight: 88) }
                        .accessibilityLabel("查看评论配图")
                    }
                }
            }
            HStack(spacing: 12) {
                Text("\(item.likeCount) 人赞过")
                Text(Date(timeIntervalSince1970: item.createdAt / 1000), style: .date)
            }.font(.caption).foregroundStyle(ReadingSpace.profileMuted)
        }.foregroundStyle(ReadingSpace.ink).frame(maxWidth: .infinity, alignment: .leading)
    }
}
private struct SourceThoughtRow: View {
    let item: SourceThought
    let anchor: SourceThoughtAnchor
    let label: String
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SourceThoughtText(item: item, label: label)
            if item.replyCount > 0 {
                Button { expanded.toggle() } label: {
                    Text(expanded ? "收起回复" : "查看回复（\(item.replyCount)）")
                        .font(.subheadline).frame(minHeight: AppLayout.minimumTouchTarget)
                }
                    .accessibilityValue(expanded ? "已展开" : "已折叠")
                if expanded {
                    SourceReplyList(anchor: anchor, commentID: item.id, label: label)
                        .padding(.leading, 14)
                }
            }
        }
    }
}
@MainActor private final class SourcePageStore: ObservableObject {
    @Published var page: SourceThoughtPage?
    @Published var loading = false
    @Published var error: String?
    private var generation = UUID()
    func load(anchor: SourceThoughtAnchor, cursor: String, commentID: String? = nil) async {
        let generation = UUID()
        self.generation = generation
        loading = true; error = nil
        do {
            var next = try await SourceThoughtsAPI.page(anchor: anchor, cursor: cursor, commentID: commentID)
            guard !Task.isCancelled, self.generation == generation else { return }
            let old = page?.items ?? []
            let ids = Set(old.map(\.id))
            next.items = old + next.items.filter { !ids.contains($0.id) }
            page = next
        } catch {
            guard !Task.isCancelled, self.generation == generation else { return }
            self.error = "来源想法加载失败，请稍后重试。"
        }
        loading = false
    }
}
private struct SourceReplyList: View {
    let anchor: SourceThoughtAnchor
    let commentID: String
    let label: String
    @StateObject private var store = SourcePageStore()
    @State private var cursor = ""
    @State private var attempt = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array((store.page?.items ?? []).enumerated()), id: \.element.id) { index, item in
                SourceThoughtText(item: item, label: label).readingSpaceEntrance(index)
            }
            SourcePageFooter(loading: store.loading, error: store.error, hasMore: store.page?.hasMore == true,
                onRetry: { attempt += 1 }, onMore: { cursor = store.page?.cursor ?? "" })
        }.task(id: "\(cursor):\(attempt)") { await store.load(anchor: anchor, cursor: cursor, commentID: commentID) }
    }
}
private struct SourcePageFooter: View {
    let loading: Bool
    let error: String?
    let hasMore: Bool
    let onRetry: () -> Void
    let onMore: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if loading { ProgressView("正在加载来源想法…").font(.caption) }
            if let error {
                Text(error).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                Button(action: onRetry) { Text("重试").frame(minHeight: AppLayout.minimumTouchTarget) }.disabled(loading)
            } else if hasMore && !loading {
                Button(action: onMore) { Text("加载更多").frame(minHeight: AppLayout.minimumTouchTarget) }
            }
        }
    }
}
struct SourceThoughtListView: View {
    let anchor: SourceThoughtAnchor
    let label: String
    @StateObject private var store = SourcePageStore()
    @State private var cursor = ""
    @State private var attempt = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array((store.page?.items ?? []).enumerated()), id: \.element.id) { index, item in
                SourceThoughtRow(item: item, anchor: anchor, label: label).readingSpaceEntrance(index)
                Divider()
            }
            if !store.loading && store.error == nil && store.page?.items.isEmpty == true {
                Text("这一段暂时没有\(label)想法。").font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            }
            SourcePageFooter(loading: store.loading, error: store.error, hasMore: store.page?.hasMore == true,
                onRetry: { attempt += 1 }, onMore: { cursor = store.page?.cursor ?? "" })
        }.task(id: "\(cursor):\(attempt)") { await store.load(anchor: anchor, cursor: cursor) }
    }
}
