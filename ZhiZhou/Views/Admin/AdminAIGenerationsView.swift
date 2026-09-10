import SwiftUI
import ZhiZhouCore

/// AI 已生成内容：列表 / 类型与状态筛选 / 批量删除 / 草稿编辑 / 发布 / 撤销发布 / 删除。
/// 对齐 Web 端 admin ai AiGenerationsPanel（/api/ai/generations、/api/ai/writing/drafts|batches）。
struct AdminAIGenerationsView: View {
    private let taskID: String?

    init(taskID: String? = nil) {
        self.taskID = taskID
    }

    @State private var items: [AiGeneration] = []
    @State private var totalCount = 0
    @State private var taskLinkage: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var actionError: String?

    // 筛选
    @State private var kindFilter = "all"
    @State private var statusFilter = "all"
    @State private var scopeFilter = "all"

    // 分页
    @State private var offset = 0
    private let pageSize = 50
    @State private var loadingMore = false
    @State private var requests = ListRequestGuard<[String]>()

    private var query: [String] { [taskID ?? "", kindFilter, scopeFilter, statusFilter] }

    // 批量
    @State private var selectionMode = false
    @State private var selectedIds = Set<String>()
    @State private var batchBusy = false
    @State private var lastDeletedIds: [String] = []
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    // 详情
    @State private var viewing: AiGeneration?
    @State private var pendingDelete: AiGeneration?
    @State private var busyItemId: String?

