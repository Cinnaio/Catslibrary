import SwiftUI
import ZhiZhouCore

private enum AgentOutputRoute: Hashable {
    case artifact(String)
    case action
}

struct AgentOutputSheet: View {
    let model: AdminAIAgentConversationModel
    var artifactID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var path: [AgentOutputRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let artifactID {
                    AgentArtifactDetail(model: model, artifactID: artifactID, returnToConversation: { dismiss() })
                } else {
                    AgentArtifactsView(model: model)
                }
            }
            .toolbar {
                if path.isEmpty {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭", systemImage: "xmark") { dismiss() }.disabled(model.working)
                    }
                }
            }
            .navigationDestination(for: AgentOutputRoute.self) { route in
                switch route {
                case .artifact(let id):
                    AgentArtifactDetail(model: model, artifactID: id, returnToConversation: { dismiss() })
                        .navigationBarBackButtonHidden(model.working)
                case .action:
                    if let action = model.selectedAction {
                        AgentActionPreview(model: model, initialAction: action)
                            .navigationBarBackButtonHidden(model.working)
                    }
                }
            }
        }
        .interactiveDismissDisabled(model.working || model.selectedAction != nil)
        .onChange(of: model.selectedAction?.id) { _, id in
            if id != nil, path.last != .action { path.append(.action) }
        }
        .onChange(of: path) { oldPath, newPath in
            if oldPath.last == .action, newPath.last != .action { model.selectedAction = nil }
        }
    }
}

private struct AgentArtifactsView: View {
    let model: AdminAIAgentConversationModel
    private var pendingActions: [AIAgentAction] { model.actions.filter(\.canConfirm) }
    private var history: [AIAgentAction] { model.actions.filter { !$0.canConfirm } }

    var body: some View {
        AgentPanelPage {
            AgentPanelHeading("产出与采纳", detail: "先读内容，再决定如何用到作品里。")
            if let error = model.operationError { AgentPanelNotice(error, isError: true) }
            if let error = model.loadError {
                LoadErrorNotice(message: error, isLoading: model.isRefreshing) { Task { await model.refresh() } }
            }
            if !pendingActions.isEmpty {
                AgentPanelSection("等待你的确认", count: pendingActions.count) {
                    ForEach(Array(pendingActions.enumerated()), id: \.element.id) { index, action in
                        actionRow(action).readingSpaceEntrance(index)
                    }
                }
            }
            if !model.artifacts.isEmpty {
                AgentPanelSection("生成产出", count: model.artifacts.count) {
                    ForEach(Array(model.artifacts.enumerated()), id: \.element.id) { index, artifact in
                        NavigationLink(value: AgentOutputRoute.artifact(artifact.id)) { outputRow(artifact) }
                            .buttonStyle(.plain).disabled(model.working).readingSpaceEntrance(index)
                        if index < model.artifacts.count - 1 { Divider().overlay(ReadingSpace.profileLine) }
                    }
                }
            }
            if !history.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(history) { action in actionRow(action) }
                    }
                    .padding(.top, 12)
                } label: {
                    Text("采纳记录 · \(history.count)")
                        .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }
            }
            if model.artifacts.isEmpty, model.actions.isEmpty, model.loadError == nil {
                ContentUnavailableView("还没有产出", systemImage: "doc.on.doc",
                    description: Text("生成的草稿、改写建议和封面候选会出现在这里。"))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await model.refresh() } } label: {
                    if model.isRefreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .accessibilityLabel("刷新列表").disabled(model.isRefreshing)
            }
        }
        .refreshable { await model.refresh() }
    }

    private func actionRow(_ action: AIAgentAction) -> some View {
        Button { Task { await model.openAction(action.id) } } label: {
            AgentOutputRow(title: action.title, subtitle: AgentDisplay.status(action.status),
                           symbol: action.canConfirm ? "checkmark.circle" : "clock.arrow.circlepath", highlighted: action.canConfirm)
                .padding(action.canConfirm ? 16 : 0)
                .background(action.canConfirm ? ReadingSpace.paper : Color.clear, in: RoundedRectangle(cornerRadius: 20))
                .overlay {
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(action.canConfirm ? ReadingSpace.profileLine : Color.clear, lineWidth: 1)
                        .allowsHitTesting(false)
                }
        }
        .buttonStyle(.plain).disabled(model.working)
    }

    private func outputRow(_ artifact: AIAgentArtifact) -> some View {
        let task = model.tasks[artifact.id] ?? artifact.task
        let kind = AgentDisplay.kind(task.kind)
        let draft = artifact.drafts.count == 1 ? artifact.drafts.first : nil
        let title = draft?.title ?? artifact.analysisReport?.title ?? kind
        let status = task.status == "completed" ? draft.map { $0.status == "draft" ? "未发布" : "已发布" } : nil
        let state = status ?? AgentDisplay.status(task.status)
        return AgentOutputRow(title: title, subtitle: title == kind ? state : "\(kind) · \(state)", symbol: outputSymbol(task.kind))
    }

    private func outputSymbol(_ kind: String) -> String {
        switch kind {
        case "cover": return "photo"
        case "rewrite_selection", "chapter_edit": return "pencil.line"
        case "novel_analysis", "analyze_plot", "analyze_relationships": return "text.magnifyingglass"
        default: return "doc.text"
        }
    }
}

