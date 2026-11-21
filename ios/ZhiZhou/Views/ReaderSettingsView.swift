import SwiftUI

/// 阅读偏好即时生效，预览与正文共用字体、间距和纸色。
struct ReaderSettingsView: View {
    var previewTitle: String? = nil
    var previewParagraphs: [String] = []
    @Environment(ReaderSettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @State private var interactionFeedback = 0

    private let themes: [(id: String, title: String, swatch: Color)] = [
        ("default", "系统", AppTheme.canvas),
        ("eye", "护眼", Color(hex: "E7EBD9")),
        ("paper", "羊皮", Color(hex: "F2E3C6")),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    readingPreview
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                } header: {
                    sectionHeading("正文预览")
                }

                Section {
                    Stepper(value: Binding(
                        get: { settings.fontSizeIndex },
                        set: { settings.set("fontSize", String($0)) }
                    ), in: 0...(settings.fontLevelCount - 1)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("字号").font(.subheadline)
                            Text("第 \(settings.fontSizeIndex + 1) 档 · \(Int(settings.bodyFontSize(for: dynamicTypeSize))) pt")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(ReadingSpace.profileMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityLabel("字号")
                    .accessibilityValue("第 \(settings.fontSizeIndex + 1) 档，\(Int(settings.bodyFontSize(for: dynamicTypeSize))) 磅")

                    choiceRow("字体", values: [("serif", "衬线"), ("sans", "无衬线")], selection: Binding(
                        get: { settings.useSerif ? "serif" : "sans" },
                        set: { set("fontFamily", $0) }
                    ))
                    choiceRow("行距", values: [("1.75", "紧凑"), ("1.95", "标准"), ("2.15", "宽松")],
                              selection: preference("readerLineHeight", default: "1.95"))
                    choiceRow("段间距", values: [("1.0", "紧凑"), ("1.4", "标准"), ("1.8", "宽松")],
                              selection: preference("readerParagraphSpacing", default: "1.4"))
                } header: {
                    sectionHeading("文字排版")
                }
                .listRowBackground(ReadingSpace.paper)

                Section {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 12),
                                       count: dynamicTypeSize >= .xxxLarge ? 2 : themes.count),
                        spacing: 16
                    ) {
                        ForEach(themes, id: \.id) { theme in
                            themeButton(theme)
                        }
                    }
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                } header: {
                    sectionHeading("纸面")
                }

                Section {
                    Picker("翻页方式", selection: Binding(
                        get: { settings.pageMode },
                        set: { set("readerPageMode", $0) }
                    )) {
                        Text("上下滚动").tag("scroll")
                        Text("左右翻页").tag("page")
                    }
                    .accessibleSegmentedPicker()
                    Toggle("显示章节插图", isOn: Binding(
                        get: { settings.illustrationsEnabled },
                        set: { set("readerIllustrations", $0 ? "on" : "off") }
                    ))
                    .accessibilityIdentifier("reader.settings.illustrations")
                    Toggle("左右区域点击翻页", isOn: Binding(
                        get: { settings.clickPagingEnabled },
                        set: { set("readerClickPaging", $0 ? "on" : "off") }
                    ))
                    Toggle("阅读时保持屏幕常亮", isOn: Binding(
                        get: { settings.wakeLockEnabled },
                        set: { set("readerWakeLock", $0 ? "on" : "off") }
                    ))
                } header: {
                    sectionHeading("阅读操作")
                } footer: {
                    if settings.pageMode == "page" {
                        Text("在正文区域向左滑动阅读下一页，向右滑动返回上一页。点击中间区域显示或隐藏阅读控制。")
                    } else {
                        Text("上下滑动滚动正文。在正文区域向左滑动进入下一章，向右滑动返回上一章。")
                    }
                }
                .listRowBackground(ReadingSpace.paper)

                if settings.hasPendingSync || settings.lastSyncError != nil {
                    Section {
                        Label(
                            settings.lastSyncError == nil ? "阅读设置等待同步" : "阅读设置同步失败，将自动重试",
                            systemImage: settings.lastSyncError == nil ? "arrow.triangle.2.circlepath" : "exclamationmark.triangle"
                        )
                        .font(.footnote)
                        .foregroundStyle(settings.lastSyncError == nil ? ReadingSpace.profileMuted : AppTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
            .background(ReadingSpace.profilePaper)
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
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDragIndicator(.visible)
    }

    private var readingPreview: some View {
        let samples = previewParagraphs.isEmpty
            ? ["这段文字用于预览字号、字体与行距。", "段落之间的留白也会随设置变化。"]
            : Array(previewParagraphs.prefix(2))
        return ScrollView {
            VStack(alignment: .leading, spacing: settings.paragraphSpacing(for: dynamicTypeSize)) {
                Text(previewTitle ?? "排版示例")
                    .font(settings.titleFont(for: dynamicTypeSize))
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(samples.enumerated()), id: \.offset) { _, paragraph in
                    let excerpt = String(paragraph.prefix(96))
                    Text(paragraphIndent + excerpt + (excerpt.count < paragraph.count ? "…" : ""))
                        .font(settings.bodyFont(for: dynamicTypeSize))
                        .lineSpacing(settings.lineSpacing(for: dynamicTypeSize))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 260 : 180)
        .foregroundStyle(settings.textColor(systemDark: colorScheme == .dark))
        .background(settings.backgroundColor(systemDark: colorScheme == .dark),
                    in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(ReadingSpace.profileLine, lineWidth: 0.8)
                .allowsHitTesting(false)
        }
        .transaction { $0.animation = nil }
        .accessibilityIdentifier("reader.settings.preview")
    }

    private func sectionHeading(_ title: String) -> some View {
        Text(title)
            .font(serifFont(.headline, .medium))
            .foregroundStyle(ReadingSpace.ink)
            .textCase(nil)
    }

    private func choiceRow(_ title: String, values: [(String, String)], selection: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            Picker(title, selection: selection) {
                ForEach(values, id: \.0) { value in
                    Text(value.1).tag(value.0)
                }
            }
            .labelsHidden()
            .accessibleSegmentedPicker()
        }
        .padding(.vertical, 6)
    }

    private func preference(_ key: String, default fallback: String) -> Binding<String> {
        Binding(get: { settings.values[key] ?? fallback }, set: { set(key, $0) })
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
                RoundedRectangle(cornerRadius: 12)
                    .fill(theme.swatch)
                    .frame(height: 48)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(selected ? AppTheme.primary : ReadingSpace.profileLine, lineWidth: selected ? 2 : 1)
                    }
                    .overlay {
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppTheme.primary)
                                .padding(6)
                                .background(ReadingSpace.profilePaper, in: Circle())
                                .accessibilityHidden(true)
                        }
                    }
                Text(theme.title)
                    .font(.footnote)
                    .foregroundStyle(selected ? AppTheme.primary : ReadingSpace.profileMuted)
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
