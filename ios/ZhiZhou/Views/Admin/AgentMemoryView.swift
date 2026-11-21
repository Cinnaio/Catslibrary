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
    @State private var loadingMore = false
    @State private var busy = false
    @State private var visible = false
    @State private var error: String?
    @State private var editing: MemoryDraft?
    @State private var sources: [String: String] = [:]
    @State private var requestID = UUID()

    private var blocked: Bool { busy || loading || model.replying || model.sending || model.working || !model.isCurrentAccount }
    private var current: [AIAgentMemory] { memories.filter(\.canEdit) }
    private var pending: [AIAgentMemory] { current.filter { $0.status == "pending" } }
    private var active: [AIAgentMemory] { current.filter { $0.status == "active" } }
    private var history: [AIAgentMemory] { memories.filter { !$0.canEdit } }

    var body: some View {
        NavigationStack {
            AgentPanelPage {
                AgentPanelHeading("作品记忆", detail: "同一账号、同一本书的对话共用，确认后从下一轮回复开始使用。")
                if model.replying { AgentPanelNotice("请等待或停止回复后再调整记忆。") }
                if !loaded && loading {
                    ProgressView("读取记忆…").frame(maxWidth: .infinity, minHeight: 100)
                }
                if busy { ProgressView("正在更新记忆…").font(.footnote) }
                if let error { AgentPanelNotice(error, isError: true) }
                if loaded && current.isEmpty {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("把重要的约定留在这里")
                            .font(serifFont(.title3, .medium)).foregroundStyle(ReadingSpace.ink)
                        Text("可以手动添加，也可以在聊天中明确提出“请记住”。")
                            .font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
                        Button("添加第一条约定", systemImage: "plus") { editing = MemoryDraft(memory: nil) }
                            .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(blocked)
                    }
                    .padding(20)
                    .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 20))
                }
                if !pending.isEmpty {
                    AgentPanelSection("待确认", count: pending.count) {
                        ForEach(Array(pending.enumerated()), id: \.element.id) { index, memory in
                            memoryRow(memory)
                                .padding(18)
                                .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 20))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 20)
                                        .strokeBorder(ReadingSpace.profileLine, lineWidth: 1)
                                        .allowsHitTesting(false)
                                }
                                .readingSpaceEntrance(index)
                        }
                    }
                }
                if !active.isEmpty {
                    AgentPanelSection("已生效", count: active.count) {
                        ForEach(Array(active.enumerated()), id: \.element.id) { index, memory in
                            memoryRow(memory).readingSpaceEntrance(index)
                            if index < active.count - 1 { Divider().overlay(ReadingSpace.profileLine) }
                        }
                    }
                }
                if !history.isEmpty || hasMore {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 20) {
                            ForEach(history) { memory in
                                memoryRow(memory)
                                Divider().overlay(ReadingSpace.profileLine)
                            }
                            if hasMore {
                                Button {
                                    Task {
                                        loadingMore = true
                                        defer { loadingMore = false }
                                        await load(more: true)
                                    }
                                } label: {
                                    HStack { Text("加载更多历史"); if loadingMore { ProgressView() } }
                                }
                                .buttonStyle(AgentPanelButtonStyle()).disabled(loading || busy)
                            }
                        }
                        .padding(.top, 16)
                    } label: {
                        Text("历史约定 · \(history.count)").font(.subheadline.weight(.medium)).frame(minHeight: 44)
                    }
                }
                summarySection
                DisclosureGroup {
                    AgentPanelNotice("最多保留 24 条生效约定和 24 条待确认提议。移除后不再作为长期约定使用，历史记录仍保留。小说分析报告与会话设置单独管理。")
                        .padding(.top, 10)
                } label: {
                    Text("记忆如何生效").font(.subheadline).frame(minHeight: 44)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await load() } } label: {
                        if loading { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                    }
                    .accessibilityLabel("刷新作品记忆").disabled(loading || busy)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("添加约定", systemImage: "plus") { editing = MemoryDraft(memory: nil) }
                        .labelStyle(.iconOnly).disabled(blocked || !loaded)
                }
            }
            .refreshable { if !busy { await load() } }
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

    private var summarySection: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 18) {
                if let summary {
                    AgentPanelNotice("早前消息的自动整理，可能有遗漏；仅用于这次对话，原始消息仍保留。")
                    if !summary.content.goal.isEmpty { AgentPanelFact(title: "当前目标", value: summary.content.goal) }
                    summaryRows("已选方案", summary.content.decisions)
                    summaryRows("已否定方案", summary.content.rejected)
                    summaryRows("待确认问题", summary.content.openQuestions)
                    summaryRows("接下来", summary.content.nextSteps)
                    summaryRows("来源与产出", summary.content.references)
                } else {
                    Text(loaded ? "对话较短时直接使用原始消息，尚未生成摘要。" : "读取成功后可查看摘要。")
                        .font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .padding(.top, 14)
        } label: {
            Text("本次对话摘要").font(.subheadline.weight(.medium)).frame(minHeight: 44)
        }
    }

    @ViewBuilder private func summaryRows(_ title: String, _ items: [String]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.caption.weight(.medium)).foregroundStyle(ReadingSpace.profileMuted)
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    Text(item).font(.subheadline).textSelection(.enabled).lineSpacing(4)
                }
            }
        }
    }

    private func memoryRow(_ memory: AIAgentMemory) -> some View {
        let target = memories.first { $0.id == memory.supersedesId }
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(memory.statusLabel).font(.caption)
                        .foregroundStyle(memory.status == "pending" ? AppTheme.primary : ReadingSpace.profileMuted)
                    Text(memory.title).font(serifFont(.title3, .medium))
                        .foregroundStyle(ReadingSpace.ink).accessibilityAddTraits(.isHeader)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if memory.canEdit {
                    Menu {
                        Button("编辑", systemImage: "pencil") { editing = MemoryDraft(memory: memory) }
                        Button(memory.status == "pending" ? "放弃提议" : "移除约定", systemImage: "archivebox", role: .destructive) {
                            Task { await change(memory, operation: "archive") }
                        }
                    } label: {
                        Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("管理约定：\(memory.title)").disabled(blocked)
                }
            }
            Text(memory.content).foregroundStyle(ReadingSpace.ink).lineSpacing(5).textSelection(.enabled)
            if memory.status == "pending", memory.supersedesId != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("确认后将替换：\(target?.title ?? "旧约定")").font(.subheadline.weight(.medium))
                    if let target { Text(target.content).font(.subheadline).foregroundStyle(ReadingSpace.profileMuted).textSelection(.enabled) }
                    if target?.status != "active" { AgentPanelNotice("旧约定已变化，请放弃这条提议后重新提出。") }
                }
                .padding(14).background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 14))
            }
            if memory.status == "pending" {
                Button(memory.supersedesId == nil ? "确认记住" : "确认替换") { Task { await change(memory, operation: "confirm") } }
                    .buttonStyle(AgentPanelButtonStyle(prominent: true))
                    .disabled(blocked || (memory.supersedesId != nil && target?.status != "active"))
            }
            if memory.sourceEventId != nil {
                Button("查看来源", systemImage: "text.bubble") { Task { await source(memory) } }
                    .font(.footnote).frame(minHeight: 44).disabled(loading || busy)
            } else {
                Text(memory.sessionId.isEmpty ? "来源会话已移除" : "手动保存")
                    .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            }
            if let text = sources[memory.id] {
                AgentPlainPreview(title: "来源消息", text: text)
            }
        }
        .padding(.vertical, 4)
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
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case title, content }

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
            AgentPanelPage {
                AgentPanelHeading(draft.memory == nil ? "添加约定" : "编辑约定",
                                  detail: draft.memory?.status == "pending" ? "保存后仍是待确认提议，确认后才会生效。" : "写下希望后续对话持续遵循的具体约定。")
                VStack(alignment: .leading, spacing: 10) {
                    AgentPanelField("记忆标题", isFocused: focusedField == .title) {
                        TextField("给这条约定起个名字", text: $title, axis: .vertical)
                            .lineLimit(1...3).focused($focusedField, equals: .title).accessibilityLabel("记忆标题")
                    }
                    Text("\(title.unicodeScalars.count) / 100")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(title.unicodeScalars.count > 100 ? Color.red : ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                VStack(alignment: .leading, spacing: 10) {
                    AgentPanelField("记忆内容", isFocused: focusedField == .content) {
                        TextField("希望后续对话遵循的具体约定", text: $content, axis: .vertical)
                            .lineLimit(6...16).focused($focusedField, equals: .content).accessibilityLabel("记忆内容")
                    }
                    Text("\(content.unicodeScalars.count) / 1000")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(content.unicodeScalars.count > 1000 ? Color.red : ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if let error { AgentPanelNotice(error, isError: true) }
            }
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard !saving else { return }
                        focusedField = nil
                        saving = true
                        Task {
                            defer { saving = false }
                            do { try await save(title, content); dismiss() }
                            catch { self.error = AppCopy.friendlyError(error) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(draft.memory?.status == "pending" ? "保存提议" : "保存并记住")
                            if saving { ProgressView() }
                        }
                    }
                    .disabled(saving || disabled || !valid)
                }
            }
        }
        .interactiveDismissDisabled(saving)
    }
}
