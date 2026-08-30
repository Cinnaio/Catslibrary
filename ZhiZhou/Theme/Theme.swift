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

    // MARK: Liquid Glass
    /// 交互控件统一使用系统 Liquid Glass，并以黛青做轻微染色。
    /// interactive() 让玻璃表面在按下、悬停和聚焦时产生原生反馈。
    static var glass: Glass {
        .regular
            .tint(primary.opacity(0.14))
            .interactive()
    }

    static var glassClear: Glass {
        .clear
            .tint(primary.opacity(0.08))
            .interactive()
    }

    static var glassProminent: Glass {
        .regular
            .tint(primary.opacity(0.24))
            .interactive()
    }

    // MARK: 语义背景 / 分隔（跟随系统）
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
    static let surfaceSecondary = Color(.secondarySystemBackground)
    static let border = Color(.separator)

    // MARK: 语义文字（层级：label > secondary > tertiary）
    static let textPrimary = Color(.label)
    static let textSecondary = Color(.secondaryLabel)
    static let textMuted = Color(.tertiaryLabel)

    // MARK: 卡片层级
    /// 内容卡片统一使用轻量阴影，避免不同页面出现深浅不一的浮层质感。
    static let cardShadow = Color.black.opacity(0.10)
    static let cardShadowRadius: CGFloat = 12
    static let cardShadowY: CGFloat = 4

    // MARK: 状态色
    static let success = Color(light: "4E713F", dark: "A9BF97")
    static let warning = Color(light: "8A5B13", dark: "D9B06A")
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

/// 中文衬线字体解析。
///
/// 优先使用已注册的 Noto Serif SC，未下载时使用系统 Songti SC；解析失败时
/// 回退到明确支持中文的系统字体，保证阅读正文不缺字。
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
        if let font = songtiFont(size: size, weight: weight) {
            return font
        }

        // 通用 serif 可能只有拉丁字形；阅读正文需要一个明确支持中文的回退字体。
        let fallbackName = weight.rawValue >= 0.265
            ? "PingFangSC-Semibold"
            : "PingFangSC-Regular"
        if let fallback = UIFont(name: fallbackName, size: size) {
            return fallback
        }

        return UIFont.systemFont(ofSize: size, weight: weight)
    }

    /// 从字体目录动态查找 Noto Serif SC 或系统 Songti SC 的实际 face 名称。
    /// UIFont.Weight 的 rawValue 不是 0...1：regular=0、medium≈0.23、
    /// semibold≈0.3、bold≈0.4、heavy≈0.56、black≈0.62。
    private static func songtiFont(size: CGFloat, weight: UIFont.Weight) -> UIFont? {
        let style: String
        switch weight.rawValue {
        case ..<(-0.2): // ultraLight / thin / light
            style = "Light"
        case ..<0.265: // regular / medium
            style = "Regular"
        case ..<0.48: // semibold / bold
            style = "Bold"
        default: // heavy / black
            style = "Black"
        }

        // 远程 Noto 字体注册成功后优先使用；未下载时继续使用系统宋体。
        for familyHint in ["Noto Serif SC", "Songti SC"] {
            guard let family = UIFont.familyNames.first(where: {
                $0.compare(
                    familyHint,
                    options: [.caseInsensitive, .diacriticInsensitive]
                ) == .orderedSame
            }) else { continue }

            let names = UIFont.fontNames(forFamilyName: family)
            var candidates = names.filter {
                $0.localizedCaseInsensitiveContains(style)
            }
            candidates.append(contentsOf: names.filter {
                !candidates.contains($0)
            })

            for name in candidates {
                guard let font = UIFont(name: name, size: size) else { continue }
                guard font.familyName.compare(
                    family,
                    options: [.caseInsensitive, .diacriticInsensitive]
                ) == .orderedSame else { continue }
                return font
            }
        }

        return nil
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
    /// SwiftUI 字重 → UIKit 字重（Songti 按字重选择系统 face）。
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
            .opacity(configuration.isPressed ? 0.86 : 1)
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
            .shadow(color: AppTheme.cardShadow, radius: AppTheme.cardShadowRadius, y: AppTheme.cardShadowY)
    }

    func frostedRowBackground() -> some View {
        self.listRowBackground(Rectangle().fill(.thinMaterial))
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
        let lowercased = raw.lowercased()
        if lowercased.contains("timed out") || lowercased.contains("timeout") {
            return "请求超时，请检查网络后重试。"
        }
        if lowercased.contains("not connected") || lowercased.contains("network") || lowercased.contains("internet") || lowercased.contains("connection") {
            return "网络连接失败，请检查网络后重试。"
        }
        if raw.contains("TLS") || raw.contains("安全连接") {
            return "无法安全连接服务器。若使用自签名证书，打开「我的 → 高级」。"
        }
        return raw.isEmpty ? "操作未完成，请稍后重试。" : raw
    }
}
