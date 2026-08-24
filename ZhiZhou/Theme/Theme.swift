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

/// 中文衬线（宋体）字体解析。
///
/// 系统 serif design 对中文的 Songti 级联在部分 iOS 版本上不可靠
/// （中文可能静默回退成黑体 PingFang），因此优先按字重显式解析
/// Songti SC 的 PostScript 名称；解析失败再回退系统 serif design，
/// 最后回退系统无衬线字体，保证任何设备上都不缺字。
enum SongtiFont {
    /// 按文本样式缩放（Dynamic Type）的衬线 Font，用于标题等系统样式字体。
    static func font(_ style: Font.TextStyle, weight: UIFont.Weight = .regular) -> Font {
        let metrics = UIFontMetrics(forTextStyle: uiTextStyle(for: style))
        return Font(metrics.scaledFont(for: uiFont(size: 17, weight: weight)))
    }

    /// 固定点数的衬线 Font（调用方自行处理缩放，如阅读器字号档位）。
    static func font(size: CGFloat, weight: UIFont.Weight = .regular) -> Font {
        Font(uiFont(size: size, weight: weight))
    }

    static func uiFont(size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        for name in postScriptNames(for: weight) {
            if let font = UIFont(name: name, size: size) { return font }
        }
        let system = UIFont.systemFont(ofSize: size, weight: weight)
        if let descriptor = system.fontDescriptor.withDesign(.serif) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return system
    }

    /// Songti SC 的 PostScript 名（首个优先；设备上没有则跳过）。
    private static func postScriptNames(for weight: UIFont.Weight) -> [String] {
        switch weight.rawValue {
        case ..<0.45: return ["STSongti-SC-Light"]
        case ..<0.65: return ["STSongti-SC-Regular"]
        case ..<0.85: return ["STSongti-SC-Bold"]
        default: return ["STSongti-SC-Black"]
        }
    }

    private static func uiTextStyle(for style: Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .largeTitle: return .largeTitle
        case .title: return .title1
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .body: return .body
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption1
        case .caption2: return .caption2
        default: return .body
        }
    }
}

extension Font.Weight {
    /// SwiftUI 字重 → UIKit 字重（Songti 按字重选 PostScript 名）。
    var uiWeight: UIFont.Weight {
        switch self {
        case .ultraLight: return .ultraLight
        case .thin: return .thin
        case .light: return .light
        case .regular: return .regular
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
        case .black: return .black
        default: return .regular
        }
    }
}

/// 衬线标题：跟系统文本样式走，尊重 Dynamic Type，中文走宋体（Songti SC）。
func serifFont(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
    SongtiFont.font(style, weight: weight.uiWeight)
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
