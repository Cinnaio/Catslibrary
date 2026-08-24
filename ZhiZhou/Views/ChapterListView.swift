import SwiftUI

/// 章节目录（阅读器内 sheet）：点选跳转章节，打开时自动定位到当前章节。
struct ChapterListView: View {
    let novel: Novel
    let currentOrder: Int
    var initialChapters: [ChapterMeta] = []
    let onSelect: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

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
                        .onChange(of: chapters) { _, _ in
                            scrollToCurrent(proxy)
                        }
                        .onAppear {
                            scrollToCurrent(proxy)
                        }
                    }
                }
            }
            .navigationTitle("目录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
                "/api/chapters?novelId=\(novel.id)"
            )
            chapters = r.chapters
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func scrollToCurrent(_ proxy: ScrollViewProxy) {
        guard chapters.contains(where: { $0.order == currentOrder }) else { return }
        let attempts = reduceMotion ? 1 : 3
        for attempt in 0..<attempts {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.06 * Double(attempt)) {
                guard let current = chapters.first(where: { $0.order == currentOrder }) else { return }
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
}
