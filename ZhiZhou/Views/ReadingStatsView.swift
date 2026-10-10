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
                .onChange(of: period) { _, _ in offset = 0 }
                if period == .custom {
                    DatePicker("开始日期", selection: $customStart, in: ...Date(), displayedComponents: .date)
                    DatePicker("结束日期", selection: $customEnd, in: ...Date(), displayedComponents: .date)
                } else if period != .all {
                    HStack {
                        Button { offset -= 1 } label: { Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel("上一周期")
                        Spacer(minLength: 4)
                        Text("\(dateText(range.start)) – \(dateText(max(range.start, range.end - 1)))")
                            .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                            .multilineTextAlignment(.center).monospacedDigit()
                        Spacer(minLength: 4)
                        Button { offset += 1 } label: { Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44) }
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

                Section("阅读趋势") {
                    Picker("趋势指标", selection: $showSessions) {
                        Text("时长").tag(false)
                        Text("次数").tag(true)
                    }.pickerStyle(.segmented)
                    if stats.trend.isEmpty {
                        Text("这个周期还没有有效阅读记录。")
                            .foregroundStyle(AppTheme.textSecondary).padding(.vertical, 32)
                    } else {
                        ReadingTrendChart(buckets: stats.trend, showSessions: showSessions)
                            .frame(height: 200).padding(.vertical, 8)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: showSessions)
                        DisclosureGroup("查看趋势明细") {
                            ForEach(stats.trend) { bucket in
                                LabeledContent(bucket.date, value: showSessions ? "\(bucket.sessions) 次" : ReadingStats.duration(bucket.milliseconds))
                                    .font(.footnote).monospacedDigit()
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
}

private struct ReadingTrendChart: View {
    let buckets: [ReadingStats.Bucket]
    let showSessions: Bool
    var body: some View {
        Chart(buckets) { bucket in
            BarMark(x: .value("日期", bucket.date), y: .value(showSessions ? "次数" : "分钟", showSessions ? Double(bucket.sessions) : Double(bucket.milliseconds) / 60_000))
                .foregroundStyle(AppTheme.primary.opacity(0.85)).cornerRadius(3)
                .accessibilityLabel(bucket.date)
                .accessibilityValue(showSessions ? "\(bucket.sessions) 次" : ReadingStats.duration(bucket.milliseconds))
        }
        .chartXAxis {
            AxisMarks(values: labels) { value in
                AxisValueLabel {
                    if let date = value.as(String.self) { Text(shortLabel(date)).font(.caption2) }
                }
            }
        }
        .chartYAxisLabel(showSessions ? "次数" : "分钟")
    }
    private var labels: [String] {
        let step = max(1, Int(ceil(Double(buckets.count) / 5)))
        return stride(from: 0, to: buckets.count, by: step).map { buckets[$0].date }
    }
    private func shortLabel(_ date: String) -> String {
        if date.contains("T") { return String(date.suffix(2)) + "时" }
        return String(date.dropFirst(5))
    }
}
