import SwiftUI
import Charts
import ZhiZhouCore

struct ReadingStatsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var period: ReadingStatPeriod = .week
    @State private var offset = 0
    @State private var customStart = Date()
    @State private var customEnd = Date()
    @State private var showSessions = false
    @State private var selectedDate: String?
    @State private var stats: ReadingStats?
    @State private var statsQuery: String?
    @State private var loading = false
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
            Section {
                Picker("统计周期", selection: $period) {
                    ForEach(ReadingStatPeriod.allCases) { item in Text(item.title).tag(item) }
                }
                .onChange(of: period) { _, _ in
                    offset = 0
                    selectedDate = nil
                }
                if period == .custom {
                    DatePicker("开始日期", selection: $customStart, in: ...Date(), displayedComponents: .date)
                    DatePicker("结束日期", selection: $customEnd, in: ...Date(), displayedComponents: .date)
                } else if period != .all {
                    HStack {
                        Button {
                            offset -= 1
                            selectedDate = nil
                        } label: { Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel("上一周期")
                        Spacer(minLength: 4)
                        Text("\(dateText(range.start)) – \(dateText(max(range.start, range.end - 1)))")
                            .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                            .multilineTextAlignment(.center).monospacedDigit()
                        Spacer(minLength: 4)
                        Button {
                            offset += 1
                            selectedDate = nil
                        } label: { Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44) }
                            .disabled(offset >= 0).accessibilityLabel("下一周期")
                    }
                    .buttonStyle(.borderless)
                }
            }

            if let error {
                Section {
                    Text(error).foregroundStyle(AppTheme.textSecondary)
                    Button("重新加载") { Task { await load() } }
                }
            }
            if loading {
                Section { HStack { ProgressView(); Text("正在更新统计…").foregroundStyle(AppTheme.textSecondary) } }
            }
            if let stats {
                if statsQuery != queryID {
                    Section { Text("下方暂时保留上一次加载的结果，当前周期尚未更新。")
                        .font(.footnote).foregroundStyle(AppTheme.textSecondary) }
                }
                Section("阅读概览") {
                    LabeledContent("阅读时长", value: ReadingStats.duration(stats.milliseconds))
                        .foregroundStyle(AppTheme.primary)
                    LabeledContent("阅读次数", value: "\(stats.sessions) 次")
                    LabeledContent("阅读章节", value: "\(stats.chapters) 章")
                    LabeledContent("阅读天数", value: "\(stats.days) 天")
                }
                .monospacedDigit()

                let chartItems = buildChartItems(from: stats.trend, period: period, range: range)
                let selectedChartItem = chartItems.first(where: { $0.id == selectedDate })
                let avgMinutes = stats.days > 0 ? (Double(stats.milliseconds) / 60_000.0) / Double(stats.days) : 0
                let avgSessions = stats.days > 0 ? Double(stats.sessions) / Double(stats.days) : 0
                let averageValue = showSessions ? avgSessions : avgMinutes
                let showAverageLine = period != .today && stats.days > 1 && averageValue > 0

                Section("阅读趋势") {
                    Picker("趋势指标", selection: $showSessions) {
                        Text("时长").tag(false)
                        Text("次数").tag(true)
                    }.pickerStyle(.segmented)

                    if chartItems.isEmpty {
                        Text("这个周期还没有有效阅读记录。")
                            .foregroundStyle(AppTheme.textSecondary).padding(.vertical, 32)
                    } else {
                        TrendSummaryHeader(
                            stats: stats,
                            selectedItem: selectedChartItem,
                            showSessions: showSessions,
                            period: period,
                            onClearSelection: { selectedDate = nil }
                        )

                        ReadingTrendChart(
                            items: chartItems,
                            showSessions: showSessions,
                            averageValue: averageValue,
                            showAverageLine: showAverageLine,
                            selectedDate: $selectedDate
                        )
                        .frame(height: 190)
                        .padding(.vertical, 4)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: showSessions)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: selectedDate)

                        if !stats.trend.isEmpty {
                            DisclosureGroup("查看趋势明细") {
                                ForEach(stats.trend) { bucket in
                                    LabeledContent(detailDateText(bucket.date), value: showSessions ? "\(bucket.sessions) 次" : ReadingStats.duration(bucket.milliseconds))
                                        .font(.footnote).monospacedDigit()
                                }
                            }
                        }
                    }
                }

                Section("阅读作品") {
                    if stats.novels.isEmpty {
                        Text("开始阅读后，作品统计会显示在这里。")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    ForEach(stats.novels) { book in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(book.title).font(.headline)
                            Text("\(ReadingStats.duration(book.milliseconds)) · \(book.chapters) 章")
                                .font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                            Text("最近阅读 \(dateText(book.lastReadAt))\(book.available ? "" : " · 作品已删除")")
                                .font(.footnote).foregroundStyle(AppTheme.textMuted)
                        }.padding(.vertical, 4).accessibilityElement(children: .combine)
                    }
                }
                Section {
                    if let since = stats.recordedSince { Text("统计起始于 \(dateText(since))。") }
                    Text("北京时间，周一为每周起点。连续有效阅读满 30 秒计一次，切换章节不增加次数；离开超过 5 分钟后重新计次。后台、弹窗及长时间无操作暂停计时。章节与天数需累计阅读满 30 秒，重复章节去重；跨设备重叠时长只计一次。")
                    Text("统计从功能启用后开始，旧阅读时长无法补算。")
                }.font(.footnote).foregroundStyle(AppTheme.textSecondary)
            }
            if ReadingStatsStore.shared.pendingCount > 0 {
                Section {
                    Text("有 \(ReadingStatsStore.shared.pendingCount) 条阅读记录等待同步，联网后会自动重试（最多保留 7 天）。")
                    if let message = ReadingStatsStore.shared.lastSyncError { Text(message) }
                    Button("同步阅读记录") { Task { await load() } }
                }.font(.footnote)
            }
        }
        .appListStyle(.settings)
        .navigationTitle("阅读统计")
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.timeZone, ReadingStatPeriod.calendar.timeZone)
        .task(id: queryID) { await load() }
        .refreshable { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: ContentAccessStore.shared.revision) { _, _ in stats = nil }
        .onChange(of: appState.user?.id) { _, _ in stats = nil }
    }

    private func load() async {
        let id = UUID(); requestID = id
        let query = queryID
        let selected = range
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
    let period: ReadingStatPeriod
    let onClearSelection: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let item = selectedItem {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(showSessions ? "\(item.sessions) 次" : ReadingStats.duration(item.milliseconds))
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(AppTheme.primary)
                        .contentTransition(.numericText())
                        .monospacedDigit()
                    Spacer()
                    Button(action: onClearSelection) {
                        HStack(spacing: 3) {
                            Text("恢复平均")
                            Image(systemName: "xmark.circle.fill")
                        }
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                    }
                    .buttonStyle(.plain)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.85).combined(with: .opacity))
                }
                Text(selectedSubtitle(item))
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(primaryText)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(AppTheme.textPrimary)
                        .contentTransition(.numericText())
                        .monospacedDigit()
                }
                Text(subtitleText)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var primaryText: String {
        if showSessions {
            return "\(stats.sessions) 次"
        } else {
            return ReadingStats.duration(stats.milliseconds)
        }
    }

    private var subtitleText: String {
        let periodName = period.title
        let days = stats.days
        let avgMinutes = days > 0 ? (stats.milliseconds / 60_000) / Int64(days) : 0
        let avgSessions = days > 0 ? Double(stats.sessions) / Double(days) : 0
        if days == 0 {
            return "\(periodName)暂无有效阅读记录"
        }
        if showSessions {
            let avgStr = String(format: "%.1f", avgSessions)
            return "\(periodName)共 \(stats.sessions) 次 · 有效天日均 \(avgStr) 次 (\(days)天)"
        } else {
            return "\(periodName)共 \(ReadingStats.duration(stats.milliseconds)) · 有效天日均 \(ReadingStats.duration(avgMinutes * 60_000)) (\(days)天)"
        }
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