private struct AgentOutputRow: View {
    let title: String
    let subtitle: String
    let symbol: String
    var highlighted = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.body)
                .foregroundStyle(highlighted ? AppTheme.primary : ReadingSpace.profileMuted)
                .frame(width: 36, height: 40)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 7) {
                Text(verbatim: title).font(serifFont(.headline, .medium)).foregroundStyle(ReadingSpace.ink)
                Text(verbatim: subtitle).font(.footnote).foregroundStyle(highlighted ? AppTheme.primary : ReadingSpace.profileMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            Image(systemName: "chevron.right").font(.caption.weight(.medium))
                .foregroundStyle(ReadingSpace.profileMuted).frame(height: 40).accessibilityHidden(true)
        }
        .padding(.vertical, 10)
        .frame(minHeight: AppLayout.minimumTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct AgentArtifactDetail: View {
    let model: AdminAIAgentConversationModel
    let artifactID: String
    let returnToConversation: () -> Void
    @State private var attemptedLoad = false

    private var artifact: AIAgentArtifact? { model.artifacts.first { $0.id == artifactID } }
    private var isLoading: Bool { model.loadingArtifacts.contains(artifactID) }

    var body: some View {
        Group {
            if let artifact {
                AgentPanelPage {
                    if let error = model.operationError ?? model.artifactErrors[artifactID] {
                        AgentPanelNotice(error, isError: true)
                    }
                    AgentArtifactContent(model: model, artifact: artifact, returnToConversation: returnToConversation)
                }
                .refreshable { await load() }
            } else if !attemptedLoad || isLoading {
                ProgressView("读取产出…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView {
                    Label("暂时无法读取这项产出", systemImage: "doc.text.magnifyingglass")
                } description: {
                    if let error = model.artifactErrors[artifactID] { Text(error) }
                } actions: {
                    Button("重试") { Task { await load() } }.frame(minHeight: AppLayout.minimumTouchTarget)
                }
            }
        }
        .agentPanelSurface()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isLoading, artifact != nil {
                    ProgressView().accessibilityLabel("正在刷新产出")
                } else if artifact != nil {
                    Button("刷新产出", systemImage: "arrow.clockwise") { Task { await load() } }
                        .disabled(model.working)
                }
            }
        }
        .task {
            if !attemptedLoad { await load() }
        }
    }

    private func load() async {
        await model.refreshArtifact(artifactID)
        if !Task.isCancelled { attemptedLoad = true }
    }
}

