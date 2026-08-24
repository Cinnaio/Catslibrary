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
            }

            Section("系统") {
                NavigationLink {
                    AdminUsersView()
                } label: {
                    Label("用户与邀请码", systemImage: "person.2")
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
