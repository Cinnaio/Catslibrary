import SwiftUI

/// 阅读设置面板：翻页/字号/字体/行距/段距/纸面主题，改动即时生效并同步服务器。
///
/// 布局以分段控件为主（翻页方式 / 字体 / 行距 / 段距），字号用 A− 步进 +
/// 舒适居中、行距用分级分段条。纸面主题为纸样色卡网格，自动高亮当前项。
/// 所有选项改动均即时生效，无需保存。
struct ReaderSettingsView: View {
    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    private let themes: [(id: String, title: String, swatch: Color)] = [
        ("default", "系统", Color(.systemBackground)),
        ("eye", "护眼", Color(hex: "E7EBD9")),
        ("paper", "羊皮", Color(hex: "F2E3C6")),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    controlsCard

                    VStack(alignment: .leading, spacing: 12) {
                        Text("纸面主题")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 12)], spacing: 12) {
                            ForEach(themes, id: \.id) { theme in
                                themeButton(theme)
                            }
                        }
                    }
                    .padding(16)
                    .modifier(SettingsCard())

                    VStack(alignment: .leading, spacing: 10) {
                        Toggle("阅读时保持屏幕常亮", isOn: Binding(
                            get: { settings.wakeLockEnabled },
                            set: { settings.set("readerWakeLock", $0 ? "on" : "off") }
                        ))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.textPrimary)
                        .tint(AppTheme.primary)
                        Text("与网页端同步阅读偏好。「跟随系统」纸面会随系统深浅自动切换。")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textMuted)
                            .lineSpacing(2)
                    }
                    .padding(16)
                    .modifier(SettingsCard())
                }
                .padding(16)
            }
            .scrollContentBackground(.hidden)
            .background(paperBackground)
            .navigationTitle("阅读设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
        .presentationDragIndicator(.hidden)
    }

    private var paperBackground: some View {
        // 设置面板沿用 App 分组底色，纸面环境同时清晰可比对预览。
        Color(.systemGroupedBackground)
    }

    // MARK: - 控件卡片

    private var controlsCard: some View {
        VStack(spacing: 18) {
            // 字号整体 + A− 步进：标尺让档位关系一目了然，而非只读文字。
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("字号")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text("第 \(settings.fontSizeIndex + 1) 档")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .monospacedDigit()
                }
                Spacer(minLength: 4)
                StepperButton(systemName: "minus") {
                    adjustFontSize(by: -1)
                }
                fontPreview
                StepperButton(systemName: "plus") {
                    adjustFontSize(by: 1)
                }
            }

            Divider().overlay(AppTheme.border)

            segmentedRow("翻页方式", values: [
                ("scroll", "上下滚动"),
                ("page", "左右翻页"),
            ], selected: settings.pageMode) { settings.set("readerPageMode", $0) }

            Divider().overlay(AppTheme.border)

            segmentedRow("字体", values: [
                ("serif", "衬线"),
                ("sans", "无衬线"),
            ], selected: settings.useSerif ? "serif" : "sans") {
                settings.set("fontFamily", $0)
            }

            Divider().overlay(AppTheme.border)

            lineSpacingControl

            Divider().overlay(AppTheme.border)

            paragraphSpacingControl
        }
        .padding(16)
        .modifier(SettingsCard())
    }

    private var fontPreview: some View {
        Text("知")
            .font(settings.bodyFont)
            .foregroundStyle(AppTheme.textPrimary)
            .frame(maxWidth: 36, maxHeight: 36)
            .fixedSize()
            .accessibilityHidden(true)
    }

    /// 行距分段条：当前档加粗高亮并显示区段名，内外侧都无空隙。
    private var lineSpacingControl: some View {
        let options: [(String, String)] = [
            ("1.75", "紧凑"),
            ("1.95", "标准"),
            ("2.15", "宽松"),
        ]
        let current = settings.values["readerLineHeight"] ?? "1.95"
        return VStack(alignment: .leading, spacing: 10) {
            Text("行距")
                .font(.callout.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 2) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    let selected = option.0 == current
                    Button {
                        settings.set("readerLineHeight", option.0)
                    } label: {
                        VStack(spacing: 4) {
                            Text(option.1)
                                .font(.caption.weight(selected ? .semibold : .regular))
                                .foregroundStyle(selected ? AppTheme.primary : AppTheme.textSecondary)
                            Rectangle()
                                .fill(selected ? AppTheme.primary : AppTheme.border)
                                .frame(height: selected ? 3 : 1)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .padding(.top, 6)
                        .padding(.bottom, 10)
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                    .accessibilityLabel("行距\(option.1)")
                }
            }
            .background(segmentTrack)
        }
    }

    /// 段间距分段条：三档，逻辑与行距一致。
    private var paragraphSpacingControl: some View {
        let options: [(String, String)] = [
            ("1.0", "紧凑"),
            ("1.4", "标准"),
            ("1.8", "宽松"),
        ]
        let current = settings.values["readerParagraphSpacing"] ?? "1.4"
        return VStack(alignment: .leading, spacing: 10) {
            Text("段间距")
                .font(.callout.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 2) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    let selected = option.0 == current
                    Button {
                        settings.set("readerParagraphSpacing", option.0)
                    } label: {
                        VStack(spacing: 4) {
                            Text(option.1)
                                .font(.caption.weight(selected ? .semibold : .regular))
                                .foregroundStyle(selected ? AppTheme.primary : AppTheme.textSecondary)
                            Rectangle()
                                .fill(selected ? AppTheme.primary : AppTheme.border)
                                .frame(height: selected ? 3 : 1)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .padding(.top, 6)
                        .padding(.bottom, 10)
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            .background(segmentTrack)
        }
    }

    /// 通用分段行（翻页方式 / 字体）：胶囊选中态 + 底部区段名。
    private func segmentedRow(_ title: String, values: [(String, String)], selected: String, onSelect: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.callout.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 4) {
                ForEach(values, id: \.0) { value in
                    let isSelected = value.0 == selected
                    Button {
                        onSelect(value.0)
                    } label: {
                        Text(value.1)
                            .font(.subheadline.weight(isSelected ? .semibold : .regular))
                            .foregroundStyle(isSelected ? Color.white : AppTheme.textSecondary)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 36)
                            .background(isSelected ? AppTheme.primary : Color.clear, in: Capsule())
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                }
            }
            .background(
                Capsule().fill(AppTheme.surface.opacity(0.7))
                    .overlay(Capsule().strokeBorder(AppTheme.border, lineWidth: 1))
            )
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
    }

    private var segmentTrack: some View {
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(AppTheme.surface.opacity(0.7))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(AppTheme.border, lineWidth: 1))
    }

    // MARK: - 字号步进

    private func adjustFontSize(by delta: Int) {
        let next = max(0, min(settings.fontSizeIndex + delta, settings.fontLevelCount - 1))
        guard next != settings.fontSizeIndex else { return }
        settings.set("fontSize", String(next))
    }

    // MARK: - 主题卡片

    private func themeButton(_ theme: (id: String, title: String, swatch: Color)) -> some View {
        let selected = settings.normalizedTheme == theme.id
        return Button {
            settings.set("readerTheme", theme.id)
        } label: {
            VStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(theme.swatch)
                    .frame(height: 46)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(selected ? AppTheme.primary : AppTheme.border, lineWidth: selected ? 2.5 : 1)
                    )
                    .overlay {
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(theme.id == "paper" ? AppTheme.primaryDeep : AppTheme.primary)
                        }
                    }
                Text(theme.title)
                    .font(.caption.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? AppTheme.primary : AppTheme.textSecondary)
            }
            .frame(minHeight: 70)
        }
        .buttonStyle(ScaleButtonStyle())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(theme.title)
    }
}

/// 设置卡片：分组表面 + 圆角 + 细描边，与 App 卡片体系一致。
private struct SettingsCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(AppTheme.border, lineWidth: 1)
            )
    }
}

/// 圆形步进按钮（字号 A− / A+）。
private struct StepperButton: View {
    var systemName: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .bold))
                .frame(width: 34, height: 34)
                .background(AppTheme.surfaceSecondary, in: Circle())
                .overlay(Circle().strokeBorder(AppTheme.border, lineWidth: 1))
        }
        .foregroundStyle(AppTheme.primary)
        .buttonStyle(ScaleButtonStyle())
        .accessibilityLabel(systemName == "minus" ? "减小字号" : "增大字号")
    }
}
