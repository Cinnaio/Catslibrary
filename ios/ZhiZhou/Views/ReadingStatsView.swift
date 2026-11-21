import SwiftUI
import Charts
import ZhiZhouCore

struct ReadingStatsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var period: ReadingStatPeriod = .week
    @State private var offset = 0
    @State private var customStart = Date()
    @State private var customEnd = Date()
    @State private var showSessions = false
    @State private var selectedDate: String?
    @State private var stats: ReadingStats?
    @State private var statsQuery: String?
    @State private var loadedPeriod: ReadingStatPeriod = .week
    @State private var loading = false
    @State private var retrying = false
    @State private var error: String?
    @State private var requestID = UUID()

    private var queryID: String {
        "\(appState.user?.id ?? ""):\(ContentAccessStore.shared.revision):\(period.rawValue):\(offset):\(customStart):\(customEnd)"
    }
    private var range: (start: Int64, end: Int64) {
        period.range(offset: offset, customStart: customStart, customEnd: customEnd)
    }

    var body: some View {
        List {
            Group {
                periodControls
                    .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 12, trailing: 22))
                loadFeedback

                if let stats {
                    if statsQuery != queryID {
                        Label("下方暂时保留上一次加载的结果，当前周期尚未更新。", systemImage: "clock")
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    statsOverview(stats)
                        .opacity(statsQuery == queryID ? 1 : 0.6)
                        .padding(.bottom, 12)

                    trendBlock(stats)
                        .opacity(statsQuery == queryID ? 1 : 0.6)
                        .disabled(statsQuery != queryID)
                        .allowsHitTesting(statsQuery == queryID)
                        .padding(.bottom, 16)

                    Section {
                        sectionHeading("阅读作品")
                            .padding(.top, 4)
                        if stats.novels.isEmpty {
                            Text("开始阅读后，作品统计会显示在这里。")
                                .font(.subheadline)
                                .foregroundStyle(ReadingSpace.profileMuted)
                        }
                        ForEach(Array(stats.novels.enumerated()), id: \.element.id) { index, book in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(book.title)
                                    .font(serifFont(.headline, .medium))
                                    .foregroundStyle(ReadingSpace.ink)
                                    .appTextLineLimit(2)
                                Text("\(ReadingStats.duration(book.milliseconds)) · \(book.chapters) 章")
                                    .font(.subheadline)
                                    .foregroundStyle(ReadingSpace.ink)
                                Text("最近阅读 \(dateText(book.lastReadAt))\(book.available ? "" : " · 作品已删除")")
                                    .font(.caption)
                                    .foregroundStyle(ReadingSpace.profileMuted)
                            }
                            .padding(.vertical, 10)
                            .accessibilityElement(children: .combine)
                            .readingSpaceEntrance(index)
                        }
                    }
                    .id(statsQuery)

                    statisticsNotes(stats)
                }

                syncNotice
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 22, bottom: 6, trailing: 22))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listSectionSeparator(.hidden)
        }
        .modifier(ReadingSpaceRoomListStyle())
        .contentMargins(.bottom, 24, for: .scrollContent)
        .readingSpaceTopEdge()
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(ReadingSpace.profilePaper)
        .tint(AppTheme.primary)
        .navigationTitle("阅读统计")
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.timeZone, ReadingStatPeriod.calendar.timeZone)
        .onChange(of: period) { _, _ in
            offset = 0
            selectedDate = nil
        }
        .task(id: queryID) { await load() }
        .refreshable { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: ContentAccessStore.shared.revision) { _, _ in stats = nil }
        .onChange(of: appState.user?.id) { _, _ in stats = nil }
    }

    private var periodRangeText: String {
        period == .all ? "累计阅读记录"
            : "\(dateText(range.start)) – \(dateText(max(range.start, range.end - 1)))"
    }

    private var periodControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            AppAdaptiveRow(spacing: 12) {
                Menu {
                    Picker("统计周期", selection: $period) {
                        ForEach(ReadingStatPeriod.allCases) { item in Text(item.title).tag(item) }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(period.title).font(serifFont(.headline, .medium))
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.medium))
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(ReadingSpace.ink)
                        Text(periodRangeText)
                            .font(.caption)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .monospacedDigit()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("统计周期")
                .accessibilityValue("\(period.title)，\(periodRangeText)")
                .accessibilityIdentifier("readingStats.period")

                if period != .all && period != .custom {
                    HStack(spacing: 0) {
                        Button {
                            offset -= 1
                            selectedDate = nil
                        } label: {
                            Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("上一周期")
                        Button {
                            offset += 1
                            selectedDate = nil
                        } label: {
                            Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                        }
                        .disabled(offset >= 0)
                        .accessibilityLabel("下一周期")
                    }
                    .buttonStyle(.borderless)
                }
            }
            if period == .custom {
                DatePicker("开始日期", selection: $customStart, in: ...Date(), displayedComponents: .date)
                DatePicker("结束日期", selection: $customEnd, in: ...Date(), displayedComponents: .date)
            }
        }
    }

    @ViewBuilder private var loadFeedback: some View {
        if let error {
            LoadErrorNotice(message: error, isLoading: loading || retrying) {
                guard !loading, !retrying else { return }
                retrying = true
                Task {
                    defer { retrying = false }
                    await load()
                }
            }
        }
        if loading && (stats == nil || retrying) {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(retrying ? "正在重试…" : "正在读取统计…")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            .frame(minHeight: 44, alignment: .leading)
        }
    }

    private func statsOverview(_ stats: ReadingStats) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("阅读时长")
                .font(.caption)
                .foregroundStyle(ReadingSpace.summarySecondary)
                .accessibilityHidden(true)
            ReadingStatsDuration(milliseconds: stats.milliseconds)
            let layout = dynamicTypeSize >= .xxxLarge
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                overviewMetric("阅读次数", value: stats.sessions)
                overviewMetric("阅读章节", value: stats.chapters)
                overviewMetric("阅读天数", value: stats.days)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
    }

    private func overviewMetric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value, format: .number.grouping(.never))
                .font(.title3.monospacedDigit())
                .foregroundStyle(ReadingSpace.onSummary)
                .fixedSize(horizontal: false, vertical: true)
            Text(title)
                .font(.caption)
                .foregroundStyle(ReadingSpace.summarySecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(String(value))
    }

    private func trendBlock(_ stats: ReadingStats) -> some View {
        let chartItems = buildChartItems(from: stats.trend, period: loadedPeriod,
                                        range: (start: stats.start, end: stats.end))
        let selectedChartItem = chartItems.first(where: { $0.id == selectedDate })
        let avgMinutes = stats.days > 0 ? (Double(stats.milliseconds) / 60_000.0) / Double(stats.days) : 0
        let avgSessions = stats.days > 0 ? Double(stats.sessions) / Double(stats.days) : 0
        let averageValue = showSessions ? avgSessions : avgMinutes
        let showAverageLine = loadedPeriod != .today && stats.days > 1 && averageValue > 0

        return VStack(alignment: .leading, spacing: 10) {
            trendControls
            if chartItems.isEmpty {
                Text("这个周期还没有有效阅读记录。")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .padding(.vertical, 24)
            } else {
                TrendSummaryHeader(
                    stats: stats,
                    selectedItem: selectedChartItem,
                    showSessions: showSessions,
                    onClearSelection: { selectedDate = nil }
                )
                ReadingTrendChart(
                    items: chartItems,
                    showSessions: showSessions,
                    averageValue: averageValue,
                    showAverageLine: showAverageLine,
                    selectedDate: $selectedDate
                )
                .frame(height: dynamicTypeSize.isAccessibilitySize ? 240 : 190)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: showSessions)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: selectedDate)

                if !stats.trend.isEmpty {
                    DisclosureGroup("查看趋势明细") {
                        ForEach(stats.trend) { bucket in
                            LabeledContent(detailDateText(bucket.date), value: showSessions ? "\(bucket.sessions) 次" : ReadingStats.duration(bucket.milliseconds))
                                .font(.footnote).monospacedDigit()
                        }
                    }
                    .font(.footnote)
                    .padding(.top, 4)
                }
            }
        }
    }

    @ViewBuilder private var trendControls: some View {
        if dynamicTypeSize >= .xxxLarge {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeading("阅读趋势")
                trendPicker
            }
        } else {
            HStack(spacing: 12) {
                sectionHeading("阅读趋势")
                Spacer(minLength: 0)
                trendPicker.frame(width: 156)
            }
        }
    }

    private var trendPicker: some View {
        Picker("趋势指标", selection: $showSessions) {
            Text("时长").tag(false)
            Text("次数").tag(true)
        }
        .accessibleSegmentedPicker()
        .frame(minHeight: 44)
        .accessibilityIdentifier("readingStats.metric")
    }

    private func statisticsNotes(_ stats: ReadingStats) -> some View {
        DisclosureGroup("统计说明") {
            if let since = stats.recordedSince { Text("统计起始于 \(dateText(since))。") }
            Text("北京时间，周一为每周起点。连续有效阅读满 30 秒计一次，切换章节不增加次数；离开超过 5 分钟后重新计次。后台、弹窗及长时间无操作暂停计时。章节与天数需累计阅读满 30 秒，重复章节去重；跨设备重叠时长只计一次。")
            Text("统计从功能启用后开始，旧阅读时长无法补算。")
        }
        .font(.footnote)
        .foregroundStyle(ReadingSpace.profileMuted)
    }

    @ViewBuilder private var syncNotice: some View {
        if ReadingStatsStore.shared.pendingCount > 0 {
            VStack(alignment: .leading, spacing: 6) {
                Text("有 \(ReadingStatsStore.shared.pendingCount) 条阅读记录等待同步，联网后会自动重试（最多保留 7 天）。")
                if let message = ReadingStatsStore.shared.lastSyncError { Text(message) }
                Button("同步阅读记录") { Task { await load() } }
                    .frame(minHeight: 44, alignment: .leading)
            }
            .font(.footnote)
            .foregroundStyle(ReadingSpace.profileMuted)
        }
    }

    private func sectionHeading(_ title: String) -> some View {
        Text(title)
            .font(serifFont(.title3, .medium))
            .foregroundStyle(ReadingSpace.ink)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }

    private func load() async {
        let id = UUID(); requestID = id
        let query = queryID
        let selected = range
        let selectedPeriod = period
        error = nil
        guard selected.end > selected.start else {
            stats = nil; loading = false; error = "请选择有效的日期范围，结束日期不能早于开始日期。"; return
        }
        guard let userID = appState.user?.id, let token = APIClient.shared.token else {
            stats = nil; loading = false; error = "请先登录后查看阅读统计。"; return
        }
        loading = true
        defer { if requestID == id { loading = false } }
        await ReadingStatsStore.shared.flush()
        guard !Task.isCancelled, queryID == query, requestID == id else { return }
        do {
            let mode = ContentAccessStore.shared.mode
            let result: ReadingStats = try await APIClient.shared.request("GET",
                "/api/reading-stats?start=\(selected.start)&end=\(selected.end)&contentMode=\(mode)",
                auth: true, expectedToken: token)
            guard !Task.isCancelled, requestID == id, queryID == query,
                  appState.user?.id == userID, APIClient.shared.token == token else { return }
            stats = result
            statsQuery = query
            loadedPeriod = selectedPeriod
        } catch {
            guard !Task.isCancelled, requestID == id, queryID == query else { return }
            self.error = error.localizedDescription
        }
    }

    private func dateText(_ milliseconds: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = ReadingStatPeriod.calendar.timeZone
        formatter.dateFormat = "yyyy/MM/dd"
        return formatter.string(from: Date(timeIntervalSince1970: Double(milliseconds) / 1000))
    }

    private func detailDateText(_ date: String) -> String {
        if date.contains("T") {
            return String(date.suffix(2)) + "时"
        }
        let cal = ReadingStatPeriod.calendar
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.timeZone = cal.timeZone
        f.dateFormat = "yyyy-MM-dd"
        if let d = f.date(from: date) {
            let weekday = cal.component(.weekday, from: d)
            let weekdaySymbols = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
            let m = cal.component(.month, from: d)
            let day = cal.component(.day, from: d)
            return "\(m)月\(day)日 \(weekdaySymbols[weekday - 1])"
        }
        return date
    }

    private func buildChartItems(
        from buckets: [ReadingStats.Bucket],
        period: ReadingStatPeriod,
        range: (start: Int64, end: Int64)
    ) -> [TrendChartItem] {
        let cal = ReadingStatPeriod.calendar
        let bucketMap = Dictionary(buckets.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })

        let dayFormatter = DateFormatter()
        dayFormatter.locale = Locale(identifier: "zh_CN")
        dayFormatter.timeZone = cal.timeZone
        dayFormatter.dateFormat = "yyyy-MM-dd"

        let hourFormatter = DateFormatter()
        hourFormatter.locale = Locale(identifier: "zh_CN")
        hourFormatter.timeZone = cal.timeZone
        hourFormatter.dateFormat = "yyyy-MM-dd'T'HH"

        let weekdaySymbols = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

        switch period {
        case .today:
            let startOfDay = Date(timeIntervalSince1970: Double(range.start) / 1000)
            return (0..<24).compactMap { hour in
                guard let date = cal.date(byAdding: .hour, value: hour, to: startOfDay) else { return nil }
                let key = hourFormatter.string(from: date)
                let bucket = bucketMap[key]
                let label = String(format: "%02d时", hour)
                let fullText = String(format: "%02d:00 – %02d:59", hour, hour)
                return TrendChartItem(
                    date: key,
                    milliseconds: bucket?.milliseconds ?? 0,
                    sessions: bucket?.sessions ?? 0,
                    label: label,
                    fullDateText: fullText
                )
            }

        case .week:
            let monday = Date(timeIntervalSince1970: Double(range.start) / 1000)
            return (0..<7).compactMap { dayOffset in
                guard let date = cal.date(byAdding: .day, value: dayOffset, to: monday) else { return nil }
                let key = dayFormatter.string(from: date)
                let bucket = bucketMap[key]
                let weekday = cal.component(.weekday, from: date)
                let weekdayName = weekdaySymbols[weekday - 1]
                let m = cal.component(.month, from: date)
                let d = cal.component(.day, from: date)
                return TrendChartItem(
                    date: key,
                    milliseconds: bucket?.milliseconds ?? 0,
                    sessions: bucket?.sessions ?? 0,
                    label: weekdayName,
                    fullDateText: "\(m)月\(d)日 \(weekdayName)"
                )
            }

        case .seven:
            let startDay = Date(timeIntervalSince1970: Double(range.start) / 1000)
            return (0..<7).compactMap { dayOffset in
                guard let date = cal.date(byAdding: .day, value: dayOffset, to: startDay) else { return nil }
                let key = dayFormatter.string(from: date)
                let bucket = bucketMap[key]
                let weekday = cal.component(.weekday, from: date)
                let weekdayName = weekdaySymbols[weekday - 1]
                let m = cal.component(.month, from: date)
                let d = cal.component(.day, from: date)
                return TrendChartItem(
                    date: key,
                    milliseconds: bucket?.milliseconds ?? 0,
                    sessions: bucket?.sessions ?? 0,
                    label: "\(m)/\(d)",
                    fullDateText: "\(m)月\(d)日 \(weekdayName)"
                )
            }

        case .month:
            let startDay = Date(timeIntervalSince1970: Double(range.start) / 1000)
            let dayCount = cal.range(of: .day, in: .month, for: startDay)?.count ?? 30
            return (0..<dayCount).compactMap { dayOffset in
                guard let date = cal.date(byAdding: .day, value: dayOffset, to: startDay) else { return nil }
                let key = dayFormatter.string(from: date)
                let bucket = bucketMap[key]
                let weekday = cal.component(.weekday, from: date)
                let weekdayName = weekdaySymbols[weekday - 1]
                let m = cal.component(.month, from: date)
                let d = cal.component(.day, from: date)
                return TrendChartItem(
                    date: key,
                    milliseconds: bucket?.milliseconds ?? 0,
                    sessions: bucket?.sessions ?? 0,
                    label: "\(d)日",
                    fullDateText: "\(m)月\(d)日 \(weekdayName)"
                )
            }

        case .thirty:
            let startDay = Date(timeIntervalSince1970: Double(range.start) / 1000)
            return (0..<30).compactMap { dayOffset in
                guard let date = cal.date(byAdding: .day, value: dayOffset, to: startDay) else { return nil }
                let key = dayFormatter.string(from: date)
                let bucket = bucketMap[key]
                let weekday = cal.component(.weekday, from: date)
                let weekdayName = weekdaySymbols[weekday - 1]
                let m = cal.component(.month, from: date)
                let d = cal.component(.day, from: date)
                return TrendChartItem(
                    date: key,
                    milliseconds: bucket?.milliseconds ?? 0,
                    sessions: bucket?.sessions ?? 0,
                    label: "\(d)日",
                    fullDateText: "\(m)月\(d)日 \(weekdayName)"
                )
            }

        case .custom:
            let startDay = Date(timeIntervalSince1970: Double(range.start) / 1000)
            let endDay = Date(timeIntervalSince1970: Double(range.end) / 1000)
            let diffDays = max(1, cal.dateComponents([.day], from: startDay, to: endDay).day ?? 1)
            if diffDays <= 31 {
                return (0..<diffDays).compactMap { dayOffset in
                    guard let date = cal.date(byAdding: .day, value: dayOffset, to: startDay) else { return nil }
                    let key = dayFormatter.string(from: date)
                    let bucket = bucketMap[key]
                    let weekday = cal.component(.weekday, from: date)
                    let weekdayName = weekdaySymbols[weekday - 1]
                    let m = cal.component(.month, from: date)
                    let d = cal.component(.day, from: date)
                    return TrendChartItem(
                        date: key,
                        milliseconds: bucket?.milliseconds ?? 0,
                        sessions: bucket?.sessions ?? 0,
                        label: "\(m)/\(d)",
                        fullDateText: "\(m)月\(d)日 \(weekdayName)"
                    )
                }
            } else {
                fallthrough
            }

        default:
            return buckets.map { bucket in
                let label: String
                if bucket.date.contains("T") {
                    label = String(bucket.date.suffix(2)) + "时"
                } else if bucket.date.count >= 10 {
                    label = String(bucket.date.dropFirst(5))
                } else {
                    label = bucket.date
                }
                return TrendChartItem(
                    date: bucket.date,
                    milliseconds: bucket.milliseconds,
                    sessions: bucket.sessions,
                    label: label,
                    fullDateText: bucket.date
                )
            }
        }
    }
}

