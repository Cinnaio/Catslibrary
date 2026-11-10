import SwiftUI
import ZhiZhouCore

struct AgentMemoryView: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @State private var memories: [AIAgentMemory] = []
    @State private var summary: AIAgentSummary?
    @State private var hasMore = false
    @State private var loaded = false
    @State private var loading = false
    @State private var busy = false
    @State private var visible = false
    @State private var error: String?
    @State private var editing: MemoryDraft?
    @State private var sources: [String: String] = [:]
    @State private var requestID = UUID()

    private var blocked: Bool { busy || loading || model.replying || model.sending || model.working || !model.isCurrentAccount }
    private var current: [AIAgentMemory] { memories.filter(\.canEdit) }
    private var history: [AIAgentMemory] { memories.filter { !$0.canEdit } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("同一账号、同一本书的对话共用这些约定；确认后从下一轮回复开始使用。")
                    Text("最多保留 24 条生效约定和 24 条待确认提议。移除后不再作为长期约定使用，历史记录仍保留。小说分析报告与会话设置单独管理。")
                        .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                    Button("添加约定", systemImage: "plus") { editing = MemoryDraft(memory: nil) }.disabled(blocked || !loaded)
                    Button("刷新") { Task { await load() } }.disabled(loading || busy)
                    if model.replying { Text("请等待或停止回复后再调整记忆。").font(.footnote) }
                    if loading { ProgressView("读取记忆…") }
                    if let error { Text(error).foregroundStyle(.red) }
                }
                if loaded && current.isEmpty {
                    Section { Text("还没有作品记忆。可以手动添加，也可以在聊天中明确提出“请记住”。").foregroundStyle(AppTheme.textSecondary) }
                }
                ForEach(current) { memory in Section { memoryRow(memory) } }
                if !history.isEmpty {
                    Section {
                        DisclosureGroup("历史约定 · \(history.count)") {
                            ForEach(history) { memory in memoryRow(memory) }
                        }
                    }
                }
                if hasMore { Section { Button("加载更多历史") { Task { await load(more: true) } }.disabled(loading || busy) } }
                Section {
                    DisclosureGroup("本次对话摘要") {
                        if let summary {
                            Text("早前消息的自动整理，可能有遗漏；仅用于这次对话，原始消息仍保留。")
                                .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                            Text(summary.content.goal)
                            summaryRows("已选方案", summary.content.decisions)
                            summaryRows("已否定方案", summary.content.rejected)
                            summaryRows("待确认问题", summary.content.openQuestions)
                            summaryRows("接下来", summary.content.nextSteps)
                            summaryRows("来源与产出", summary.content.references)
                        } else {
                            Text(loaded ? "对话较短时直接使用原始消息，尚未生成摘要。" : "读取成功后可查看摘要。")
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            .appListStyle(.settings)
            .navigationTitle("作品记忆")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(busy) } }
            .task { visible = true; await load() }
            .onDisappear { visible = false; requestID = UUID(); loading = false }
            .sheet(item: $editing) { draft in
                AgentMemoryEditor(draft: draft, disabled: blocked) { title, content in
                    try await save(draft.memory, title: title, content: content)
                }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    @ViewBuilder private func summaryRows(_ title: String, _ items: [String]) -> some View {
        if !items.isEmpty {
            Text(title).font(.subheadline.weight(.semibold))
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in Text(item).textSelection(.enabled) }
        }
    }

    private func memoryRow(_ memory: AIAgentMemory) -> some View {
        let target = memories.first { $0.id == memory.supersedesId }
        return VStack(alignment: .leading, spacing: 12) {
            Text(memory.title).font(.headline)
            Text(memory.statusLabel).font(.caption).foregroundStyle(AppTheme.textSecondary)
            Text(memory.content).textSelection(.enabled)
            if memory.status == "pending", memory.supersedesId != nil {
                Text("确认后将替换：\(target?.title ?? "旧约定")").font(.subheadline.weight(.medium))
                if let target { Text(target.content).foregroundStyle(AppTheme.textSecondary) }
                if target?.status != "active" { Text("旧约定已变化，请放弃这条提议后重新提出。").font(.footnote) }
            }
            if memory.status == "pending" {
                Button(memory.supersedesId == nil ? "确认记住" : "确认替换") { Task { await change(memory, operation: "confirm") } }
                    .disabled(blocked || (memory.supersedesId != nil && target?.status != "active"))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            if memory.canEdit {
                Button("编辑") { editing = MemoryDraft(memory: memory) }.disabled(blocked).frame(minHeight: 44).contentShape(Rectangle())
                Button(memory.status == "pending" ? "放弃" : "移除", role: .destructive) { Task { await change(memory, operation: "archive") } }.disabled(blocked).frame(minHeight: 44).contentShape(Rectangle())
            }
            if memory.sourceEventId != nil {
                Button("查看来源") { Task { await source(memory) } }.disabled(loading || busy).frame(minHeight: 44).contentShape(Rectangle())
            } else { Text(memory.sessionId.isEmpty ? "来源会话已移除" : "手动保存").font(.caption).foregroundStyle(AppTheme.textSecondary) }
            if let text = sources[memory.id] { Text(text).font(.callout).foregroundStyle(AppTheme.textSecondary).textSelection(.enabled) }
        }
        .buttonStyle(.borderless)
        .padding(.vertical, 8)
    }

    private func load(more: Bool = false) async {
        guard model.isCurrentAccount, visible, !loading else { return }
        let request = UUID()
        requestID = request
        loading = true
        defer { if requestID == request { loading = false } }
        do {
            let value = try await model.api.memories(model.sessionID, offset: more ? memories.count : 0)
            guard visible, model.isCurrentAccount, !Task.isCancelled, requestID == request else { return }
            let oldIDs = Set(memories.map(\.id))
            memories = more ? memories + value.memories.filter { !oldIDs.contains($0.id) } : value.memories
            summary = value.summary
            hasMore = value.hasMore
            loaded = true
            model.pendingMemoryCount = memories.filter { $0.status == "pending" }.count
            error = nil
        } catch {
            guard visible, model.isCurrentAccount, !Task.isCancelled, requestID == request else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func change(_ memory: AIAgentMemory, operation: String) async {
        guard !blocked, visible else { return }
        busy = true
        model.working = true
        defer { busy = false; model.working = false }
        do {
            _ = try await model.api.changeMemory(model.sessionID, memory: memory, operation: operation)
            guard visible, model.isCurrentAccount else { return }
            await load()
        } catch { if visible && model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
    }

    private func save(_ memory: AIAgentMemory?, title: String, content: String) async throws {
        guard !blocked, visible else { throw CancellationError() }
        busy = true
        model.working = true
        defer { busy = false; model.working = false }
        if let memory { _ = try await model.api.changeMemory(model.sessionID, memory: memory, operation: "edit", title: title, content: content) }
        else { _ = try await model.api.createMemory(model.sessionID, title: title, content: content) }
        guard visible, model.isCurrentAccount else { throw CancellationError() }
        await load()
    }

    private func source(_ memory: AIAgentMemory) async {
        guard !loading, !busy, visible, model.isCurrentAccount else { return }
        loading = true
        defer { loading = false }
        do {
            let value = try await model.api.memorySource(model.sessionID, memoryID: memory.id)
            guard visible, model.isCurrentAccount else { return }
            sources[memory.id] = value?.content ?? "来源消息已不可用"
        } catch { if visible && model.isCurrentAccount { self.error = AppCopy.friendlyError(error) } }
    }
}

private struct MemoryDraft: Identifiable {
    let id = UUID()
    let memory: AIAgentMemory?
}

private struct AgentMemoryEditor: View {
    let draft: MemoryDraft
    let disabled: Bool
    let save: (String, String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var content: String
    @State private var saving = false
    @State private var error: String?

    init(draft: MemoryDraft, disabled: Bool, save: @escaping (String, String) async throws -> Void) {
        self.draft = draft
        self.disabled = disabled
        self.save = save
        _title = State(initialValue: draft.memory?.title ?? "")
        _content = State(initialValue: draft.memory?.content ?? "")
    }
    private var valid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.unicodeScalars.count <= 100
            && !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.unicodeScalars.count <= 1000
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("记忆标题") { TextField("最多 100 字", text: $title) }
                Section("记忆内容") {
                    TextField("希望后续对话遵循的具体约定", text: $content, axis: .vertical).lineLimit(5...16)
                    Text("\(content.unicodeScalars.count) / 1000").font(.caption).foregroundStyle(AppTheme.textSecondary)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .disabled(saving)
            .appListStyle(.settings)
            .navigationTitle(draft.memory == nil ? "添加约定" : "编辑约定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(draft.memory?.status == "pending" ? "保存提议" : "保存并记住") {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            do { try await save(title, content); dismiss() }
                            catch { self.error = AppCopy.friendlyError(error) }
                        }
                    }.disabled(saving || disabled || !valid)
                }
            }
        }
        .interactiveDismissDisabled(saving)
    }
}
