import SwiftUI
import ZhiZhouCore

/// 只展示当前账户、内容模式和站点的已确认结果，失败不补成零。
struct ProfileReadingOverview: View {
    let openBookshelf: () -> Void
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
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: ProfileRoute.readingStats) { summary }
                .accessibilityIdentifier("profile.reading-stats")
            if statsError != nil, statsScope == scope {
                Button("重新加载阅读统计") { Task { await loadStats() } }
                    .font(.footnote).foregroundStyle(AppTheme.primary)
                    .frame(minHeight: AppLayout.minimumTouchTarget).disabled(loadingStats)
            }
            HStack {
                Text("故事还在继续")
                    .font(serifFont(.headline, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button(action: openBookshelf) {
                    HStack(spacing: 3) {
                        Text("书架")
                        Image(systemName: "chevron.right").accessibilityHidden(true)
                    }
                    .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("profile.bookshelf")
            }
            .padding(.top, 14)
            .padding(.bottom, 6)
            if recentScope == scope {
                if let recent {
                    let launch = ReaderLaunch(novel: recent.asNovel, chapterOrder: recent.chapterOrder)
                    NavigationLink(value: ProfileRoute.reader(launch)) { continueReading(recent) }
                    .accessibilityIdentifier("profile.continue-reading")
                } else if let recentError {
                    LoadErrorNotice(message: recentError, isLoading: loadingRecent) { Task { await loadRecent() } }
                } else {
                    Text("还没有阅读记录，去书架挑一本喜欢的故事吧。")
                        .font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                }
            } else {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("正在寻找上次读到的地方…").font(.footnote)
                }
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            }
        }
        .task(id: refreshScope) { if scenePhase == .active { await loadStats() } }
        .task(id: refreshScope) { if scenePhase == .active { await loadRecent() } }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("这周，读了一点世界。")
                    .font(serifFont(.subheadline))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Text("本周 ↗").font(.caption2).foregroundStyle(ReadingSpace.summarySecondary)
            }
            if statsScope == scope, let stats {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        durationMetric(stats).fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 12)
                        daysMetric(stats).fixedSize(horizontal: true, vertical: false)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        durationMetric(stats)
                        daysMetric(stats)
                    }
                }
                weekStrip(stats)
            } else if statsScope == scope, statsError != nil {
                Text("统计暂时未能更新").font(serifFont(.title3, .medium))
                Text("点此查看详情，或稍后重试。")
                    .font(.footnote).foregroundStyle(ReadingSpace.summarySecondary)
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(ReadingSpace.onSummary)
                    Text("正在读取阅读记录…").font(.subheadline)
                }
                .frame(minHeight: 78)
            }
        }
        .foregroundStyle(ReadingSpace.onSummary)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: 25, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("查看阅读统计")
    }

    private func durationMetric(_ stats: ReadingStats) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            durationNumber(stats.milliseconds)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(ReadingStats.duration(stats.milliseconds))
            Text("阅读时光 · \(stats.chapters) 章")
                .font(.caption2).foregroundStyle(ReadingSpace.summarySecondary)
        }
    }

    private func daysMetric(_ stats: ReadingStats) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            (number(stats.days) + unit(" 天"))
                .accessibilityLabel("\(stats.days) 天有阅读")
            Text("与故事相遇")
                .font(.caption2).foregroundStyle(ReadingSpace.summarySecondary)
        }
    }

    private func number<T: BinaryInteger>(_ value: T) -> Text {
        Text(String(value)).font(.custom("Georgia", size: 32, relativeTo: .largeTitle))
    }

    private func unit(_ value: String) -> Text {
        Text(value).font(.caption2).foregroundColor(ReadingSpace.summarySecondary)
    }

    private func durationNumber(_ milliseconds: Int64) -> Text {
        let minutes = max(0, milliseconds) / 60_000
        if milliseconds > 0 && minutes == 0 { return unit("不足 ") + number(1) + unit(" 分钟") }
        if minutes < 60 { return number(minutes) + unit(" 分钟") }
        return number(minutes / 60) + unit(" 小时 ") + number(minutes % 60) + unit(" 分")
    }

    private func weekStrip(_ stats: ReadingStats) -> some View {
        let calendar = ReadingStatPeriod.calendar
        let start = Date(timeIntervalSince1970: Double(stats.start) / 1000)
        let today = calendar.startOfDay(for: Date())
        let weekdays = ["一", "二", "三", "四", "五", "六", "日"]
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        // 周一的接口可能返回小时桶；先按同一上海自然日合并，和统计页的天数口径一致。
        let dayTotals = Dictionary(grouping: stats.trend, by: { String($0.date.prefix(10)) })
            .mapValues { $0.reduce(Int64(0)) { $0 + $1.milliseconds } }
        return HStack(spacing: 0) {
            ForEach(0..<7) { index in
                let date = calendar.date(byAdding: .day, value: index, to: start) ?? start
                let isToday = calendar.isDate(date, inSameDayAs: today)
                let hasRead = (dayTotals[formatter.string(from: date)] ?? 0) >= 30_000
                let status = date > today ? "尚未到来" : hasRead ? "有阅读" : "暂无有效阅读记录"
                Text(weekdays[index])
                    .font(.caption2)
                    .foregroundStyle(isToday ? Color(hex: "332B21") : ReadingSpace.summarySecondary)
                    .frame(minWidth: 24, minHeight: 24)
                    .background {
                        if isToday {
                            Circle().fill(ReadingSpace.profileToday)
                        } else if hasRead {
                            Circle().fill(ReadingSpace.profileReadDay)
                        }
                    }
                    .overlay(alignment: .bottom) {
                        if hasRead { Circle().fill(ReadingSpace.profileToday).frame(width: 3, height: 3).offset(y: 5) }
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("周\(weekdays[index])，\(isToday ? "今天，" : "")\(status)")
            }
        }
        .padding(.bottom, 4)
    }

    private func continueReading(_ item: RecentItem) -> some View {
        HStack(spacing: 13) {
            if !dynamicTypeSize.isAccessibilitySize {
                CachedAsyncImage(url: APIClient.shared.coverURL(novelId: item.novelId, updatedAt: item.updatedAt),
                                 targetSize: CGSize(width: 58, height: 84)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { AppTheme.primaryLight }
                .frame(width: 58, height: 84).clipShape(RoundedRectangle(cornerRadius: 5)).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(item.novelTitle).font(serifFont(.headline, .medium)).foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                Text(item.chapterTitle).font(.caption).foregroundStyle(ReadingSpace.profileMuted).appTextLineLimit(2)
                if item.scrollPercent.isFinite {
                    let fraction = min(1, max(0, item.scrollPercent))
                    GeometryReader { geometry in
                        Capsule().fill(ReadingSpace.profileLine)
                            .overlay(alignment: .leading) {
                                Capsule().fill(AppTheme.primary).frame(width: geometry.size.width * CGFloat(fraction))
                            }
                    }
                    .frame(height: 3)
                    .padding(.vertical, 3)
                    .accessibilityHidden(true)
                    Text("本章读到 \(Int((fraction * 100).rounded()))% · 接着上次的故事")
                        .font(.caption2).foregroundStyle(ReadingSpace.profileMuted)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("接着上次的故事").font(.caption2).foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.right")
                .font(.footnote).foregroundStyle(ReadingSpace.ink)
                .frame(width: 32, height: 32)
                .background(ReadingSpace.profileFill, in: Circle())
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
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
