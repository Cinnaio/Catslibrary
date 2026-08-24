import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if appState.isBooting {
                BootView()
            } else if appState.user == nil {
                LoginView()
            } else {
                MainTabView()
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.isBooting)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.user != nil)
    }
}

/// 启动连接页：系统背景 + 品牌标识
struct BootView: View {
    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 18) {
                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(AppTheme.deepGradient)
                    Image(systemName: "book.closed.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                }
                .frame(width: 76, height: 76)
                .shadow(color: .black.opacity(0.15), radius: 14, y: 7)

                Text("知舟")
                    .font(serifFont(.title, .bold))
                    .foregroundStyle(AppTheme.textPrimary)

                ProgressView()
                    .controlSize(.regular)
                    .tint(AppTheme.primary)

                Text("正在连接…")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            Tab("发现", systemImage: "sparkle.magnifyingglass") {
                HomeView()
            }
            Tab("书架", systemImage: "books.vertical") {
                BookshelfView()
            }
            Tab("我的", systemImage: "person") {
                NavigationStack { ProfileView() }
            }
        }
        .tint(AppTheme.primary)
    }
}
