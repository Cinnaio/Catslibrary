import SwiftUI

/// 离线阅读管理：按小说展示已保存章节，点按即可在无网络时打开。
struct OfflineReadingView: View {
    @Environment(OfflineReadingStore.self) private var offlineStore
    @State private var showClearConfirm = false
    @State private var isRemovingAll = false

    var body: some View {
        List {
            if offlineStore.books.isEmpty {
                ContentUnavailableView {
                    Label("还没有离线章节", systemImage: "arrow.down.circle")
                } description: {
                    Text("在小说详情页下载章节，没网时也能继续阅读。")
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else {
                Section {
                    summaryRow
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(offlineStore.books) { book in
                    Section {
                        ForEach(book.chapters) { chapter in
                            NavigationLink {
                                ReaderView(
                                    novel: book.novel,
                                    chapterOrder: chapter.order,
                                    preloadedChapters: book.chapters,
                                    offlineOnly: true
                                )
                            } label: {
                                chapterRow(chapter)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task {
                                        await offlineStore.remove(
                                            novelID: book.novel.id,
                                            chapterID: chapter.id
                                        )
                                    }
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                        }
                    } header: {
                        bookHeader(book)
                    }
                    .frostedRowBackground()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("离线阅读")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !offlineStore.books.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showClearConfirm = true
                    } label: {
                        if isRemovingAll {
                            ProgressView()
                        } else {
                            Image(systemName: "trash")
                        }
                    }
                    .disabled(isRemovingAll)
                    .accessibilityLabel("清除全部离线章节")
                }
            }
        }
        .task {
            await offlineStore.refresh()
        }
        .refreshable {
            await offlineStore.refresh()
        }
        .confirmationDialog(
            "清除全部离线章节？",
            isPresented: $showClearConfirm,
            titleVisibility: .visible
        ) {
            Button("清除全部", role: .destructive) {
                Task {
                    isRemovingAll = true
                    await offlineStore.removeAll()
                    isRemovingAll = false
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("已下载的章节会从本机删除，需要时可以重新下载。")
        }
        .alert(
            "下载未完成",
            isPresented: Binding(
                get: { offlineStore.lastError != nil },
                set: { if !$0 { offlineStore.clearError() } }
            )
        ) {
            Button("好", role: .cancel) {
                offlineStore.clearError()
            }
        } message: {
            Text(offlineStore.lastError ?? "")
        }
    }

    private var summaryRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.title3)
                .foregroundStyle(AppTheme.primary)

            VStack(alignment: .leading, spacing: 3) {
                Text("已保存到本机")
                    .font(.subheadline.weight(.semibold))
                Text("无网络时仍可打开这些章节")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Spacer()

            Text("\(offlineStore.totalChapterCount) 章")
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private func bookHeader(_ book: OfflineReadingStore.DownloadedBook) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(book.novel.title)
                .font(serifFont(.headline, .semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
            Spacer()
            Text("\(book.chapters.count) 章")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .textCase(nil)
    }

    private func chapterRow(_ chapter: ChapterMeta) -> some View {
        HStack(spacing: 12) {
            Text("\(chapter.order)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(AppTheme.textMuted)
                .frame(minWidth: 28, alignment: .trailing)

            VStack(alignment: .leading, spacing: 3) {
                Text(chapter.title)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text("\(chapter.wordCount) 字 · 离线可读")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(AppTheme.success)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("第 \(chapter.order) 章，\(chapter.title)，离线可读")
    }
}
