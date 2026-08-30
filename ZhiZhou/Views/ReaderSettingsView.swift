import SwiftUI

/// 阅读设置面板：保留所有即时生效选项，采用轻量原生表单式布局。
/// 视觉参考为旧版设置页：大留白、灰色分段控件、字号单行步进。
struct ReaderSettingsView: View {
    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var interactionFeedback = 0
    @State private var showingResetConfirmation = false

    private let themes: [(id: String, title: String, swatch: Color)] = [
        ("default", "系统", Color(.systemBackground)),
        ("eye", "护眼", Color(hex: "E7EBD9")),
        ("paper", "羊皮", Color(hex: "F2E3C6")),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    previewSection
                    sectionDivider
                    fontSizeSection
                    sectionDivider

                    segmentedSection(
                        "翻页方式",
                        values: [
                            ("scroll", "上下滚动"),
                            ("page", "左右翻页"),
                        ],
                        selected: settings.pageMode
                    ) {
                        settings.set("readerPageMode", $0)
                        interactionFeedback &+= 1
                    }
                    sectionDivider

                    segmentedSection(
                        "字体",
                        values: [
                            ("serif", "衬线"),
                            ("sans", "无衬线"),
                        ],
                        selected: settings.useSerif ? "serif" : "sans"
                    ) {
                        settings.set("fontFamily", $0)
                        interactionFeedback &+= 1
                    }
                    sectionDivider

                    segmentedSection(
                        "行距",
                        values: [
                            ("1.75", "紧凑"),
                            ("1.95", "标准"),
                            ("2.15", "宽松"),
                        ],
                        selected: settings.values["readerLineHeight"] ?? "1.95"
                    ) {
                        settings.set("readerLineHeight", $0)
                        interactionFeedback &+= 1
                    }
                    sectionDivider

                    segmentedSection(
                        "段间距",
                        values: [
                            ("1.0", "紧凑"),
                            ("1.4", "标准"),
                            ("1.8", "宽松"),
                        ],
                        selected: settings.values["readerParagraphSpacing"] ?? "1.4"
                    ) {
                        settings.set("readerParagraphSpacing", $0)
                        interactionFeedback &+= 1
                    }
                    sectionDivider

                    themeSection
                    sectionDivider

                    wakeLockSection
                    sectionDivider

                    clickPagingSection

                    if settings.hasPendingSync || settings.lastSyncError != nil {
                        sectionDivider
                        syncStatusSection
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 34)
                .padding(.bottom, 32)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .background(.clear)
            .scrollIndicators(.hidden)
            .navigationTitle("阅读设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .sensoryFeedback(.selection, trigger: settings.fontSizeIndex)
            .sensoryFeedback(.selection, trigger: interactionFeedback)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("恢复默认") { showingResetConfirmation = true }
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .font(.body.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                }
            }
            .confirmationDialog(
                "恢复默认阅读设置？",
                isPresented: $showingResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("恢复默认") {
                    settings.resetToDefaults()
                    interactionFeedback &+= 1
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("字号、字体、纸面和翻页方式会恢复默认，并同步到当前账号。")
            }
        }
        .presentationDragIndicator(.visible)
    }

    private var previewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("预览")
                .font(.body)
                .foregroundStyle(AppTheme.textSecondary)

            VStack(
                alignment: .leading,
                spacing: min(settings.paragraphSpacing(for: dynamicTypeSize), 32)
            ) {
                Text("知舟 · 阅读预览")
                    .font(settings.titleFont(for: dynamicTypeSize))
                    .foregroundStyle(settings.textColor(systemDark: colorScheme == .dark))

                Text("暮色沿着窗棂慢慢落下，纸页上的字在安静的呼吸里变得清晰。")
                    .font(settings.bodyFont(for: dynamicTypeSize))
                    .foregroundStyle(settings.textColor(systemDark: colorScheme == .dark))
                    .lineSpacing(settings.lineSpacing(for: dynamicTypeSize))
                    .fixedSize(horizontal: false, vertical: true)

                Text("调整下面的字号、字体、行距和纸面，预览会即时更新。")
                    .font(settings.bodyFont(for: dynamicTypeSize))
                    .foregroundStyle(settings.textColor(systemDark: colorScheme == .dark))
                    .lineSpacing(settings.lineSpacing(for: dynamicTypeSize))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                settings.backgroundColor(systemDark: colorScheme == .dark),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(AppTheme.border.opacity(0.75), lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel("阅读样式预览")
        }
    }

    private var fontSizeSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("字号")
                .font(.body)
                .foregroundStyle(AppTheme.textSecondary)

