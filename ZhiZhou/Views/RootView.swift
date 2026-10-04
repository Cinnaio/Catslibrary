import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if appState.isBooting {
                BootView()
            } else if appState.user == nil {
                LoginView()
            } else {
                MainTabView()
                    .id(ContentAccessStore.shared.accountRevision)
            }
        }
        .accessibilityHidden(scenePhase != .active && ContentAccessStore.shared.mode == "adult")
        .overlay {
            if scenePhase != .active && ContentAccessStore.shared.mode == "adult" {
                AppTheme.canvas.ignoresSafeArea()
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.isBooting)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.user != nil)
    }
}

/// 连接页：暖纸画布、Web 共用花枝与真实连接状态。
struct BootView: View {
    var body: some View {
        ZStack {
            AppTheme.canvas.ignoresSafeArea()
            VStack(spacing: 32) {
                VStack(spacing: 16) {
                    BrandFlower(width: 192)
                    Text("知舟")
                        .font(serifFont(.largeTitle, .regular))
                        .foregroundStyle(AppTheme.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("让故事，慢慢展开。")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(AppTheme.primary)
                        .accessibilityHidden(true)
                    Text("正在连接…")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            .multilineTextAlignment(.center)
            .padding(32)
            .frame(maxWidth: 440)
            .accessibilityIdentifier("session.connecting")
        }
    }
}

/// 复用 Web 登录页的原始花枝资源，仅用于安静的品牌装饰。
struct BrandFlower: View {
    var width: CGFloat = 112
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Image("AuthFlower")
            .resizable()
            .scaledToFit()
            .frame(width: width, height: width / 2)
            .brightness(colorScheme == .dark ? 0.12 : 0)
            .opacity(colorScheme == .dark ? 0.85 : 0.7)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
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
