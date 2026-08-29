import SwiftUI

/// 离线阅读管理：按小说展示已保存章节，点按即可在无网络时打开。
struct OfflineReadingView: View {
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showClearConfirm = false
    @State private var isRemovingAll = false
    @State private var expandedBookIDs: Set<String> = []
    @State private var hasEstablishedInitialExpansion = false

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
                        if expandedBookIDs.contains(book.id) {
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
                        }
                    } header: {
                        Button {
                            toggleBook(book.id)
                        } label: {
                            bookHeader(book)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(book.novel.title)，\(displayAuthor(for: book.novel))")
                        .accessibilityValue(
                            expandedBookIDs.contains(book.id)
                                ? "已展开，\(book.chapters.count)章"
                                : "已收起，\(book.chapters.count)章"
                        )
                        .accessibilityHint("点按展开或收起章节")
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
            synchronizeExpandedBooks()
        }
        .refreshable {
            await offlineStore.refresh()
            synchronizeExpandedBooks()
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
        HStack(alignment: .top, spacing: 12) {
            CachedAsyncImage(
                url: APIClient.shared.coverURL(
                    novelId: book.novel.id,
                    updatedAt: book.novel.updatedAt
                ),
                targetSize: CGSize(width: 68, height: 96)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    AppTheme.primaryLight
                    Image(systemName: "book.closed")
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .frame(width: 68, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(book.novel.title)
                        .font(serifFont(.headline, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Image(
                        systemName: expandedBookIDs.contains(book.id)
                            ? "chevron.up"
                            : "chevron.down"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
                    .accessibilityHidden(true)
                }

                Text(displayAuthor(for: book.novel))
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    if let status = book.novel.statusLabel {
                        Text(status)
                            .modifier(ThemeTagModifier())
                    }
                    if book.novel.hasUpdate {
                        Text("有更新")
                            .modifier(ThemeTagModifier(emphasized: true))
                    }
                }

                if !book.novel.categories.isEmpty {
                    Text(book.novel.categories.prefix(2).joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(1)
                }

                Text(savedProgressText(for: book))
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 10)
        .textCase(nil)
    }

    private func displayAuthor(for novel: Novel) -> String {
        novel.author.isEmpty ? "佚名" : novel.author
    }

    private func savedProgressText(for book: OfflineReadingStore.DownloadedBook) -> String {
        let savedCount = book.chapters.count
        let totalCount = max(book.novel.chapterCount, book.novel.remoteChapterCount, savedCount)
        if totalCount > savedCount {
            return "已保存 \(savedCount)/\(totalCount) 章 · 离线可读"
        }
        return "已保存 \(savedCount) 章 · 离线可读"
    }

    private func toggleBook(_ bookID: String) {
        let update: () -> Void = {
            if expandedBookIDs.contains(bookID) {
                expandedBookIDs.remove(bookID)
            } else {
                expandedBookIDs.insert(bookID)
            }
        }

        if reduceMotion {
            update()
        } else {
            withAnimation(.easeInOut(duration: 0.2), update)
        }
    }

    private func synchronizeExpandedBooks() {
        let bookIDs = Set(offlineStore.books.map(\.id))
        expandedBookIDs.formIntersection(bookIDs)
        guard !hasEstablishedInitialExpansion,
              let firstBook = offlineStore.books.first else { return }
        expandedBookIDs.insert(firstBook.id)
        hasEstablishedInitialExpansion = true
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
