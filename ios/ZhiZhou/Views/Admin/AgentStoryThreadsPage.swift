import SwiftUI
import ZhiZhouCore

struct AgentStoryThreadsPage: View {
    let model: AdminAIAgentConversationModel
    @Binding var busy: Bool
    @Binding var editing: Bool
    let onApplied: () -> Void
    let onDiscussed: () -> Void
    @State private var state: AIAgentStoryThreadState?
    @State private var selected: Set<String> = []
    @State private var loading = true
    @State private var initialized = false
    @State private var error: String?
    @State private var query = ""
    @State private var edit: ThreadEdit?
    @State private var removing: AIAgentStoryThreadPlan?
    private var blocked: Bool { busy || loading || !model.canChangeChapterPlan }
    private var chosen: [AIAgentStoryThreadPlan] { state?.plans.filter { selected.contains($0.id) } ?? [] }
    private var selectionValid: Bool { chosen.count == selected.count && chosen.count <= 6 && chosen.allSatisfy { $0.stale != true && $0.disposition != "resolved" } }
    private var candidates: [StoryThread] {
        guard let state else { return [] }
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return state.candidates.filter { item in
            (term.isEmpty || (item.title + item.summary).localizedStandardContains(term))
                && !state.plans.contains { $0.sourceRevision == state.sourceRevision && $0.thread.id == item.id }
        }
    }
    var body: some View {
        AgentPanelPage {
            AgentPanelHeading("线索安排", detail: "这些是作者的创作安排，不是已经发生的剧情。是否回收由你确认。")
            if loading { ProgressView("读取线索…") }
            if let error { AgentPanelNotice(error, isError: true) }
            AppAdaptiveRow(spacing: 12) {
                Button("重新读取") { Task { await load() } }.disabled(busy || loading)
                NavigationLink("打开故事星图") {
                    AdminStoryGraphView(novelID: model.session.novelId, novelTitle: model.session.novelTitle,
                        afterChapterID: model.session.afterChapterId.isEmpty ? nil : model.session.afterChapterId)
                }.disabled(busy || editing)
            }.buttonStyle(AgentPanelButtonStyle())
            if let edit { editor(edit) }
            if let state {
                ForEach(Array(state.plans.enumerated()), id: \.element.id) { index, plan in
                    planRow(plan).readingSpaceEntrance(index)
                }
                if model.chapterPlan == nil { AgentPanelNotice("可以先整理线索；建立章节计划后再选入本章。") }
                Button("清空本章选择") { selected = [] }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || editing || selected.isEmpty)
                Button("保存本章线索选择（\(selected.count)/6）") { Task { await apply() } }
                    .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(blocked || editing || !selectionValid || model.chapterPlan == nil)
                AgentPanelSection("从星图加入") {
                    if state.graphStatus != "ready" { AgentPanelNotice("当前起点没有有效星图。请先打开星图，选择相同阅读范围并生成，再回来读取。") }
                    AgentPanelField("查找线索") { TextField("名称或内容", text: $query) }
                    ForEach(Array(candidates.enumerated()), id: \.element.id) { index, thread in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(thread.title).font(.headline)
                            Text(thread.summary).font(.subheadline).lineSpacing(4)
                            Button("安排这条线索") {
                                self.edit = ThreadEdit(thread: thread, sourceRevision: state.sourceRevision)
                                editing = true
                            }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || editing)
                        }.readingSpaceEntrance(index)
                    }
                    if state.graphStatus == "ready" && candidates.isEmpty { AgentPanelNotice("没有尚未加入的匹配线索。") }
                }
            }
        }
        .task {
            if !initialized { selected = Set(model.chapterPlan?.storyThreads?.map(\.id) ?? []); initialized = true }
            await load()
        }
        .confirmationDialog("移除这条线索安排？", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { plan in
            Button("移除「\(plan.thread.title)」", role: .destructive) { Task { await write {
                try await model.api.removeStoryThread(model.sessionID, plan: plan)
                guard model.isCurrentAccount else { return }; selected.remove(plan.id); await load()
            } } }
            Button("取消", role: .cancel) {}
        } message: { _ in Text("已经提交的章节计划快照仍然保留。") }
    }
    private func planRow(_ plan: AIAgentStoryThreadPlan) -> some View {
        AgentPanelSection(plan.thread.title) {
            Toggle("带入本章 · \(plan.label)", isOn: Binding(get: { selected.contains(plan.id) }, set: { value in
                if value { selected.insert(plan.id) } else { selected.remove(plan.id) }
            })).tint(AppTheme.primary).frame(minHeight: 44)
                .disabled(blocked || editing || (!selected.contains(plan.id) && (selected.count >= 6 || plan.stale == true || plan.disposition == "resolved")))
            Text(plan.note.isEmpty ? plan.thread.summary : plan.note).lineSpacing(4)
            if plan.stale == true { AgentPanelNotice("来源与当前起点的星图不同。请核对后从有效星图重新加入，再用于本章。") }
            DisclosureGroup("报告依据（请回读原文核对）") {
                ForEach(Array(plan.thread.evidence.enumerated()), id: \.offset) { _, source in
                    Text(verbatim: source.quote).textSelection(.enabled).padding(.top, 12)
                    ForEach(source.chapterIds, id: \.self) { id in
                        NavigationLink("回读来源章节") { SavedChapterDestination(novelID: model.session.novelId, chapterID: id) }
                            .buttonStyle(AgentPanelButtonStyle())
                    }
                }
            }
            AppAdaptiveRow(spacing: 12) {
                Button("调整安排") { edit = ThreadEdit(plan: plan); editing = true }
                Button("核对进展") { Task {
                    let sent = await model.discussWorkflow("请只核对线索「\(plan.thread.title)」的进展：先查阅线索安排，再读取本会话实际草稿或已发布正文，给出对应引文，区分已推进、尚未处理与无法确认。只报告结果，不修改大纲或章节计划，是否回收由我确认。")
                    if sent { onDiscussed() } else { error = model.messageError }
                } }
                Button("移除", role: .destructive) { removing = plan }
            }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || editing)
        }
    }
    private func editor(_ value: ThreadEdit) -> some View {
        AgentPanelSection("安排「\(value.title)」") {
            Picker("处理方式", selection: Binding(get: { edit?.disposition ?? "advance" }, set: { edit?.disposition = $0 })) {
                Text("本章推进").tag("advance"); Text("安排到后面").tag("later")
                Text("暂时搁置").tag("hold"); Text("已回收").tag("resolved")
            }.pickerStyle(.menu).frame(minHeight: 44)
            AgentPanelField("安排说明 · 最多 1200 字") {
                TextField("补充推进方式或回收依据", text: Binding(get: { edit?.note ?? "" }, set: { edit?.note = $0 }), axis: .vertical).lineLimit(3...6)
            }
            AppAdaptiveRow(spacing: 12) {
                Button("取消") { edit = nil; editing = false }
                Button(value.disposition == "resolved" ? "确认已回收" : "保存安排") { Task { await save() } }
                    .disabled(value.note.utf16.count > 1200)
            }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked)
        }.disabled(busy)
    }
    @MainActor private func write(_ operation: () async throws -> Void) async {
        guard !blocked else { return }; busy = true; error = nil; defer { busy = false }
        do { try await operation() } catch { if model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
    }
    @MainActor private func save() async {
        guard let edit else { return }
        await write {
            let result = try await model.api.saveStoryThread(model.sessionID, body: edit.body)
            guard model.isCurrentAccount else { return }; state = result
            if edit.disposition == "resolved", let id = edit.planID { selected.remove(id) }
            self.edit = nil; editing = false
        }
    }
    @MainActor private func apply() async {
        guard let plan = model.chapterPlan, selectionValid else { return }
        await write {
            let result = try await model.api.applyStoryThreads(model.sessionID, plans: chosen, planRevision: plan.revision)
            guard model.isCurrentAccount else { return }; model.receiveChapterPlan(result); onApplied()
        }
    }
    @MainActor private func load() async {
        loading = true; defer { loading = false }
        do { let result = try await model.api.storyThreads(model.sessionID)
            if model.isCurrentAccount, !Task.isCancelled { state = result; error = nil }
        } catch { if model.isCurrentAccount, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
}
private struct ThreadEdit {
    var planID: String?
    var threadID: String
    var title: String
    var revision: Int
    var sourceRevision: String
    var disposition: String
    var note: String
    init(thread: StoryThread, sourceRevision: String) {
        threadID = thread.id; title = thread.title; revision = 0; self.sourceRevision = sourceRevision; disposition = "advance"; note = ""
    }
    init(plan: AIAgentStoryThreadPlan) {
        planID = plan.id; threadID = plan.thread.id; title = plan.thread.title; revision = plan.revision
        sourceRevision = plan.sourceRevision; disposition = plan.disposition; note = plan.note
    }
    var body: [String: Any] {
        var body: [String: Any] = ["threadId": threadID, "sourceRevision": sourceRevision, "expectedRevision": revision, "disposition": disposition, "note": note]
        if let planID { body["id"] = planID }; return body
    }
}
