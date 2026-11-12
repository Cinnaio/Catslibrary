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
                    AgentArtifactDetail(model: model, artifactID: artifactID)
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
                    AgentArtifactDetail(model: model, artifactID: id)
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
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let error = model.operationError {
                    Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled)
                }
                if let error = model.loadError {
                    LoadErrorNotice(message: error, isLoading: model.isRefreshing) { Task { await model.refresh() } }
                }
                if !pendingActions.isEmpty { actionSection("待确认", actions: pendingActions) }
                if !model.artifacts.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        if !model.actions.isEmpty { sectionTitle("生成产出") }
                        ForEach(model.artifacts) { artifact in
                            NavigationLink(value: AgentOutputRoute.artifact(artifact.id)) {
                                outputRow(artifact)
                            }
                            .buttonStyle(.plain)
                            .disabled(model.working)
                        }
                    }
                }
                if !history.isEmpty { actionSection("采纳记录", actions: history) }
                if model.artifacts.isEmpty, model.actions.isEmpty, model.loadError == nil {
                    ContentUnavailableView("还没有产出", systemImage: "doc.on.doc",
                        description: Text("生成的草稿、改写建议和封面候选会出现在这里。"))
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: AppLayout.readableWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(AppTheme.canvas)
        .navigationTitle("产出与采纳")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("刷新列表", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                    .disabled(model.isRefreshing)
            }
        }
        .refreshable { await model.refresh() }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(AppTheme.textSecondary)
            .padding(.bottom, 4).accessibilityAddTraits(.isHeader)
    }

    private func actionSection(_ title: String, actions: [AIAgentAction]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle(title)
            ForEach(actions) { action in
                Button { Task { await model.openAction(action.id) } } label: {
                    AgentOutputRow(title: action.title, subtitle: AgentDisplay.status(action.status),
                                   symbol: action.canConfirm ? "checkmark.circle" : "clock.arrow.circlepath", highlighted: action.canConfirm)
                }
                .buttonStyle(.plain)
                .disabled(model.working)
            }
        }
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
        case "rewrite_selection": return "pencil.line"
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
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.body)
                .foregroundStyle(highlighted ? AppTheme.primaryDeep : AppTheme.textSecondary)
                .frame(width: 38, height: 38)
                .background(highlighted ? AppTheme.primaryLight : AppTheme.surfaceSecondary, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: title).font(.body.weight(.medium)).foregroundStyle(AppTheme.textPrimary)
                Text(verbatim: subtitle).font(.footnote).foregroundStyle(highlighted ? AppTheme.primaryDeep : AppTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary).accessibilityHidden(true)
        }
        .padding(.vertical, 8)
        .frame(minHeight: AppLayout.minimumTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct AgentArtifactDetail: View {
    let model: AdminAIAgentConversationModel
    let artifactID: String
    @State private var attemptedLoad = false

    private var artifact: AIAgentArtifact? { model.artifacts.first { $0.id == artifactID } }
    private var isLoading: Bool { model.loadingArtifacts.contains(artifactID) }

    var body: some View {
        Group {
            if let artifact {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let error = model.operationError ?? model.artifactErrors[artifactID] {
                            Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled)
                        }
                        AgentArtifactContent(model: model, artifact: artifact)
                    }
                    .padding(20).frame(maxWidth: AppLayout.readableWidth, alignment: .leading).frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
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
        .background(AppTheme.canvas)
        .navigationTitle(artifact.map { AgentDisplay.kind($0.task.kind) } ?? "产出详情")
        .navigationBarTitleDisplayMode(.inline)
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
    private var task: AIAgentTask { model.tasks[artifact.id] ?? artifact.task }
    private var analysisURL: URL? {
        guard let report = artifact.analysisReport, report.url.hasPrefix("/admin/ai?"),
              let base = ServerConfig.shared.baseURL else { return nil }
        return URL(string: report.url, relativeTo: base)?.absoluteURL
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if task.status != "completed" || !task.error.isEmpty { AgentTaskStatusView(task: task) }
            if task.isRunning {
                Button("停止此任务", systemImage: "stop.circle") { Task { await model.stop(task.id) } }
                    .disabled(model.working).frame(minHeight: 44)
            }
            if let progress = task.progress, !progress.preview.isEmpty, task.status != "completed" {
                DisclosureGroup(task.isRunning ? "生成中的预览" : "未完成的预览") {
                    Text(verbatim: progress.preview).font(.callout).textSelection(.enabled).padding(.top, 8)
                }
            }
            ForEach(artifact.drafts) { draft in
                AgentDraftResultView(model: model, draft: draft, publishable: ["continue", "write_chapter"].contains(task.kind))
            }
            if let report = artifact.analysisReport {
                if let analysisURL {
                    Link(destination: analysisURL) {
                        AgentOutputRow(title: report.title, subtitle: "阅读报告", symbol: "text.magnifyingglass")
                    }
                } else {
                    Label("暂时无法打开报告", systemImage: "doc.text.magnifyingglass")
                        .font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                }
            }
            if let rewrite = artifact.rewrite {
                rewriteResult(rewrite)
            }
            ForEach(artifact.covers) { cover in
                VStack(alignment: .leading, spacing: 12) {
                    AgentCoverPreview(sessionID: model.sessionID, candidateID: cover.id)
                    DisclosureGroup("画面描述") { Text(verbatim: cover.prompt).font(.callout).textSelection(.enabled) }
                    Button("预览设为封面") { Task { await model.prepare(.adoptCover, targetID: cover.id) } }
                        .buttonStyle(.bordered).frame(minHeight: 44).disabled(model.working)
                }
            }
            if task.status == "completed", artifact.drafts.isEmpty, artifact.covers.isEmpty, artifact.rewrite == nil, artifact.analysisReport == nil {
                Text(task.kind == "cover" ? "候选可能已采纳或移除，可在产出与采纳中查看记录。" : "任务已完成，详细结果可在 AI 任务中查看。")
                    .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                NavigationLink("查看 AI 任务") { AdminAITasksView() }
            }
        }
    }

    private func rewriteResult(_ rewrite: AIAgentArtifact.Rewrite) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            AppAdaptiveRow(spacing: 12) {
                Text("改写后").font(serifFont(.title3, .semibold))
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NavigationLink {
                    AgentRewriteComparison(rewrite: rewrite)
                } label: {
                    Label("对照原文", systemImage: "text.alignleft")
                        .font(.subheadline).frame(minHeight: AppLayout.minimumTouchTarget)
                }
            }
            if let warning = rewrite.minimumLengthWarning {
                Text(verbatim: warning).font(.footnote).foregroundStyle(AppTheme.textSecondary)
            }
            Text(verbatim: rewrite.after).textSelection(.enabled).lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { Task { await model.prepare(.applyRewrite, targetID: artifact.id) } } label: {
                Text("预览采纳").frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
            }
            .buttonStyle(.borderedProminent).disabled(model.working)
        }
    }
}

