import SwiftUI

/// 管理后台首页：模块入口列表。入口在「我的」页（仅 role == admin 可见），
/// 此处再兜底校验一次权限，防止误入。
struct AdminRootView: View {
    @Environment(AppState.self) private var appState

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
                .pageBackground()
            }
        }
        .navigationTitle("管理后台")
        .navigationBarTitleDisplayMode(.large)
    }

    private var moduleList: some View {
        List {
            Section("监控") {
                NavigationLink {
                    AdminDashboardView()
                } label: {
                    Label("总览", systemImage: "gauge")
                }
            }

            Section("内容") {
                NavigationLink {
                    AdminModerationView()
                } label: {
                    Label("内容审核", systemImage: "bubble.left.and.bubble.right")
                }
                NavigationLink {
                    AdminNovelsView()
                } label: {
                    Label("小说管理", systemImage: "books.vertical")
                }
                NavigationLink {
                    AdminChaptersView()
                } label: {
                    Label("章节管理", systemImage: "doc.text")
                }
            }

            Section("运维") {
                NavigationLink {
                    AdminJobsView()
                } label: {
                    Label("任务管理", systemImage: "shippingbox")
                }
                NavigationLink {
                    AdminScrapeCenterView()
                } label: {
                    Label("爬虫抓取中心", systemImage: "scope")
                }
                NavigationLink {
                    AdminDiscoverView()
                } label: {
                    Label("发现小说", systemImage: "magnifyingglass")
                }
                NavigationLink {
                    AdminScrapeConfigsView()
                } label: {
                    Label("配置导入导出", systemImage: "arrow.left.arrow.right.square")
                }
                NavigationLink {
                    AdminScrapeSourcesView()
                } label: {
                    Label("源管理", systemImage: "antenna.radiowaves.left.and.right")
                }
                NavigationLink {
                    Po18AccountSheet()
                } label: {
                    Label("POPO 账号", systemImage: "person.badge.key")
                }
                NavigationLink {
                    AdminProxyView()
                } label: {
                    Label("代理设置", systemImage: "network")
                }
            }

            Section("AI 服务") {
                NavigationLink {
                    AdminAIServiceView()
                } label: {
                    Label("AI 服务", systemImage: "sparkles")
                }
            }

            Section("系统") {
                NavigationLink {
                    AdminSiteOperationsView()
                } label: {
                    Label("站点运营", systemImage: "chart.bar.xaxis")
                }
                NavigationLink {
                    AdminUsersView()
                } label: {
                    Label("用户与邀请码", systemImage: "person.2")
                }
                NavigationLink {
                    AdminLoginAuditView()
                } label: {
                    Label("登录审计", systemImage: "lock.shield")
                }
                NavigationLink {
                    AdminPolicyView()
                } label: {
                    Label("内容安全", systemImage: "shield.lefthalf.filled")
                }
                NavigationLink {
                    AdminAnnouncementView()
                } label: {
                    Label("站点公告", systemImage: "megaphone")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
    }
}
