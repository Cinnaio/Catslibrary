import SwiftUI
import ZhiZhouCore

struct AgentSettingsSheet: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var brief: String
    @State private var preferences: AIAgentPreferences
    @State private var updatedAt: Int64
    @State private var bookSettingsRevision: Int?
    @State private var useForNewConversations = true
    @State private var saving = false
    @State private var error: String?
    @FocusState private var briefFocused: Bool

    init(model: AdminAIAgentConversationModel) {
        self.model = model
        _brief = State(initialValue: model.session.brief)
        _preferences = State(initialValue: model.session.contentPreferences)
        _updatedAt = State(initialValue: model.session.updatedAt)
        _bookSettingsRevision = State(initialValue: model.session.bookSettingsRevision)
    }

    var body: some View {
        NavigationStack {
            AgentPanelPage {
                AgentPanelHeading("会话设置", detail: "为这次创作定下方向。")
                AgentPanelSection("取材范围") {
                    AppAdaptiveRow(spacing: 20) {
                        AgentPanelFact(title: "作品", value: model.session.novelTitle.isEmpty ? "当前作品" : model.session.novelTitle)
                        AgentPanelFact(title: "续写起点", value: anchorTitle)
                    }
                }
                AgentPanelSection("创作约定") {
                    AgentPanelField("文风与情节方向", isFocused: briefFocused) {
                        TextField("文风、情节方向、需要保留的设定…", text: $brief, axis: .vertical)
                            .lineLimit(5...12).focused($briefFocused)
                            .accessibilityLabel("创作约定")
                    }
                    Text("\(brief.utf16.count) / 4000")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(brief.utf16.count > 4000 ? Color.red : ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                AgentPanelSection("内容偏好") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("内容尺度").font(.subheadline.weight(.medium))
                        if dynamicTypeSize >= .xxxLarge {
                            contentModePicker.pickerStyle(.menu)
                                .frame(minHeight: 44).labelsHidden().accessibilityLabel("内容尺度")
                        } else {
                            contentModePicker.pickerStyle(.segmented).frame(minHeight: 44)
                        }
                    }
                    if preferences.adultContentMode == "explicit" {
                        AppAdaptiveRow(spacing: 12) {
                            Text("亲密描写比重").frame(maxWidth: .infinity, alignment: .leading)
                            Picker("亲密描写比重", selection: $preferences.intimacyWeight) {
                                Text("少量").tag("low")
                                Text("适中").tag("medium")
                                Text("较多").tag("high")
                            }
                            .pickerStyle(.menu).labelsHidden().accessibilityLabel("亲密描写比重")
                        }
                        .frame(minHeight: 44)
                        Divider().overlay(ReadingSpace.profileLine)
                        AppAdaptiveRow(spacing: 12) {
                            Text("叙事约束").frame(maxWidth: .infinity, alignment: .leading)
                            Picker("叙事约束", selection: Binding(get: { preferences.consentRuleTier ?? "default" }, set: { preferences.consentRuleTier = $0 })) {
                                Text("默认规则").tag("default")
                                Text("虚构非自愿情节").tag("fictional_nonconsent")
                            }
                            .pickerStyle(.menu).labelsHidden().accessibilityLabel("叙事约束")
                        }
                        .frame(minHeight: 44)
                        AgentPanelNotice("所有涉及成人内容的角色均为成年人。")
                    }
                    AgentPanelNotice("作品发布仍遵循现有分级规则。")
                }
                if bookSettingsRevision != nil {
                    AgentPanelSection("下次创作") {
                        Toggle(isOn: $useForNewConversations) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("设为本书新对话的默认设置").font(.subheadline.weight(.medium))
                                Text("已有对话继续使用各自的设置。")
                                    .font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                        .disabled(saving || model.working || model.replying || model.sending)
                    }
                }
                if model.replying { AgentPanelNotice("请等待或停止当前回复后再保存设置。") }
                if let error {
                    VStack(alignment: .leading, spacing: 14) {
                        AgentPanelNotice(error, isError: true)
                        Button("载入最新设置，替换当前编辑") { Task { await reload() } }
                            .buttonStyle(AgentPanelButtonStyle())
                            .disabled(saving || model.working)
                    }
                }
            }
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        briefFocused = false
                        Task { await save() }
                    } label: {
                        HStack(spacing: 6) { Text("保存"); if saving { ProgressView() } }
                    }
                    .disabled(saving || model.working || model.replying || model.sending || brief.utf16.count > 4000)
                }
            }
            .onChange(of: preferences.adultContentMode) { _, _ in preferences = preferences.normalized }
            .interactiveDismissDisabled(saving)
        }
    }

    private var contentModePicker: some View {
        Picker("内容尺度", selection: $preferences.adultContentMode) {
            Text("常规").tag("off")
            Text("成人").tag("explicit")
        }
    }

    private var anchorTitle: String {
        if !model.session.anchorTitle.isEmpty { return model.session.anchorTitle }
        return model.session.afterChapterId.isEmpty ? "从头创作" : "原章节不可用"
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await model.saveSettings(brief: brief, preferences: preferences, updatedAt: updatedAt,
                                         bookSettingsRevision: useForNewConversations ? bookSettingsRevision : nil)
            dismiss()
        } catch { self.error = AppCopy.friendlyError(error) }
    }

    private func reload() async {
        await model.refresh()
        guard model.loadError == nil, model.isCurrentAccount else { error = model.loadError; return }
        brief = model.session.brief
        preferences = model.session.contentPreferences
        updatedAt = model.session.updatedAt
        bookSettingsRevision = model.session.bookSettingsRevision
        error = nil
    }
}
