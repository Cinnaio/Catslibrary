import SwiftUI

/// 站点运营：运营概览（指标 / 流量分析 / 内容健康度 / 公告编辑）。
/// 对齐 Web 端 admin SiteOperationsTab（GET /api/admin/site 一次拉取全部数据）。
struct AdminSiteOperationsView: View {
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
    @State private var saveMessage: String?
    @State private var actionError: String?

    var body: some View {
        List {
            if isLoading && overview == nil {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, overview == nil {
                Section {
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
                Section {
                    Picker("视图", selection: $tab) {
                        ForEach(SectionTab.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
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
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("站点运营")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
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
                Section("今日指标") {
                    metricRow("页面浏览", value: metrics.todayPageViews, unit: "次")
                    metricRow("独立访客", value: metrics.todayVisitors, unit: "人")
                }
                Section("近 7 天") {
                    metricRow("页面浏览", value: metrics.weekPageViews, unit: "次")
                    metricRow("独立访客", value: metrics.weekVisitors, unit: "人")
                    metricRow("活跃读者", value: metrics.activeReaders, unit: "人")
                }
            }
            if let popular = overview.popularNovels, !popular.isEmpty {
                Section("热门小说（近 7 天）") {
                    ForEach(popular) { novel in
                        HStack {
                            Text(novel.title)
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text("\(novel.views ?? 0) 次浏览")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            announcementSection
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
        Section("站点公告") {
            TextEditor(text: $announcement)
                .frame(minHeight: 80)
                .font(.subheadline)
                .scrollContentBackground(.hidden)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(AppTheme.border, lineWidth: 1)
                )
                .padding(.vertical, 4)
            Button {
                Task { await saveAnnouncement() }
            } label: {
                if savingAnnouncement {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Label("保存公告", systemImage: "checkmark.circle")
                }
            }
            .disabled(savingAnnouncement)
            if let saveMessage {
                Label(saveMessage, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.success)
            }
        } footer: {
            Text("公告显示在网站头部与 App 首页，留空表示不展示（最长 240 字）。")
        }
    }

    // MARK: - 流量分析

    private func trafficContent(_ traffic: SiteTraffic?) -> some View {
        Group {
            if let trend = traffic?.dailyTrend, !trend.isEmpty {
                Section("每日流量趋势（近 \(trend.count) 天）") {
                    ForEach(Array(trend.suffix(14).reversed())) { point in
                        HStack {
                            Text(point.date)
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                            Spacer()
                            Text("\(point.pageViews ?? 0) 浏览")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textPrimary)
                            Text("· \(point.visitors ?? 0) 访客")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textMuted)
                        }
                    }
                }
            }
            if let countries = traffic?.countries, !countries.isEmpty {
                Section("访客地区") {
                    ForEach(countries.prefix(8)) { country in
                        HStack {
                            Text(countryLabel(country.countryCode))
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                            Spacer()
                            Text("\(country.visits ?? 0) 次")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            if let devices = traffic?.devices, !devices.isEmpty {
                Section("设备类型") {
                    ForEach(devices) { device in
                        HStack {
                            Text(deviceLabel(device.key))
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                            Spacer()
                            Text("\(device.visits ?? 0) 次")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            if let sources = traffic?.sources, !sources.isEmpty {
                Section("流量来源") {
                    ForEach(sources) { source in
                        HStack {
                            Text(sourceLabel(source.key))
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textPrimary)
                            Spacer()
                            Text("\(source.visits ?? 0) 次")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            if traffic == nil || (traffic?.dailyTrend?.isEmpty != false) {
                Section {
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
                Section("规模") {
                    metricRow("小说", value: health.novels, unit: "本")
                    metricRow("章节", value: health.chapters, unit: "章")
                    metricRow("新评论", value: health.newComments, unit: "条")
                    metricRow("待处理举报", value: health.openReports, unit: "条")
                }
                if let quality = health.quality {
                    Section("质量检查") {
                        qualityRow("未分类", value: quality.uncategorized)
                        qualityRow("缺封面", value: quality.missingCover)
                        qualityRow("缺简介", value: quality.missingDescription)
                        qualityRow("停滞连载", value: quality.staleOngoing)
                    }
                }
                if let updates = health.recentUpdates {
                    Section("更新情况") {
                        metricRow("近 7 天更新", value: updates.last7Days, unit: "本")
                        metricRow("近 30 天更新", value: updates.last30Days, unit: "本")
                        if let novels = updates.novels, !novels.isEmpty {
                            ForEach(novels) { novel in
                                HStack {
                                    Text(novel.title)
                                        .font(.subheadline)
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(AdminFormat.relativeTime(novel.updatedAt ?? 0))
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                        }
                    }
                }
                if let categories = health.categories, !categories.isEmpty {
                    Section("分类分布（前 10）") {
                        ForEach(categories.prefix(10)) { category in
                            HStack {
                                Text(category.category)
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(category.novels ?? 0) 本")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                }
                if let completeness = health.completeness, !completeness.isEmpty {
                    Section("信息完整度最低（前 8）") {
                        ForEach(completeness) { item in
                            HStack {
                                Text(item.title)
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(item.score ?? 0)/6")
                                    .font(.caption)
                                    .foregroundStyle(item.score ?? 0 < 4 ? AppTheme.warning : AppTheme.success)
                            }
                        }
                    }
                }
                if let scrape = health.scrapeHealth {
                    Section("采集健康（近 \(scrape.windowDays ?? 30) 天）") {
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
                Section {
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
        saveMessage = nil
        do {
            let saved = String(announcement.prefix(240))
            _ = try await AdminAPI.setAnnouncement(saved)
            announcement = saved
            saveMessage = "公告已保存"
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
