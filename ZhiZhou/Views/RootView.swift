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
            AppTheme.canvas.ignoresSafeArea()
            VStack(spacing: 18) {
                BrandMark()

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

/// 启动、登录与关于页面共用的品牌标记。
struct BrandMark: View {
    var size: CGFloat = 64

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(AppTheme.primaryLight)
            Image(systemName: "book.closed.fill")
                .resizable()
                .scaledToFit()
                .frame(width: size * 0.42, height: size * 0.42)
                .foregroundStyle(AppTheme.primary)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
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
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(.ultraThinMaterial, for: .tabBar)
    }
}