private struct ReadingStatsDuration: View {
    let milliseconds: Int64

    var body: some View {
        let minutes = milliseconds / 60_000
        Group {
            if minutes == 0 && milliseconds > 0 {
                Text(ReadingStats.duration(milliseconds))
                    .font(serifFont(.title2, .medium))
            } else if minutes < 60 {
                Text("\(number(minutes)) 分钟")
            } else {
                Text("\(number(minutes / 60)) 小时 \(number(minutes % 60)) 分钟")
            }
        }
        .font(.subheadline)
        .foregroundStyle(ReadingSpace.onSummary)
        .monospacedDigit()
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("阅读时长")
        .accessibilityValue(ReadingStats.duration(milliseconds))
    }

    private func number(_ value: Int64) -> Text {
        Text(String(value)).font(serifFont(.largeTitle, .medium))
    }
}

private struct TrendChartItem: Identifiable {
    var id: String { date }
    let date: String
    let milliseconds: Int64
    let sessions: Int
    let label: String
    let fullDateText: String
    var minutes: Double { Double(milliseconds) / 60_000.0 }
}

private struct TrendSummaryHeader: View {
    let stats: ReadingStats
    let selectedItem: TrendChartItem?
    let showSessions: Bool
    let onClearSelection: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AppAdaptiveRow(spacing: 8) {
                Text(selectedItem.map { showSessions ? "\($0.sessions) 次" : ReadingStats.duration($0.milliseconds) } ?? primaryText)
                    .font(serifFont(.title2, .medium))
                    .foregroundStyle(selectedItem == nil ? ReadingSpace.ink : AppTheme.primary)
                    .contentTransition(.numericText())
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onClearSelection) {
                    HStack(spacing: 3) {
                        Text("恢复平均")
                        Image(systemName: "xmark.circle.fill").accessibilityHidden(true)
                    }
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.plain)
                .opacity(selectedItem == nil ? 0 : 1)
                .disabled(selectedItem == nil)
                .accessibilityHidden(selectedItem == nil)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: selectedItem?.id)
            }
            Text(selectedItem.map(selectedSubtitle) ?? subtitleText)
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
        }
        .accessibilityElement(children: .contain)
    }

    private var primaryText: String {
        guard stats.days > 0 else { return "暂无有效阅读" }
        if showSessions {
            return String(format: "%.1f 次", Double(stats.sessions) / Double(stats.days))
        } else {
            return ReadingStats.duration(stats.milliseconds / Int64(stats.days))
        }
    }

    private var subtitleText: String {
        "有效阅读日平均 · \(stats.days) 天有阅读"
    }

    private func selectedSubtitle(_ item: TrendChartItem) -> String {
        if item.milliseconds == 0 && item.sessions == 0 {
            return "\(item.fullDateText) · 未阅读"
        }
        if showSessions {
            return "\(item.fullDateText) · 阅读时长 \(ReadingStats.duration(item.milliseconds))"
        } else {
            return "\(item.fullDateText) · 阅读 \(item.sessions) 次"
        }
    }
}

