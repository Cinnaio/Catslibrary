import SwiftUI
import ZhiZhouCore

struct AdminAIAgentConversationView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: AdminAIAgentConversationModel
    @State private var panel: Panel?

    private enum Panel: Identifiable {
        case outputs, artifact(String), settings, memory
        var id: String {
            switch self {
            case .outputs: "outputs"
            case .artifact(let id): "artifact:\(id)"
            case .settings: "settings"
            case .memory: "memory"
            }
        }
    }

    init(session: AIAgentSession, userID: String, token: String) {
        _model = State(initialValue: AdminAIAgentConversationModel(session: session, userID: userID, token: token))
    }

    var body: some View {
        VStack(spacing: 0) {
            context
            if model.hasLoaded {
                AgentMessagesView(model: model, readingOverlay: panel != nil || model.selectedAction != nil,
                                  showArtifact: { panel = .artifact($0) }, showOutputs: { panel = .outputs })
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("暂时无法读取对话", systemImage: "bubble.left.and.exclamationmark.bubble.right")
                } description: { Text(error) } actions: { Button("重试") { Task { await model.refresh() } } }
            } else {
                ProgressView("读取对话…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppTheme.canvas)
        .navigationTitle(model.session.title.isEmpty ? "对话创作" : model.session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { panel = .outputs } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                        if model.pendingActionCount > 0 {
                            Text(model.pendingActionCount, format: .number).font(.caption.weight(.semibold))
                        }
                    }
                }
                .accessibilityLabel("产出与采纳")
                .accessibilityValue(model.pendingActionCount > 0 ? "\(model.pendingActionCount) 项待确认" : "无待确认操作")
                .disabled(!model.hasLoaded)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("更多", systemImage: "ellipsis") {
                    Button("作品记忆", systemImage: "bookmark") { panel = .memory }
                    Button("会话设置", systemImage: "slider.horizontal.3") { panel = .settings }
                }
                .disabled(!model.hasLoaded)
            }
        }
        .sheet(item: $panel) { panel in
            switch panel {
            case .outputs: AgentOutputSheet(model: model)
            case .artifact(let id): AgentOutputSheet(model: model, artifactID: id)
            case .settings: AgentSettingsSheet(model: model)
            case .memory: AgentMemoryView(model: model)
            }
        }
        .sheet(item: Binding(get: { panel == nil ? model.selectedAction : nil },
                             set: { if panel == nil { model.selectedAction = $0 } })) { action in
            AgentActionSheet(model: model, initialAction: action)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { model.pause(); return }
            await model.monitor()
        }
        .onDisappear { model.pause() }
    }

    private var context: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.session.novelTitle).font(.subheadline.weight(.medium))
            Text(contextSummary).font(.caption).foregroundStyle(AppTheme.textSecondary)
            if model.pendingMemoryCount > 0 {
                Button("作品记忆 · \(model.pendingMemoryCount) 条待确认") { panel = .memory }
                    .font(.footnote).frame(minHeight: 44)
            }
        }
        .frame(maxWidth: 820, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(maxWidth: .infinity)
    }

    private var contextSummary: String {
        let session = model.session
        let origin = session.anchorTitle.isEmpty
            ? (session.afterChapterId.isEmpty ? "从头创作" : "续写起点：原章节不可用")
            : "续写起点：\(session.anchorTitle)"
        return session.contentPreferences.adultContentMode == "explicit" ? origin + " · 成人模式" : origin
    }
}

private struct AgentMessagesView: View {
    let model: AdminAIAgentConversationModel
    let readingOverlay: Bool
    let showArtifact: (String) -> Void
    let showOutputs: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var followsBottom = true
    @State private var scrollPhase: ScrollPhase = .idle
    @State private var recoveryOffer: AIAgentRecovery?

    private var usesSolidBar: Bool { reduceTransparency || contrast == .increased }