private struct AgentArtifactContent: View {
    let model: AdminAIAgentConversationModel
    let artifact: AIAgentArtifact
    let returnToConversation: () -> Void
    private var task: AIAgentTask { model.tasks[artifact.id] ?? artifact.task }
    private var analysisURL: URL? {
        guard let report = artifact.analysisReport, report.url.hasPrefix("/admin/ai?"),
              let base = ServerConfig.shared.baseURL else { return nil }
        return URL(string: report.url, relativeTo: base)?.absoluteURL
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text(AgentDisplay.kind(task.kind)).font(.caption.weight(.medium))
                .foregroundStyle(ReadingSpace.profileMuted)
            if task.status != "completed" || !task.error.isEmpty { AgentTaskStatusView(task: task) }
            if task.isRunning {
                Button("停止此任务", systemImage: "stop.circle") { Task { await model.stop(task.id) } }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(model.working)
            }
            if let progress = task.progress, !progress.preview.isEmpty, task.status != "completed" {
                DisclosureGroup(task.isRunning ? "生成中的预览" : "未完成的预览") {
                    Text(verbatim: progress.preview).font(.callout).textSelection(.enabled).lineSpacing(5).padding(.top, 12)
                }
            }
            ForEach(artifact.drafts) { draft in
                AgentDraftResultView(model: model, draft: draft, publishable: ["continue", "write_chapter"].contains(task.kind),
                                     returnToConversation: returnToConversation)
            }
            if let report = artifact.analysisReport {
                AgentPanelHeading(report.title)
                if let analysisURL {
                    Link(destination: analysisURL) {
                        Label("阅读分析报告", systemImage: "arrow.up.right")
                    }
                    .buttonStyle(AgentPanelButtonStyle())
                } else {
                    AgentPanelNotice("暂时无法打开报告")
                }
            }
            if let rewrite = artifact.rewrite { rewriteResult(rewrite) }
            if let edit = artifact.chapterEdit {
                VStack(alignment: .leading, spacing: 20) {
                    AgentPanelHeading(edit.chapterTitle, detail: "章节修改建议")
                    NavigationLink {
                        AgentTextComparison(title: "章节修改对照", beforeTitle: "原章节", afterTitle: "建议正文", before: edit.before, after: edit.after)
                    } label: {
                        Label("对照原章节", systemImage: "rectangle.split.2x1")
                    }
                    .buttonStyle(AgentPanelButtonStyle())
                    AgentPlainPreview(title: "建议正文", text: edit.after)
                    Button("预览写回原章节") { Task { await model.prepare(.applyChapterEdit, targetID: artifact.id) } }
                        .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(model.working)
                }
            }
            ForEach(Array(artifact.covers.enumerated()), id: \.element.id) { index, cover in
                VStack(alignment: .leading, spacing: 20) {
                    AgentPanelHeading(artifact.covers.count > 1 ? "封面候选 \(index + 1)" : "封面候选")
                    AgentCoverPreview(sessionID: model.sessionID, candidateID: cover.id)
                        .frame(maxWidth: .infinity)
                    DisclosureGroup {
                        Text(verbatim: cover.prompt).font(.callout).lineSpacing(5).textSelection(.enabled).padding(.top, 12)
                    } label: {
                        Text("画面描述").font(.subheadline).frame(minHeight: 44)
                    }
                    Button("预览设为封面") { Task { await model.prepare(.adoptCover, targetID: cover.id) } }
                        .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(model.working)
                }
            }
            if task.status == "completed", artifact.drafts.isEmpty, artifact.covers.isEmpty, artifact.rewrite == nil, artifact.chapterEdit == nil, artifact.analysisReport == nil {
                AgentPanelNotice(task.kind == "cover" ? "候选可能已采纳或移除，可在产出与采纳中查看记录。" : "任务已完成，详细结果可在 AI 任务中查看。")
                NavigationLink("查看 AI 任务") { AdminAITasksView() }
                    .buttonStyle(AgentPanelButtonStyle())
            }
        }
    }

    private func rewriteResult(_ rewrite: AIAgentArtifact.Rewrite) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            AgentPanelHeading("改写建议", detail: "阅读新版文字，或展开原文逐段对照。")
            NavigationLink {
                AgentTextComparison(title: "原文与改写", beforeTitle: "原文", afterTitle: "改写后", before: rewrite.before, after: rewrite.after)
            } label: {
                Label("对照原文", systemImage: "rectangle.split.2x1")
            }
            .buttonStyle(AgentPanelButtonStyle())
            if let warning = rewrite.minimumLengthWarning { AgentPanelNotice(warning) }
            AgentPlainPreview(title: "改写后", text: rewrite.after)
            Button { Task { await model.prepare(.applyRewrite, targetID: artifact.id) } } label: {
                Text("预览采纳")
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(model.working)
        }
    }
}

