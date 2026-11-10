import SwiftUI
import ZhiZhouCore

struct AdminAIAgentConversationView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: AdminAIAgentConversationModel
    @State private var panel = 0
    @State private var showSettings = false
    @State private var showMemory = false

    init(session: AIAgentSession, userID: String, token: String) {
        _model = State(initialValue: AdminAIAgentConversationModel(session: session, userID: userID, token: token))
    }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            context
            if model.hasLoaded {
                if panel == 0 { AgentMessagesView(model: model) { panel = 1 } }
                else { AgentArtifactsView(model: model) }
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("暂时无法读取对话", systemImage: "bubble.left.and.exclamationmark.bubble.right")
                } description: { Text(error) } actions: { Button("重试") { Task { await model.refresh() } } }
            } else {
                ProgressView("读取对话…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppTheme.canvas)
        .safeAreaInset(edge: .bottom, spacing: 12) {
            if panel == 0 && model.hasLoaded { AgentComposerView(model: model) }
        }
        .navigationTitle(model.session.title.isEmpty ? "对话创作" : model.session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("作品记忆", systemImage: "bookmark") { showMemory = true }
                    .disabled(!model.hasLoaded)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("会话设置", systemImage: "slider.horizontal.3") { showSettings = true }
                    .disabled(!model.hasLoaded)
            }
        }
        .sheet(isPresented: $showSettings) { AgentSettingsSheet(model: model) }
        .sheet(isPresented: $showMemory) { AgentMemoryView(model: model) }
        .sheet(item: $model.selectedAction) { action in AgentActionSheet(model: model, initialAction: action) }
        .task(id: scenePhase) {
            guard scenePhase == .active else { model.pause(); return }
            await model.monitor()
        }
        .onDisappear { model.pause() }
    }

    private var context: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.session.novelTitle).font(.subheadline.weight(.medium)).lineLimit(2)
                Spacer(minLength: 12)
                Text(model.session.contentPreferences.adultContentMode == "explicit" ? "成人模式" : "常规模式")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            Picker("工作区", selection: $panel) {
                Text("对话").tag(0)
                Text("产出与采纳").tag(1)
            }.pickerStyle(.segmented)
            if model.pendingMemoryCount > 0 {
                Button("作品记忆 · \(model.pendingMemoryCount) 条待确认") { showMemory = true }
                    .font(.footnote).frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }
}

private struct AgentMessagesView: View {
    let model: AdminAIAgentConversationModel
    let showArtifacts: () -> Void
    @State private var followsBottom = true
    @State private var userScrolling = false

    private var scrollMarker: String {
        "\(model.events.last?.id ?? 0):\(model.liveReply?.id ?? ""):\(model.liveReply?.progress?.updatedAt ?? 0)"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if model.hasEarlier {
                        Button {
                            followsBottom = false
                            Task { await model.loadEarlier() }
                        } label: {
                            HStack { Text("查看更早的消息"); if model.loadingEarlier { ProgressView() } }
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }.disabled(model.loadingEarlier)
                    }
                    if model.events.isEmpty {
                        ContentUnavailableView("一起把故事往下写", systemImage: "sparkles",
                            description: Text("可以聊情节、调整草稿，也可以描述你想要的封面。"))
                    }
                    ForEach(AgentMessageGroup.grouped(model.events)) { group in
                        if group.activities.isEmpty {
                            AgentMessageRow(event: group.firstEvent, model: model, showArtifacts: showArtifacts)
                        } else {
                            AgentActivityGroupView(events: group.activities) { followsBottom = false }
                        }
                    }
                    if let live = model.liveReply, let progress = live.progress {
                        VStack(alignment: .leading, spacing: 10) {
                            AgentTaskStatusView(task: live)
                            if !progress.preview.isEmpty { AgentMarkdownView(content: progress.preview) }
                            if !live.isRunning { Text("未完成的回复").font(.caption).foregroundStyle(AppTheme.textSecondary) }
                        }
                    } else if let task = model.activeTask, task.isRunning || !task.error.isEmpty {
                        AgentTaskStatusView(task: task)
                    }
                    if let error = model.loadError {
                        LoadErrorNotice(message: error, isLoading: model.isRefreshing) { Task { await model.refresh() } }
                    }
                    if !model.streamErrors.isEmpty {
                        Text("连接暂时中断，正在恢复进度；可以稍后返回继续查看。")
                            .font(.caption).foregroundStyle(AppTheme.textSecondary)
                    }
                    Color.clear.frame(height: 1).id("agent-bottom")
                }
                .padding(16).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .onScrollPhaseChange { _, phase in
                switch phase {
                case .tracking, .interacting, .decelerating: userScrolling = true
                default: userScrolling = false
                }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.visibleRect.maxY < 90
            } action: { _, atBottom in
                if userScrolling { followsBottom = atBottom }
            }
            .onChange(of: scrollMarker, initial: true) { _, _ in
                if followsBottom { proxy.scrollTo("agent-bottom", anchor: .bottom) }
            }
            .overlay(alignment: .bottomTrailing) {
                if !followsBottom {
                    Button {
                        followsBottom = true
                        proxy.scrollTo("agent-bottom", anchor: .bottom)
                    } label: {
                        Label("回到最新", systemImage: "arrow.down")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(AppTheme.primary)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("agent.scrollToLatest")
                    .padding(.trailing, 12).padding(.bottom, 4)
                }
            }
        }
    }
}