private struct AgentRewriteComparison: View {
    let rewrite: AIAgentArtifact.Rewrite

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                AgentPlainPreview(title: "原文", text: rewrite.before)
                AgentPlainPreview(title: "改写后", text: rewrite.after)
            }
            .padding(20).frame(maxWidth: AppLayout.readableWidth, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(AppTheme.canvas)
        .navigationTitle("原文与改写")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AgentDraftResultView: View {
    let model: AdminAIAgentConversationModel
    let draft: AIAgentArtifact.Draft
    let publishable: Bool
    @State private var title: String
    @State private var showsPublishFields = false

    init(model: AdminAIAgentConversationModel, draft: AIAgentArtifact.Draft, publishable: Bool) {
        self.model = model
        self.draft = draft
        self.publishable = publishable
        _title = State(initialValue: draft.title == "未命名章节" ? "" : draft.title)
    }

    private var excerpt: String {
        let opening = draft.content.drop(while: \.isWhitespace).prefix(481)
        if opening.count > 480 { return String(opening.prefix(480)) + "…" }
        return String(opening)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: draft.title).font(serifFont(.title2, .semibold))
                    .foregroundStyle(AppTheme.textPrimary).accessibilityAddTraits(.isHeader)
                Text(draft.status == "draft" ? "未发布" : "已发布")
                    .font(.subheadline).foregroundStyle(AppTheme.textSecondary)
            }
            let opening = excerpt
            if let warning = draft.minimumLengthWarning {
                Text(verbatim: warning).font(.footnote).foregroundStyle(AppTheme.textSecondary)
            }
            if !opening.isEmpty {
                Text(verbatim: opening).font(.body).lineSpacing(5).appTextLineLimit(5)
                    .foregroundStyle(AppTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(AppTheme.surfaceSecondary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            NavigationLink {
                draftReader
            } label: {
                Label("阅读全文", systemImage: "doc.plaintext")
                    .frame(minHeight: AppLayout.minimumTouchTarget)
            }
            if publishable && draft.status == "draft" { publishFields }
        }
    }

    private var draftReader: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(verbatim: draft.title).font(serifFont(.title2, .semibold)).accessibilityAddTraits(.isHeader)
                Text(verbatim: draft.content).textSelection(.enabled).lineSpacing(5)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20).frame(maxWidth: AppLayout.readableWidth, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(AppTheme.canvas)
        .navigationTitle("草稿全文")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var publishFields: some View {
        DisclosureGroup(isExpanded: $showsPublishFields) {
            VStack(alignment: .leading, spacing: 10) {
                Text("发布章节标题").font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                TextField("输入章节标题", text: $title, axis: .vertical).lineLimit(1...3)
                    .frame(minHeight: AppLayout.fieldMinHeight)
                    .padding(.horizontal, AppLayout.fieldHorizontalInset)
                    .appFieldSurface().accessibilityLabel("发布章节标题")
                    .disabled(model.working)
                if title.utf16.count > 200 {
                    Text("章节标题过长，请缩短后再预览。").font(.footnote).foregroundStyle(AppTheme.warning)
                }
                Button {
                    Task { await model.prepare(.publishDraft, targetID: draft.id, title: title) }
                } label: {
                    Text("预览发布章节").frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.working || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.utf16.count > 200)
            }
            .padding(.top, 8)
        } label: {
            Label("准备发布", systemImage: "square.and.arrow.up")
                .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        }
    }
}

struct AgentPlainPreview: View {
    let title: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(AppTheme.textSecondary)
            Text(verbatim: text).textSelection(.enabled).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading)
        }
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
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 220)
            .background(AppTheme.surfaceSecondary)
        }
        .frame(maxWidth: 300, maxHeight: 420)
        .clipShape(RoundedRectangle(cornerRadius: 16))
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
        case .publishDraft: return "发布章节"
        case .applyRewrite: return "替换草稿中的选段"
        case .adoptCover: return "设为当前封面"
        case .restoreDraft: return "恢复上一版草稿"
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(action.title).font(serifFont(.title2, .semibold)).accessibilityAddTraits(.isHeader)
                    Text("作品：\(model.session.novelTitle)").font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                    if let draftTitle { Text("草稿：\(draftTitle)").font(.subheadline).foregroundStyle(AppTheme.textSecondary) }
                    Text(action.preview.description)
                }
                Label(AgentDisplay.status(action.status), systemImage: action.status == "completed" ? "checkmark.circle" : "doc.text")
                    .font(.subheadline).foregroundStyle(action.status == "completed" ? AppTheme.success : AppTheme.textSecondary)
                if let before = action.preview.before { AgentPlainPreview(title: "修改前", text: before) }
                if let after = action.preview.after { AgentPlainPreview(title: action.kind == .publishDraft ? "发布内容" : "修改后", text: after) }
                if let id = action.preview.candidateId { AgentCoverPreview(sessionID: model.sessionID, candidateID: id) }
                if !action.error.isEmpty { Text(verbatim: action.error).foregroundStyle(.red).textSelection(.enabled) }
                if let error = model.operationError { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                controls
            }
            .padding(20).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }
        .id(action.id)
        .background(AppTheme.canvas)
        .navigationTitle("预览与确认")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            if action.canConfirm {
                Button { Task { await model.confirm(action) } } label: {
                    HStack { Text(confirmLabel); if model.working { ProgressView() } }
                        .frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.borderedProminent).disabled(model.working)
            }
            if action.status == "pending" {
                Button("放弃这次采纳", role: .destructive) { Task { await model.reject(action) } }
                    .frame(minHeight: 44).disabled(model.working)
            }
            if action.status == "completed", action.kind == .applyRewrite || action.kind == .restoreDraft {
                Button("预览恢复修改前的草稿") { Task { await model.prepare(.restoreDraft, targetID: action.id) } }
                    .frame(minHeight: 44).disabled(model.working)
            }
            if action.status == "failed" {
                Text("请核对当前内容，返回产出区重新预览；已变化的版本不会被覆盖。")
                    .font(.footnote).foregroundStyle(AppTheme.textSecondary)
            }
            Button("刷新操作状态") { Task { await model.openAction(action.id) } }.frame(minHeight: 44).disabled(model.working)
        }
    }
}
