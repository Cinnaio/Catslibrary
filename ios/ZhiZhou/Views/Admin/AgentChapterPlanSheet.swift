import SwiftUI
import ZhiZhouCore

struct AgentChapterPlanSheet: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: String?
    @State private var input = AIAgentChapterPlanInput()
    @State private var wordCount = "2000"
    @State private var editingRevision: Int?
    @State private var busy = false
    @State private var error: String?
    @State private var showBranches = false
    @State private var confirmation: Confirmation?

    private enum Confirmation {
        case discard
        case write(AIAgentChapterPlan)

        var title: String {
            switch self {
            case .discard: "放弃这次编辑？"
            case .write: "按这版计划写作？"
            }
        }
    }

    private var editing: Bool { editingRevision != nil }
    private var conflict: Bool {
        guard let editingRevision else { return false }
        return editingRevision != (model.chapterPlan?.revision ?? 0)
    }

    private var valid: Bool {
        guard let words = Int(wordCount), (300...30_000).contains(words) else { return false }
        return PlanTextField.allCases.allSatisfy { field in
            let value = input[keyPath: field.keyPath]
            return value.utf16.count <= field.limit
                && (!field.required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if showBranches {
                    AgentPlanBranchesView(model: model, busy: $busy) { showBranches = false }
                } else {
                    planPage.id(editing)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if showBranches {
                        Button("返回计划", systemImage: "chevron.backward") { showBranches = false }
                            .labelStyle(.iconOnly).disabled(busy)
                    } else if editing {
                        Button("取消编辑") { confirmation = .discard }.disabled(busy)
                    } else {
                        Button("关闭") { dismiss() }.disabled(busy)
                    }
                }
            }
            .interactiveDismissDisabled(busy || editing)
            .confirmationDialog(confirmation?.title ?? "", isPresented: Binding(
                get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }
            ), titleVisibility: .visible, presenting: confirmation) { option in
                switch option {
                case .discard:
                    Button("放弃编辑", role: .destructive) { endEditing() }
                    Button("继续编辑", role: .cancel) {}
                case .write(let plan):
                    Button("确认生成草稿") { Task { await submit(plan) } }
                    Button("取消", role: .cancel) {}
                }
            } message: { option in
                switch option {
                case .discard:
                    Text("尚未保存的改动会丢失。")
                case .write(let plan):
                    Text("将按第 \(plan.revision) 版《\(plan.input.title)》生成一章草稿，写完后可在「产出与采纳」中审阅。")
                }
            }
        }
    }

    private var planPage: some View {
        AgentPanelPage {
            AgentPanelHeading("章节计划", detail: model.chapterPlan.map { "第 \($0.revision) 版" }
                ?? "每段对话有一份当前计划。可以先请助手拟定，也可以手动填写。")
            if model.replying { AgentPanelNotice("助手正在处理这段对话，回复结束后可以修改计划。") }
            if !model.sending && model.localDraft.pending != nil {
                AgentPanelNotice("请先回到对话核对上次的发送状态。")
            }
            if let error {
                VStack(alignment: .leading, spacing: 8) {
                    AgentPanelNotice(error, isError: true)
                    Button("重新读取计划") { Task { await reload() } }
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                        .disabled(busy || model.isRefreshing)
                }
            }
            if conflict {
                AgentPanelNotice("当前计划已在别处更新，编辑内容仍保留。取消编辑后可查看最新版本。", isError: true)
            }
            if editing {
                editor
            } else {
                planActions
                if let plan = model.chapterPlan {
                    if let branch = plan.sourceBranch {
                        AgentPanelNotice("当前走向来自分支「\(branch.name)」。")
                    }
                    AgentPanelSection("核对计划") {
                        ForEach(PlanTextField.allCases) { field in
                            AgentPanelFact(title: field.title, value: plan.input.displayValue(for: field))
                        }
                        AgentPanelFact(title: "目标篇幅", value: "约 \(plan.input.targetWords) 字")
                    }
                    Button("确认计划并写作", systemImage: "pencil.and.outline") { confirmation = .write(plan) }
                        .buttonStyle(AgentPanelButtonStyle(prominent: true))
                        .disabled(busy || !model.canChangeChapterPlan)
                }
            }
        }
    }

    private var planActions: some View {
        VStack(spacing: 10) {
            Button {
                Task { await submit() }
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView() }
                    Label(model.chapterPlan == nil ? "请助手拟定计划" : "请助手完善计划", systemImage: "sparkles")
                }
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: model.chapterPlan == nil))
            .disabled(busy || !model.canChangeChapterPlan)
            AppAdaptiveRow(spacing: 10) {
                Button(model.chapterPlan == nil ? "手动填写" : "编辑计划") { beginEditing() }
                    .buttonStyle(AgentPanelButtonStyle())
                    .disabled(busy || !model.canChangeChapterPlan)
                if model.chapterPlan != nil && model.supportsPlanBranches {
                    Button("分支对比", systemImage: "arrow.branch") {
                        error = nil
                        showBranches = true
                    }
                    .buttonStyle(AgentPanelButtonStyle())
                    .disabled(busy)
                }
            }
            AgentPanelNotice("请助手拟定或完善计划会调用当前选定的文本模型。")
        }
    }

    private var editor: some View {
        AgentPanelSection("编辑计划") {
            ForEach(PlanTextField.allCases) { field in
                let label = field.required ? "\(field.title)（必填）" : field.title
                let count = input[keyPath: field.keyPath].utf16.count
                AgentPanelField(label, isFocused: focusedField == field.id) {
                    TextField(field.title, text: $input[dynamicMember: field.keyPath], axis: .vertical)
                        .lineLimit(field == .title ? 1...3 : 3...8)
                        .focused($focusedField, equals: field.id)
                        .accessibilityLabel(label)
                }
                if focusedField == field.id || count > field.limit {
                    Text("\(count) / \(field.limit)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(count > field.limit ? Color.red : ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            AgentPanelField("目标字数（300–30000）", isFocused: focusedField == "wordCount") {
                TextField("目标字数", text: $wordCount)
                    .keyboardType(.numberPad)
                    .focused($focusedField, equals: "wordCount")
                    .accessibilityLabel("目标字数")
            }
            Button {
                Task { await save() }
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView() }
                    Text("保存计划")
                }
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true))
            .disabled(!valid || conflict || busy || !model.canChangeChapterPlan)
        }
        .disabled(busy)
    }

    private func beginEditing() {
        input = model.chapterPlan?.input ?? AIAgentChapterPlanInput()
        wordCount = String(input.targetWords)
        editingRevision = model.chapterPlan?.revision ?? 0
        error = nil
    }

    private func endEditing() {
        focusedField = nil
        editingRevision = nil
        error = nil
    }

    private func reload() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await model.refresh()
        error = model.loadError
    }

    private func save() async {
        guard !busy, !conflict, valid, let revision = editingRevision, let words = Int(wordCount) else { return }
        busy = true
        focusedField = nil
        defer { busy = false }
        error = nil
        var updated = input
        updated.targetWords = words
        do {
            try await model.saveChapterPlan(updated, expectedRevision: revision)
            endEditing()
        } catch {
            guard model.isCurrentAccount else { return }
            self.error = AppCopy.friendlyError(error)
            if case APIError.http(let status, _) = error, status == 409 { await model.refresh() }
        }
    }

    private func submit(_ plan: AIAgentChapterPlan? = nil) async {
        guard !busy, !editing, model.canChangeChapterPlan else { return }
        busy = true
        defer { busy = false }
        error = nil
        if await model.sendChapterPlan(confirmed: plan) {
            dismiss()
        } else {
            error = model.messageError
        }
    }
}

enum PlanTextField: String, CaseIterable, Identifiable {
    case title, goal, beats, characters, ending, constraints

    var id: String { rawValue }
    var title: String {
        switch self {
        case .title: "章节标题"
        case .goal: "章节目标"
        case .beats: "情节步骤"
        case .characters: "人物变化"
        case .ending: "结尾悬念"
        case .constraints: "约束"
        }
    }
    var keyPath: WritableKeyPath<AIAgentChapterPlanInput, String> {
        switch self {
        case .title: \.title
        case .goal: \.goal
        case .beats: \.beats
        case .characters: \.characters
        case .ending: \.ending
        case .constraints: \.constraints
        }
    }
    var required: Bool { self == .title || self == .goal || self == .beats }
    var limit: Int {
        switch self {
        case .title: 200
        case .beats: 4000
        default: 1200
        }
    }
}

extension AIAgentChapterPlanInput {
    func displayValue(for field: PlanTextField) -> String {
        let value = self[keyPath: field.keyPath]
        return value.isEmpty ? "尚未决定" : value
    }
}
