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
    @State private var showOutline = false
    @State private var showThreads = false
    @State private var threadEditing = false
    @State private var outlineEditing = false
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
                if showThreads {
                    AgentStoryThreadsPage(model: model, busy: $busy, editing: $threadEditing, onApplied: { showThreads = false }, onDiscussed: { dismiss() })
                } else if showOutline {
                    AgentOutlinePage(model: model, busy: $busy, editing: $outlineEditing, onDiscussed: { dismiss() }) { showOutline = false }
                } else if showBranches {
                    AgentPlanBranchesView(model: model, busy: $busy) { showBranches = false }
                } else {
                    planPage.id(editing)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if showOutline || showBranches || showThreads {
                        Button("返回计划", systemImage: "chevron.backward") { showOutline = false; showBranches = false; showThreads = false }
                            .labelStyle(.iconOnly).disabled(busy || outlineEditing || threadEditing)
                    } else if editing {
                        Button("取消编辑") { confirmation = .discard }.disabled(busy)
                    } else {
                        Button("关闭") { dismiss() }.disabled(busy)
                    }
                }
            }
            .interactiveDismissDisabled(busy || editing || outlineEditing || threadEditing)
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
                    if let threads = plan.storyThreads, !threads.isEmpty {
                        AgentPanelNotice("本章已带入：" + threads.map { $0.thread.title }.joined(separator: "、") + "。调整安排后需重新保存本章选择。")
                    }
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
            if model.supportsStoryThreads {
                Button("线索安排", systemImage: "point.3.connected.trianglepath.dotted") { error = nil; showThreads = true }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(busy)
            }
            if model.supportsOutline {
                Button("多章大纲", systemImage: "list.bullet.rectangle") {
                    error = nil
                    showOutline = true
                }
                .buttonStyle(AgentPanelButtonStyle())
                .disabled(busy)
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

private struct AgentOutlinePage: View {
    let model: AdminAIAgentConversationModel
    @Binding var busy: Bool
    @Binding var editing: Bool
    let onDiscussed: () -> Void
    let onApplied: () -> Void
    @State private var outline: AIAgentOutline?
    @State private var draft: [AIAgentOutlineChapter] = []
    @State private var revision = 0
    @State private var chosen: Int?
    @State private var loading = true
    @State private var error: String?

    private enum Field: String, CaseIterable {
        case title, goal, beats
        var label: String {
            switch self {
            case .title: "标题"
            case .goal: "本章目标"
            case .beats: "情节步骤"
            }
        }
        var limit: Int {
            switch self {
            case .title: 80
            case .goal: 180
            case .beats: 1_000
            }
        }
        var path: WritableKeyPath<AIAgentOutlineChapter, String> {
            switch self {
            case .title: \.title
            case .goal: \.goal
            case .beats: \.beats
            }
        }
    }

    private var stale: Bool { editing && revision != (outline?.revision ?? 0) }
    private var valid: Bool {
        draft.allSatisfy { chapter in
            Field.allCases.allSatisfy { field in
                let value = chapter[keyPath: field.path]
                return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= field.limit
            }
        }
    }

    var body: some View {
        AgentPanelPage {
            AgentPanelHeading("多章大纲", detail: "按顺序安排接下来 3 至 5 章。设为章节计划后，可以继续核对和编辑。")
            if model.supportsOutlineWorkflow && !editing {
                Button(outline == nil ? "请助手拟定多章大纲" : "请助手核对进度并完善大纲") { Task {
                    if await model.discussWorkflow("请先读取本书多章大纲及实际草稿、发布进度，结合我们的讨论拟定或完善未来 3 至 5 章安排。保留已有章节标识，核对实际写出的情节，指出后续哪些安排需要调整，再用 propose_outline 保存待核对大纲。只做规划，暂不生成正文。") { onDiscussed() }
                    else { error = model.messageError }
                } }.buttonStyle(AgentPanelButtonStyle()).disabled(busy || loading || !model.canChangeChapterPlan)
            }
            if loading { ProgressView("正在读取作品大纲…") }
            if let error {
                AgentPanelNotice(error, isError: true)
                Button("重新读取大纲") { Task { await load(); await model.refresh() } }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(busy || loading)
            }
            if editing {
                editor
            } else if let outline {
                reading(outline)
            } else if !loading && error == nil {
                AgentPanelNotice("这本书还没有保存的大纲。")
                Button("新建大纲") { edit() }.buttonStyle(AgentPanelButtonStyle(prominent: true))
            }
        }
        .task { await load() }
    }

    private func reading(_ outline: AIAgentOutline) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("本书大纲 · 第 \(outline.revision) 版").font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            if let chosen, outline.chapters.indices.contains(chosen) {
                let title = outline.chapters[chosen].title
                let text = model.chapterPlan == nil ? "将使用「\(title)」建立当前章节计划。" : "将使用「\(title)」替换当前章节计划。"
                AgentPanelNotice(text + "写作仍需返回计划确认。")
                AppAdaptiveRow(spacing: 12) {
                    Button("取消选择") { self.chosen = nil }.buttonStyle(AgentPanelButtonStyle())
                    Button("确认设为章节计划") {
                        Task {
                            await write {
                                try await model.applyOutlineChapter(chosen, outlineRevision: outline.revision,
                                                                    planRevision: model.chapterPlan?.revision ?? 0)
                                if model.isCurrentAccount { onApplied() }
                            }
                        }
                    }.buttonStyle(AgentPanelButtonStyle(prominent: true))
                        .disabled(!model.canChangeChapterPlan)
                }
            } else {
                Button("编辑大纲") { edit() }.buttonStyle(AgentPanelButtonStyle())
            }
            ForEach(outline.chapters.indices, id: \.self) { index in
                let chapter = outline.chapters[index]
                AgentPanelSection("\(index + 1). \(chapter.title)") {
                    if let progress = chapter.progress {
                        Text(progress.label + (index == outline.chapters.firstIndex(where: { $0.progress?.status != "published" }) ? " · 下一项" : ""))
                            .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        if progress.changedSinceWriting { AgentPanelNotice("大纲在写作后有更新，已有稿件仍保留当时的计划。请核对后续安排。") }
                        ForEach(progress.drafts) { draft in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(draft.title + " · " + (draft.status == "published" ? draft.chapterId == nil ? "正式章节已不可用" : "已发布" : "草稿")).font(.subheadline)
                                if let chapterID = draft.chapterId {
                                    NavigationLink("阅读已发布章节") { SavedChapterDestination(novelID: model.session.novelId, chapterID: chapterID) }
                                }
                                if !draft.sessionId.isEmpty {
                                    NavigationLink("打开创作对话") { AgentOutlineConversationDestination(model: model, sessionID: draft.sessionId) }
                                }
                            }
                        }
                    }
                    AgentPanelFact(title: "本章目标", value: chapter.goal)
                    AgentPanelFact(title: "情节步骤", value: chapter.beats)
                    Button("选作章节计划") { chosen = index }
                        .buttonStyle(AgentPanelButtonStyle(prominent: chosen == index))
                        .accessibilityAddTraits(chosen == index ? .isSelected : [])
                        .disabled(!model.canChangeChapterPlan)
                }.readingSpaceEntrance(index)
            }
        }
        .disabled(busy || loading)
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 24) {
            if stale {
                AgentPanelNotice("已保存的大纲发生变化，当前编辑仍保留。放弃编辑后可查看新版本。", isError: true)
            }
            ForEach(draft.indices, id: \.self) { index in
                AgentPanelSection("大纲第 \(index + 1) 章") {
                    ForEach(Field.allCases, id: \.self) { field in
                        let value = text(index, field)
                        AgentPanelField(field.label) {
                            TextField(field.label, text: value, axis: .vertical)
                                .lineLimit(field == .title ? 1...3 : 2...6)
                        }
                        if value.wrappedValue.utf16.count > field.limit {
                            AgentPanelNotice("\(field.label)最多 \(field.limit) 字。", isError: true)
                        }
                    }
                    if draft.count > 3 {
                        Button("移除这一章") { draft.remove(at: index) }.buttonStyle(AgentPanelButtonStyle())
                    }
                }
            }
            if draft.count < 5 {
                Button("添加一章", systemImage: "plus") { draft.append(.init()) }.buttonStyle(AgentPanelButtonStyle())
            }
            AppAdaptiveRow(spacing: 12) {
                Button("放弃编辑") { editing = false; error = nil }.buttonStyle(AgentPanelButtonStyle())
                Button("保存大纲") {
                    Task {
                        await write {
                            let saved = try await model.api.saveOutline(model.sessionID, chapters: draft, revision: revision)
                            guard model.isCurrentAccount else { return }
                            outline = saved
                            editing = false
                        }
                    }
                }.buttonStyle(AgentPanelButtonStyle(prominent: true))
                    .disabled(!valid || stale)
            }
        }.disabled(busy || loading)
    }

    private func text(_ index: Int, _ field: Field) -> Binding<String> {
        Binding(get: { draft.indices.contains(index) ? draft[index][keyPath: field.path] : "" },
                set: { if draft.indices.contains(index) { draft[index][keyPath: field.path] = $0 } })
    }

    private func edit() {
        revision = outline?.revision ?? 0
        draft = outline?.chapters ?? Array(repeating: AIAgentOutlineChapter(), count: 3)
        editing = true
    }

    private func load() async {
        guard model.isCurrentAccount else { return }
        loading = true
        error = nil
        chosen = nil
        defer { loading = false }
        do {
            let value = try await model.api.outline(model.sessionID)
            if model.isCurrentAccount, !Task.isCancelled { outline = value }
        } catch {
            if model.isCurrentAccount, !Task.isCancelled { self.error = AppCopy.friendlyError(error) }
        }
    }

    private func write(_ operation: () async throws -> Void) async {
        guard !busy, !loading, model.isCurrentAccount else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await operation() }
        catch { if model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
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

private struct AgentOutlineConversationDestination: View {
    let model: AdminAIAgentConversationModel
    let sessionID: String
    @State private var session: AIAgentSession?
    @State private var error: String?
    var body: some View {
        Group {
            if let session {
                AdminAIAgentConversationView(session: session, userID: model.userID, token: model.api.token,
                    onOpenContinuation: { self.session = $0 }).id(session.id)
            } else if let error { AgentPanelNotice(error, isError: true) }
            else { ProgressView("读取创作对话…") }
        }.task(id: sessionID) {
            do { let result = try await model.api.detail(sessionID)
                if model.isCurrentAccount, !Task.isCancelled { session = result.session }
            } catch { if model.isCurrentAccount, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
        }
    }
}