private struct AgentMessageGroup: Identifiable {
    let firstEvent: AIAgentEvent
    var activities: [AIAgentEvent]
    var id: Int64 { firstEvent.id }

    private static let readingTools: Set<String> = [
        "read_overview", "search_chapters", "read_chapter", "read_story_memory",
        "search_story", "list_novel_analyses", "read_novel_analysis",
        "list_drafts", "read_draft", "list_covers", "read_task", "read_conversation",
    ]

    static func grouped(_ events: [AIAgentEvent]) -> [Self] {
        var groups: [Self] = []
        for event in events {
            // Only successful read-only calls collapse; errors and actionable results remain visible.
            let canGroup = event.role == "activity" && event.metadata.error != true
                && event.metadata.artifactTaskId == nil && event.metadata.actionId == nil
                && readingTools.contains(event.metadata.tool ?? "")
            if canGroup, let last = groups.last, !last.activities.isEmpty,
               last.firstEvent.taskId == event.taskId {
                groups[groups.count - 1].activities.append(event)
            } else {
                groups.append(Self(firstEvent: event, activities: canGroup ? [event] : []))
            }
        }
        return groups
    }
}

private struct AgentActivityGroupView: View {
    let events: [AIAgentEvent]
    let onExpand: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if !isExpanded { onExpand() }
                withAnimation(reduceMotion ? nil : AppMotion.state) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "text.book.closed").accessibilityHidden(true)
                    Text("查阅资料").fontWeight(.medium)
                    Text("\(events.count) 次").monospacedDigit()
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .accessibilityHidden(true)
                    Spacer(minLength: 0)
                }
                .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("查阅资料，\(events.count) 次")
            .accessibilityValue(isExpanded ? "已展开" : "已折叠")
            .accessibilityHint(isExpanded ? "收起查阅明细" : "展开查看每次查阅")
            .accessibilityIdentifier("agent.activity.\(events.first?.id ?? 0)")

            if isExpanded {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(events) { event in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: "checkmark").font(.caption2).accessibilityHidden(true)
                            Text(verbatim: event.content).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                .padding(.leading, 4).padding(.top, 2).padding(.bottom, 8)
                .transition(.opacity)
            }
        }
    }
}

private struct AgentMessageRow: View {
    let event: AIAgentEvent
    let model: AdminAIAgentConversationModel
    let showArtifacts: () -> Void

    var body: some View {
        if event.role == "user" {
            HStack {
                Spacer(minLength: 28)
                Text(verbatim: event.content).textSelection(.enabled).padding(14)
                    .background(AppTheme.surfaceSecondary, in: RoundedRectangle(cornerRadius: 18))
            }
        } else if event.role == "assistant" && event.metadata.error != true {
            AgentMarkdownView(content: event.content)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: event.content).textSelection(.enabled)
                    .foregroundStyle(event.metadata.error == true ? Color.red : AppTheme.textSecondary)
                    .font(.footnote)
                if let id = event.metadata.artifactTaskId {
                    Button("查看产出", systemImage: "doc.text.magnifyingglass") {
                        Task { if await model.openArtifact(id) != nil { showArtifacts() } }
                    }.font(.footnote).frame(minHeight: 44).disabled(model.working)
                }
                if let id = event.metadata.actionId {
                    Button("查看采纳记录", systemImage: "checkmark.rectangle") { Task { await model.openAction(id) } }
                        .font(.footnote).frame(minHeight: 44).disabled(model.working)
                }
            }
        }
    }
}

