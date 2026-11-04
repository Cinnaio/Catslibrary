import SwiftUI
import ZhiZhouCore

/// 章节目录（阅读器内 sheet）：点选跳转章节，打开时自动定位到当前章节。
struct ChapterListView: View {
    let novel: Novel
    let currentOrder: Int
    var initialChapters: [ChapterMeta] = []
    var offlineOnly = false
    let onSelect: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(OfflineReadingStore.self) private var offlineStore
    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasScrolledToCurrent = false
    @State private var isShowingOffline = false
    @State private var search = ""
    @State private var descending = false
    @State private var showJump = false
    @State private var jumpOrder = ""

    private var visibleChapters: [ChapterMeta] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = chapters.filter { query.isEmpty || $0.title.localizedStandardContains(query) || String($0.order) == query }
        return descending ? Array(matches.reversed()) : matches
    }

    private var jumpTarget: ChapterMeta? {
        guard let order = Int(jumpOrder) else { return nil }
        return chapters.first { $0.order == order }
    }

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
                            .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
                    }
                } else if chapters.isEmpty {
                    ContentUnavailableView("暂无章节", systemImage: "list.bullet", description: Text("这本书尚未发布章节"))
                } else {
                    ScrollViewReader { proxy in
                        List(visibleChapters) { chapter in
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
                                        .chapterTitleStyle()
                                        .foregroundStyle(chapter.order == currentOrder ? AppTheme.primary : AppTheme.textPrimary)
                                    if chapter.order == currentOrder {
                                        Image(systemName: "checkmark")
                                            .font(.subheadline.weight(.bold))
                                            .foregroundStyle(AppTheme.primary)
                                            .accessibilityHidden(true)
                                    }
                                }
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
                            .listRowBackground(
                                chapter.order == currentOrder
                                    ? AppTheme.primary.opacity(0.12)
                                    : Color.clear
                            )
                            .id(chapter.id)
                            .accessibilityAddTraits(chapter.order == currentOrder ? [.isSelected] : [])
                        }
                        .appListStyle(.browsing)
                        .listRowSeparatorTint(AppTheme.border)
                        .overlay {
                            if visibleChapters.isEmpty { ContentUnavailableView.search(text: search) }
                        }
                        .refreshable { await load(refresh: true) }
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
            .pageBackground(.browsing)
            .safeAreaInset(edge: .bottom) {
                if let errorMessage, !chapters.isEmpty, !isShowingOffline {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load(refresh: true) }
                    }
                    .padding()
                    .background(AppTheme.canvas)
                }
            }
            .navigationTitle("目录")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "搜索章节名或章号")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle("倒序排列", isOn: $descending)
                        Button("跳转章节", systemImage: "number") {
                            jumpOrder = ""
                            showJump = true
                        }
                    } label: {
                        Label("目录选项", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .disabled(chapters.isEmpty)
                }
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
            .task(id: ContentAccessStore.shared.mode) { await load() }
            .alert("跳转章节", isPresented: $showJump) {
                TextField("章号", text: $jumpOrder).keyboardType(.numberPad)
                Button("开始阅读") {
                    guard let chapter = jumpTarget else { return }
                    dismiss()
                    onSelect(chapter.order)
                }
                .disabled(jumpTarget == nil)
                Button("取消", role: .cancel) {}
            } message: {
                Text("输入目录中已有的章号，直接打开该章节。")
            }
        }
        .presentationBackground(AppTheme.canvas)
        .presentationDragIndicator(.visible)
        .readerContentAccess(isRestricted: novel.isRestricted)
    }

    private func load(refresh: Bool = false) async {
        guard !isLoading else { return }
        if offlineOnly {
            await offlineStore.refresh()
            chapters = offlineStore.chapters(for: novel.id)
            isShowingOffline = true
            errorMessage = nil
            return
        }
        if !refresh, chapters.isEmpty, !initialChapters.isEmpty {
            chapters = initialChapters
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let r: ChaptersResponse = try await APIClient.shared.getReader(
                "/api/chapters?novelId=\(novel.id)", refresh: refresh
            )
            chapters = r.chapters
            isShowingOffline = false
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            let saved = ContentAccessStore.shared.mode == "adult" || novel.isRestricted ? [] : offlineStore.chapters(for: novel.id)
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
