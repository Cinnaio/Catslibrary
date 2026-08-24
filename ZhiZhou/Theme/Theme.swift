import SwiftUI
import UIKit

extension Color {
    /// 从 "#RRGGBB" 十六进制字符串创建颜色
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        for ch in s {
            value <<= 4
            if let digit = ch.hexDigitValue { value |= UInt64(digit) }
        }
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

/// 知舟设计系统：暖调奶油 · 治愈手账风。
/// 浏览页锁定浅色纸面；阅读器可走独立夜间主题。
enum AppTheme {
    // MARK: 主色（奶茶棕 · 品牌强调）
    static let primary = Color(hex: "8B6045")
    static let primaryDeep = Color(hex: "6E4A34")
    static let primaryLight = Color(hex: "F5E7D3")

    // MARK: 纸面 / 背景
    static let background = Color(hex: "FBF6EE")
    static let surfaceWarm = Color(hex: "F7F0E2")
    static let surface = Color(hex: "FFFDF9")
    static let border = Color(hex: "EADFCF")

    // MARK: 文字（奶油底上正文 ≥ 4.5:1）
    static let textPrimary = Color(hex: "3A2E24")
    static let textSecondary = Color(hex: "5C4E42")
    static let textMuted = Color(hex: "5C4E42")

    // MARK: 附属暖色
    static let terracotta = Color(hex: "C97B5A")
    static let peach = Color(hex: "F2C9A0")
    static let butter = Color(hex: "E8C79A")
    static let sage = Color(hex: "A9B89B")
    static let rose = Color(hex: "D8A4A0")

    static let success = Color(hex: "7A8B6F")
    static let warning = Color(hex: "C99A4B")
    static let danger = Color(hex: "A34438")
    static let seal = Color(hex: "B8453A")

    static let glassBackground = LinearGradient(
        colors: [Color(hex: "FFF9F0"), Color(hex: "FAF0E1"), Color(hex: "F5E7D6")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let auroraBackground = LinearGradient(
        colors: [Color(hex: "FBF4E9"), Color(hex: "F6E7D4"), Color(hex: "EED5BC"), Color(hex: "E4BFA2")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let buttonGradient = LinearGradient(
        colors: [Color(hex: "A07150"), Color(hex: "8B6045"), Color(hex: "6E4A34")],
        startPoint: .top,
        endPoint: .bottom
    )

    static let brandGradient = LinearGradient(
        colors: [Color(hex: "F2C9A0"), Color(hex: "E0A177"), Color(hex: "C97B5A")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// MARK: - 字体

/// 衬线标题：跟系统文本样式走，尊重 Dynamic Type。
func serifFont(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
    Font.system(style, design: .serif, weight: weight)
}

// MARK: - 按压反馈

struct ScaleButtonStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        ScaleButtonStyleBody(configuration: configuration, pressedScale: pressedScale)
    }
}

private struct ScaleButtonStyleBody: View {
    let configuration: ButtonStyleConfiguration
    var pressedScale: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        configuration.label
            .scaleEffect((reduceMotion || !configuration.isPressed) ? 1 : pressedScale)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// 系统浅/深（不受浏览页 `.preferredColorScheme(.light)` 影响，尽量读 UIScreen）。
final class SystemAppearance: ObservableObject {
    static let shared = SystemAppearance()
    @Published private(set) var isDark: Bool
    private var observers: [NSObjectProtocol] = []

    private init() {
        isDark = Self.read()
        let names: [Notification.Name] = [
            UIApplication.didBecomeActiveNotification,
            UIApplication.willEnterForegroundNotification,
        ]
        for name in names {
            let token = NotificationCenter.default.addObserver(
                forName: name,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refresh()
            }
            observers.append(token)
        }
    }

    static func read() -> Bool {
        UIScreen.main.traitCollection.userInterfaceStyle == .dark
    }

    func refresh() {
        let next = Self.read()
        if next != isDark { isDark = next }
    }
}

// MARK: - View 扩展

extension View {
    /// 浏览页暖纸面。玻璃留给系统栏，不再用大半径实时模糊光斑。
    func glassPageBackground() -> some View {
        self.background {
            AppTheme.glassBackground.ignoresSafeArea()
        }
    }

    func paperCard(cornerRadius: CGFloat = 18) -> some View {
        self
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(AppTheme.border, lineWidth: 1)
            )
            .shadow(color: AppTheme.primaryDeep.opacity(0.06), radius: 10, y: 4)
    }

    func frostedRowBackground() -> some View {
        self.listRowBackground(AppTheme.surface.opacity(0.92))
    }

    /// 浏览栈共用的详情 / 阅读器出口。
    func zhiZhouDestinations() -> some View {
        self
            .navigationDestination(for: Novel.self) { NovelDetailView(novel: $0) }
            .navigationDestination(for: ReaderLaunch.self) { launch in
                ReaderView(
                    novel: launch.novel,
                    chapterOrder: launch.chapterOrder,
                    preloadedChapters: launch.preloadedChapters
                )
            }
    }

    func browseColorScheme() -> some View {
        preferredColorScheme(.light)
    }
}

enum AppCopy {
    static func friendlyError(_ error: Error) -> String {
        let raw = error.localizedDescription
        if raw.contains("TLS") || raw.contains("安全连接") {
            return "无法安全连接服务器。若使用自签名证书，打开「我的 → 高级」。"
        }
        return raw
    }
}