private struct ReadingTrendChart: View {
    let items: [TrendChartItem]
    let showSessions: Bool
    let averageValue: Double
    let showAverageLine: Bool
    @Binding var selectedDate: String?

    var body: some View {
        Chart {
            if showAverageLine {
                RuleMark(y: .value("日均", averageValue))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(AppTheme.primary.opacity(0.45))
                    .annotation(position: .top, alignment: .trailing) {
                        Text("日均 \(formattedAverage)")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(AppTheme.surface.opacity(0.85), in: RoundedRectangle(cornerRadius: 3))
                    }
            }

            if let selectedDate, items.contains(where: { $0.id == selectedDate }) {
                RuleMark(x: .value("选中", selectedDate))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(AppTheme.textSecondary.opacity(0.45))
            }

            ForEach(items) { item in
                let val = showSessions ? Double(item.sessions) : item.minutes
                let isSelected = (selectedDate == item.id)
                let isDimmed = (selectedDate != nil && !isSelected)

                BarMark(
                    x: .value("日期", item.id),
                    y: .value(showSessions ? "次数" : "分钟", val),
                    width: .fixed(barWidth)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            AppTheme.primary.opacity(isDimmed ? 0.25 : (isSelected ? 1.0 : 0.85)),
                            AppTheme.primary.opacity(isDimmed ? 0.15 : (isSelected ? 0.85 : 0.55))
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .cornerRadius(barCornerRadius)
                .accessibilityLabel(item.fullDateText)
                .accessibilityValue(showSessions ? "\(item.sessions) 次" : ReadingStats.duration(item.milliseconds))
            }
        }
        .chartXSelection(value: $selectedDate)
        .onChange(of: selectedDate) { oldVal, newVal in
            if newVal != nil && newVal != oldVal {
                UISelectionFeedbackGenerator().selectionChanged()
            }
        }
        .chartXAxis {
            AxisMarks(values: axisValues) { value in
                AxisTick()
                    .foregroundStyle(AppTheme.border.opacity(0.8))
                AxisValueLabel {
                    if let id = value.as(String.self),
                       let item = items.first(where: { $0.id == id }) {
                        Text(item.label)
                            .font(.caption2)
                            .fontWeight(selectedDate == id ? .bold : .regular)
                            .foregroundStyle(selectedDate == id ? AppTheme.primary : AppTheme.textSecondary)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                    .foregroundStyle(AppTheme.border.opacity(0.5))
                AxisTick()
                    .foregroundStyle(AppTheme.border.opacity(0.6))
                AxisValueLabel {
                    if let val = value.as(Double.self) {
                        Text("\(Int(val))\(showSessions ? "次" : "分")")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
        }
        .chartYScale(domain: 0...domainUpper)
    }

    private var barWidth: CGFloat {
        let count = items.count
        if count <= 1 { return 24 }
        if count <= 7 { return 18 }
        if count <= 14 { return 12 }
        if count <= 31 { return 6 }
        return max(3, min(24, 260 / CGFloat(count)))
    }

    private var barCornerRadius: CGFloat {
        min(4, barWidth / 2)
    }

    private var domainUpper: Double {
        let maxVal = items.map { Double(showSessions ? $0.sessions : Int(ceil($0.minutes))) }.max() ?? 0
        if showSessions {
            return max(4, maxVal * 1.2)
        } else {
            return max(15, maxVal * 1.2)
        }
    }

    private var formattedAverage: String {
        if showSessions {
            return String(format: "%.1f次", averageValue)
        } else {
            let mins = Int(round(averageValue))
            if mins < 60 {
                return "\(mins)分"
            } else {
                return "\(mins / 60)时\(mins % 60)分"
            }
        }
    }

    private var axisValues: [String] {
        if items.count <= 7 {
            return items.map(\.id)
        }
        let step = max(1, Int(ceil(Double(items.count) / 6.0)))
        return stride(from: 0, to: items.count, by: step).map { items[$0].id }
    }
}
