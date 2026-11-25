import SwiftUI
import ZhiZhouCore

struct AgentWritingReferencesView: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @State private var references: [AIAgentWritingReference] = []
    @State private var selected: [AIAgentWritingReference] = []
    @State private var persistent = false
    @State private var query = ""
    @State private var hasMore = false
    @State private var loading = false
    @State private var busy = false
    @State private var initialized = false
    @State private var error: String?
    @State private var requestID = UUID()
    @State private var editing: ReferenceDraft?
    @State private var removing: AIAgentWritingReference?
    private var blocked: Bool { busy || loading || !model.canChangeChapterPlan }
    private var characters: Int { selected.reduce(0) { $0 + ($1.title + $1.content + $1.usage + $1.tags.joined(separator: " ")).utf16.count } }

    var body: some View {
        NavigationStack {
            AgentPanelPage {
                AgentPanelHeading("写作参考", detail: "个人参考库可跨作品使用。本轮最多选择 6 份、合计 24000 字；发送时读取最新版本，已提交任务保留原快照。")
                if let error { AgentPanelNotice(error, isError: true) }
                if !model.canChangeChapterPlan { AgentPanelNotice("请先等待回复完成，或核对待重试消息。") }
                if !selected.isEmpty {
                    AgentPanelSection("已选参考", count: selected.count) {
                        ForEach(selected) { item in
                            HStack {
                                Text(item.title).frame(maxWidth: .infinity, alignment: .leading)
                                Button("取消选择") { selected.removeAll { $0.id == item.id } }.disabled(blocked)
                            }.frame(minHeight: 44)
                        }
                    }
                }
                Toggle("持续用于当前对话", isOn: $persistent).tint(AppTheme.primary).disabled(blocked)
                AgentPanelNotice(persistent ? "下一次发送时保存这组选项。清空后发送，可停止后续轮次使用。" : "只覆盖下一轮参考；之后恢复本对话已保存的默认选择。")
                Text("已选 \(selected.count)/6 · \(characters)/24000 字").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                if characters > 24000 { AgentPanelNotice("参考内容超过本轮容量，请减少选择。", isError: true) }
                Button("使用选中参考") {
                    model.selectReferences(selected, scope: persistent ? "session" : "turn")
                    dismiss()
                }.buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(blocked || characters > 24000)
                AgentPanelField("搜索参考") { TextField("名称、标签或正文", text: $query).submitLabel(.search) }
                AppAdaptiveRow(spacing: 12) {
                    Button("新建参考", systemImage: "plus") { editing = ReferenceDraft() }.disabled(blocked)
                    Button("重新读取") { Task { await load() } }.disabled(loading || busy)
                }.buttonStyle(AgentPanelButtonStyle())
                if loading { ProgressView("读取参考库…") }
                ForEach(Array(references.enumerated()), id: \.element.id) { index, item in
                    AgentPanelSection(item.title) {
                        if !item.tags.isEmpty { Text(item.tags.joined(separator: " · ")).font(.caption).foregroundStyle(ReadingSpace.profileMuted) }
                        DisclosureGroup("参考正文与使用说明") {
                            Text(verbatim: item.content).textSelection(.enabled).lineSpacing(6).padding(.top, 12)
                            if !item.usage.isEmpty { AgentPanelFact(title: "使用说明", value: item.usage) }
                        }
                        Toggle("用于写作", isOn: Binding(get: { selected.contains { $0.id == item.id } }, set: { value in
                            if value { selected.append(item) } else { selected.removeAll { $0.id == item.id } }
                        })).tint(AppTheme.primary).frame(minHeight: 44)
                            .disabled(blocked || (!selected.contains { $0.id == item.id } && selected.count >= 6))
                        AppAdaptiveRow(spacing: 12) {
                            Button("编辑") { editing = ReferenceDraft(item) }
                            Button("移除", role: .destructive) { removing = item }
                        }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked)
                    }.readingSpaceEntrance(index)
                }
                if !loading && references.isEmpty { AgentPanelNotice(query.isEmpty ? "还没有写作参考，可以先保存一段自己的创作材料。" : "没有匹配的参考。") }
                if hasMore { Button("加载更多") { Task { await load(more: true) } }.buttonStyle(AgentPanelButtonStyle()).disabled(loading || busy) }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() }.disabled(busy) } }
            .task(id: query) {
                if !initialized { selected = model.selectedReferences; persistent = model.referenceSelection?.scope == "session"; initialized = true }
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                await load()
            }
            .sheet(item: $editing) { draft in
                AgentWritingReferenceEditor(model: model, original: draft) { reference in
                    if let index = selected.firstIndex(where: { $0.id == reference.id }) { selected[index] = reference }
                    Task { await load() }
                }
            }
            .confirmationDialog("移除这份写作参考？", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { item in
                Button("移除「\(item.title)」", role: .destructive) { Task { await remove(item) } }
                Button("取消", role: .cancel) {}
            } message: { _ in Text("已提交任务中的参考快照仍然保留。") }
            .interactiveDismissDisabled(busy)
        }
    }
    @MainActor private func load(more: Bool = false) async {
        guard model.isCurrentAccount else { return }
        let request = UUID(); requestID = request; loading = true; error = nil
        defer { if requestID == request { loading = false } }
        let term = query
        do {
            let page = try await model.api.writingReferences(query: term, offset: more ? references.count : 0)
            guard model.isCurrentAccount, requestID == request, query == term, !Task.isCancelled else { return }
            references = more ? references + page.references.filter { item in !references.contains { $0.id == item.id } } : page.references
            hasMore = page.hasMore
            selected = selected.map { old in page.references.first { $0.id == old.id } ?? old }
        } catch { if model.isCurrentAccount, requestID == request, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
    @MainActor private func remove(_ item: AIAgentWritingReference) async {
        guard !blocked else { return }; busy = true; defer { busy = false }
        do {
            try await model.api.removeWritingReference(item)
            guard model.isCurrentAccount else { return }
            selected.removeAll { $0.id == item.id }; await load()
        } catch { if model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
    }
}

private struct ReferenceDraft: Identifiable {
    let id = UUID()
    var referenceID: String?
    var revision: Int?
    var title = ""
    var tags = ""
    var content = ""
    var usage = ""
    init() {}
    init(_ reference: AIAgentWritingReference) {
        referenceID = reference.id; revision = reference.revision; title = reference.title
        tags = reference.tags.joined(separator: "、"); content = reference.content; usage = reference.usage
    }
    var tagList: [String] { Array(Set(tags.components(separatedBy: CharacterSet(charactersIn: "、,，\n")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted() }
    var valid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.utf16.count <= 100
            && !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.utf16.count <= 8000
            && usage.utf16.count <= 1000 && tagList.count <= 12 && tagList.allSatisfy { $0.utf16.count <= 32 }
    }
}
private struct AgentWritingReferenceEditor: View {
    let model: AdminAIAgentConversationModel
    let original: ReferenceDraft
    let onSaved: (AIAgentWritingReference) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ReferenceDraft()
    @State private var busy = false
    @State private var error: String?
    @State private var discard = false
    @State private var initialized = false
    var body: some View {
        NavigationStack {
            AgentPanelPage {
                AgentPanelHeading(original.referenceID == nil ? "新建写作参考" : "编辑写作参考")
                if let error { AgentPanelNotice(error + " 编辑内容仍保留；版本冲突时可放弃编辑后重新读取核对。", isError: true) }
                AgentPanelField("名称 · 最多 100 字") { TextField("参考名称", text: $draft.title) }
                AgentPanelField("标签 · 最多 12 个，每个 32 字") { TextField("以顿号分隔", text: $draft.tags) }
                AgentPanelField("参考正文 · 最多 8000 字") { TextField("写下可复用的材料", text: $draft.content, axis: .vertical).lineLimit(6...18) }
                AgentPanelField("使用说明 · 最多 1000 字") { TextField("说明想借鉴的方面", text: $draft.usage, axis: .vertical).lineLimit(3...6) }
                Button("保存参考") { Task { await save() } }.buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(!draft.valid || busy || !model.canChangeChapterPlan)
            }.disabled(busy)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { discard = true }.disabled(busy) } }
            .onAppear { if !initialized { draft = original; initialized = true } }
            .interactiveDismissDisabled()
            .confirmationDialog("放弃未保存的编辑？", isPresented: $discard, titleVisibility: .visible) {
                Button("放弃编辑", role: .destructive) { dismiss() }; Button("继续编辑", role: .cancel) {}
            }
        }
    }
    @MainActor private func save() async {
        guard draft.valid, !busy, model.canChangeChapterPlan else { return }
        busy = true; defer { busy = false }; error = nil
        do {
            let reference = try await model.api.saveWritingReference(id: draft.referenceID, title: draft.title, tags: draft.tagList, content: draft.content, usage: draft.usage, revision: draft.revision)
            guard model.isCurrentAccount else { return }; onSaved(reference); dismiss()
        } catch { if model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
    }
}
