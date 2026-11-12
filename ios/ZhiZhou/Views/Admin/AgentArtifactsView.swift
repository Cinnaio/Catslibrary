import SwiftUI
import ZhiZhouCore

struct AgentOutputSheet: View {
    let model: AdminAIAgentConversationModel
    var artifactID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var attemptedLoad = false

    private var artifact: AIAgentArtifact? {
        guard let artifactID else { return nil }
        return model.artifacts.first { $0.id == artifactID }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let artifactID {
                    artifactDetails(artifactID)
                } else {
                    AgentArtifactsView(model: model)
                }
            }
            .background(AppTheme.canvas)
            .navigationTitle(artifact.map { AgentDisplay.kind($0.task.kind) } ?? (artifactID == nil ? "产出与采纳" : "产出详情"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }.disabled(model.working)
                }
            }
            .navigationDestination(isPresented: Binding(get: { model.selectedAction != nil }, set: {
                if !$0 { model.selectedAction = nil }
            })) {
                if let action = model.selectedAction {
                    AgentActionPreview(model: model, initialAction: action)
                        .navigationBarBackButtonHidden(model.working)
                }
            }
        }
        .interactiveDismissDisabled(model.working || model.selectedAction != nil)
        .task(id: artifactID) {
            if let artifactID { await load(artifactID) }
        }
    }

    @ViewBuilder private func artifactDetails(_ id: String) -> some View {
        if let artifact {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error = model.operationError {
                        Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled)
                    }
                    AgentArtifactCard(model: model, artifact: artifact, standalone: true)
                }
                .padding(20).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
            }
            .refreshable { await load(id) }
        } else if !attemptedLoad || model.loadingArtifacts.contains(id) {
            ProgressView("读取产出…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("暂时无法读取这项产出", systemImage: "doc.text.magnifyingglass")
            } description: {
                if let error = model.artifactErrors[id] { Text(error) }
            } actions: {
                Button("重试") { Task { await load(id) } }.frame(minHeight: 44)
            }
        }
    }

    private func load(_ id: String) async {
        await model.refreshArtifact(id)
        attemptedLoad = true
    }
}

struct AgentArtifactsView: View {
    let model: AdminAIAgentConversationModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let error = model.operationError { Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled) }
                if let error = model.loadError {
                    LoadErrorNotice(message: error, isLoading: model.isRefreshing) { Task { await model.refresh() } }
                }
                if !model.actions.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("采纳记录").font(serifFont(.title3, .semibold))
                        ForEach(model.actions.filter(\.canConfirm) + model.actions.filter { !$0.canConfirm }) { action in
                            Button { Task { await model.openAction(action.id) } } label: {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(action.title).foregroundStyle(AppTheme.textPrimary)
                                        Text(AgentDisplay.status(action.status)).font(.caption).foregroundStyle(AppTheme.textSecondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(AppTheme.textSecondary)
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(model.working)
                        }
                    }
                }
                ForEach(model.artifacts) { artifact in AgentArtifactCard(model: model, artifact: artifact) }
                if model.artifacts.isEmpty && model.actions.isEmpty {
                    ContentUnavailableView("产出会保存在这里", systemImage: "doc.text.magnifyingglass",
                        description: Text("生成的草稿、改写建议和封面候选都可以先预览，再决定是否采纳。"))
                }
            }
            .padding(16).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }
        .refreshable { await model.refresh() }
    }
}

private struct AgentArtifactCard: View {
    let model: AdminAIAgentConversationModel
    let artifact: AIAgentArtifact
    var standalone = false
    private var task: AIAgentTask { model.tasks[artifact.id] ?? artifact.task }
    private var analysisURL: URL? {
        guard let report = artifact.analysisReport, report.url.hasPrefix("/admin/ai?"),
              let base = ServerConfig.shared.baseURL else { return nil }
        return URL(string: report.url, relativeTo: base)?.absoluteURL
    }

    var body: some View {
        if standalone { content }
        else { content.padding(16).paperCard() }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !standalone { Text(AgentDisplay.kind(task.kind)).font(serifFont(.title3, .semibold)) }
            AgentTaskStatusView(task: task)
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
            if let analysisURL, let report = artifact.analysisReport {
                Link("阅读\(report.title)", destination: analysisURL).frame(minHeight: 44)
            }
            if let rewrite = artifact.rewrite {
                DisclosureGroup("查看改写前后") {
                    VStack(alignment: .leading, spacing: 16) {
                        AgentPlainPreview(title: "原文", text: rewrite.before)
                        AgentPlainPreview(title: "建议", text: rewrite.after)
                    }.padding(.top, 12)
                }
                Button("预览采纳改写") { Task { await model.prepare(.applyRewrite, targetID: artifact.id) } }
                    .buttonStyle(.bordered).frame(minHeight: 44).disabled(model.working)
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
            if let error = model.artifactErrors[artifact.id] {
                Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled)
            }
            Button(model.loadingArtifacts.contains(artifact.id) ? "正在刷新产出…" : "刷新这项产出", systemImage: "arrow.clockwise") {
                Task { await model.refreshArtifact(artifact.id) }
            }
            .font(.footnote).frame(minHeight: 44).disabled(model.loadingArtifacts.contains(artifact.id))
        }
    }
}

private struct AgentDraftResultView: View {
    let model: AdminAIAgentConversationModel
    let draft: AIAgentArtifact.Draft
    let publishable: Bool
    @State private var title: String

    init(model: AdminAIAgentConversationModel, draft: AIAgentArtifact.Draft, publishable: Bool) {
        self.model = model; self.draft = draft; self.publishable = publishable
        _title = State(initialValue: draft.title == "未命名章节" ? "" : draft.title)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(draft.title).font(.headline)
            Text(draft.status == "draft" ? "未发布草稿" : "已发布").font(.caption).foregroundStyle(AppTheme.textSecondary)
            NavigationLink {
                ScrollView {
                    Text(verbatim: draft.content).textSelection(.enabled).lineSpacing(5)
                        .frame(maxWidth: 780, alignment: .leading).padding(20).frame(maxWidth: .infinity)
                }
                .background(AppTheme.canvas)
                .navigationTitle(draft.title)
                .navigationBarTitleDisplayMode(.inline)
            } label: {
                Label("阅读全文", systemImage: "doc.plaintext").frame(minHeight: 44)
            }
            if publishable && draft.status == "draft" {
                TextField("章节标题", text: $title, axis: .vertical).lineLimit(1...3)
                    .padding(12).appFieldSurface().accessibilityLabel("发布章节标题")
                Button("预览发布章节") { Task { await model.prepare(.publishDraft, targetID: draft.id, title: title) } }
                    .buttonStyle(.bordered)
                    .disabled(model.working || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.utf16.count > 200)
            }
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
