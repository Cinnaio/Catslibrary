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
                AppPrivacyCover()
                    .transition(.identity)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.isBooting)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: appState.user != nil)
    }
}

/// 磨砂只叠在不透明的品牌底色上，不采样阅读正文或封面。
private struct AppPrivacyCover: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        ZStack {
            AppTheme.canvas

            if !reduceTransparency && contrast != .increased {
                LinearGradient(
                    colors: [AppTheme.surfaceSecondary, AppTheme.primaryLight, AppTheme.canvas],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Rectangle().fill(.regularMaterial)
            }

            VStack(spacing: 14) {
                BrandMark(size: 56)
                Text("Cat’s Library")
                    .font(.system(.title2, design: .serif))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("内容已隐藏")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            .multilineTextAlignment(.center)
            .padding(32)
            .frame(maxWidth: 440)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cat’s Library，内容已隐藏")
        .accessibilityIdentifier("privacy.cover")
    }
}

/// 连接页：网站品牌标识、主题画布与真实连接状态。
struct BootView: View {
    var body: some View {
        ZStack {
            AppTheme.canvas.ignoresSafeArea()
            VStack(spacing: 32) {
                VStack(spacing: 16) {
                    BrandMark(size: 80)
                    Text("Cat’s Library")
                        .font(.system(.title, design: .serif))
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

/// 启动、登录、关于与隐私遮罩共用部署站点的 Logo，离线时也可直接显示。
struct BrandMark: View {
    var size: CGFloat = 64

    var body: some View {
        Image("SiteLogo")
            .renderingMode(.original)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(Circle())
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
