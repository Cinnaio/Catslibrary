import SwiftUI

/// 阅读设置面板：字号/字体/行距/主题，改动即时生效并同步服务器。
struct ReaderSettingsView: View {
    @EnvironmentObject private var settings: ReaderSettingsStore
    @Environment(\.dismiss) private var dismiss

    private let fontLevels = ["0", "1", "2", "3", "4", "5"]
    private let themes: [(id: String, title: String, swatch: Color)] = [
        ("default", "纸面", Color(hex: "FBF6EE")),
        ("eye", "护眼", Color(hex: "E7EBD9")),
        ("paper", "羊皮", Color(hex: "F2E3C6")),
        ("dark", "夜间", Color(hex: "1C1916")),
        ("system", "系统", Color(hex: "8B6045")),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("字号") {
                    Stepper(
                        "第 \(settings.fontSizeIndex + 1) 档 · \(Int(settings.bodyFontSizeUnscaled)) pt",
                        value: Binding(
                            get: { settings.fontSizeIndex },
                            set: { settings.set("fontSize", fontLevels[$0]) }
                        ),
                        in: 0...5
                    )
                }

                Section("字体") {
                    Picker("字体", selection: Binding(
                        get: { settings.useSerif ? "serif" : "sans" },
                        set: { settings.set("fontFamily", $0) }
                    )) {
                        Text("衬线（宋体感）").tag("serif")
                        Text("无衬线（黑体感）").tag("sans")
                    }
                    .pickerStyle(.segmented)
                    .frame(minHeight: 44)
                }

                Section("行距") {
                    Picker("行距", selection: Binding(
                        get: { settings.values["readerLineHeight"] ?? "1.95" },
                        set: { settings.set("readerLineHeight", $0) }
                    )) {
                        Text("紧凑").tag("1.75")
                        Text("标准").tag("1.95")
                        Text("宽松").tag("2.15")
                    }
                    .pickerStyle(.segmented)
                    .frame(minHeight: 44)
                }

                Section("纸面") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 10)], spacing: 10) {
                        ForEach(themes, id: \.id) { theme in
                            themeButton(theme)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Toggle("阅读时保持屏幕常亮", isOn: Binding(
                        get: { settings.wakeLockEnabled },
                        set: { settings.set("readerWakeLock", $0 ? "true" : "false") }
                    ))
                } footer: {
                    Text("与网页端同步阅读偏好。浏览页保持浅色奶茶风，夜间只作用于阅读器。")
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("阅读设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func themeButton(_ theme: (id: String, title: String, swatch: Color)) -> some View {
        let selected = settings.normalizedTheme == theme.id
            || (theme.id == "system" && settings.themeName == "system")
            || (theme.id == "dark" && ["dark", "night", "ink", "black"].contains(settings.themeName))
        return Button {
            settings.set("readerTheme", theme.id)
        } label: {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(theme.swatch)
                    .frame(height: 36)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(selected ? AppTheme.primary : AppTheme.border, lineWidth: selected ? 2 : 1)
                    )
                Text(theme.title)
                    .font(.caption)
                    .foregroundStyle(selected ? AppTheme.primary : Color.secondary)
            }
            .frame(minHeight: 64)
        }
        .buttonStyle(ScaleButtonStyle())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(theme.title)
    }
}
