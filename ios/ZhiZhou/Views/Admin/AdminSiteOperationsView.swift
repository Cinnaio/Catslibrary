import SwiftUI
import Charts

/// 站点运营：运营概览（指标 / 流量分析 / 内容健康度 / 公告编辑）。
/// 对齐 Web 端 admin SiteOperationsTab（GET /api/admin/site 一次拉取全部数据）。
struct AdminSiteOperationsView: View {
    @Environment(AppState.self) private var appState
    enum SectionTab: String, CaseIterable, Identifiable {
        case overview = "运营概览"
        case traffic = "流量分析"
        case content = "内容健康"
        var id: String { rawValue }
    }

    @State private var overview: SiteOverview?
    @State private var tab: SectionTab = .overview
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var announcement = ""
    @State private var savingAnnouncement = false
    @State private var actionError: String?
    @FocusState private var focusedField: Bool

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("站点运营")
            if let errorMessage, overview != nil {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            if isLoading && overview == nil {
                Group {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, overview == nil {
                Group {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if let overview {
                Group {
                    Picker("视图", selection: $tab) {
                        ForEach(SectionTab.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .accessibleSegmentedPicker()
                }
                switch tab {
                case .overview:
                    overviewContent(overview)
                case .traffic:
                    trafficContent(overview.traffic)
                case .content:
                    contentContent(overview.contentHealth)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = false }
            }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 运营概览

    private func overviewContent(_ overview: SiteOverview) -> some View {
        Group {
            if let metrics = overview.metrics {
                AdminWorkspaceSection("今日指标") {
                    metricRow("页面浏览", value: metrics.todayPageViews, unit: "次")
                    metricRow("独立访客", value: metrics.todayVisitors, unit: "人")
                }
                AdminWorkspaceSection("近 7 天") {
                    metricRow("页面浏览", value: metrics.weekPageViews, unit: "次")
                    metricRow("独立访客", value: metrics.weekVisitors, unit: "人")
                    metricRow("活跃读者", value: metrics.activeReaders, unit: "人")
                }
            }
            if let popular = overview.popularNovels, !popular.isEmpty {
                AdminWorkspaceSection("热门小说（近 7 天）") {
                    ReadingSpaceSummaryRows(popular) { novel, _ in
                        ReadingSpaceSummaryRow(title: novel.title, value: "\(novel.views ?? 0) 次浏览", isBookTitle: true)
                    }
                }
            }
            if appState.user?.isSuperAdmin == true {
                announcementSection
            }
        }
    }

    private func metricRow(_ label: String, value: Int?, unit: String) -> some View {
        LabeledContent(label) {
            Text("\(value ?? 0) \(unit)")
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    // MARK: - 公告编辑

    private var announcementSection: some View {
        AdminWorkspaceSection("站点公告") {
            AccountSettingsField("公告内容", isFocused: focusedField) {
                TextEditor(text: $announcement)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 100)
                    .focused($focusedField)
                    .disabled(savingAnnouncement)
                    .accessibilityLabel("公告内容")
            }
            Button {
                Task { await saveAnnouncement() }
            } label: {
                if savingAnnouncement {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Label("保存公告", systemImage: "checkmark.circle")
                }
            }
            .disabled(savingAnnouncement || announcement.count > 240)
            Text("\(announcement.count)/240")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(announcement.count > 240 ? AppTheme.danger : AppTheme.textSecondary)
            AccountSettingsNote("公告显示在网站头部与 App 首页，留空表示不展示（最长 240 字）。")
        }
    }

    // MARK: - 流量分析

    private func trafficContent(_ traffic: SiteTraffic?) -> some View {
        Group {
            if let trend = traffic?.dailyTrend, !trend.isEmpty {
                let recentTrend = Array(trend.suffix(14))
                let recentDays = Array(recentTrend.reversed().prefix(5))
                AdminWorkspaceSection("每日流量趋势（最近 \(recentTrend.count) 个记录日）") {
                    Chart {
                        ForEach(recentTrend) { point in
                            LineMark(
                                x: .value("日期", point.date),
                                y: .value("页面浏览", Double(point.pageViews ?? 0))
                            )
                            .foregroundStyle(by: .value("指标", "页面浏览"))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            PointMark(
                                x: .value("日期", point.date),
                                y: .value("页面浏览", Double(point.pageViews ?? 0))
                            )
                            .foregroundStyle(by: .value("指标", "页面浏览"))

                            LineMark(
                                x: .value("日期", point.date),
                                y: .value("访客", Double(point.visitors ?? 0))
                            )
                            .foregroundStyle(by: .value("指标", "访客"))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            PointMark(
                                x: .value("日期", point.date),
                                y: .value("访客", Double(point.visitors ?? 0))
                            )
                            .foregroundStyle(by: .value("指标", "访客"))
                        }
                    }
                    .frame(height: 170)
                    .chartForegroundStyleScale([
                        "页面浏览": AppTheme.primary,
                        "访客": AppTheme.warning,
                    ])
                    .chartLegend(position: .bottom, alignment: .leading)
                    .chartYAxis { AxisMarks(position: .leading) }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                            AxisGridLine()
                            AxisValueLabel()
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("最近 \(recentTrend.count) 个记录日的页面浏览与访客趋势")
                    .accessibilityValue(
                        recentTrend
                            .map { "\($0.date) 浏览 \($0.pageViews ?? 0) 次，访客 \($0.visitors ?? 0) 人" }
                            .joined(separator: "，")
                    )

                    DisclosureGroup("查看最近 \(recentDays.count) 个记录日明细") {
                        ForEach(recentDays) { point in
                            ReadingSpaceSummaryRow(
                                title: point.date,
                                value: "\(point.pageViews ?? 0) 次浏览",
                                detail: "\(point.visitors ?? 0) 位访客"
                            )
                        }
                    }
                }
            }
            if let countries = traffic?.countries, !countries.isEmpty {
                AdminWorkspaceSection("访客地区") {
                    ReadingSpaceSummaryRows(Array(countries.prefix(8))) { country, _ in
                        ReadingSpaceSummaryRow(title: countryLabel(country.countryCode), value: "\(country.visits ?? 0) 次")
                    }
                }
            }
            if let devices = traffic?.devices, !devices.isEmpty {
                AdminWorkspaceSection("设备类型") {
                    ReadingSpaceSummaryRows(devices) { device, _ in
                        ReadingSpaceSummaryRow(title: deviceLabel(device.key), value: "\(device.visits ?? 0) 次")
                    }
                }
            }
            if let sources = traffic?.sources, !sources.isEmpty {
                AdminWorkspaceSection("流量来源") {
                    ReadingSpaceSummaryRows(sources) { source, _ in
                        ReadingSpaceSummaryRow(title: sourceLabel(source.key), value: "\(source.visits ?? 0) 次")
                    }
                }
            }
            if traffic == nil || (traffic?.dailyTrend?.isEmpty != false) {
                Group {
                    ContentUnavailableView {
                        Label("暂无流量数据", systemImage: "chart.bar")
                    } description: {
                        Text("站点还没有记录访问数据，读者访问后这里会逐步填充。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
        }
    }

    private func countryLabel(_ code: String) -> String {
        switch code {
        case "CN": return "中国"
        case "HK": return "中国香港"
        case "MO": return "中国澳门"
        case "TW": return "中国台湾"
        case "JP": return "日本"
        case "KR": return "韩国"
        case "SG": return "新加坡"
        case "US": return "美国"
        case "CA": return "加拿大"
        case "GB": return "英国"
        case "DE": return "德国"
        case "AU": return "澳大利亚"
        case "ZZ": return "其他"
        default: return code
        }
    }

    private func deviceLabel(_ key: String) -> String {
        switch key {
        case "mobile": return "移动端"
        case "desktop": return "桌面端"
        case "tablet": return "平板"
        case "bot": return "自动访问"
        default: return "其他"
        }
    }

    private func sourceLabel(_ key: String) -> String {
        switch key {
        case "direct": return "直接访问"
        case "search": return "搜索引擎"
        case "external": return "外部链接"
        case "internal": return "站内跳转"
        default: return "其他"
        }
    }

    // MARK: - 内容健康度

    private func contentContent(_ health: SiteContentHealth?) -> some View {
        Group {
            if let health {
                AdminWorkspaceSection("规模") {
                    metricRow("小说", value: health.novels, unit: "本")
                    metricRow("章节", value: health.chapters, unit: "章")
                    metricRow("新评论", value: health.newComments, unit: "条")
                    metricRow("待处理举报", value: health.openReports, unit: "条")
                }
                if let quality = health.quality {
                    AdminWorkspaceSection("质量检查") {
                        qualityRow("未分类", value: quality.uncategorized)
                        qualityRow("缺封面", value: quality.missingCover)
                        qualityRow("缺简介", value: quality.missingDescription)
                        qualityRow("停滞连载", value: quality.staleOngoing)
                    }
                }
                if let updates = health.recentUpdates {
                    AdminWorkspaceSection("更新情况") {
                        metricRow("近 7 天更新", value: updates.last7Days, unit: "本")
                        metricRow("近 30 天更新", value: updates.last30Days, unit: "本")
                        if let novels = updates.novels, !novels.isEmpty {
                            ReadingSpaceSummaryRows(novels) { novel, _ in
                                ReadingSpaceSummaryRow(
                                    title: novel.title,
                                    value: AdminFormat.relativeTime(novel.updatedAt ?? 0),
                                    isBookTitle: true
                                )
                            }
                        }
                    }
                }
                if let categories = health.categories, !categories.isEmpty {
                    AdminWorkspaceSection("分类分布（前 10）") {
                        ReadingSpaceSummaryRows(Array(categories.prefix(10))) { category, _ in
                            ReadingSpaceSummaryRow(title: category.category, value: "\(category.novels ?? 0) 本")
                        }
                    }
                }
                if let completeness = health.completeness, !completeness.isEmpty {
                    AdminWorkspaceSection("信息完整度最低（前 8）") {
                        ReadingSpaceSummaryRows(completeness) { item, _ in
                            let score = item.score ?? 0
                            ReadingSpaceSummaryRow(
                                title: item.title,
                                value: "\(score)/6",
                                isBookTitle: true,
                                valueTint: score < 4 ? AppTheme.warning : AppTheme.success
                            )
                        }
                    }
                }
                if let scrape = health.scrapeHealth {
                    AdminWorkspaceSection("采集健康（近 \(scrape.windowDays ?? 30) 天）") {
                        metricRow("完成", value: scrape.completed, unit: "个")
                        metricRow("失败", value: scrape.failed, unit: "个")
                        metricRow("运行中", value: scrape.active, unit: "个")
                        if let last = scrape.lastUpdated, last > 0 {
                            LabeledContent("最近更新") {
                                Text(AdminFormat.relativeTime(last))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                }
            } else {
                Group {
                    ContentUnavailableView {
                        Label("暂无数据", systemImage: "waveform.path.ecg")
                    } description: {
                        Text("内容健康度数据暂不可用。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
        }
    }

    private func qualityRow(_ label: String, value: Int?) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            Text("\(value ?? 0)")
                .font(.subheadline)
                .foregroundStyle((value ?? 0) > 0 ? AppTheme.warning : AppTheme.success)
        }
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await AdminAPI.siteOverview()
            overview = result
            announcement = result.announcement ?? ""
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func saveAnnouncement() async {
        savingAnnouncement = true
        defer { savingAnnouncement = false }
        do {
            let saved = String(announcement.prefix(240))
            _ = try await AdminAPI.setAnnouncement(saved)
            announcement = saved
            AppFeedback.success("公告已保存")
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
