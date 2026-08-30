import SwiftUI

/// 离线阅读管理：按小说展示已保存章节，点按即可在无网络时打开。
struct OfflineReadingView: View {
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showClearConfirm = false
    @State private var isRemovingAll = false
    @State private var expandedBookIDs: Set<String> = []
    @State private var hasEstablishedInitialExpansion = false
    @State private var isSelectingBooks = false
    @State private var selectedBookIDs: Set<String> = []
    @State private var expandedBookIDsBeforeSelection: Set<String>?
    @State private var showDeleteSelectedConfirm = false
    @State private var isRemovingSelectedBooks = false
    @State private var interactionFeedback = 0

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
                    if isSelectingBooks {
                        selectionSummaryRow
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                ForEach(offlineStore.books) { book in
                    Section {
                        if !isSelectingBooks && expandedBookIDs.contains(book.id) {
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
                                            let removed = await offlineStore.remove(
                                                novelID: book.novel.id,
                                                chapterID: chapter.id
                                            )
                                            if removed {
                                                AppFeedback.success("已删除离线章节")
                                            } else {
                                                AppFeedback.error("离线章节删除失败，请重试")
                                            }
                                        }
                                    } label: {
                                        Label("删除", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    } header: {
                        Button {
                            if isSelectingBooks {
                                toggleBookSelection(book.id)
                            } else {
                                toggleBook(book.id)
                            }
                        } label: {
                            bookHeader(book, selectionMode: isSelectingBooks)
                        }
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
                        .accessibilityLabel("\(book.novel.title)，\(displayAuthor(for: book.novel))")
                        .accessibilityValue(
                            isSelectingBooks
                                ? selectedBookIDs.contains(book.id) ? "已选择" : "未选择"
                                : expandedBookIDs.contains(book.id)
                                    ? "已展开，\(book.chapters.count)章"
                                    : "已收起，\(book.chapters.count)章"
                        )
                        .accessibilityHint(
                            isSelectingBooks
                                ? "点按选择或取消选择这本书"
                                : "点按展开或收起章节"
                        )
                    }
                    .frostedRowBackground()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("离线阅读")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: interactionFeedback)
        .toolbar {
            if !offlineStore.books.isEmpty {
                if isSelectingBooks {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("取消") {
                            exitBookSelection()
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showDeleteSelectedConfirm = true
                        } label: {
                            if isRemovingSelectedBooks {
                                ProgressView()
                            } else {
                                Text("删除")
                            }
                        }
                        .tint(AppTheme.danger)
                        .disabled(
                            selectedBookIDs.isEmpty
                                || isRemovingSelectedBooks
                                || offlineStore.isBatchDownloading
                        )
                        .accessibilityLabel("删除所选书籍")
                    }
                } else {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button {
                            enterBookSelection()
                        } label: {
                            Label("选择", systemImage: "checkmark.circle")
                        }
                        .disabled(offlineStore.isBatchDownloading)
                        .accessibilityLabel("选择书籍批量删除")

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
                    let removed = await offlineStore.removeAll()
                    isRemovingAll = false
                    if removed {
                        AppFeedback.success("已清除全部离线章节")
                    } else {
                        AppFeedback.error("离线内容清除失败，请重试")
                    }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("已下载的章节会从本机删除，需要时可以重新下载。")
        }
        .confirmationDialog(
            "删除所选书籍？",
            isPresented: $showDeleteSelectedConfirm,
            titleVisibility: .visible
        ) {
            Button("删除 \(selectedBookIDs.count) 本", role: .destructive) {
                removeSelectedBooks()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("所选书籍的全部离线章节和本机缓存都会被删除。")
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

    private var isAllBooksSelected: Bool {
        let bookIDs = Set(offlineStore.books.map(\.id))
        return !bookIDs.isEmpty && bookIDs.isSubset(of: selectedBookIDs)
    }

    private var selectionSummaryRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle")
                .font(.title3)
                .foregroundStyle(AppTheme.primary)

            VStack(alignment: .leading, spacing: 3) {
                Text("已选 \(selectedBookIDs.count) 本")
                    .font(.subheadline.weight(.semibold))
                Text("选择要删除的离线书籍")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Spacer()

            Button(isAllBooksSelected ? "取消全选" : "全选") {
                toggleAllBookSelection()
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(ScaleButtonStyle(pressedScale: 0.94))
            .frame(minHeight: 44)
            .disabled(isRemovingSelectedBooks || offlineStore.isBatchDownloading)
        }
    }

    private func bookHeader(
        _ book: OfflineReadingStore.DownloadedBook,
        selectionMode: Bool = false
    ) -> some View {
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
                    if selectionMode {
                        Image(
                            systemName: selectedBookIDs.contains(book.id)
                                ? "checkmark.circle.fill"
                                : "circle"
                        )
                        .font(.title3)
                        .foregroundStyle(
                            selectedBookIDs.contains(book.id)
                                ? AppTheme.primary
                                : AppTheme.textMuted
                        )
                        .accessibilityHidden(true)
                    } else {
                        Image(
                            systemName: expandedBookIDs.contains(book.id)
                                ? "chevron.up"
                                : "chevron.down"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                        .accessibilityHidden(true)
                    }
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
        .contentShape(Rectangle())
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
        interactionFeedback &+= 1
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

    private func enterBookSelection() {
        guard !offlineStore.books.isEmpty else { return }
        isSelectingBooks = true
        selectedBookIDs.removeAll()
        expandedBookIDsBeforeSelection = expandedBookIDs
        expandedBookIDs.removeAll()
    }

    private func exitBookSelection() {
        isSelectingBooks = false
        selectedBookIDs.removeAll()
        if let savedExpansion = expandedBookIDsBeforeSelection {
            let currentBookIDs = Set(offlineStore.books.map(\.id))
            expandedBookIDs = savedExpansion.intersection(currentBookIDs)
        }
        expandedBookIDsBeforeSelection = nil
    }

    private func toggleBookSelection(_ bookID: String) {
        interactionFeedback &+= 1
        if selectedBookIDs.contains(bookID) {
            selectedBookIDs.remove(bookID)
        } else {
            selectedBookIDs.insert(bookID)
        }
    }

    private func toggleAllBookSelection() {
        let bookIDs = Set(offlineStore.books.map(\.id))
        interactionFeedback &+= 1
        if bookIDs.isSubset(of: selectedBookIDs) {
            selectedBookIDs.removeAll()
        } else {
            selectedBookIDs = bookIDs
        }
    }

    private func removeSelectedBooks() {
        let bookIDs = selectedBookIDs
        guard !bookIDs.isEmpty,
              !isRemovingSelectedBooks,
              !offlineStore.isBatchDownloading else { return }
        isRemovingSelectedBooks = true
        Task {
            let removed = await offlineStore.removeBooks(novelIDs: bookIDs)
            isRemovingSelectedBooks = false
            if removed {
                AppFeedback.success("已删除 \(bookIDs.count) 本离线书籍")
            } else {
                AppFeedback.error("离线书籍删除失败，请重试")
            }
            exitBookSelection()
            synchronizeExpandedBooks()
        }
    }

    private func synchronizeExpandedBooks() {
        let bookIDs = Set(offlineStore.books.map(\.id))
        selectedBookIDs.formIntersection(bookIDs)
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
