import SwiftUI

/// 管理后台首页：模块入口列表。入口在「我的」页（仅 role == admin 可见），
/// 此处再兜底校验一次权限，防止误入。
struct AdminRootView: View {
    @Environment(AppState.self) private var appState
    @State private var searchText = ""

    private enum Destination {
        case dashboard
        case moderation
        case contentRatings
        case novels
        case chapters
        case jobs
        case calls
        case bookImport
        case operationsAudit
        case siteSettings
        case backups
        case scrapeCenter
        case discover
        case scrapeConfigs
        case scrapeSources
        case popoAccount
        case proxy
        case aiService
        case siteOperations
        case users
        case loginAudit
        case policy
        case announcement
    }

    private struct AdminModule: Identifiable {
        let id: String
        let title: String
        let systemImage: String
        let destination: Destination
    }

    private struct AdminModuleGroup: Identifiable {
        let id: String
        let title: String
        let modules: [AdminModule]
    }

    private let moduleGroups: [AdminModuleGroup] = [
        AdminModuleGroup(id: "monitoring", title: "监控", modules: [
            AdminModule(id: "dashboard", title: "后台总览", systemImage: "gauge", destination: .dashboard),
        ]),
        AdminModuleGroup(id: "library", title: "内容库", modules: [
            AdminModule(id: "novels", title: "小说管理", systemImage: "books.vertical", destination: .novels),
            AdminModule(id: "chapters", title: "章节管理", systemImage: "doc.text", destination: .chapters),
            AdminModule(id: "book-import", title: "书籍导入", systemImage: "square.and.arrow.down", destination: .bookImport),
        ]),
        AdminModuleGroup(id: "production", title: "内容生产", modules: [
            AdminModule(id: "scrape-center", title: "爬虫抓取", systemImage: "scope", destination: .scrapeCenter),
            AdminModule(id: "ai-service", title: "AI 服务", systemImage: "sparkles", destination: .aiService),
            AdminModule(id: "discover", title: "发现小说", systemImage: "magnifyingglass", destination: .discover),
            AdminModule(id: "scrape-configs", title: "配置导入导出", systemImage: "arrow.left.arrow.right.square", destination: .scrapeConfigs),
            AdminModule(id: "scrape-sources", title: "源管理", systemImage: "antenna.radiowaves.left.and.right", destination: .scrapeSources),
            AdminModule(id: "popo-account", title: "POPO 账号", systemImage: "person.badge.key", destination: .popoAccount),
            AdminModule(id: "proxy", title: "代理设置", systemImage: "network", destination: .proxy),
        ]),
        AdminModuleGroup(id: "runtime", title: "运行监控", modules: [
            AdminModule(id: "tasks", title: "任务中心", systemImage: "shippingbox", destination: .jobs),
            AdminModule(id: "calls", title: "调用与用量", systemImage: "chart.bar.xaxis", destination: .calls),
        ]),
        AdminModuleGroup(id: "governance", title: "内容治理", modules: [
            AdminModule(id: "moderation", title: "内容审核", systemImage: "bubble.left.and.bubble.right", destination: .moderation),
            AdminModule(id: "content-ratings", title: "分级管理", systemImage: "checkmark.shield", destination: .contentRatings),
            AdminModule(id: "policy", title: "内容安全", systemImage: "shield.lefthalf.filled", destination: .policy),
        ]),
        AdminModuleGroup(id: "platform", title: "平台运营", modules: [
            AdminModule(id: "site-operations", title: "站点运营", systemImage: "chart.bar.xaxis", destination: .siteOperations),
            AdminModule(id: "users", title: "账户与注册", systemImage: "person.2", destination: .users),
            AdminModule(id: "login-audit", title: "登录审计", systemImage: "lock.shield", destination: .loginAudit),
            AdminModule(id: "operations-audit", title: "操作审计", systemImage: "list.bullet.clipboard", destination: .operationsAudit),
            AdminModule(id: "site-settings", title: "站点设置", systemImage: "gearshape", destination: .siteSettings),
            AdminModule(id: "backups", title: "备份与恢复", systemImage: "externaldrive", destination: .backups),
            AdminModule(id: "announcement", title: "站点公告", systemImage: "megaphone", destination: .announcement),
        ]),
    ]

    var body: some View {
        Group {
            if appState.user?.role == "admin" {
                moduleList
            } else {
                ContentUnavailableView {
                    Label("需要管理员权限", systemImage: "lock.shield")
                } description: {
                    Text("当前账号没有访问管理后台的权限。")
                }
                .pageBackground(.browsing)
            }
        }
        .navigationTitle("管理后台")
        .navigationBarTitleDisplayMode(.large)
    }

    private var moduleList: some View {
        List {
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                moduleSections
            } else {
                searchSections
            }
        }
        .appListStyle(.settings)
        .searchable(text: $searchText, prompt: "搜索后台功能")
    }

    @ViewBuilder
    private var moduleSections: some View {
        ForEach(moduleGroups) { group in
            Section(group.title) {
                ForEach(group.modules) { module in
                    moduleLink(module)
                }
            }
        }
    }

    @ViewBuilder
    private var searchSections: some View {
        if filteredModules.isEmpty {
            ContentUnavailableView {
                Label("没有匹配的功能", systemImage: "magnifyingglass")
            } description: {
                Text("试试搜索“小说”“任务”或“用户”。")
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
            ForEach(moduleGroups) { group in
                let matches = matchingModules(in: group)
                if !matches.isEmpty {
                    Section(group.title) {
                        ForEach(matches) { module in
                            moduleLink(module)
                        }
                    }
                }
            }
        }
    }

    private var filteredModules: [AdminModule] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return moduleGroups.flatMap { matchingModules(in: $0, query: query) }
    }

    private func matchingModules(
        in group: AdminModuleGroup,
        query: String? = nil
    ) -> [AdminModule] {
        let normalized = (query ?? searchText).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return group.modules }
        return group.modules.filter { module in
            module.title.localizedCaseInsensitiveContains(normalized)
                || group.title.localizedCaseInsensitiveContains(normalized)
        }
    }

    private func moduleLink(_ module: AdminModule) -> some View {
        NavigationLink {
            destination(for: module.destination)
        } label: {
            AppIconLabel(module.title, systemImage: module.systemImage)
        }
        .accessibilityIdentifier("admin.module.\(module.id)")
    }

    @ViewBuilder
    private func destination(for destination: Destination) -> some View {
        switch destination {
        case .dashboard: AdminDashboardView()
        case .moderation: AdminModerationView()
        case .contentRatings: AdminContentRatingsView()
        case .novels: AdminNovelsView()
        case .chapters: AdminChaptersView()
        case .jobs: AdminTaskCenterView()
        case .calls: AdminCallsView()
        case .bookImport: AdminBookImportView()
        case .operationsAudit: AdminOperationsView()
        case .siteSettings: AdminSiteSettingsView()
        case .backups: AdminBackupsView()
        case .scrapeCenter: AdminScrapeCenterView()
        case .discover: AdminDiscoverView()
        case .scrapeConfigs: AdminScrapeConfigsView()
        case .scrapeSources: AdminScrapeSourcesView()
        case .popoAccount: Po18AccountSheet()
        case .proxy: AdminProxyView()
        case .aiService: AdminAIServiceView()
        case .siteOperations: AdminSiteOperationsView()
        case .users: AdminUsersView()
        case .loginAudit: AdminLoginAuditView()
        case .policy: AdminPolicyView()
        case .announcement: AdminAnnouncementView()
        }
    }
}
