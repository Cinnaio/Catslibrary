import SwiftUI

/// 阅读设置面板：保留所有即时生效选项，采用轻量原生表单式布局。
/// 视觉参考为旧版设置页：大留白、灰色分段控件、字号单行步进。
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
                VStack(alignment: .leading, spacing: 0) {
                    fontSizeSection
                    sectionDivider

                    segmentedSection(
                        "翻页方式",
                        values: [
                            ("scroll", "上下滚动"),
                            ("page", "左右翻页"),
                        ],
                        selected: settings.pageMode
                    ) { settings.set("readerPageMode", $0) }
                    sectionDivider

                    segmentedSection(
                        "字体",
                        values: [
                            ("serif", "衬线"),
                            ("sans", "无衬线"),
                        ],
                        selected: settings.useSerif ? "serif" : "sans"
                    ) { settings.set("fontFamily", $0) }
                    sectionDivider

                    segmentedSection(
                        "行距",
                        values: [
                            ("1.75", "紧凑"),
                            ("1.95", "标准"),
                            ("2.15", "宽松"),
                        ],
                        selected: settings.values["readerLineHeight"] ?? "1.95"
                    ) { settings.set("readerLineHeight", $0) }
                    sectionDivider

                    segmentedSection(
                        "段间距",
                        values: [
                            ("1.0", "紧凑"),
                            ("1.4", "标准"),
                            ("1.8", "宽松"),
                        ],
                        selected: settings.values["readerParagraphSpacing"] ?? "1.4"
                    ) { settings.set("readerParagraphSpacing", $0) }
                    sectionDivider

                    themeSection
                    sectionDivider

                    wakeLockSection
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
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.glass(AppTheme.glassClear))
                        .tint(AppTheme.primary)
                }
            }
        }
        .presentationDragIndicator(.visible)
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
                Button {
                    adjustFontSize(by: -1)
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 16, weight: .medium))
                        .frame(width: 42, height: 42)
                }
                .disabled(settings.fontSizeIndex == 0)
                .buttonStyle(.glass(AppTheme.glassClear))
                .accessibilityLabel("减小字号")

                Button {
                    adjustFontSize(by: 1)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .medium))
                        .frame(width: 42, height: 42)
                }
                .disabled(settings.fontSizeIndex >= settings.fontLevelCount - 1)
                .buttonStyle(.glass(AppTheme.glassClear))
                .accessibilityLabel("增大字号")
            }
        }
        .foregroundStyle(AppTheme.primary)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("调整字号")
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

            GlassEffectContainer(spacing: 4) {
                HStack(spacing: 4) {
                    ForEach(values, id: \.0) { value in
                        let isSelected = value.0 == selected
                        Button {
                            onSelect(value.0)
                        } label: {
                            Text(value.1)
                                .font(.body.weight(isSelected ? .semibold : .regular))
                                .foregroundStyle(isSelected ? AppTheme.textPrimary : AppTheme.textSecondary)
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 42)
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.glass(isSelected ? AppTheme.glass : AppTheme.glassClear))
                        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        .accessibilityLabel(value.1)
                    }
                }
            }
        }
    }

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("纸面")
                .font(.body)
                .foregroundStyle(AppTheme.textSecondary)

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 76), spacing: 12)],
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
                set: { settings.set("readerWakeLock", $0 ? "on" : "off") }
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
            settings.set("readerTheme", theme.id)
        } label: {
            VStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(theme.swatch)
                    .frame(height: 38)
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
            .frame(minHeight: 62)
        }
        .buttonStyle(.glass(selected ? AppTheme.glass : AppTheme.glassClear))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(theme.title)
    }
}
