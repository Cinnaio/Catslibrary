import SwiftUI

/// 小说详情页：继续阅读为主操作，目录为次要入口。
struct NovelDetailView: View {
    let novel: Novel
    @EnvironmentObject private var appState: AppState

    @State private var chapters: [ChapterMeta] = []
    @State private var isLoading = false
    @State private var inBookshelf = false
    @State private var errorMessage: String?
    @State private var progress: ReadingProgress?
    @State private var displayNovel: Novel?
    @State private var bookshelfBusy = false
    @State private var showBookshelfError = false
    @State private var showRemoveConfirm = false
    @State private var expandDescription = false
    @State private var readerLaunch: ReaderLaunch?

    var body: some View {
        List {
            Section {
                headerCard
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section {
                if isLoading && chapters.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.danger)
                }
                ForEach(chapters) { chapter in
                    NavigationLink(value: ReaderLaunch(
                        novel: currentNovel,
                        chapterOrder: chapter.order,
                        preloadedChapters: chapters
                    )) {
                        HStack {
                            Text(chapter.title)
                                .lineLimit(2)
                            Spacer()
                            if chapter.id == progress?.chapterId {
                                Image(systemName: "bookmark.fill")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.seal)
                                    .accessibilityLabel("上次读到这里")
                            }
                            Text("\(chapter.wordCount) 字")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textMuted)
                        }
                    }
                }
            } header: {
                Text("章节（\(chapters.count)）")
            }
            .frostedRowBackground()
        }
        .scrollContentBackground(.hidden)
        .glassPageBackground()
        .navigationTitle(currentNovel.title)
        .navigationBarTitleDisplayMode(.inline)
        .zhiZhouDestinations()
        .navigationDestination(item: $readerLaunch) { launch in
            ReaderView(
                novel: launch.novel,
                chapterOrder: launch.chapterOrder,
                preloadedChapters: launch.preloadedChapters
            )
        }
        .task { await load() }
        .alert("操作未完成", isPresented: $showBookshelfError) {
            Button("好", role: .cancel) {}
        } message: {
            Text(inBookshelf ? "移出书架失败，请检查网络后重试。" : "加入书架失败，请检查网络后重试。")
        }
        .confirmationDialog("从书架移除这本书？", isPresented: $showRemoveConfirm, titleVisibility: .visible) {
            Button("移除", role: .destructive) { toggleBookshelf() }
            Button("取消", role: .cancel) {}
        }
        .browseColorScheme()
    }

    private var currentNovel: Novel { displayNovel ?? novel }

    private var continueChapter: ChapterMeta? {
        if let progress, let match = chapters.first(where: { $0.id == progress.chapterId }) {
            return match
        }
        return chapters.first
    }

    private var continueTitle: String {
        guard let chapter = continueChapter else { return "开始阅读" }
        if progress?.chapterId == chapter.id {
            return "继续阅读"
        }
        return "开始阅读"
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                CachedAsyncImage(
                    url: APIClient.shared.coverURL(novelId: currentNovel.id, updatedAt: currentNovel.updatedAt),
                    targetSize: CGSize(width: 88, height: 126)
                ) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack {
                        AppTheme.primaryLight
                        Image(systemName: "book.closed")
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                .frame(width: 88, height: 126)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .accessibilityLabel("\(currentNovel.title) 封面")

                VStack(alignment: .leading, spacing: 6) {
                    Text(currentNovel.title)
                        .font(serifFont(.title3, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(currentNovel.author)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                    HStack(spacing: 6) {
                        if let status = currentNovel.statusLabel {
                            Text(status).modifier(ThemeTagModifier())
                        }
                        if currentNovel.hasUpdate {
                            Text("有更新").modifier(ThemeTagModifier(emphasized: true))
                        }
                        ForEach(currentNovel.categories.prefix(2), id: \.self) { category in
                            Text(category).modifier(ThemeTagModifier())
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            if !currentNovel.description.isEmpty {
                Text(currentNovel.description)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(expandDescription ? nil : 4)
                if currentNovel.description.count > 80 {
                    Button(expandDescription ? "收起" : "展开简介") {
                        expandDescription.toggle()
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.primary)
                    .buttonStyle(.plain)
                    .frame(minHeight: 32, alignment: .leading)
                }
            }

            HStack(spacing: 10) {
                Button {
                    if let chapter = continueChapter {
                        readerLaunch = ReaderLaunch(
                            novel: currentNovel,
                            chapterOrder: chapter.order,
                            preloadedChapters: chapters
                        )
                    }
                } label: {
                    VStack(spacing: 2) {
                        Label(continueTitle, systemImage: "book.fill")
                            .font(.subheadline.weight(.semibold))
                        if let chapter = continueChapter {
                            Text(chapter.title)
                                .font(.caption2)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.primary)
                .disabled(continueChapter == nil)
                .accessibilityHint(continueChapter.map { "从第 \($0.order) 章开始" } ?? "正在加载章节")

                Button {
                    if inBookshelf {
                        showRemoveConfirm = true
                    } else {
                        toggleBookshelf()
                    }
                } label: {
                    Image(systemName: inBookshelf ? "bookmark.fill" : "bookmark")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
                .disabled(bookshelfBusy)
                .accessibilityLabel(inBookshelf ? "已在书架，点按移除" : "加入书架")
            }
        }
        .padding(16)
        .paperCard(cornerRadius: 22)
    }

    private func toggleBookshelf() {
        guard !bookshelfBusy else { return }
        bookshelfBusy = true
        Task {
            defer { bookshelfBusy = false }
            do {
                if inBookshelf {
                    let _: OkEnvelope = try await APIClient.shared.delete(
                        "/api/bookshelf?novelId=\(novel.id)", auth: true
                    )
                    inBookshelf = false
                } else {
                    let body = try APIClient.shared.jsonBody(["novelId": novel.id])
                    let _: OkEnvelope = try await APIClient.shared.post(
                        "/api/bookshelf", body: body, auth: true
                    )
                    inBookshelf = true
                }
            } catch {
                showBookshelfError = true
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            if let d: NovelDetailResponse = try? await APIClient.shared.get("/api/novels/\(novel.id)") {
                displayNovel = d.novel
            }

            let r: ChaptersResponse = try await APIClient.shared.get(
                "/api/chapters?novelId=\(novel.id)"
            )
            chapters = r.chapters
            errorMessage = nil

            if appState.user != nil {
                let p: ProgressResponse = try await APIClient.shared.get(
                    "/api/progress?novelId=\(novel.id)", auth: true
                )
                progress = p.progress
                let b: BookshelfResponse = try await APIClient.shared.get(
                    "/api/bookshelf", auth: true
                )
                inBookshelf = b.favorites.contains { $0.novelId == novel.id }
            }
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}

private struct NovelDetailResponse: Decodable {
    let novel: Novel
}
