import SwiftUI
import ZhiZhouCore

struct AgentPlanBranchesView: View {
    let model: AdminAIAgentConversationModel
    @Binding var busy: Bool
    let onSelected: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var nameFocused: Bool
    @State private var data: AIAgentPlanBranches?
    @State private var selectedID: String?
    @State private var name = ""
    @State private var onlyChanges = false
    @State private var loading = false
    @State private var error: String?
    @State private var pending: AdminAgentAPI.PlanBranchChange?
    @State private var confirmRemoval: AIAgentPlanBranch?

    private var selected: AIAgentPlanBranch? { data?.branches.first { $0.id == selectedID } }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var stale: Bool { data != nil && data?.plan?.revision != model.chapterPlan?.revision }
    private var blocked: Bool { busy || loading || pending != nil || stale || !model.canChangeChapterPlan }

    var body: some View {
        AgentPanelPage {
            AgentPanelHeading("分支对比", detail: "保存当前走向，再试写另一版计划。选定分支后，仍需回到计划确认写作。")
            if loading { ProgressView("读取分支…") }
            if busy { ProgressView("正在保存分支变更…") }
            if let error {
                VStack(alignment: .leading, spacing: 10) {
                    AgentPanelNotice(error, isError: true)
                    if let pending {
                        AgentPanelNotice("请求结果尚未确认。重试会沿用同一次操作。")
                        Button("重试原操作") { Task { await change(pending) } }
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                            .disabled(busy || loading || !model.canChangeChapterPlan)
                    } else {
                        reloadButton
                    }
                }
            } else if stale {
                AgentPanelNotice("当前计划有更新，请重新读取分支后再操作。")
                reloadButton
            }
            if let data {
                if let plan = data.plan { saveBranch(plan, count: data.branches.count) }
                branchList(data.branches)
                if let selected, let current = data.plan {
                    comparison(current: current, branch: selected)
                }
            }
        }
        .task { await load() }
        .confirmationDialog("移除这个分支？", isPresented: Binding(
            get: { confirmRemoval != nil }, set: { if !$0 { confirmRemoval = nil } }
        ), titleVisibility: .visible, presenting: confirmRemoval) { branch in
            Button("移除分支", role: .destructive) { Task { await change(.remove(branchID: branch.id)) } }
            Button("取消", role: .cancel) {}
        } message: { branch in
            Text("「\(branch.name)」的分支记录会被删除。当前计划和已提交的草稿任务会保留。")
        }
    }

    private var reloadButton: some View {
        Button("重新读取分支") { Task { await load() } }
            .frame(minHeight: AppLayout.minimumTouchTarget)
            .disabled(loading || busy)
    }

    private func saveBranch(_ plan: AIAgentChapterPlan, count: Int) -> some View {
        AgentPanelSection("保存当前走向", count: count) {
            AgentPanelFact(title: "第 \(plan.revision) 版", value: plan.input.title)
            AgentPanelField("分支名称", isFocused: nameFocused) {
                TextField("例如：独自赴约", text: $name)
                    .focused($nameFocused).accessibilityLabel("分支名称")
            }
            .disabled(blocked || count >= 8)
            if name.utf16.count > 60 { AgentPanelNotice("分支名称最多 60 字。", isError: true) }
            Button("保存当前计划为分支") {
                let request = AdminAgentAPI.PlanBranchChange.save(name: trimmedName, revision: plan.revision,
                                                               operationID: UUID().uuidString)
                Task { await change(request) }
            }
            .buttonStyle(AgentPanelButtonStyle())
            .disabled(blocked || trimmedName.isEmpty || name.utf16.count > 60 || count >= 8)
            if count >= 8 {
                AgentPanelNotice("已保存 8 个分支。切换前若需要保留当前走向，请先腾出一个位置。")
            }
        }
    }

