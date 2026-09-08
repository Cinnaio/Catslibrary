import SwiftUI

/// 阅读偏好即时生效，面板表面独立于正文纸面。
struct ReaderSettingsView: View {
    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var interactionFeedback = 0

    private let themes: [(id: String, title: String, swatch: Color)] = [
        ("default", "系统", Color(.systemBackground)),
        ("eye", "护眼", Color(hex: "E7EBD9")),
        ("paper", "羊皮", Color(hex: "F2E3C6")),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("字号") {
                    Stepper(value: Binding(
                        get: { settings.fontSizeIndex },
                        set: { settings.set("fontSize", String($0)) }
                    ), in: 0...(settings.fontLevelCount - 1)) {
                        Text("第 \(settings.fontSizeIndex + 1) 档 · \(Int(settings.bodyFontSize)) pt")
                            .monospacedDigit()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityLabel("字号")
                    .accessibilityValue("第 \(settings.fontSizeIndex + 1) 档，\(Int(settings.bodyFontSize)) 磅")
                }

                choiceSection("字体", values: [("serif", "衬线"), ("sans", "无衬线")], selection: Binding(
                    get: { settings.useSerif ? "serif" : "sans" },
                    set: { set("fontFamily", $0) }
                ))
                choiceSection("行距", values: [("1.75", "紧凑"), ("1.95", "标准"), ("2.15", "宽松")], selection: preference("readerLineHeight", default: "1.95"))
                choiceSection("段间距", values: [("1.0", "紧凑"), ("1.4", "标准"), ("1.8", "宽松")], selection: preference("readerParagraphSpacing", default: "1.4"))

                Section("纸面") {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 120 : 72), spacing: 16)],
                        spacing: 16
                    ) {
                        ForEach(themes, id: \.id) { theme in
                            themeButton(theme)
                        }
                    }
                    .padding(.vertical, 8)
                }

                choiceSection("翻页方式", values: [("scroll", "上下滚动"), ("page", "左右翻页")], selection: Binding(
                    get: { settings.pageMode },
                    set: { set("readerPageMode", $0) }
                ))

                Section {
                    Toggle("左右区域点击翻页", isOn: Binding(
                        get: { settings.clickPagingEnabled },
                        set: { set("readerClickPaging", $0 ? "on" : "off") }
                    ))
                    Toggle("阅读时保持屏幕常亮", isOn: Binding(
                        get: { settings.wakeLockEnabled },
                        set: { set("readerWakeLock", $0 ? "on" : "off") }
                    ))
                }

                if settings.hasPendingSync || settings.lastSyncError != nil {
                    Section {
                        Label(
                            settings.lastSyncError == nil
                                ? "阅读设置等待同步"
                                : "阅读设置同步失败，将自动重试",
                            systemImage: settings.lastSyncError == nil ? "arrow.triangle.2.circlepath" : "exclamationmark.triangle"
                        )
                        .font(.footnote)
                        .foregroundStyle(settings.lastSyncError == nil ? AppTheme.textSecondary : AppTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .appListStyle(.settings)
            .tint(AppTheme.primary)
            .navigationTitle("阅读设置")
            .navigationBarTitleDisplayMode(.inline)
            .sensoryFeedback(.selection, trigger: settings.fontSizeIndex)
            .sensoryFeedback(.selection, trigger: interactionFeedback)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationBackground(AppTheme.background)
        .presentationDragIndicator(.visible)
    }

    private func choiceSection(
        _ title: String,
        values: [(String, String)],
        selection: Binding<String>
    ) -> some View {
        Section(title) {
            Picker(title, selection: selection) {
                ForEach(values, id: \.0) { value in
                    Text(value.1).tag(value.0)
                }
            }
            .accessibleSegmentedPicker()
        }
    }

    private func preference(_ key: String, default fallback: String) -> Binding<String> {
        Binding(
            get: { settings.values[key] ?? fallback },
            set: { set(key, $0) }
        )
    }

    private func set(_ key: String, _ value: String) {
        settings.set(key, value)
        interactionFeedback &+= 1
    }

    private func themeButton(_ theme: (id: String, title: String, swatch: Color)) -> some View {
        let selected = settings.normalizedTheme == theme.id
        return Button {
            guard !selected else { return }
            set("readerTheme", theme.id)
        } label: {
            VStack(spacing: 8) {
                RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                    .fill(theme.swatch)
                    .frame(height: 44)
                    .overlay {
                        RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                            .strokeBorder(selected ? AppTheme.primary : AppTheme.border, lineWidth: selected ? 2 : 1)
                    }
                    .overlay {
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(AppTheme.primary)
                                .padding(6)
                                .background(AppTheme.canvas, in: Circle())
                                .accessibilityHidden(true)
                        }
                    }
                Text(theme.title)
                    .font(.subheadline)
                    .foregroundStyle(selected ? AppTheme.primary : AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(theme.title)
    }
}