    var body: some View {
        List {
            if taskID == nil { filterSection }
            if isLoading && items.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("暂无内容", systemImage: "tray")
                    } description: {
                        Text("当前筛选条件下没有 AI 生成内容。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if let errorMessage {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load() }
                    }
                }
                if selectionMode {
                    Section {
                        HStack {
                            Text("已选 \(selectedIds.count) 条")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                            Spacer()
                            Button("全选") {
                                selectedIds = Set(items.map { $0.id })
                            }
                            .font(.subheadline)
                            .disabled(batchBusy)
                            Button("删除所选", role: .destructive) {
                                requestBatchDelete()
                            }
                            .font(.subheadline)
                            .disabled(selectedIds.isEmpty || batchBusy)
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                if !lastDeletedIds.isEmpty {
                    Section {
                        Button {
                            Task { await restoreDeleted() }
                        } label: {
                            Label("撤销上次删除（\(lastDeletedIds.count) 条）", systemImage: "arrow.uturn.backward")
                        }
                        .disabled(batchBusy)
                        .listRowBackground(Color.clear)
                    }
                }
                Section(taskID == nil ? "共 \(totalCount) 条" : "本次任务结果（\(totalCount)）") {
                    if taskID != nil, taskLinkage == "unavailable" {
                        Text("旧任务未记录精确关联，暂时没有可安全归属到本次任务的内容。")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    } else if taskID != nil, taskLinkage == "legacy_batch" {
                        Text("本次结果按历史批次关联。")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    ForEach(items) { item in
                        generationRow(item)
                    }
                    if offset + pageSize < totalCount {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                if loadingMore { ProgressView() }
                                Text("加载更多（\(items.count)/\(totalCount)）")
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.primary)
                                Spacer()
                            }
                        }
                        .listRowBackground(Color.clear)
                        .disabled(isLoading || loadingMore || errorMessage != nil)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.browsing)
        .navigationTitle("已生成内容")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: query) {
            selectedIds = []
            await load()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(selectionMode ? "完成" : "选择") {
                    selectionMode.toggle()
                    selectedIds = []
                }
            }
        }
        .sheet(item: $viewing) { item in
            GenerationDetailSheet(item: item) { refresh in
                viewing = nil
                if refresh { Task { await load() } }
            }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .confirmationDialog(
            "删除生成内容",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除内容", role: .destructive) {
                guard let item = pendingDelete else { return }
                pendingDelete = nil
                Task { await delete(item) }
            }
            Button("取消", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("删除后内容不可恢复；已发布内容也会被移除。")
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            guard operation.action == .batchDeleteAIGenerations else { return }
            Task { await batchDelete(operation) }
        }
    }

    // MARK: - 筛选

    private var filterSection: some View {
        Section {
            AdminFilterBar {
                AdminFilterMenu("范围", value: scopeFilterTitle) {
                    Picker("范围", selection: $scopeFilter) {
                        Text("全部").tag("all")
                        Text("读者侧").tag("reader")
                        Text("创作侧").tag("writing")
                    }
                }
                AdminFilterMenu("类型", value: kindFilterTitle) {
                    Picker("类型", selection: $kindFilter) {
                        Text("全部").tag("all")
                        Text("前情提要").tag("summary")
                        Text("回顾总结").tag("catchup")
                        Text("续写").tag("continue")
                        Text("创作大纲").tag("write_outline")
                        Text("创作章节").tag("write_chapter")
                    }
                }
                AdminFilterMenu("状态", value: statusFilterTitle) {
                    Picker("状态", selection: $statusFilter) {
                        Text("已发布").tag("published")
                        Text("草稿").tag("draft")
                        Text("已拒绝").tag("rejected")
                        Text("全部").tag("all")
                    }
                }
            }
        }
    }

    private var scopeFilterTitle: String {
        switch scopeFilter {
        case "reader": return "读者侧"
        case "writing": return "创作侧"
        default: return "全部"
        }
    }

    private var kindFilterTitle: String {
        switch kindFilter {
        case "summary": return "前情提要"
        case "catchup": return "回顾总结"
        case "continue": return "续写"
        case "write_outline": return "创作大纲"
        case "write_chapter": return "创作章节"
        default: return "全部类型"
        }
    }

    private var statusFilterTitle: String {
        switch statusFilter {
        case "published": return "已发布"
        case "draft": return "草稿"
        case "rejected": return "已拒绝"
        default: return "全部状态"
        }
    }

    // MARK: - 行

    private func generationRow(_ item: AiGeneration) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if selectionMode {
                Button {
                    toggleSelect(item.id)
                } label: {
                    Image(systemName: selectedIds.contains(item.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(selectedIds.contains(item.id) ? AppTheme.primary : AppTheme.textSecondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(selectedIds.contains(item.id) ? "取消选择\(item.novelTitle ?? "此项")" : "选择\(item.novelTitle ?? "此项")")
                .accessibilityValue(selectedIds.contains(item.id) ? "已选择" : "未选择")
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    AdminStatusBadge(
                        AdminFormat.aiTaskKind(item.kind ?? ""),
                        tint: AppTheme.primary
                    )
                    if item.isDraft {
                        AdminStatusBadge("草稿", tint: AppTheme.warning)
                    } else if item.isPublished {
                        AdminStatusBadge("已发布", tint: AppTheme.success)
                    }
                    Spacer()
                    Text(AdminFormat.relativeTime(item.createdAt ?? 0))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Text(item.novelTitle ?? "—")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(1)
                if let chapter = item.chapterTitle, !chapter.isEmpty {
                    Text(chapter)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .appTextLineLimit(1)
                }
                if let result = item.result, !result.isEmpty {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .appTextLineLimit(2)
                }
                HStack(spacing: 10) {
                    Button("查看") { viewing = item }
                        .font(.subheadline.weight(.medium))
                    Spacer(minLength: 4)
                    if busyItemId == item.id {
                        AdminInlineProgress()
                    } else {
                        Menu {
                            if item.isDraft, let novelId = item.novelId, !novelId.isEmpty {
                                Button("发布", systemImage: "paperplane") { viewing = item }
                            }
                            if item.isPublished {
                                Button("撤销发布", systemImage: "arrow.uturn.backward", role: .destructive) {
                                    Task { await unpublish(item) }
                                }
                            }
                            Button("删除", systemImage: "trash", role: .destructive) {
                                pendingDelete = item
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.title3)
                                .foregroundStyle(AppTheme.textSecondary)
                                .frame(width: 44, height: 44)
                        }
                        .disabled(busyItemId != nil || batchBusy)
                        .accessibilityLabel("内容操作")
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func toggleSelect(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    // MARK: - 数据

    private func load() async {
        let ticket = requests.begin(query)
        isLoading = true
        loadingMore = false
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                isLoading = false
            }
        }
        do {
            let result: AiGenerationsResponse
            if let taskID, !taskID.isEmpty {
                let taskResult = try await AdminAPI.aiTaskGenerations(id: taskID)
                taskLinkage = taskResult.linkage
                result = AiGenerationsResponse(items: taskResult.items, total: taskResult.items.count, limit: taskResult.items.count, offset: 0)
            } else {
                taskLinkage = nil
                result = try await AdminAPI.aiGenerations(
                    kind: ticket.query[1],
                    scope: ticket.query[2],
                    status: ticket.query[3],
                    limit: pageSize,
                    offset: 0
                )
            }
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            items = result.items
            selectedIds.formIntersection(items.map(\.id))
            totalCount = result.total ?? items.count
            offset = 0
            errorMessage = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        guard !isLoading, !loadingMore, errorMessage == nil, offset + pageSize < totalCount,
              let ticket = requests.beginNext(query) else { return }
        loadingMore = true
        defer {
            if requests.accepts(ticket, query: ticket.query) {
                requests.finish(ticket)
                loadingMore = false
            }
        }
        do {
            let next = offset + pageSize
            let result = try await AdminAPI.aiGenerations(
                kind: ticket.query[1],
                scope: ticket.query[2],
                status: ticket.query[3],
                limit: pageSize,
                offset: next
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            let existing = Set(items.map(\.id))
            items += result.items.filter { !existing.contains($0.id) }
            offset = next
            totalCount = result.total ?? items.count
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func delete(_ item: AiGeneration) async {
        guard busyItemId == nil else { return }
        busyItemId = item.id
        defer { busyItemId = nil }
        do {
            try await AdminAPI.aiDeleteGeneration(id: item.id)
            items.removeAll { $0.id == item.id }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func unpublish(_ item: AiGeneration) async {
        guard busyItemId == nil else { return }
        busyItemId = item.id
        defer { busyItemId = nil }
        do {
            try await AdminAPI.aiUnpublishDraft(id: item.id)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func requestBatchDelete() {
        let ids = selectedIds.sorted()
        guard !ids.isEmpty, !batchBusy else { return }
        pendingDangerousOperation = AdminDangerousOperation(
            action: .batchDeleteAIGenerations,
            kind: .batchDelete,
            targetIDs: ids,
            title: "批量删除生成内容",
            message: "将删除确认时选中的 \(ids.count) 条生成内容；已发布内容也会被移除。目标已锁定，删除后仅可在短暂撤销窗口内恢复。",
            confirmLabel: "删除 \(ids.count) 条内容"
        )
    }

    private func batchDelete(_ operation: AdminDangerousOperation) async {
        let ids = operation.targetIDs
        guard !ids.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            let result = try await AdminAPI.aiDeleteGenerations(
                ids: ids,
                operationID: operation.operationID
            )
            lastDeletedIds = ids
            selectedIds = []
            if (result.deleted ?? 0) > 0 {
                await load()
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func restoreDeleted() async {
        guard !lastDeletedIds.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            _ = try await AdminAPI.aiRestoreGenerations(ids: lastDeletedIds)
            lastDeletedIds = []
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - 详情 Sheet（查看 / 编辑草稿 / 发布）

private struct GenerationDetailSheet: View {
    let item: AiGeneration
    let onClose: (Bool) -> Void

    @State private var savedText = ""
    @State private var editorText = ""
    @State private var isEditing = false
    @State private var didMutate = false
    @State private var showCloseConfirmation = false
    @State private var publishStatusUnknown = false
    @State private var didNotifyClose = false
    @State private var publishTitle = ""
    @State private var titleCandidates: [String] = []
    @State private var generatingTitles = false
    @State private var saving = false
    @State private var savingAction: String?
    @State private var actionError: String?

    private var isEditableDraft: Bool {
        item.isDraft && ["write_chapter", "continue", "write_outline"].contains(item.kind ?? "")
    }

    private var isPublishableDraft: Bool {
        item.isDraft && ["write_chapter", "continue"].contains(item.kind ?? "")
    }

    private var isDirty: Bool {
        editorText.trimmingCharacters(in: .whitespacesAndNewlines) != savedText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var currentText: String {
        isEditing ? editorText : savedText
    }

    var body: some View {
        NavigationStack {
            List {
                Section("信息") {
                    LabeledContent("类型", value: AdminFormat.aiTaskKind(item.kind ?? ""))
                    if let novel = item.novelTitle, !novel.isEmpty {
                        LabeledContent("小说", value: novel)
                    }
                    if let chapter = item.chapterTitle, !chapter.isEmpty {
                        LabeledContent("章节", value: chapter)
                    }
                    if let model = item.model, !model.isEmpty {
                        LabeledContent("模型", value: model)
                    }
                    LabeledContent("状态") {
                        Text(item.isDraft ? "草稿" : item.isPublished ? "已发布" : "已拒绝")
                            .foregroundStyle(item.isDraft ? AppTheme.warning : item.isPublished ? AppTheme.success : AppTheme.textSecondary)
                    }
                }

                Section("内容") {
                    if isEditing {
                        TextEditor(text: $editorText)
                        .frame(minHeight: 260)
                        .font(.subheadline)
                        .scrollContentBackground(.hidden)
                        .padding(AppLayout.textEditorInset)
                        .appFieldSurface()
                        .padding(.vertical, 4)
                    } else {
                        Text(savedText.isEmpty ? "（无内容）" : savedText)
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                }

                if isEditableDraft {
                    Section("草稿操作") {
                        if !isEditing {
                            Button("编辑草稿") {
                                editorText = savedText
                                isEditing = true
                            }
                        } else {
                            Button {
                                Task { await saveDraft() }
                            } label: {
                                if savingAction == "draft" {
                                    Label("保存中…", systemImage: "hourglass")
                                } else {
                                    Text("保存修改")
                                }
                            }
                                .disabled(saving)
                            Button("放弃编辑") {
                                editorText = savedText
                                isEditing = false
                            }
                        }
                    }
                    if isPublishableDraft {
                        Section("发布为正式章节") {
                        TextField("章节标题", text: $publishTitle)
                        Button("AI 生成标题") { Task { await generateTitles() } }
                            .disabled(generatingTitles)
                        if generatingTitles {
                            HStack {
                                ProgressView()
                                Text("正在分析草稿并生成候选标题…")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                                Spacer()
                            }
                        }
                        if !titleCandidates.isEmpty {
                            ForEach(titleCandidates, id: \.self) { title in
                                Button(title) { publishTitle = title }
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.textPrimary)
                            }
                        }
                        Button {
                            Task { await publish() }
                        } label: {
                            if savingAction == "publish" {
                                Label("发布中…", systemImage: "hourglass")
                            } else {
                                Label("发布", systemImage: "paperplane.fill")
                            }
                        }
                        .disabled(publishTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || publishStatusUnknown)
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.primary)
                        }
                    }
                } else if item.isPublished {
                    Section {
                        Button {
                            Task { await unpublish() }
                        } label: {
                            if savingAction == "unpublish" {
                                Label("撤销发布中…", systemImage: "hourglass")
                            } else {
                                Text("撤销发布")
                            }
                        }
                        .disabled(saving)
                    }
                }

                if let actionError {
                    Section {
                        Text(actionError)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle(item.draftTitle?.isEmpty == false ? item.draftTitle! : "生成内容")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { requestClose() }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(saving || (isEditing && isDirty))
        .confirmationDialog(
            "有未保存修改",
            isPresented: $showCloseConfirmation,
            titleVisibility: .visible
        ) {
            Button("保存并关闭") {
                Task { await saveAndClose() }
            }
            .disabled(saving)
            Button("放弃修改", role: .destructive) {
                editorText = savedText
                isEditing = false
                notifyClose(didMutate)
            }
            Button("继续编辑", role: .cancel) {}
        } message: {
            Text("当前正文尚未保存。")
        }
        .onAppear {
            didNotifyClose = false
            savedText = item.result ?? ""
            editorText = savedText
            publishTitle = item.draftTitle ?? ""
        }
        .onDisappear {
            // 系统下滑关闭不会经过工具栏按钮；仍要把已保存正文的刷新信号交给父列表。
            notifyClose(didMutate)
        }
    }

    private func notifyClose(_ refresh: Bool) {
        guard !didNotifyClose else { return }
        didNotifyClose = true
        onClose(refresh)
    }

    private func saveDraft() async {
        guard let text = normalizedEditorText else { return }
        saving = true
        savingAction = "draft"
        defer {
            saving = false
            savingAction = nil
        }
        do {
            let response = try await AdminAPI.aiUpdateDraft(id: item.id, result: text)
            let committed = (response.result ?? text).trimmingCharacters(in: .whitespacesAndNewlines)
            savedText = committed
            editorText = committed
            isEditing = false
            didMutate = true
            actionError = nil
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generateTitles() async {
        let content = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            actionError = "草稿内容为空，无法生成标题"
            return
        }
        generatingTitles = true
        defer { generatingTitles = false }
        do {
            let r = try await AdminAPI.aiWritingTitles(content: content, novelId: item.novelId ?? "", contextTitle: item.chapterTitle ?? "")
            titleCandidates = r.titles ?? []
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func publish() async {
        let title = publishTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let novelId = item.novelId else {
            actionError = "请填写章节标题"
            return
        }
        saving = true
        savingAction = "publish"
        publishStatusUnknown = false
        var publishRequestStarted = false
        defer {
            saving = false
            savingAction = nil
        }
        do {
            // 发布前先提交当前编辑内容；服务端发布事务随后读取锁内最新正文。
            if isEditing && isDirty {
                guard let text = normalizedEditorText else { return }
                let response = try await AdminAPI.aiUpdateDraft(id: item.id, result: text)
                let committed = (response.result ?? text).trimmingCharacters(in: .whitespacesAndNewlines)
                savedText = committed
                editorText = committed
                isEditing = false
                didMutate = true
            }
            publishRequestStarted = true
            _ = try await AdminAPI.aiPublishDraft(id: item.id, novelId: novelId, title: title)
            notifyClose(true)
        } catch {
            if publishRequestStarted && isPublishOutcomeUnknown(error) {
                publishStatusUnknown = true
                actionError = "修改已保存，发布状态待确认。请稍后刷新此内容；确认前不会自动重复发布。"
                await verifyPublishStatus()
            } else {
                actionError = AppCopy.friendlyError(error)
            }
        }
    }

    private func isPublishOutcomeUnknown(_ error: Error) -> Bool {
        if case APIError.network = error { return true }
        if case APIError.invalidResponse = error { return true }
        return false
    }

    private var normalizedEditorText: String? {
        let value = editorText.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func requestClose() {
        guard isEditing && isDirty else {
            notifyClose(didMutate)
            return
        }
        showCloseConfirmation = true
    }

    private func saveAndClose() async {
        guard normalizedEditorText != nil else {
            actionError = "内容不能为空"
            return
        }
        await saveDraft()
        guard !isEditing, actionError == nil else { return }
        notifyClose(true)
    }

    private func verifyPublishStatus() async {
        do {
            let latest = try await AdminAPI.aiGeneration(id: item.id).item
            if latest.isPublished {
                publishStatusUnknown = false
                notifyClose(true)
            } else if latest.isDraft {
                publishStatusUnknown = false
                actionError = "修改已保存，发布尚未完成，可以再次发布。"
            } else {
                actionError = "发布状态已变化，请刷新后确认。"
            }
        } catch {
            actionError = "发布状态暂时无法确认，请稍后刷新。"
        }
    }

    private func unpublish() async {
        saving = true
        savingAction = "unpublish"
        defer {
            saving = false
            savingAction = nil
        }
        do {
            try await AdminAPI.aiUnpublishDraft(id: item.id)
            notifyClose(true)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }
}
