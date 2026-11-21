import SwiftUI
import ZhiZhouCore

struct AdminAIAgentConversationView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: AdminAIAgentConversationModel
    @State private var panel: Panel?

    private enum Panel: Identifiable {
        case outputs, artifact(String), settings, memory, findBook
        var id: String {
            switch self {
            case .outputs: "outputs"
            case .artifact(let id): "artifact:\(id)"
            case .settings: "settings"
            case .memory: "memory"
            case .findBook: "find-book"
            }
        }
    }

    init(session: AIAgentSession, userID: String, token: String) {
        _model = State(initialValue: AdminAIAgentConversationModel(session: session, userID: userID, token: token))
    }

    var body: some View {
        VStack(spacing: 0) {
            if model.hasLoaded {
                AgentMessagesView(model: model, readingOverlay: panel != nil || model.selectedAction != nil,
                                  showArtifact: { panel = .artifact($0) }, showOutputs: { panel = .outputs },
                                  showMemory: { panel = .memory })
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("暂时无法读取对话", systemImage: "bubble.left.and.exclamationmark.bubble.right")
                } description: { Text(error) } actions: { Button("重试") { Task { await model.refresh() } } }
            } else {
                ProgressView("读取对话…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaBar(edge: .top, spacing: 0) { context }
        .readingSpaceTopEdge()
        .background(ReadingSpace.profilePaper)
        .navigationTitle(model.session.novelTitle.isEmpty ? "对话创作" : model.session.novelTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(model.session.novelTitle.isEmpty ? "对话创作" : model.session.novelTitle)
                        .font(serifFont(.headline, .semibold)).foregroundStyle(ReadingSpace.ink)
                        .lineLimit(1)
                    Text("创作对话").font(.caption2).foregroundStyle(AppTheme.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityHint(model.session.title)
            }
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
                    if !model.session.title.isEmpty { Text(model.session.title) }
                    Button("作品记忆", systemImage: "bookmark") { panel = .memory }
                    Button("会话设置", systemImage: "slider.horizontal.3") { panel = .settings }
                    Button("找书入库", systemImage: "magnifyingglass") { panel = .findBook }
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
            case .findBook:
                NavigationStack {
                    AdminAgentBookDiscoveryView(token: model.api.token)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) { Button("关闭") { self.panel = nil } }
                        }
                }
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
        AppAdaptiveRow(spacing: 10) {
            Label(contextSummary, systemImage: "text.book.closed")
                .font(.caption).foregroundStyle(AppTheme.textSecondary)
                .appTextLineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { panel = .memory } label: {
                Label(model.pendingMemoryCount > 0 ? "记忆 · \(model.pendingMemoryCount)" : "作品记忆",
                      systemImage: "bookmark")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(AppTheme.primary)
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("作品记忆")
            .accessibilityValue(model.pendingMemoryCount > 0 ? "\(model.pendingMemoryCount) 条待确认" : "无待确认提议")
            .disabled(!model.hasLoaded)
        }
        .padding(.horizontal, 20).padding(.vertical, 2)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity)
        .background(ReadingSpace.profilePaper, ignoresSafeAreaEdges: [])
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
    let showMemory: () -> Void
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
        let groups = AgentMessageGroup.grouped(model.events)
        return LazyVStack(alignment: .leading, spacing: 16) {
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
            ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                VStack(alignment: .leading, spacing: 12) {
                    replyHeading(for: group.firstEvent, after: index > 0 ? groups[index - 1].firstEvent : nil)
                    if group.activities.isEmpty {
                        AgentMessageRow(event: group.firstEvent, model: model, showArtifact: showArtifact,
                                        pauseFollowing: { followsBottom = false })
                    } else {
                        AgentActivityGroupView(events: group.activities, showArtifact: showArtifact) { followsBottom = false }
                    }
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
        .padding(20).frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
    }

    @ViewBuilder private func replyHeading(for event: AIAgentEvent, after previous: AIAgentEvent?) -> some View {
        if event.role != "user", event.role != "assistant", event.taskId.isEmpty {
            AgentReplyHeading(createdAt: event.createdAt,
                              title: event.metadata.actionId == nil ? "操作记录" : "采纳记录",
                              symbol: "clock")
                .padding(.top, 6)
        } else if event.role != "user", !event.taskId.isEmpty,
           previous?.role == "user" || previous?.taskId != event.taskId {
            let followsRequest = previous?.role == "user" && previous?.taskId == event.taskId
            let request = followsRequest ? nil : model.events.last { $0.role == "user" && $0.taskId == event.taskId }
            AgentReplyHeading(createdAt: event.createdAt, request: request)
                .padding(.top, 6)
        }
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
                .buttonStyle(AppGlassButtonStyle(glass: AppTheme.glass, fallback: ReadingSpace.paper))
                .accessibilityIdentifier("agent.scrollToLatest")
                .transition(reduceMotion ? .identity : .offset(y: 8).combined(with: .opacity))
            }
            AgentComposerView(model: model, showMemory: showMemory)
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity)
        .background {
            if usesSolidBar { ReadingSpace.profilePaper.ignoresSafeArea(.container, edges: .bottom) }
        }
        .animation(reduceMotion ? nil : AppMotion.panel, value: followsBottom)
    }
}

