import SwiftUI
import ZhiZhouCore

struct AgentSettingsSheet: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @State private var brief: String
    @State private var preferences: AIAgentPreferences
    @State private var updatedAt: Int64
    @State private var saving = false
    @State private var error: String?

    init(model: AdminAIAgentConversationModel) {
        self.model = model
        _brief = State(initialValue: model.session.brief)
        _preferences = State(initialValue: model.session.contentPreferences)
        _updatedAt = State(initialValue: model.session.updatedAt)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("取材范围") {
                    LabeledContent("作品", value: model.session.novelTitle)
                    LabeledContent("续写起点", value: model.session.anchorTitle.isEmpty ? "从头创作" : model.session.anchorTitle)
                }
                Section("创作约定") {
                    TextField("文风、情节方向、需要保留的设定…", text: $brief, axis: .vertical).lineLimit(4...12)
                    Text("\(brief.utf16.count) / 4000").font(.caption).foregroundStyle(brief.utf16.count > 4000 ? Color.red : AppTheme.textSecondary)
                }
                Section {
                    Picker("内容尺度", selection: $preferences.adultContentMode) {
                        Text("常规").tag("off")
                        Text("成人").tag("explicit")
                    }
                    if preferences.adultContentMode == "explicit" {
                        Picker("亲密描写比重", selection: $preferences.intimacyWeight) {
                            Text("少量").tag("low")
                            Text("适中").tag("medium")
                            Text("较多").tag("high")
                        }
                        Picker("叙事约束", selection: Binding(get: { preferences.consentRuleTier ?? "default" }, set: { preferences.consentRuleTier = $0 })) {
                            Text("默认规则").tag("default")
                            Text("虚构非自愿情节").tag("fictional_nonconsent")
                        }
                        Text("所有涉及成人内容的角色均为成年人。")
                            .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                    }
                } header: { Text("内容偏好") } footer: {
                    Text("偏好只影响本次会话的创作方向，作品发布仍遵循现有分级规则。")
                }
                if model.replying { Text("请等待或停止当前回复后再保存设置。").font(.footnote) }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                        Button("载入最新设置，替换当前编辑") { Task { await reload() } }.disabled(saving || model.working)
                    }
                }
            }
            .appListStyle(.settings)
            .navigationTitle("会话设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await save() } }
                        .disabled(saving || model.working || model.replying || model.sending || brief.utf16.count > 4000)
                }
            }
            .onChange(of: preferences.adultContentMode) { _, _ in preferences = preferences.normalized }
            .interactiveDismissDisabled(saving)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await model.saveSettings(brief: brief, preferences: preferences, updatedAt: updatedAt)
            dismiss()
        } catch { self.error = AppCopy.friendlyError(error) }
    }

    private func reload() async {
        await model.refresh()
        guard model.loadError == nil, model.isCurrentAccount else { error = model.loadError; return }
        brief = model.session.brief
        preferences = model.session.contentPreferences
        updatedAt = model.session.updatedAt
        error = nil
    }
}
