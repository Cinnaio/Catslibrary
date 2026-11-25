import SwiftUI
import ZhiZhouCore

struct AgentRewriteSelectionView: View {
    let model: AdminAIAgentConversationModel
    let artifactID: String
    let kind: AIAgentActionKind
    let revision: String
    let differences: [AIAgentTextDifference]
    let before: String
    let after: String
    @State private var accepted: Set<Int> = []
    @State private var ready = false
    @State private var changesOnly = true
    @State private var width: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var count: Int { differences.filter { $0.kind != "equal" }.count }
    private var saved: AIAgentAction? {
        model.actions.filter { $0.kind == kind && $0.preview.sourceTaskId == artifactID && $0.preview.selection?.revision == revision }
            .sorted {
                let left = $0.status == "completed" ? 2 : $0.status == "executing" ? 1 : 0
                let right = $1.status == "completed" ? 2 : $1.status == "executing" ? 1 : 0
                return left != right ? left > right : $0.createdAt > $1.createdAt
            }.first
    }
    private var locked: Bool { saved?.status == "completed" || saved?.status == "executing" }
    private var merged: String { AIAgentRewriteChoices.merge(differences, accepted: accepted) }
    private var valid: Bool {
        !differences.isEmpty && differences.map(\.before).joined() == before && differences.map(\.after).joined() == after
            && differences.allSatisfy { ["equal", "changed", "added", "removed"].contains($0.kind) }
    }
    private func changeIndex(_ index: Int) -> Int { differences.prefix(index).filter { $0.kind != "equal" }.count }
    private func select(_ indexes: Set<Int>) {
        accepted = indexes
        model.rewriteSelections[artifactID] = AIAgentRewriteSelection(revision: revision, acceptedChanges: Array(indexes))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            AgentPanelHeading("逐处选择改动", detail: "采用 \(accepted.count) / \(count) 处。未选处保留原文，预览后仍需确认采纳。")
            if !valid { AgentPanelNotice("改动对照暂不可用，请返回并重新读取产出。", isError: true) }
            if let error = model.operationError { AgentPanelNotice(error, isError: true) }
            if locked { AgentPanelNotice("这份预览正在采纳或已经采纳，选择已锁定。") }
            AppAdaptiveRow(spacing: 12) {
                Button("全部采用") { select(Set(0..<count)) }
                Button("全部保留原文") { select([]) }
            }.buttonStyle(AgentPanelButtonStyle()).disabled(!ready || !valid || locked || model.working)
            Toggle("只看改动", isOn: $changesOnly).tint(AppTheme.primary).frame(minHeight: 44)
            LazyVStack(alignment: .leading, spacing: 24) {
                ForEach(Array(differences.enumerated()), id: \.offset) { index, part in
                    if part.kind != "equal" || !changesOnly {
                        VStack(alignment: .leading, spacing: 12) {
                            if part.kind != "equal" {
                                let choice = changeIndex(index)
                                Toggle("采用第 \(choice + 1) 处改动", isOn: Binding(get: { accepted.contains(choice) }, set: { value in
                                    var next = accepted
                                    if value { next.insert(choice) } else { next.remove(choice) }
                                    select(next)
                                })).tint(AppTheme.primary).frame(minHeight: 44)
                                    .disabled(locked || model.working || !ready || !valid)
                            } else { Text("保持不变").font(.caption).foregroundStyle(ReadingSpace.profileMuted) }
                            let layout = width >= 640 && dynamicTypeSize < .xxxLarge
                                ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                                : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
                            layout {
                                column("原文", part.before)
                                column("修改后", part.after)
                            }
                        }
                        Divider().overlay(ReadingSpace.profileLine)
                    }
                }
            }
            DisclosureGroup("阅读合并结果") { Text(verbatim: merged).lineSpacing(6).textSelection(.enabled).padding(.top, 12) }
            if let saved, locked {
                Button("查看采纳记录") { Task { await model.openAction(saved.id) } }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(model.working)
            } else {
                Button("预览所选结果") { Task { await model.prepare(kind, targetID: artifactID,
                    selection: AIAgentRewriteSelection(revision: revision, acceptedChanges: Array(accepted))) } }
                    .buttonStyle(AgentPanelButtonStyle(prominent: true))
                    .disabled(!ready || !valid || model.working || !model.isCurrentAccount || accepted.isEmpty || merged == before || merged.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .background { GeometryReader { geometry in Color.clear.onAppear { width = geometry.size.width }
            .onChange(of: geometry.size.width) { _, value in width = value } } }
        .onChange(of: saved.map { $0.id + ":" + $0.status }) { _, _ in
            if locked, let selection = saved?.preview.selection,
               AIAgentRewriteChoices.valid(selection, revision: revision, count: count) {
                accepted = Set(selection.acceptedChanges)
            }
        }
        .task(id: revision) {
            let stored = locked ? saved?.preview.selection : model.rewriteSelections[artifactID] ?? saved?.preview.selection
            if let stored, stored.revision == revision,
               stored.acceptedChanges.allSatisfy({ (0..<count).contains($0) }) {
                accepted = Set(stored.acceptedChanges)
            } else { accepted = Set(0..<count) }
            ready = true
        }
    }
    private func column(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            Text(verbatim: text.isEmpty ? "（无文字）" : text).lineSpacing(6).textSelection(.enabled)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
