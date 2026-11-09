import SwiftUI
import ZhiZhouCore

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
                        ForEach(model.actions) { action in
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
    private var task: AIAgentTask { model.tasks[artifact.id] ?? artifact.task }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(AgentDisplay.kind(task.kind)).font(serifFont(.title3, .semibold))
            AgentTaskStatusView(task: task)
            if task.isRunning {
                Button("停止此任务", systemImage: "stop.circle") { Task { await model.stop(task.id) } }
                    .disabled(model.working).frame(minHeight: 44)
            }
            if let progress = task.progress, !progress.preview.isEmpty, task.status != "completed" {
                DisclosureGroup("生成中的预览（尚未完成）") {
                    Text(verbatim: progress.preview).font(.callout).textSelection(.enabled).padding(.top, 8)
                }
            }
            ForEach(artifact.drafts) { draft in
                AgentDraftResultView(model: model, draft: draft, publishable: ["continue", "write_chapter"].contains(task.kind))
            }
            if let rewrite = artifact.rewrite {
                DisclosureGroup("查看改写前后") {
                    VStack(alignment: .leading, spacing: 16) {
                        AgentPlainPreview(title: "原文", text: rewrite.before)
                        AgentPlainPreview(title: "建议", text: rewrite.after)
                    }.padding(.top, 12)
                }
                Button("预览采纳改写") { Task { await model.prepare(.applyRewrite, targetID: artifact.id) } }
                    .buttonStyle(.bordered).disabled(model.working)
            }
            ForEach(artifact.covers) { cover in
                VStack(alignment: .leading, spacing: 12) {
                    AgentCoverPreview(sessionID: model.sessionID, candidateID: cover.id)
                    DisclosureGroup("画面描述") { Text(verbatim: cover.prompt).font(.callout).textSelection(.enabled) }
                    Button("预览设为封面") { Task { await model.prepare(.adoptCover, targetID: cover.id) } }
                        .buttonStyle(.bordered).disabled(model.working)
                }
            }
            if task.status == "completed", artifact.drafts.isEmpty, artifact.covers.isEmpty, artifact.rewrite == nil {
                Text(task.kind == "cover" ? "候选可能已采纳或移除，可查看上方采纳记录。" : "任务已完成，详细结果可在 AI 任务中查看。")
                    .font(.footnote).foregroundStyle(AppTheme.textSecondary)
                NavigationLink("查看 AI 任务") { AdminAITasksView() }
            }
            Button("刷新这项产出", systemImage: "arrow.clockwise") { Task { _ = await model.openArtifact(artifact.id) } }
                .font(.footnote).frame(minHeight: 44).disabled(model.working)
        }
        .padding(16).paperCard()
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
            DisclosureGroup("阅读全文") {
                Text(verbatim: draft.content).textSelection(.enabled).lineSpacing(5)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
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
    private var action: AIAgentAction { model.selectedAction ?? initialAction }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text(action.title).font(serifFont(.title2, .semibold))
                    Text(action.preview.description)
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
            .background(AppTheme.canvas)
            .navigationTitle("预览与确认")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() }.disabled(model.working) } }
            .interactiveDismissDisabled(model.working)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            if action.canConfirm {
                Button { Task { await model.confirm(action) } } label: {
                    HStack { Text(action.status == "executing" ? "核对后继续执行" : "确认采纳"); if model.working { ProgressView() } }
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