private struct AgentTextComparison: View {
    let title: String
    let beforeTitle: String
    let afterTitle: String
    let before: String
    let after: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        GeometryReader { geometry in
            AgentPanelPage {
                AgentPanelHeading(title)
                let layout = geometry.size.width >= 820 && dynamicTypeSize < .xxxLarge
                    ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                    : AnyLayout(VStackLayout(alignment: .leading, spacing: 28))
                layout {
                    AgentPlainPreview(title: beforeTitle, text: before)
                    AgentPlainPreview(title: afterTitle, text: after)
                }
            }
        }
        .agentPanelSurface()
    }
}

private struct AgentDraftResultView: View {
    let model: AdminAIAgentConversationModel
    let draft: AIAgentArtifact.Draft
    let publishable: Bool
    let returnToConversation: () -> Void
    @State private var title: String
    @State private var showsPublishFields = false
    @FocusState private var titleFocused: Bool

    init(model: AdminAIAgentConversationModel, draft: AIAgentArtifact.Draft, publishable: Bool, returnToConversation: @escaping () -> Void) {
        self.model = model
        self.draft = draft
        self.publishable = publishable
        self.returnToConversation = returnToConversation
        _title = State(initialValue: draft.title == "未命名章节" ? "" : draft.title)
    }

    private var excerpt: String {
        let opening = draft.content.drop(while: \.isWhitespace).prefix(481)
        if opening.count > 480 { return String(opening.prefix(480)) + "…" }
        return String(opening)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            AgentPanelHeading(draft.title, detail: draft.status == "draft" ? "未发布草稿" : "已发布章节")
            let opening = excerpt
            if let warning = draft.minimumLengthWarning {
                AgentPanelNotice(warning)
            } else if let length = draft.lengthCheck {
                let target = length.minimumWords.map { "要求至少 \($0) 字" } ?? length.targetWords.map { "目标约 \($0) 字" } ?? ""
                Text(target.isEmpty ? "正文 \(length.actualWords) 字" : "正文 \(length.actualWords) 字 · \(target)")
                    .font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
            }
            if !opening.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("正文节选").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                    Text(verbatim: opening).font(serifFont(.body)).lineSpacing(7).appTextLineLimit(5)
                        .foregroundStyle(ReadingSpace.ink).frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(18)
                .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 20))
            }
            NavigationLink { draftReader } label: {
                Label("阅读全文", systemImage: "doc.plaintext")
            }
            .buttonStyle(AgentPanelButtonStyle())
            if publishable && draft.status == "draft" {
                Divider().overlay(ReadingSpace.profileLine)
                DisclosureGroup {
                    AgentDraftReviewContent(model: model, draft: draft, returnToConversation: returnToConversation)
                        .id(draft.revision)
                } label: {
                    Label("核对草稿", systemImage: "text.magnifyingglass")
                        .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }
                publishFields
            }
        }
    }

    private var draftReader: some View {
        AgentPanelPage {
            AgentPanelHeading(draft.title)
            Text(verbatim: draft.content).font(serifFont(.body)).textSelection(.enabled).lineSpacing(8)
                .foregroundStyle(ReadingSpace.ink).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var publishFields: some View {
        DisclosureGroup(isExpanded: $showsPublishFields) {
            VStack(alignment: .leading, spacing: 16) {
                AgentPanelField("发布章节标题", isFocused: titleFocused) {
                    TextField("输入章节标题", text: $title, axis: .vertical).lineLimit(1...3).focused($titleFocused)
                        .accessibilityLabel("发布章节标题").disabled(model.working)
                }
                if title.utf16.count > 200 {
                    AgentPanelNotice("章节标题过长，请缩短后再预览。", isError: true)
                }
                Button {
                    titleFocused = false
                    Task { await model.prepare(.publishDraft, targetID: draft.id, title: title) }
                } label: {
                    Text("预览发布章节")
                }
                .buttonStyle(AgentPanelButtonStyle(prominent: true))
                .disabled(model.working || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.utf16.count > 200)
            }
            .padding(.top, 16)
        } label: {
            Label("准备发布", systemImage: "square.and.arrow.up")
                .font(.subheadline.weight(.medium)).frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        }
    }
}

private struct AgentDraftReviewContent: View {
    let model: AdminAIAgentConversationModel
    let draft: AIAgentArtifact.Draft
    let returnToConversation: () -> Void
    @State private var report: AgentDraftReview?
    @State private var checking = false
    @State private var error: String?
    @State private var requestVersion = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            AgentPanelNotice("核对任务保存的作者要求和作品资料。检查会调用文本模型，完整结果可复用。")
            Button { Task { await load(run: true) } } label: {
                HStack(spacing: 8) { Text(checking ? "正在检查…" : "检查草稿"); if checking { ProgressView() } }
            }
            .buttonStyle(AgentPanelButtonStyle()).disabled(checking || model.working)
            if let error { AgentPanelNotice(error, isError: true) }
            if let report {
                let stale = report.stale == true || report.draftRevision != draft.revision
                if stale { AgentPanelNotice("草稿或来源已变化，请重新检查。") }
                if report.completeness == "partial" { AgentPanelNotice("检查结果不完整，下方仅显示通过校验的条目。") }
                if report.findings.isEmpty && report.completeness != "partial" {
                    Label("本次材料范围内未发现有依据的问题。", systemImage: "checkmark.circle")
                        .font(.subheadline).foregroundStyle(ReadingSpace.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(report.findings.indices, id: \.self) { index in
                    let finding = report.findings[index]
                    VStack(alignment: .leading, spacing: 16) {
                        Text(finding.label).font(serifFont(.title3, .medium)).accessibilityAddTraits(.isHeader)
                        Text(verbatim: finding.description).lineSpacing(5).textSelection(.enabled)
                        if !finding.draftQuote.isEmpty {
                            AgentPlainPreview(title: "草稿原文", text: finding.draftQuote)
                        }
                        if !finding.evidence.isEmpty {
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 16) {
                                    ForEach(finding.evidence.indices, id: \.self) { evidenceIndex in
                                        let evidence = finding.evidence[evidenceIndex]
                                        let title = report.sources.first(where: { $0.id == evidence.sourceId })?.title ?? "引用依据"
                                        AgentPlainPreview(title: title, text: evidence.quote)
                                    }
                                }
                                .padding(.top, 12)
                            } label: {
                                Text("引用依据 · \(finding.evidence.count)").font(.subheadline).frame(minHeight: 44)
                            }
                        }
                        if !stale && !finding.draftQuote.isEmpty {
                            Button("带到对话中修改") {
                                let prompt = "请读取草稿 \(draft.id)。质量检查指出：\(finding.description)\n对应原文：“\(finding.draftQuote)”\n请核对原文与作者要求。若问题确实存在，请只针对这一点提出改写建议。"
                                let input = model.localDraft.input
                                model.localDraft.input = input.isEmpty ? prompt : input + "\n\n" + prompt
                                returnToConversation()
                            }
                            .buttonStyle(AgentPanelButtonStyle()).disabled(model.working)
                        }
                    }
                    .padding(.vertical, 12)
                    .readingSpaceEntrance(index)
                    if index < report.findings.count - 1 { Divider().overlay(ReadingSpace.profileLine) }
                }
            }
        }
        .padding(.top, 16)
        .task { await load(run: false) }
    }

    private func load(run: Bool) async {
        guard model.isCurrentAccount, !checking else { return }
        requestVersion += 1
        let version = requestVersion
        if run { checking = true }
        defer { if run { checking = false } }
        error = nil
        do {
            let result = try await model.api.draftReview(draft, run: run)
            guard model.isCurrentAccount, !Task.isCancelled, version == requestVersion else { return }
            report = result
        } catch {
            guard model.isCurrentAccount, !Task.isCancelled, version == requestVersion else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

struct AgentPlainPreview: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: text).font(serifFont(.body)).foregroundStyle(ReadingSpace.ink)
                .textSelection(.enabled).lineSpacing(7).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 16)
        .overlay(alignment: .leading) {
            Rectangle().fill(ReadingSpace.profileLine).frame(width: 2).allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AgentCoverPreview: View {
    let sessionID: String
    let candidateID: String

    var body: some View {
        CachedAsyncImage(url: AdminAgentAPI.coverURL(sessionID: sessionID, candidateID: candidateID),
                         targetSize: CGSize(width: 300, height: 420)) { image in
            image.resizable().scaledToFit()
        } placeholder: {
            VStack(spacing: 12) {
                Image(systemName: "photo").font(.largeTitle)
                Text("封面预览").font(.caption)
            }
            .foregroundStyle(ReadingSpace.profileMuted)
            .frame(maxWidth: .infinity, minHeight: 220)
            .background(ReadingSpace.profileFill)
        }
        .frame(maxWidth: 300, maxHeight: 420)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).strokeBorder(ReadingSpace.profileLine, lineWidth: 1).allowsHitTesting(false)
        }
        .accessibilityLabel("候选封面")
    }
}

