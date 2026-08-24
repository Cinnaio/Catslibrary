import SwiftUI
import UIKit

extension Color {
    /// 从 "#RRGGBB" 十六进制字符串创建颜色
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }

    /// 从浅/深两个 hex 创建自适应颜色（跟随系统外观）
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

extension UIColor {
    /// 从 "#RRGGBB" 十六进制字符串创建颜色
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        for ch in s.prefix(8) {
            value <<= 4
            if let digit = ch.hexDigitValue { value |= UInt64(digit) }
        }
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}

/// 知舟设计系统 v2：语义色跟随系统浅/深外观，无强制浅色。
/// 阅读器纸面由 ReaderSettingsStore 独立管理（可选中夜间/护眼等）。
enum AppTheme {
    // MARK: 品牌强调色（黛青：浅色深、深色亮，双向可用）
    static let primary = Color(light: "3A6B5E", dark: "7FBFB0")
    static let primaryDeep = Color(light: "2C5348", dark: "9AD4C6")
    static let primaryLight = Color(light: "E3EFEB", dark: "243330")

    // MARK: 语义背景 / 分隔（跟随系统）
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
    static let surfaceSecondary = Color(.secondarySystemBackground)
    static let border = Color(.separator)

    // MARK: 语义文字（层级：label > secondary > tertiary）
    static let textPrimary = Color(.label)
    static let textSecondary = Color(.secondaryLabel)
    static let textMuted = Color(.tertiaryLabel)

    // MARK: 状态色
    static let success = Color(light: "6E8B5E", dark: "A9BF97")
    static let warning = Color(light: "B07D2E", dark: "D9B06A")
    static let danger = Color(light: "A34438", dark: "E98F83")
    static let seal = Color(light: "B8453A", dark: "E8968D")

    // MARK: 渐变
    /// 品牌自适应渐变：装饰性视觉用，前景须为深色文字（避免亮色系在深色模式下对比不足）。
    static let primaryGradient = LinearGradient(
        colors: [Color(light: "4E7D70", dark: "9AD4C6"), Color(light: "3A6B5E", dark: "7FBFB0"), Color(light: "2C5348", dark: "5E9C8E")],
        startPoint: .top,
        endPoint: .bottom
    )

    /// 深色品牌渐变：白色前景（图标 / 按钮文字）在浅色与深色外观下都保持足够对比。
    /// 深浅外观使用同一组深黛青色，避免亮色系按钮在深色模式下文字对比不足。
    static let deepGradient = LinearGradient(
        colors: [Color(hex: "4A7C6F"), Color(hex: "35695C"), Color(hex: "2A5448")],
        startPoint: .top,
        endPoint: .bottom
    )
}

// MARK: - 字体

/// 衬线标题：跟系统文本样式走，尊重 Dynamic Type。
/// 系统 serif design 对中文走 Songti 级联（提交 1c68742 真机验证）。
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

// MARK: - View 扩展

extension View {
    /// 浏览页统一系统分组背景。
    func pageBackground() -> some View {
        self.background {
            Color(.systemGroupedBackground).ignoresSafeArea()
        }
    }

    func paperCard(cornerRadius: CGFloat = 18) -> some View {
        self
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(AppTheme.border, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
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
}

enum AppCopy {
    static func friendlyError(_ error: Error) -> String {
        if case APIError.unauthorized = error {
            return "登录已过期，请重新登录"
        }
        let raw = error.localizedDescription
        if raw.contains("TLS") || raw.contains("安全连接") {
            return "无法安全连接服务器。若使用自签名证书，打开「我的 → 高级」。"
        }
        return raw
    }
}
