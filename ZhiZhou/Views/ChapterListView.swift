import SwiftUI
import ZhiZhouCore

/// 章节目录（阅读器内 sheet）：点选跳转章节，打开时自动定位到当前章节。
struct ChapterListView: View {
    let novel: Novel
    let currentOrder: Int
    var initialChapters: [ChapterMeta] = []
    let onSelect: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(OfflineReadingStore.self) private var offlineStore
    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasScrolledToCurrent = false
    @State private var isShowingOffline = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && chapters.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, chapters.isEmpty {
                    ContentUnavailableView {
                        Label("目录加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                } else {
                    ScrollViewReader { proxy in
                        List(chapters) { chapter in
                            Button {
                                dismiss()
                                onSelect(chapter.order)
                            } label: {
                                HStack(spacing: 12) {
                                    Text("\(chapter.order)")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(chapter.order == currentOrder ? AppTheme.primary : Color.secondary)
                                        .frame(minWidth: 28, alignment: .trailing)
                                    Text(chapter.title)
                                        .font(.subheadline)
                                        .foregroundStyle(chapter.order == currentOrder ? AppTheme.primary : Color.primary)
                                        .lineLimit(2)
                                    Spacer()
                                    if chapter.order == currentOrder {
                                        Image(systemName: "checkmark")
                                            .font(.subheadline.weight(.bold))
                                            .foregroundStyle(AppTheme.primary)
                                            .accessibilityHidden(true)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(
                                chapter.order == currentOrder
                                    ? AppTheme.primary.opacity(0.12)
                                    : Color.clear
                            )
                            .id(chapter.id)
                            .accessibilityAddTraits(chapter.order == currentOrder ? [.isSelected] : [])
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .listRowSeparatorTint(AppTheme.border)
                        .onAppear {
                            scrollToCurrent(proxy)
                        }
                        .onChange(of: chapters) { _, _ in
                            hasScrolledToCurrent = false
                            scrollToCurrent(proxy)
                        }
                    }
                }
            }
            .navigationTitle("目录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if isShowingOffline {
                    ToolbarItem(placement: .topBarLeading) {
                        Label("离线", systemImage: "wifi.slash")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        if chapters.isEmpty, !initialChapters.isEmpty {
            chapters = initialChapters
            return
        }
        if !chapters.isEmpty { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let r: ChaptersResponse = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/chapters?novelId=\(novel.id)")
            )
            chapters = r.chapters
            isShowingOffline = false
            errorMessage = nil
        } catch {
            let saved = offlineStore.chapters(for: novel.id)
            if !saved.isEmpty {
                chapters = saved
                isShowingOffline = true
                errorMessage = nil
            } else {
                errorMessage = AppCopy.friendlyError(error)
            }
        }
    }

    private func scrollToCurrent(_ proxy: ScrollViewProxy) {
        guard !hasScrolledToCurrent,
              let current = chapters.first(where: { $0.order == currentOrder }) else { return }
        hasScrolledToCurrent = true
        // 等一次 runloop，让 List 完成数据更新后的布局
        DispatchQueue.main.async {
            if reduceMotion {
                proxy.scrollTo(current.id, anchor: .center)
            } else {
                withAnimation(.easeOut(duration: 0.22)) {
                    proxy.scrollTo(current.id, anchor: .center)
                }
            }
        }
    }
}