    private var scrollMarker: String {
        "\(model.events.last?.id ?? 0):\(model.activeTask?.id ?? ""):\(model.activeTask?.status ?? ""):\(model.activeTask?.step ?? ""):\(model.liveReply?.progress?.updatedAt ?? 0):\(model.interruptedReply?.taskId ?? ""):\(!model.streamErrors.isEmpty)"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView { transcript }
            .scrollDismissesKeyboard(.interactively)
            .onScrollPhaseChange { previous, phase in
                scrollPhase = phase
                if previous == .animating && phase == .idle && followsBottom && !readingOverlay {
                    proxy.scrollTo("agent-bottom", anchor: .bottom)
                }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.visibleRect.maxY < 90
            } action: { _, atBottom in
                guard !readingOverlay else { return }
                switch scrollPhase {
                case .tracking, .interacting, .decelerating: followsBottom = atBottom
                default: break
                }
            }
            .onChange(of: scrollMarker, initial: true) { old, new in
                if readingOverlay {
                    if old != new { followsBottom = false }
                } else if followsBottom && scrollPhase == .idle {
                    proxy.scrollTo("agent-bottom", anchor: .bottom)
                }
            }
            .scrollEdgeEffectStyle(.soft, for: .bottom)
            .scrollEdgeEffectHidden(usesSolidBar, for: .bottom)
            .safeAreaBar(edge: .bottom, spacing: 0) { composerBar(proxy) }
        }
        .confirmationDialog("继续整理回复？", isPresented: Binding(get: { recoveryOffer != nil }, set: {
            if !$0 { recoveryOffer = nil }
        }), titleVisibility: .visible, presenting: recoveryOffer) { offer in
            Button("确认继续整理") { Task { await model.resume(offer) } }
            Button("取消", role: .cancel) {}
        } message: { _ in
            Text("会再次调用文本模型，仅查阅和答复。已有草稿、封面和采纳预览会保留，不会重新生成。")
        }
    }

    private var transcript: some View {
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
                    AgentMessageRow(event: group.firstEvent, model: model, showArtifact: showArtifact,
                                    pauseFollowing: { followsBottom = false })
                } else {
                    AgentActivityGroupView(events: group.activities) { followsBottom = false }
                }
            }
            replyStatus
            if let offer = model.interruptedReply { recoveryRow(offer) }
            if let error = model.loadError {
                LoadErrorNotice(message: error, isLoading: model.isRefreshing) { Task { await model.refresh() } }
            }
            if !model.streamErrors.isEmpty {
                Text("实时进度暂时断开，正在重新连接。离开对话不会停止任务。")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            Color.clear.frame(height: 1).id("agent-bottom")
        }
        .padding(16).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
    }

    @ViewBuilder private var replyStatus: some View {
        if let live = model.liveReply, let progress = live.progress {
            VStack(alignment: .leading, spacing: 10) {
                AgentTaskStatusView(task: live, showsDetailedProgress: false)
                if !progress.preview.isEmpty { AgentMarkdownView(content: progress.preview) }
                if !live.isRunning { Text("未完成的回复").font(.caption).foregroundStyle(AppTheme.textSecondary) }
            }
        } else if let task = model.activeTask, task.isRunning || task.status == "failed" || task.status == "cancelled" {
            AgentTaskStatusView(task: task, showsDetailedProgress: false)
        } else if model.replying {
            ProgressView("正在读取回复状态…").font(.footnote)
        }
    }

    private func recoveryRow(_ offer: AIAgentRecovery) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(AgentDisplay.recoveryPhase(offer.phase)).font(.footnote.weight(.semibold))
            Text(offer.message).font(.footnote).foregroundStyle(AppTheme.textSecondary)
            if !model.artifacts.isEmpty || !model.actions.isEmpty {
                Button("查看已有产出", systemImage: "doc.on.doc", action: showOutputs)
                    .font(.footnote).frame(minHeight: 44)
            }
            if offer.canResume {
                Button("继续整理回复", systemImage: "arrow.clockwise") { recoveryOffer = offer }
                    .font(.footnote).frame(minHeight: 44)
                    .disabled(model.working || model.sending || model.localDraft.pending != nil)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func composerBar(_ proxy: ScrollViewProxy) -> some View {
        VStack(spacing: 6) {
            if !followsBottom {
                Button {
                    followsBottom = true
                    withAnimation(reduceMotion ? nil : AppMotion.structural) {
                        proxy.scrollTo("agent-bottom", anchor: .bottom)
                    }
                } label: {
                    Label("回到最新", systemImage: "arrow.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                        .padding(.horizontal, 14)
                }
                .buttonStyle(AppGlassButtonStyle(glass: AppTheme.glass, fallback: AppTheme.surface))
                .accessibilityIdentifier("agent.scrollToLatest")
                .transition(reduceMotion ? .identity : .offset(y: 8).combined(with: .opacity))
            }
            AgentComposerView(model: model)
        }
        .padding(.top, 8)
        .frame(maxWidth: .infinity)
        .background {
            if usesSolidBar { AppTheme.canvas.ignoresSafeArea(.container, edges: .bottom) }
        }
        .animation(reduceMotion ? nil : AppMotion.panel, value: followsBottom)
    }
}

private struct AgentMessageGroup: Identifiable {
    let firstEvent: AIAgentEvent
    var activities: [AIAgentEvent]
    var id: Int64 { firstEvent.id }

    private static let readingTools: Set<String> = [
        "read_overview", "search_chapters", "read_chapter", "read_story_memory",
        "search_story", "list_novel_analyses", "read_novel_analysis",
        "list_drafts", "read_draft", "list_covers", "read_task", "read_conversation", "read_conversation_sources",
    ]

    static func grouped(_ events: [AIAgentEvent]) -> [Self] {
        var groups: [Self] = []
        for event in events {
            // Only successful read-only calls collapse; errors and actionable results remain visible.
            let canGroup = event.role == "activity" && event.metadata.error != true
                && event.metadata.artifactTaskId == nil && event.metadata.actionId == nil && event.metadata.memoryId == nil
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
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: event.content).textSelection(.enabled)
                                if let sources = event.metadata.sources, !sources.isEmpty {
                                    AgentEvidenceView(sources: sources, onExpand: onExpand)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if !events.contains(where: { $0.metadata.sources?.isEmpty == false }) {
                        Text("这组查阅没有已保存的依据片段。").font(.caption)
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
    let showArtifact: (String) -> Void
    let pauseFollowing: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            message
            if let sources = event.metadata.sources, !sources.isEmpty {
                AgentEvidenceView(sources: sources, onExpand: pauseFollowing)
            }
        }
    }

    @ViewBuilder private var message: some View {
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
                    artifactLink(id)
                }
                if let id = event.metadata.actionId {
                    let pending = model.actions.first(where: { $0.id == id })?.canConfirm == true
                    Button(pending ? "查看待确认操作" : "查看采纳记录", systemImage: "checkmark.rectangle") {
                        Task { await model.openAction(id) }
                    }
                    .font(.footnote).frame(minHeight: 44).disabled(model.working)
                }
            }
        }
    }

    private func artifactLink(_ id: String) -> some View {
        let artifact = model.artifacts.first(where: { $0.id == id })
        let task = model.tasks[id] ?? artifact?.task
        let kind = task.map { AgentDisplay.kind($0.kind) } ?? "查看产出"
        let draft = artifact?.drafts.count == 1 ? artifact?.drafts.first : nil
        let title = draft?.title ?? artifact?.analysisReport?.title ?? kind
        let status = draft.map { $0.status == "draft" ? "未发布草稿" : "已发布" }
            ?? task.map { AgentDisplay.status($0.status) }
        return Button { showArtifact(id) } label: {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(.medium)).foregroundStyle(AppTheme.primary)
                    if let status { Text(status).font(.caption).foregroundStyle(AppTheme.textSecondary) }
                }
            } icon: { Image(systemName: "doc.text").foregroundStyle(AppTheme.primary) }
            .frame(minHeight: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(model.working)
        .accessibilityHint("打开这项产出")
    }
}

