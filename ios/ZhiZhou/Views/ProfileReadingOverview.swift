import SwiftUI
import ZhiZhouCore

/// 只展示当前账户、内容模式和站点的已确认结果，失败不补成零。
struct ProfileReadingOverview: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var stats: ReadingStats?
    @State private var recent: RecentItem?
    @State private var statsScope: [String]?
    @State private var recentScope: [String]?
    @State private var statsError: String?
    @State private var recentError: String?
    @State private var statsRequest = UUID()
    @State private var recentRequest = UUID()
    @State private var loadingStats = false
    @State private var loadingRecent = false

    private var scope: [String] {
        [appState.user?.id ?? "", APIClient.shared.token ?? "",
         ServerConfig.shared.baseURL?.absoluteString ?? "", ContentAccessStore.shared.revision.uuidString]
    }
    private var refreshScope: [String] { scope + [scenePhase == .active ? "active" : "inactive"] }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            NavigationLink { ReadingStatsView() } label: { summary }
                .accessibilityIdentifier("profile.reading-stats")
            if statsError != nil, statsScope == scope {
                Button("重新加载阅读统计") { Task { await loadStats() } }
                    .font(.footnote).foregroundStyle(AppTheme.primary)
                    .frame(minHeight: AppLayout.minimumTouchTarget).disabled(loadingStats)
            }
            if recentScope == scope {
                if let recent {
                    NavigationLink {
                        ReaderView(novel: recent.asNovel, chapterOrder: recent.chapterOrder)
                    } label: { continueReading(recent) }
                    .accessibilityIdentifier("profile.continue-reading")
                } else if let recentError {
                    LoadErrorNotice(message: recentError, isLoading: loadingRecent) { Task { await loadRecent() } }
                }
            }
            HStack(spacing: 12) {
                NavigationLink { ReaderBookmarksView() } label: {
                    collectionLink("我的书签", symbol: "bookmark")
                }
                .accessibilityIdentifier("profile.bookmarks")
                NavigationLink { MyThoughtsView() } label: {
                    collectionLink("我的想法", symbol: "text.bubble")
                }
                .accessibilityIdentifier("profile.thoughts")
            }
        }
        .task(id: refreshScope) { if scenePhase == .active { await loadStats() } }
        .task(id: refreshScope) { if scenePhase == .active { await loadRecent() } }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("本周阅读").font(.subheadline)
                Spacer()
                Image(systemName: "arrow.up.right").accessibilityHidden(true)
            }
            .foregroundStyle(ReadingSpace.summarySecondary)
            if statsScope == scope, let stats {
                Text(ReadingStats.duration(stats.milliseconds))
                    .font(serifFont(.title, .medium))
                    .fixedSize(horizontal: false, vertical: true)
                AppAdaptiveRow(spacing: 16) {
                    Text("\(stats.chapters) 章")
                    Text("\(stats.days) 天有阅读")
                }
                .font(.subheadline).foregroundStyle(ReadingSpace.summarySecondary)
            } else if statsScope == scope, statsError != nil {
                Text("统计暂时未能更新").font(serifFont(.title3, .medium))
                Text("点此查看详情，或稍后重试。")
                    .font(.footnote).foregroundStyle(ReadingSpace.summarySecondary)
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(ReadingSpace.onSummary)
                    Text("正在读取阅读记录…").font(.subheadline)
                }
                .frame(minHeight: 54)
            }
        }
        .monospacedDigit()
        .foregroundStyle(ReadingSpace.onSummary)
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("查看阅读统计")
    }

    private func collectionLink(_ title: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundStyle(AppTheme.primary).accessibilityHidden(true)
            Text(title).font(.subheadline).foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 94, alignment: .leading)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 20))
        .contentShape(Rectangle())
    }

    private func continueReading(_ item: RecentItem) -> some View {
        HStack(spacing: 16) {
            if !dynamicTypeSize.isAccessibilitySize {
                CachedAsyncImage(url: APIClient.shared.coverURL(novelId: item.novelId, updatedAt: item.updatedAt),
                                 targetSize: CGSize(width: 52, height: 74)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { AppTheme.primaryLight }
                .frame(width: 52, height: 74).clipShape(RoundedRectangle(cornerRadius: 6)).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("接着读").font(.caption).foregroundStyle(AppTheme.primary)
                Text(item.novelTitle).font(serifFont(.headline, .semibold)).foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                Text(item.chapterTitle).font(.footnote).foregroundStyle(AppTheme.textSecondary).appTextLineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.right").foregroundStyle(AppTheme.primary).accessibilityHidden(true)
        }
        .padding(18)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        .accessibilityElement(children: .combine)
    }

    @MainActor private func loadStats() async {
        let captured = scope
        let ticket = UUID()
        statsRequest = ticket
        guard !captured[0].isEmpty, let token = APIClient.shared.token else { return }
        loadingStats = true
        statsError = nil
        defer { if statsRequest == ticket { loadingStats = false } }
        await ReadingStatsStore.shared.flush()
        guard !Task.isCancelled, scope == captured, statsRequest == ticket else { return }
        let range = ReadingStatPeriod.week.range()
        do {
            let result: ReadingStats = try await APIClient.shared.request("GET",
                "/api/reading-stats?start=\(range.start)&end=\(range.end)&contentMode=\(ContentAccessStore.shared.mode)",
                auth: true, expectedToken: token)
            guard !Task.isCancelled, scope == captured, statsRequest == ticket else { return }
            stats = result
            statsScope = captured
        } catch {
            guard !Task.isCancelled, scope == captured, statsRequest == ticket else { return }
            stats = nil
            statsScope = captured
            statsError = AppCopy.friendlyError(error)
        }
    }

    @MainActor private func loadRecent() async {
        let captured = scope
        let ticket = UUID()
        recentRequest = ticket
        guard !captured[0].isEmpty, APIClient.shared.isAuthenticated else { return }
        loadingRecent = true
        recentError = nil
        defer { if recentRequest == ticket { loadingRecent = false } }
        do {
            let result: BookshelfResponse = try await APIClient.shared.getReader("/api/bookshelf?limit=1&offset=0", auth: true)
            guard !Task.isCancelled, scope == captured, recentRequest == ticket else { return }
            recent = result.recent.first { ContentAccessStore.shared.mode == "adult" || !$0.asNovel.isRestricted }
            recentScope = captured
        } catch {
            guard !Task.isCancelled, scope == captured, recentRequest == ticket else { return }
            recent = nil
            recentScope = captured
            recentError = AppCopy.friendlyError(error)
        }
    }
}