    private func branchList(_ branches: [AIAgentPlanBranch]) -> some View {
        AgentPanelSection("已保存的分支") {
            if branches.isEmpty {
                AgentPanelNotice("还没有保存的分支。")
            }
            ForEach(Array(branches.enumerated()), id: \.element.id) { index, branch in
                Button {
                    withAnimation(reduceMotion ? nil : AppMotion.state) { selectedID = branch.id }
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(branch.name).foregroundStyle(ReadingSpace.ink)
                            Text("保存自第 \(branch.plan.revision) 版" + (branch.source == "switch" ? " · 切换前保留" : ""))
                                .font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
                        }
                        Spacer(minLength: 0)
                        if selectedID == branch.id {
                            Image(systemName: "checkmark").foregroundStyle(AppTheme.primary)
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                    .background(selectedID == branch.id ? ReadingSpace.profileFill : Color.clear,
                                in: RoundedRectangle(cornerRadius: 12))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selectedID == branch.id ? .isSelected : [])
                .disabled(busy || loading)
                .readingSpaceEntrance(index)
            }
        }
    }

    private func comparison(current: AIAgentChapterPlan, branch: AIAgentPlanBranch) -> some View {
        let fields = PlanTextField.allCases.filter {
            !onlyChanges || current.input[keyPath: $0.keyPath] != branch.plan.input[keyPath: $0.keyPath]
        }
        let wordsChanged = current.input.targetWords != branch.plan.input.targetWords
        let same = current.input == branch.plan.input
        return AgentPanelSection("与「\(branch.name)」对比") {
            Toggle("只看不同", isOn: $onlyChanges.animation(reduceMotion ? nil : AppMotion.state))
                .frame(minHeight: AppLayout.minimumTouchTarget)
            if onlyChanges && same {
                AgentPanelNotice("这个分支与当前计划的内容相同。")
            }
            ForEach(fields) { field in
                comparisonRow(field.title, current: current.input.displayValue(for: field),
                              alternate: branch.plan.input.displayValue(for: field), name: branch.name)
                    .transition(reduceMotion ? .identity : .opacity)
            }
            if !onlyChanges || wordsChanged {
                comparisonRow("目标篇幅", current: "\(current.input.targetWords) 字",
                              alternate: "\(branch.plan.input.targetWords) 字", name: branch.name)
                    .transition(reduceMotion ? .identity : .opacity)
            }
            AgentPanelNotice("切换时，尚未保留的当前走向会自动保存为分支。")
            Button("设为当前计划") {
                let request = AdminAgentAPI.PlanBranchChange.select(branchID: branch.id, revision: current.revision,
                                                                 operationID: UUID().uuidString)
                Task { await change(request) }
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true))
            .disabled(blocked || same)
            Button("移除分支", role: .destructive) { confirmRemoval = branch }
                .buttonStyle(.plain).foregroundStyle(.red)
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .disabled(blocked)
        }
    }

    private func comparisonRow(_ title: String, current: String, alternate: String, name: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            AgentPanelFact(title: "当前计划", value: current)
            AgentPanelFact(title: name, value: alternate)
        }
        .padding(.vertical, 6)
    }

    private func load() async {
        guard !loading, !busy, pending == nil, model.isCurrentAccount, !Task.isCancelled else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let value = try await model.api.planBranches(model.sessionID)
            guard model.isCurrentAccount, !Task.isCancelled else { return }
            apply(value)
        } catch {
            guard model.isCurrentAccount, !Task.isCancelled else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func change(_ request: AdminAgentAPI.PlanBranchChange) async {
        guard !busy, !loading, model.canChangeChapterPlan, pending != nil || !stale else { return }
        busy = true
        nameFocused = false
        pending = request
        error = nil
        defer { busy = false }
        do {
            let value = try await model.changePlanBranch(request)
            pending = nil
            apply(value)
            switch request {
            case .select:
                onSelected()
            case .save(let name, _, _):
                self.name = ""
                if let branch = value.branches.first(where: { $0.name == name }) { selectedID = branch.id }
            case .remove:
                break
            }
        } catch {
            guard model.isCurrentAccount else { return }
            if case APIError.http(let status, _) = error, (400..<500).contains(status), status != 408, status != 429 {
                pending = nil
            }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func apply(_ value: AIAgentPlanBranches) {
        model.receiveChapterPlan(value.plan)
        data = value
        if !value.branches.contains(where: { $0.id == selectedID }) { selectedID = value.branches.first?.id }
    }
}