private struct AgentEvidenceView: View {
    let sources: [AIAgentEvidence]
    let onExpand: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 14) {
                Text("以下是查阅时保存的片段。打开章节可查看当前原文。")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
                ForEach(sources) { source in
                    AgentEvidenceRow(source: source)
                }
            }
            .padding(.bottom, 4)
        } label: {
            Text("查阅依据 · \(sources.count) 条")
                .font(.footnote.weight(.medium))
                .frame(minHeight: 44, alignment: .leading)
                .foregroundStyle(AppTheme.primary)
        }
        .tint(AppTheme.primary)
        .onChange(of: isExpanded) { _, expanded in if expanded { onExpand() } }
        .transaction { transaction in
            if reduceMotion {
                transaction.animation = nil
                transaction.disablesAnimations = true
            }
        }
    }
}

private struct AgentEvidenceRow: View {
    let source: AIAgentEvidence

    private var link: URL? {
        guard let base = ServerConfig.shared.baseURL, !source.novelId.isEmpty else { return nil }
        if source.kind == "chapter", let chapter = source.chapterId, !chapter.isEmpty {
            let path = "/read/\(ReaderMediaAPI.pathSegment(source.novelId))/\(ReaderMediaAPI.pathSegment(chapter))"
            return APIRequestURL.resolve(path, relativeTo: base)
        }
        if source.kind == "analysis", let report = source.reportId, !report.isEmpty {
            let query = HomeView.query(["sub": "writing", "view": "analysis", "novel": source.novelId, "report": report])
            return APIRequestURL.resolve("/admin/ai?\(query)", relativeTo: base)
        }
        return nil
    }

