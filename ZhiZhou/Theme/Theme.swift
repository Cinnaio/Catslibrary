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

/// 知舟设计系统：浏览、编辑与阅读纸面分别管理，语义色跟随系统外观。
/// 阅读器纸面由 ReaderSettingsStore 独立管理（可选中夜间/护眼等）。
enum AppTheme {
    // MARK: 品牌强调色（黛青：浅色深、深色亮，双向可用）
    static let primary = Color(light: "3A6B5E", dark: "7FBFB0")
    static let primaryDeep = Color(light: "2C5348", dark: "9AD4C6")
    static let primaryLight = Color(light: "E3EFEB", dark: "243330")
    /// 实心品牌色上的前景色。深色外观的 primary 较亮，不能继续固定使用白色。
    static let onPrimary = Color(light: "FFFFFF", dark: "10231D")

    // MARK: Liquid Glass
    /// 浮动阅读控制使用系统 Liquid Glass，并以黛青做轻微染色。
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
    static let canvas = Color(.systemBackground)
    /// 仅用于编辑表单；浏览列表使用 canvas，阅读正文使用用户纸面。
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
    static let surfaceSecondary = Color(.secondarySystemBackground)
    static let controlFill = Color(.tertiarySystemFill)
    static let border = Color(.separator)

    // MARK: 语义文字（层级：label > secondary > tertiary）
    static let textPrimary = Color(.label)
    static let textSecondary = Color(.secondaryLabel)
    static let textMuted = Color(.tertiaryLabel)

    // MARK: 封面与独立预览
    static let cardShadow = Color(light: "29483E", dark: "000000").opacity(0.12)
    static let cardCornerRadius: CGFloat = 8
    static let controlCornerRadius: CGFloat = 8

    // MARK: 状态色
    static let success = Color(light: "4E713F", dark: "A9BF97")
    static let warning = Color(light: "8A5B13", dark: "D9B06A")
    static let danger = Color(light: "A34438", dark: "E98F83")
    static let seal = Color(light: "B8453A", dark: "E8968D")
}

// MARK: - 字体

/// 中文衬线字体解析。
///
/// 优先使用已注册的 Noto Serif SC，未下载时使用系统 Songti SC；解析失败时
/// 回退到明确支持中文的系统字体，保证阅读正文不缺字。
enum SongtiFont {
    /// 按文本样式缩放（Dynamic Type）的衬线 Font，用于标题等系统样式字体。
    static func font(_ style: Font.TextStyle, weight: UIFont.Weight = .regular) -> Font {
        let textStyle = uiTextStyle(for: style)
        let baseSize = UIFont.preferredFont(
            forTextStyle: textStyle,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: .large)
        ).pointSize
        let metrics = UIFontMetrics(forTextStyle: textStyle)
        return Font(metrics.scaledFont(for: uiFont(size: baseSize, weight: weight)))
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
            .animation(
                reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1),
                value: configuration.isPressed
            )
    }
}

/// Liquid Glass 按钮的统一降级版本：减少透明度时保留层级、边界和按压反馈。
struct AppGlassButtonStyle: ButtonStyle {
    let glass: Glass
    var fallback: Color = AppTheme.controlFill

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Group {
            if reduceTransparency || contrast == .increased {
                configuration.label
                    .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                    .background(fallback, in: Capsule())
                    .background(AppTheme.canvas, in: Capsule())
                    .overlay {
                        Capsule()
                            .strokeBorder(AppTheme.border.opacity(0.55), lineWidth: 0.8)
                    }
            } else {
                configuration.label
                    .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                    .glassEffect(glass, in: Capsule())
            }
        }
        .opacity(isEnabled ? (configuration.isPressed ? 0.86 : 1) : 0.45)
        .scaleEffect((reduceMotion || !configuration.isPressed) ? 1 : 0.97)
        .animation(
            reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1),
            value: configuration.isPressed
        )
    }
}

// MARK: - View 扩展

extension View {
    func pageBackground(_ style: AppPageStyle) -> some View {
        self.background {
            style.background.ignoresSafeArea()
        }
    }

    func paperCard(cornerRadius: CGFloat = AppTheme.cardCornerRadius) -> some View {
        self
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(AppTheme.border.opacity(0.72), lineWidth: 0.8)
            )
    }

    /// 统一输入控件表面：聚焦时用品牌色描边，保持清晰的键盘输入反馈。
    func appFieldSurface(
        isFocused: Bool = false,
        cornerRadius: CGFloat = AppTheme.controlCornerRadius
    ) -> some View {
        self
            .background(
                isFocused ? AppTheme.primaryLight.opacity(0.58) : AppTheme.controlFill,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isFocused
                            ? AppTheme.primary.opacity(0.78)
                            : AppTheme.border.opacity(0.3),
                        lineWidth: isFocused ? 1.4 : 0.7
                    )
            }
    }

    /// 透明度减少时退化为实色表面，避免材质层叠后文字与背景失去边界。
    func appMaterialBackground<S: Shape>(
        _ material: Material,
        fallback: Color = AppTheme.surface,
        in shape: S
    ) -> some View {
        modifier(AdaptiveMaterialBackgroundModifier(
            material: material,
            fallback: fallback,
            shape: shape
        ))
    }

    /// Liquid Glass 的透明度减少降级版本，保持按钮仍有明确的触控边界。
    func appGlassEffect<S: Shape>(
        _ glass: Glass,
        fallback: Color = AppTheme.controlFill,
        in shape: S
    ) -> some View {
        modifier(AdaptiveGlassEffectModifier(
            glass: glass,
            fallback: fallback,
            shape: shape
        ))
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

private struct AdaptiveMaterialBackgroundModifier<S: Shape>: ViewModifier {
    let material: Material
    let fallback: Color
    let shape: S

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background(fallback, in: shape)
                .background(AppTheme.canvas, in: shape)
        } else {
            content.background(material, in: shape)
        }
    }
}

private struct AdaptiveGlassEffectModifier<S: Shape>: ViewModifier {
    let glass: Glass
    let fallback: Color
    let shape: S

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background(fallback, in: shape)
                .background(AppTheme.canvas, in: shape)
                .overlay {
                    shape.stroke(AppTheme.border.opacity(0.55), lineWidth: 0.8)
                }
        } else {
            content.glassEffect(glass, in: shape)
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
            #if DEBUG
            return "无法安全连接服务器。若使用自签名证书，请检查「我的 → 关于知舟 → 开发设置」。"
            #else
            return "无法安全连接服务器，请联系管理员检查服务器证书。"
            #endif
        }
        return raw.isEmpty ? "操作未完成，请稍后重试。" : raw
    }
}
