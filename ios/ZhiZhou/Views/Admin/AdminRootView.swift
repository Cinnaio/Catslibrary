import SwiftUI

/// 入口在「我的」页。工作台、功能目录和搜索共用同一份权限过滤后的模块表。
struct AdminRootView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var searchText = ""
    @State private var overview = AdminWorkspaceOverview()

    private enum Destination: Hashable {
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
        let summary: String
    }

    private struct AdminModuleGroup: Identifiable {
        let id: String
        let title: String
        let modules: [AdminModule]
    }

    private let allModuleGroups: [AdminModuleGroup] = [
        AdminModuleGroup(id: "library", title: "作品", modules: [
            AdminModule(id: "novels", title: "小说管理", systemImage: "books.vertical", destination: .novels, summary: "查找作品、编辑资料与封面"),
            AdminModule(id: "chapters", title: "章节管理", systemImage: "doc.text", destination: .chapters, summary: "查找、编辑与排序章节"),
            AdminModule(id: "book-import", title: "书籍导入", systemImage: "square.and.arrow.down", destination: .bookImport, summary: "从目录地址预览并导入章节"),
            AdminModule(id: "discover", title: "发现小说", systemImage: "magnifyingglass", destination: .discover, summary: "按书名或作者搜索书源"),
        ]),
        AdminModuleGroup(id: "creation", title: "创作", modules: [
            AdminModule(id: "ai-service", title: "AI 服务", systemImage: "sparkles", destination: .aiService, summary: "对话创作、续写、封面及调用记录"),
        ]),
        AdminModuleGroup(id: "runtime", title: "运行", modules: [
            AdminModule(id: "tasks", title: "任务中心", systemImage: "shippingbox", destination: .jobs, summary: "跟踪 AI 与抓取任务的进度"),
            AdminModule(id: "dashboard", title: "后台总览", systemImage: "gauge", destination: .dashboard, summary: "内容规模、任务状态与最近更新"),
            AdminModule(id: "calls", title: "调用与用量", systemImage: "chart.bar.xaxis", destination: .calls, summary: "AI 调用、Token 用量与出站请求"),
            AdminModule(id: "scrape-center", title: "爬虫抓取", systemImage: "scope", destination: .scrapeCenter, summary: "按作品链接抓取、更新章节"),
            AdminModule(id: "scrape-sources", title: "源管理", systemImage: "antenna.radiowaves.left.and.right", destination: .scrapeSources, summary: "管理书源、账号与可用状态"),
            AdminModule(id: "scrape-configs", title: "配置导入导出", systemImage: "arrow.left.arrow.right.square", destination: .scrapeConfigs, summary: "迁移或备份抓取配置"),
        ]),
        AdminModuleGroup(id: "governance", title: "治理", modules: [
            AdminModule(id: "moderation", title: "内容审核", systemImage: "bubble.left.and.bubble.right", destination: .moderation, summary: "查看举报与处理评论"),
            AdminModule(id: "content-ratings", title: "分级管理", systemImage: "checkmark.shield", destination: .contentRatings, summary: "核查作品分级与规则"),
            AdminModule(id: "policy", title: "内容安全", systemImage: "shield.lefthalf.filled", destination: .policy, summary: "设置内容访问条件"),
        ]),
        AdminModuleGroup(id: "platform", title: "系统", modules: [
            AdminModule(id: "site-operations", title: "站点运营", systemImage: "chart.bar.xaxis", destination: .siteOperations, summary: "查看流量、趋势及站点运营数据"),
            AdminModule(id: "users", title: "账户与注册", systemImage: "person.2", destination: .users, summary: "管理用户、注册方式与邀请码"),
            AdminModule(id: "login-audit", title: "登录审计", systemImage: "lock.shield", destination: .loginAudit, summary: "检查登录方式、时间和结果"),
            AdminModule(id: "operations-audit", title: "操作审计", systemImage: "list.bullet.clipboard", destination: .operationsAudit, summary: "查找后台操作与执行回执"),
            AdminModule(id: "site-settings", title: "站点设置", systemImage: "gearshape", destination: .siteSettings, summary: "管理站点信息和品牌资源"),
            AdminModule(id: "proxy", title: "代理设置", systemImage: "network", destination: .proxy, summary: "配置代理与测试出站连接"),
            AdminModule(id: "backups", title: "备份与恢复", systemImage: "externaldrive", destination: .backups, summary: "检查备份、存储目标与恢复范围"),
            AdminModule(id: "announcement", title: "站点公告", systemImage: "megaphone", destination: .announcement, summary: "编辑面向读者的公告"),
        ]),
    ]

    private var moduleGroups: [AdminModuleGroup] {
        allModuleGroups.compactMap { group in
            let modules = group.modules.filter { canOpen($0.destination) }
            return modules.isEmpty ? nil : AdminModuleGroup(id: group.id, title: group.title, modules: modules)
        }
    }

    private let restricted: Set<Destination> = [.proxy, .policy, .siteSettings, .backups, .announcement]
    private var searchTerms: [Substring] { searchText.split(whereSeparator: \.isWhitespace) }

    var body: some View {
        Group {
            if appState.user?.isAdmin == true {
                workspace
            } else {
                ContentUnavailableView("需要管理员权限", systemImage: "lock.shield")
            }
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceNavigation()
    }

    private var workspace: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("管理工作台")
            if searchTerms.isEmpty {
                AdminWorkspaceHomeSections(overview: overview) { shortcuts }
            } else {
                let matches = matchingGroups
                if matches.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    moduleSections(matches, animateRows: true)
                }
            }
        }
        .searchable(text: Binding(get: { searchText }, set: updateSearch), prompt: "搜索管理功能")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("刷新工作台", systemImage: "arrow.clockwise") {
                    Task { await overview.load(forceMetadata: true) }
                }
                .labelStyle(.iconOnly)
                .disabled(overview.loading)

                NavigationLink {
                    AdminWorkspaceList {
                        AdminWorkspaceHeading("全部管理功能")
                        moduleSections(moduleGroups, animateRows: true)
                    }
                } label: {
                    Label("全部功能", systemImage: "square.grid.2x2")
                        .labelStyle(.iconOnly)
                }
                .accessibilityIdentifier("admin.allModules")
            }
        }
        .refreshable { await overview.load(forceMetadata: true) }
        .task(id: ContentAccessStore.shared.accountRevision) {
            await overview.load(forceMetadata: true)
        }
    }

    private var shortcuts: some View {
        let modules = moduleGroups.flatMap(\.modules)
        let frequent: [Destination] = [.novels, .bookImport, .jobs, .aiService]
        return AdminWorkspaceSection("常用操作") {
            ForEach(frequent.compactMap { destination in modules.first { $0.destination == destination } }) { module in
                moduleLink(module, showsSummary: false)
            }
        }
    }

    private func moduleSections(_ groups: [AdminModuleGroup], animateRows: Bool = false) -> some View {
        ForEach(groups) { group in
            AdminWorkspaceSection(group.title) {
                ForEach(Array(group.modules.enumerated()), id: \.element.id) { index, module in
                    moduleLink(module, showsSummary: true)
                        .readingSpaceEntrance(index)
                        .transition(
                            animateRows && !reduceMotion
                                ? .opacity.animation(AppMotion.micro.delay(Double(index) * 0.018))
                                : .identity
                        )
                }
            }
        }
    }

    private var matchingGroups: [AdminModuleGroup] {
        let terms = searchTerms.map { String($0) }
        return moduleGroups.compactMap { group in
            let matches = group.modules.filter { module in
                let searchable = "\(group.title) \(module.title) \(module.summary)"
                return terms.allSatisfy { searchable.localizedStandardContains($0) }
            }
            return matches.isEmpty ? nil : AdminModuleGroup(id: group.id, title: group.title, modules: matches)
        }
    }

    private func updateSearch(_ value: String) {
        withAnimation(reduceMotion ? nil : AppMotion.micro) { searchText = value }
    }

    private func canOpen(_ destination: Destination) -> Bool {
        appState.user?.isAdmin == true && (!restricted.contains(destination) || appState.user?.isSuperAdmin == true)
    }

    private func moduleLink(_ module: AdminModule, showsSummary: Bool) -> some View {
        NavigationLink {
            if canOpen(module.destination) {
                destination(for: module.destination)
            } else {
                ContentUnavailableView("需要管理员权限", systemImage: "lock.shield")
            }
        } label: {
            AdminWorkspaceEntry(module.title, systemImage: module.systemImage,
                                detail: showsSummary ? module.summary : "")
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