    private var sourceLabel: String {
        if source.origin == "published" { return "章节原文" }
        if source.kind == "analysis" { return source.origin == "manual" ? "人工修订报告" : "自动分析报告" }
        return source.origin == "manual" ? "人工修订档案" : "自动分析档案"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let link {
                Link(destination: link) {
                    Text(verbatim: source.title)
                        .foregroundStyle(AppTheme.primary)
                        .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .font(.footnote.weight(.semibold))
            } else {
                Text(verbatim: source.title)
                    .font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.textPrimary)
            }
            Text(verbatim: sourceLabel + (source.truncated ? " · 节选" : ""))
                .font(.caption).foregroundStyle(AppTheme.textSecondary)
            if source.kind == "analysis", let revision = source.reportRevision {
                Text("查阅时修订版本 \(revision)").font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            if let end = source.throughChapter {
                let range = source.fromChapter.map { "《\($0.title)》至《\(end.title)》" } ?? "截至《\(end.title)》"
                Text("覆盖范围 \(range)，仅供对照原文。")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            Text(verbatim: source.excerpt)
                .font(.footnote).foregroundStyle(AppTheme.textPrimary)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AgentComposerView: View {
    @Bindable var model: AdminAIAgentConversationModel
    @State private var showDiscard = false

    private var modelName: String {
        model.presets.first(where: { $0.id == model.localDraft.providerPresetId })?.name
            ?? (model.localDraft.providerPresetId.isEmpty ? "默认文本模型" : "已保存的预设")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.operationError { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            if let error = model.messageError { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            if let pending = model.localDraft.pending {
                pendingMessage(pending)
            }
            HStack(alignment: .bottom, spacing: 8) {
                modelMenu
                HStack(alignment: .bottom, spacing: 2) {
                    TextField("和创作助手聊聊…", text: $model.localDraft.input, axis: .vertical)
                        .lineLimit(1...6)
                        .padding(.leading, 14)
                        .padding(.vertical, 9)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("agent.composer")
                    messageAction
                }
                .padding(2)
                .appGlassEffect(.regular, fallback: AppTheme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
            if model.localDraft.input.utf16.count > 8_000 {
                Text("消息最多 8000 字，请缩短后发送。").font(.caption).foregroundStyle(.red)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 8)
        .frame(maxWidth: 820).frame(maxWidth: .infinity)
        .confirmationDialog("先核对消息是否已发送", isPresented: $showDiscard, titleVisibility: .visible) {
            Button("取回文字，结束本次重试") { model.discardPending() }
            Button("取消", role: .cancel) {}
        } message: { Text("服务器可能已接收此消息。结束重试不会停止任务，再次发送会创建新的一轮。") }
    }

    @ViewBuilder private var messageAction: some View {
        if model.replying, let taskID = model.activeTask?.id {
            Button { Task { await model.stop(taskID) } } label: {
                actionIcon("stop.fill", active: !model.working)
            }
            .accessibilityLabel("停止回复")
            .disabled(model.working)
            .buttonStyle(ScaleButtonStyle())
        } else {
            Button { Task { await model.send() } } label: {
                actionIcon("arrow.up", active: model.canSend)
            }
            .accessibilityLabel(model.sending ? "正在发送" : "发送消息")
            .accessibilityIdentifier("agent.send")
            .disabled(!model.canSend)
            .keyboardShortcut(.return, modifiers: .command)
            .buttonStyle(ScaleButtonStyle())
        }
    }

    private func actionIcon(_ symbol: String, active: Bool) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(active ? AppTheme.onPrimary : AppTheme.textSecondary)
            .frame(width: 34, height: 34)
            .background(active ? AppTheme.primary : AppTheme.controlFill.opacity(0.7), in: Circle())
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
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
            Image(systemName: "cpu")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(AppTheme.primary)
                .frame(width: 48, height: 48)
                .appGlassEffect(AppTheme.glass, fallback: AppTheme.surface, in: Circle())
        }
        .disabled(model.replying || model.sending || model.localDraft.pending != nil)
        .accessibilityLabel("切换文本模型")
        .accessibilityValue(modelName)
    }

    private func pendingMessage(_ pending: AIAgentPendingMessage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.sending ? "正在发送…" : (model.pendingReceiptChecked ? "暂未查到送达回执" : "上次消息尚未确认送达"))
                .font(.caption.weight(.medium))
            Text(verbatim: pending.content).font(.caption).lineLimit(2).foregroundStyle(AppTheme.textSecondary)
            if !model.sending {
                ViewThatFits(in: .horizontal) {
                    HStack { pendingActions }
                    VStack(alignment: .leading) { pendingActions }
                }
            }
        }
    }
    @ViewBuilder private var pendingActions: some View {
        Button(model.isRefreshing ? "正在核对…" : "核对发送状态") { Task { await model.refresh() } }
            .font(.caption).frame(minHeight: 44).disabled(model.isRefreshing)
        if model.pendingReceiptChecked {
            Button("重试原消息") { Task { await model.send(retry: true) } }
                .font(.caption).frame(minHeight: 44).disabled(model.working || model.replying || model.isRefreshing)
        }
        Button("取回文字") { showDiscard = true }.font(.caption).frame(minHeight: 44)
    }
}

struct AgentTaskStatusView: View {
    let task: AIAgentTask
    var showsDetailedProgress = true
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                if task.isRunning && (!showsDetailedProgress || task.total <= 0) { ProgressView().controlSize(.small).accessibilityHidden(true) }
                Text(task.step.isEmpty ? AgentDisplay.status(task.status)
                     : (task.isRunning ? task.step : "\(AgentDisplay.status(task.status)) · \(task.step)")).font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if showsDetailedProgress && task.isRunning && task.total > 0 {
                ProgressView(value: Double(max(0, min(task.current, task.total))), total: Double(task.total))
                    .tint(AppTheme.primary)
            }
            if showsDetailedProgress, let progress = task.progress, task.isRunning {
                Text(progress.phase == "thinking" ? "正在构思…" : "已输出 \(progress.generatedCharacters) 字")
                    .font(.caption).foregroundStyle(AppTheme.textSecondary)
            }
            if !task.error.isEmpty { Text(verbatim: task.error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
        }
    }
}

enum AgentDisplay {
    static func recoveryPhase(_ value: String) -> String {
        ["context": "准备对话时中断", "retrieval": "查阅资料时中断", "model": "整理回复时中断",
         "generation": "提交创作操作时中断", "save": "保存回复时中断", "summary": "更新对话摘要时中断"][value] ?? "本轮回复中断"
    }

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