private struct AgentReplyHeading: View {
    let createdAt: Int64
    var request: AIAgentEvent? = nil
    var title = "创作助手"
    var symbol = "sparkle"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AppAdaptiveRow(spacing: 8) {
                Label(title, systemImage: symbol)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if createdAt > 0 {
                    Text(Date(timeIntervalSince1970: Double(createdAt) / 1000),
                         format: .dateTime.month().day().hour().minute())
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .font(.caption)
            if let request {
                Text(verbatim: "回应「\(String(request.content.prefix(48)))\(request.content.count > 48 ? "…" : "")」")
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .appTextLineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct AgentMessageGroup: Identifiable {
    let firstEvent: AIAgentEvent
    var activities: [AIAgentEvent]
    var id: Int64 { firstEvent.id }

    private static let readingTools: Set<String> = [
        "read_overview", "find_chapter", "search_chapters", "read_chapter", "read_story_memory",
        "search_story", "list_novel_analyses", "read_novel_analysis",
        "list_drafts", "find_draft_version", "read_draft", "list_covers", "read_task", "read_conversation", "read_conversation_sources",
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
    let showArtifact: (String) -> Void
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
                                ForEach(event.metadata.draftReads ?? []) { read in
                                    let label = draftReadLabel(read)
                                    if read.kind == "rewrite", let taskId = read.taskId {
                                        Button { showArtifact(taskId) } label: {
                                            Text(verbatim: label)
                                                .foregroundStyle(AppTheme.primary)
                                                .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityHint("打开这份改写建议")
                                    } else {
                                        Text(verbatim: label).font(.caption)
                                    }
                                }
                                if let sources = event.metadata.sources, !sources.isEmpty {
                                    AgentEvidenceView(sources: sources, onExpand: onExpand)
                                }
                            }
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

    private func draftReadLabel(_ read: AIAgentEvent.DraftRead) -> String {
        var label = "《\(read.title)》· \(read.kind == "rewrite" ? "改写建议" : "草稿正文")"
        if read.kind == "rewrite", let time = read.createdAt {
            label += " · " + Date(timeIntervalSince1970: Double(time) / 1000).formatted(.dateTime.month().day().hour().minute())
        }
        if read.truncated == true { label += " · 已读节选" }
        return label
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
                Text(verbatim: event.content).textSelection(.enabled)
                    .foregroundStyle(ReadingSpace.ink).lineSpacing(4)
                    .padding(.horizontal, 18).padding(.vertical, 14)
                    .background(ReadingSpace.userMessage, in: UnevenRoundedRectangle(
                        topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20))
            }
        } else if event.role == "assistant" && event.metadata.error != true {
            VStack(alignment: .leading, spacing: 10) {
                if event.taskId.isEmpty {
                    AgentReplyHeading(createdAt: event.createdAt)
                }
                AgentMarkdownView(content: event.content)
                    .foregroundStyle(ReadingSpace.ink)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if event.metadata.error == true {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundStyle(AppTheme.danger).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(failureTitle).font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.danger)
                            Text(verbatim: failureReason).font(.footnote).foregroundStyle(ReadingSpace.ink)
                                .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        }
                    }
                    .padding(.vertical, 4)
                } else if event.metadata.artifactTaskId == nil {
                    Text(verbatim: event.content).textSelection(.enabled)
                        .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                }
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

    private var failureTitle: String {
        if let operation = AgentDisplay.operation(event.metadata.tool) { return "\(operation)未完成" }
        if event.metadata.tool != nil { return "这一步未完成" }
        return event.taskId.isEmpty ? "这次操作未完成" : "这次回复未完成"
    }

    private var failureReason: String {
        guard let operation = AgentDisplay.operation(event.metadata.tool) else { return event.content }
        let prefix = operation + "："
        guard event.content.hasPrefix(prefix), event.content.count > prefix.count else { return event.content }
        return String(event.content.dropFirst(prefix.count))
    }

    private func artifactLink(_ id: String) -> some View {
        let artifact = model.artifacts.first(where: { $0.id == id })
        let task = model.tasks[id] ?? artifact?.task
        let kind = task.map { AgentDisplay.kind($0.kind) } ?? "创作产出"
        let draft = artifact?.drafts.count == 1 ? artifact?.drafts.first : nil
        let title = draft?.title ?? artifact?.chapterEdit?.chapterTitle ?? artifact?.analysisReport?.title ?? kind
        let excerpt = draft?.content ?? artifact?.rewrite?.after ?? artifact?.chapterEdit?.after ?? ""
        let status = artifactStatus(task: task, draft: draft, artifact: artifact)
        let warning = draft?.minimumLengthWarning ?? artifact?.rewrite?.minimumLengthWarning
        let hasSuggestion = artifact?.rewrite != nil || artifact?.chapterEdit != nil
        return Button { showArtifact(id) } label: {
            VStack(alignment: .leading, spacing: 12) {
                AppAdaptiveRow(spacing: 10) {
                    VStack(alignment: .leading, spacing: 5) {
                        if title != kind {
                            Text(kind).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        }
                        Text(title).font(serifFont(.title3, .semibold)).foregroundStyle(ReadingSpace.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let status {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(task?.status == "failed" ? AppTheme.danger : AppTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                // The activity belongs to this result; keep its wording once inside the preview.
                if event.metadata.error != true && !event.content.isEmpty && event.content != title {
                    Text(verbatim: event.content).font(.footnote).foregroundStyle(AppTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if task?.status == "completed" && !excerpt.isEmpty {
                    Text(verbatim: String(excerpt.prefix(360)))
                        .font(serifFont(.body)).foregroundStyle(ReadingSpace.ink).lineSpacing(5)
                        .appTextLineLimit(3)
                }
                if let warning, !warning.isEmpty {
                    Text(verbatim: warning).font(.caption).foregroundStyle(AppTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Text(draft != nil ? "阅读草稿" : (hasSuggestion ? "查看建议" : "查看产出"))
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.right").accessibilityHidden(true)
                }
                .font(.footnote.weight(.medium)).foregroundStyle(AppTheme.primary)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(ReadingSpace.line, lineWidth: 0.5) }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(model.working)
        .accessibilityHint("打开完整产出与采纳预览")
    }

    private func artifactStatus(task: AIAgentTask?, draft: AIAgentArtifact.Draft?, artifact: AIAgentArtifact?) -> String? {
        if let task, task.status != "completed" { return AgentDisplay.status(task.status) }
        if let draft {
            switch draft.status {
            case "draft": return "未发布草稿"
            case "published": return "已发布"
            default: return draft.status
            }
        }
        if artifact?.rewrite != nil || artifact?.chapterEdit != nil { return "建议已生成" }
        return task.map { $0.status == "completed" ? "生成完成" : AgentDisplay.status($0.status) }
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
    let showMemory: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
            VStack(alignment: .leading, spacing: 0) {
                TextField("和创作助手聊聊…", text: $model.localDraft.input, axis: .vertical)
                    .lineLimit(1...6)
                    .foregroundStyle(ReadingSpace.ink)
                    .padding(.horizontal, 4)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .accessibilityLabel("消息")
                    .accessibilityIdentifier("agent.composer")
                if dynamicTypeSize >= .xxxLarge {
                    modelMenu
                    HStack(spacing: 12) {
                        memoryButton
                        Spacer(minLength: 0)
                        messageAction
                    }
                } else {
                    HStack(spacing: 12) {
                        memoryButton
                        modelMenu
                        Spacer(minLength: 0)
                        messageAction
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 4)
            .appGlassEffect(.regular, fallback: ReadingSpace.paper,
                            in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            if model.localDraft.input.utf16.count > 8_000 {
                Text("消息最多 8000 字，请缩短后发送。").font(.caption).foregroundStyle(.red)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
        .frame(maxWidth: 760).frame(maxWidth: .infinity)
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
            HStack(spacing: 5) {
                Text(modelName).appTextLineLimit(1)
                Image(systemName: "chevron.down").font(.caption2).accessibilityHidden(true)
            }
            .font(.caption).foregroundStyle(AppTheme.textSecondary)
            .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .disabled(model.replying || model.sending || model.localDraft.pending != nil)
        .accessibilityLabel("切换文本模型")
        .accessibilityValue(modelName)
    }

    private var memoryButton: some View {
        Button(action: showMemory) {
            Label("记忆", systemImage: "bookmark")
                .font(.caption).foregroundStyle(AppTheme.primary)
                .frame(minWidth: 44, minHeight: AppLayout.minimumTouchTarget)
                .fixedSize(horizontal: true, vertical: false)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("作品记忆")
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
    static func operation(_ tool: String?) -> String? {
        guard let tool else { return nil }
        return [
            "read_overview": "读取小说和章节目录", "find_chapter": "定位原章节", "search_chapters": "检索章节依据",
            "search_story": "检索人物与情节依据", "read_chapter": "阅读章节原文", "list_novel_analyses": "查看小说分析目录",
            "read_novel_analysis": "查阅小说分析", "list_drafts": "查找草稿", "find_draft_version": "定位草稿版本",
            "read_draft": "读取草稿", "list_covers": "查看封面候选", "read_task": "读取任务结果",
            "read_conversation": "查阅早前对话", "read_conversation_sources": "核对作者原话",
            "propose_chapter_plan": "整理章节计划", "generate_draft": "生成章节草稿",
            "rewrite_chapter": "生成原章节改写建议", "refine_chapter_edit": "调整原章节建议",
            "list_chapter_edits": "查看章节修改历史", "rewrite_draft": "生成改写建议",
            "refine_rewrite": "调整上一版改写建议", "generate_cover": "生成封面候选",
            "analyze_novel": "生成小说分析报告", "propose_memory": "提出创作记忆", "prepare_action": "准备采纳预览",
        ][tool]
    }

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
         "rewrite_selection": "改写建议", "chapter_edit": "原章节改写", "analyze_plot": "情节档案", "analyze_relationships": "关系档案",
         "novel_analysis": "小说分析报告", "agent_chat": "助手回复"][value] ?? "创作任务"
    }
}