struct AgentActionSheet: View {
    let model: AdminAIAgentConversationModel
    let initialAction: AIAgentAction
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            AgentActionPreview(model: model, initialAction: initialAction)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() }.disabled(model.working) }
                }
        }
        .interactiveDismissDisabled(model.working)
    }
}

private struct AgentActionPreview: View {
    let model: AdminAIAgentConversationModel
    let initialAction: AIAgentAction
    private var action: AIAgentAction { model.selectedAction ?? initialAction }

    private var draftTitle: String? {
        guard let id = action.preview.draftId, action.kind != .publishDraft else { return nil }
        return model.artifacts.lazy.flatMap(\.drafts).first(where: { $0.id == id })?.title
    }

    private var confirmLabel: String {
        if action.status == "executing" { return "核对后继续执行" }
        switch action.kind {
        case .publishDraft: return "按此位置发布"
        case .applyRewrite: return "替换草稿中的选段"
        case .adoptCover: return "设为当前封面"
        case .restoreDraft: return "恢复上一版草稿"
        case .applyChapterEdit: return "确认写回原章节"
        case .restoreChapter: return "确认恢复原章节"
        }
    }

    var body: some View {
        AgentPanelPage {
            AgentPanelHeading(action.title, detail: action.preview.description)
            AppAdaptiveRow(spacing: 20) {
                AgentPanelFact(title: "作品", value: model.session.novelTitle)
                if let draftTitle { AgentPanelFact(title: "草稿", value: draftTitle) }
            }
            Label(AgentDisplay.status(action.status), systemImage: action.status == "completed" ? "checkmark.circle" : "doc.text")
                .font(.subheadline).foregroundStyle(action.status == "completed" ? AppTheme.success : ReadingSpace.profileMuted)
            if let before = action.preview.before { AgentPlainPreview(title: "修改前", text: before) }
            if let after = action.preview.after { AgentPlainPreview(title: action.kind == .publishDraft ? "发布内容" : "修改后", text: after) }
            if let id = action.preview.candidateId {
                AgentCoverPreview(sessionID: model.sessionID, candidateID: id).frame(maxWidth: .infinity)
            }
            if !action.error.isEmpty { AgentPanelNotice(action.error, isError: true) }
            if let error = model.operationError { AgentPanelNotice(error, isError: true) }
            Divider().overlay(ReadingSpace.profileLine)
            controls
        }
        .id(action.id)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 16) {
            if action.canConfirm {
                Text("确认操作").font(serifFont(.title3, .medium)).accessibilityAddTraits(.isHeader)
                Button { Task { await model.confirm(action) } } label: {
                    HStack(spacing: 8) { Text(confirmLabel); if model.working { ProgressView() } }
                }
                .buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(model.working)
            }
            if action.status == "pending" {
                Button("放弃这次采纳", role: .destructive) { Task { await model.reject(action) } }
                    .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44).disabled(model.working)
            }
            if action.status == "completed", action.kind == .applyChapterEdit || action.kind == .restoreChapter {
                Button("预览恢复修改前的章节") { Task { await model.prepare(.restoreChapter, targetID: action.id) } }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(model.working)
            }
            if action.status == "completed", action.kind == .applyRewrite || action.kind == .restoreDraft {
                Button("预览恢复修改前的草稿") { Task { await model.prepare(.restoreDraft, targetID: action.id) } }
                    .buttonStyle(AgentPanelButtonStyle()).disabled(model.working)
            }
            if action.status == "failed" {
                AgentPanelNotice("请核对当前内容，返回产出区重新预览；已变化的版本不会被覆盖。")
            }
            Button("刷新操作状态", systemImage: "arrow.clockwise") { Task { await model.openAction(action.id) } }
                .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44).disabled(model.working)
        }
    }
}