private struct AgentComposerView: View {
    @Bindable var model: AdminAIAgentConversationModel
    @State private var showDiscard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.operationError { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            if let pending = model.localDraft.pending {
                pendingMessage(pending)
            }
            TextField("和创作助手聊聊…", text: $model.localDraft.input, axis: .vertical)
                .lineLimit(1...6).padding(.horizontal, 4).padding(.top, 4)
                .accessibilityIdentifier("agent.composer")
            HStack(spacing: 12) {
                modelMenu
                Spacer(minLength: 0)
                if model.replying, let taskID = model.activeTask?.id {
                    Button { Task { await model.stop(taskID) } } label: {
                        Image(systemName: "stop.fill").frame(width: 44, height: 44)
                    }.accessibilityLabel("停止回复").disabled(model.working)
                } else {
                    Button { Task { await model.send() } } label: {
                        Image(systemName: "arrow.up").font(.headline).frame(width: 44, height: 44)
                            .foregroundStyle(model.canSend ? Color.white : AppTheme.textSecondary)
                            .background(model.canSend ? AppTheme.primary : AppTheme.surfaceSecondary, in: Circle())
                    }
                    .accessibilityLabel(model.sending ? "正在发送" : "发送消息")
                    .accessibilityIdentifier("agent.send")
                    .disabled(!model.canSend)
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
            if model.localDraft.input.utf16.count > 8_000 {
                Text("消息最多 8000 字，请缩短后发送。").font(.caption).foregroundStyle(.red)
            }
        }
        .padding(12).paperCard(cornerRadius: 22)
        .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
        .padding(.horizontal, 12).padding(.bottom, 6)
        .frame(maxWidth: 820).frame(maxWidth: .infinity)
        .confirmationDialog("先核对消息是否已发送", isPresented: $showDiscard, titleVisibility: .visible) {
            Button("取回文字，结束本次重试") { model.discardPending() }
            Button("取消", role: .cancel) {}
        } message: { Text("服务器可能已接收此消息。结束重试不会停止任务，再次发送会创建新的一轮。") }
    }

    private var modelMenu: some View {
        Menu {
            Picker("文本模型", selection: $model.localDraft.providerPresetId) {
                Text("默认文本模型").tag("")
                if !model.localDraft.providerPresetId.isEmpty && !model.presets.contains(where: { $0.id == model.localDraft.providerPresetId }) {
                    Text("已保存的预设（暂不可用）").tag(model.localDraft.providerPresetId)
                }
                ForEach(model.presets) { preset in
                    Text("\(preset.name) · \(preset.model)").tag(preset.id)
                }
            }
            Button("刷新模型列表") { Task { await model.loadPresets() } }
            if let error = model.presetError { Text(error) }
        } label: {
            HStack(spacing: 5) {
                Text(model.presets.first(where: { $0.id == model.localDraft.providerPresetId })?.name
                     ?? (model.localDraft.providerPresetId.isEmpty ? "默认文本模型" : "已保存的预设"))
                    .lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2)
            }.font(.caption).frame(minHeight: 44).foregroundStyle(AppTheme.textSecondary)
        }
        .disabled(model.replying || model.sending || model.localDraft.pending != nil)
        .accessibilityLabel("切换文本模型")
    }

    private func pendingMessage(_ pending: AIAgentPendingMessage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.sending ? "正在发送…" : "上次消息尚未确认送达").font(.caption.weight(.medium))
            Text(verbatim: pending.content).font(.caption).lineLimit(2).foregroundStyle(AppTheme.textSecondary)
            if !model.sending {
                ViewThatFits(in: .horizontal) {
                    HStack { retryButton; discardButton }
                    VStack(alignment: .leading) { retryButton; discardButton }
                }
            }
        }
    }
    private var retryButton: some View {
        Button("重试原消息") { Task { await model.send(retry: true) } }.font(.caption).frame(minHeight: 44)
    }
    private var discardButton: some View {
        Button("取回文字") { showDiscard = true }.font(.caption).frame(minHeight: 44)
    }
}

struct AgentTaskStatusView: View {
    let task: AIAgentTask
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                if task.isRunning { ProgressView().controlSize(.small) }
                Text(task.step.isEmpty ? AgentDisplay.status(task.status)
                     : (task.isRunning ? task.step : "\(AgentDisplay.status(task.status)) · \(task.step)")).font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if task.isRunning && task.total > 0 {
                ProgressView(value: Double(max(0, min(task.current, task.total))), total: Double(task.total))
                    .tint(AppTheme.primary)
            }
            if let progress = task.progress, task.isRunning {
                Text(progress.phase == "thinking" ? "正在构思…" : "已输出 \(progress.generatedCharacters) 字")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            if !task.error.isEmpty { Text(verbatim: task.error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
        }
    }
}

enum AgentDisplay {
    static func status(_ value: String) -> String {
        ["queued": "等待处理", "running": "正在处理", "completed": "已完成", "failed": "处理失败",
         "cancelled": "已停止", "pending": "待确认", "executing": "正在执行", "rejected": "已放弃"][value] ?? value
    }
    static func kind(_ value: String) -> String {
        ["continue": "续写草稿", "write_chapter": "章节草稿", "write_outline": "章节大纲", "cover": "封面候选",
         "rewrite_selection": "改写建议", "analyze_plot": "情节档案", "analyze_relationships": "关系档案",
         "novel_analysis": "小说分析报告", "agent_chat": "助手回复"][value] ?? "创作任务"
    }
}