            HStack(spacing: 16) {
                Text("第 \(settings.fontSizeIndex + 1) 档 · \(Int(settings.bodyFontSize)) pt")
                    .font(.body)
                    .foregroundStyle(AppTheme.textPrimary)
                    .monospacedDigit()
                    .lineLimit(1)

                Spacer(minLength: 8)
                fontStepper
            }
        }
    }

    private var fontStepper: some View {
        GlassEffectContainer(spacing: 6) {
            HStack(spacing: 6) {
                fontStepButton(systemName: "minus", label: "减小字号", isDisabled: settings.fontSizeIndex == 0) {
                    adjustFontSize(by: -1)
                }

                fontStepButton(systemName: "plus", label: "增大字号", isDisabled: settings.fontSizeIndex >= settings.fontLevelCount - 1) {
                    adjustFontSize(by: 1)
                }
            }
        }
        .frame(height: 44)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("调整字号")
    }

    private func fontStepButton(
        systemName: String,
        label: String,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .contentShape(Capsule())
        }
        .foregroundStyle(isDisabled ? AppTheme.textMuted : AppTheme.primary)
        .disabled(isDisabled)
        .buttonStyle(.glass(AppTheme.glassClear))
        .accessibilityLabel(label)
    }

    private func segmentedSection(
        _ title: String,
        values: [(String, String)],
        selected: String,
        onSelect: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title)
                .font(.body)
                .foregroundStyle(AppTheme.textSecondary)

            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(values, id: \.0) { value in
                        let isSelected = value.0 == selected
                        Button {
                            guard !isSelected else { return }
                            onSelect(value.0)
                        } label: {
                            Text(value.1)
                                .font(.body.weight(isSelected ? .semibold : .regular))
                                .foregroundStyle(isSelected ? AppTheme.textPrimary : AppTheme.textSecondary)
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.glass(isSelected ? AppTheme.glass : AppTheme.glassClear))
                        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        .accessibilityLabel(value.1)
                    }
                }
            }
            .frame(minHeight: 44)
        }
    }

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("纸面")
                .font(.body)
                .foregroundStyle(AppTheme.textSecondary)

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 88), spacing: 10)],
                spacing: 12
            ) {
                ForEach(themes, id: \.id) { theme in
                    themeButton(theme)
                }
            }
        }
    }

    private var wakeLockSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("阅读时保持屏幕常亮", isOn: Binding(
                get: { settings.wakeLockEnabled },
                set: {
                    settings.set("readerWakeLock", $0 ? "on" : "off")
                    interactionFeedback &+= 1
                }
            ))
            .font(.body)
            .foregroundStyle(AppTheme.textPrimary)
            .tint(AppTheme.primary)

            Text("与网页端同步阅读偏好。「系统」纸面会随系统深浅自动切换。")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
                .lineSpacing(2)
        }
    }

    private var clickPagingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("左右区域点击翻页", isOn: Binding(
                get: { settings.clickPagingEnabled },
                set: {
                    settings.set("readerClickPaging", $0 ? "on" : "off")
                    interactionFeedback &+= 1
                }
            ))
            .font(.body)
            .foregroundStyle(AppTheme.textPrimary)
            .tint(AppTheme.primary)

            Text("关闭后，左右区域点按不会翻页；滚动模式下可从屏幕边缘向内滑动切换章节，翻页模式仍支持左右滑动。")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
                .lineSpacing(2)
        }
    }

    private var syncStatusSection: some View {
        Label(
            settings.lastSyncError == nil
                ? "阅读设置将在回到前台时自动同步"
                : "阅读设置同步失败，回到前台时会自动重试",
            systemImage: settings.lastSyncError == nil ? "arrow.triangle.2.circlepath" : "exclamationmark.triangle"
        )
        .font(.footnote)
        .foregroundStyle(settings.lastSyncError == nil ? AppTheme.textSecondary : AppTheme.seal)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var sectionDivider: some View {
        Divider()
            .overlay(AppTheme.border.opacity(0.75))
            .padding(.vertical, 26)
    }

    private func adjustFontSize(by delta: Int) {
        let next = max(0, min(settings.fontSizeIndex + delta, settings.fontLevelCount - 1))
        guard next != settings.fontSizeIndex else { return }
        settings.set("fontSize", String(next))
    }

    private func themeButton(_ theme: (id: String, title: String, swatch: Color)) -> some View {
        let selected = settings.normalizedTheme == theme.id
        return Button {
            guard !selected else { return }
            settings.set("readerTheme", theme.id)
            interactionFeedback &+= 1
        } label: {
            VStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(theme.swatch)
                    .frame(height: 30)
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(
                                selected ? AppTheme.primary : AppTheme.border,
                                lineWidth: selected ? 2 : 1
                            )
                    )
                Text(theme.title)
                    .font(.caption)
                    .foregroundStyle(selected ? AppTheme.primary : AppTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.glass(selected ? AppTheme.glass : AppTheme.glassClear))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(theme.title)
    }
}
