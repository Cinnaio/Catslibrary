import SwiftUI

struct ProfileReadingHistoryView: View {
    let store: ProfileReadingStore
    @State private var pendingDelete: RecentItem?
    @State private var isDeleting = false
    @State private var actionError: String?

    var body: some View {
        List {
            if let error = store.errorMessage {
                Section {
                    Text(error).foregroundStyle(AppTheme.textSecondary)
                    Button("重试", systemImage: "arrow.clockwise") {
                        Task { await store.refresh() }
                    }
                    .disabled(store.isLoading)
                }
            }
            ForEach(store.recent) { item in
                NavigationLink {
                    ReaderView(novel: item.asNovel, chapterOrder: item.chapterOrder)
                } label: {
                    ProfileRecentBookRow(item: item)
                        .padding(.vertical, 4)
                }
                .swipeActions {
                    Button("删除记录", systemImage: "trash", role: .destructive) {
                        pendingDelete = item
                    }
                    .disabled(isDeleting)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("最近阅读")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if store.recent.isEmpty && store.errorMessage == nil {
                if store.isLoading {
                    ProgressView("正在加载阅读记录")
                } else {
                    ContentUnavailableView("暂无阅读记录", systemImage: "clock")
                }
            }
        }
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
        .confirmationDialog(
            "删除这条阅读记录？",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { item in
            Button("删除记录", role: .destructive) {
                Task {
                    isDeleting = true
                    defer { isDeleting = false }
                    if await ReaderProgressStore.shared.delete(novelID: item.novelId) {
                        await store.refresh()
                        AppFeedback.success("阅读记录已删除")
                    } else {
                        actionError = "删除请求尚未同步，请稍后重试。"
                    }
                }
            }
        } message: { item in
            Text(item.novelTitle)
        }
        .alert("操作未完成", isPresented: Binding(
            get: { actionError != nil }, set: { if !$0 { actionError = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }
}

struct ProfileRecentBookRow: View {
    let item: RecentItem

    var body: some View {
        HStack(spacing: 14) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(novelId: item.novelId, updatedAt: item.updatedAt),
                targetSize: CGSize(width: 44, height: 62),
                showsRetry: false
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                AppTheme.primaryLight.overlay {
                    Image(systemName: "book.closed").foregroundStyle(AppTheme.primary)
                }
            }
            .frame(width: 44, height: 62)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(item.novelTitle)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text(item.chapterTitle.isEmpty ? "第 \(item.chapterOrder) 章" : item.chapterTitle)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(2)
                Text("本章已读 \(percent)% · \(AppFormat.relativeTime(item.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var percent: Int {
        guard item.scrollPercent.isFinite else { return 0 }
        return Int((min(max(item.scrollPercent, 0), 1) * 100).rounded())
    }
}
