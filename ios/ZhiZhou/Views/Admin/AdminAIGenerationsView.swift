import SwiftUI
import UIKit
import ZhiZhouCore

/// AI 已生成内容：列表 / 类型与状态筛选 / 批量删除 / 批次发布 / 草稿编辑 / 发布 / 撤销发布 / 删除。
/// 对齐 Web 端 admin ai AiGenerationsPanel（/api/ai/generations、/api/ai/writing/drafts|batches）。
struct AdminAIGenerationsView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let taskID: String?
    private let novelID: String?

    init(taskID: String? = nil, novelID: String? = nil, initialStatus: String = "all") {
        self.taskID = taskID
        self.novelID = novelID
        _statusFilter = State(initialValue: initialStatus)
        _scopeFilter = State(initialValue: novelID != nil || initialStatus == "draft" ? "writing" : "all")
    }

    private struct GenerationDisplayGroup: Identifiable {
        let id: String
        let batchID: String?
        let items: [AiGeneration]
        let expectedCount: Int

        var isBatch: Bool { batchID != nil }
        var representative: AiGeneration { items[0] }
        var itemIDs: [String] { items.map(\.id) }
        var draftCount: Int { items.filter(\.isDraft).count }
        var publishedCount: Int { items.filter(\.isPublished).count }
        var latestCreatedAt: Int64 { items.compactMap(\.createdAt).max() ?? 0 }

        var novelID: String? {
            guard let novelID = representative.novelId?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !novelID.isEmpty else { return nil }
            return novelID
        }

        var progressText: String {
            if items.count < expectedCount {
                return "续写批次 · 当前显示 \(items.count)/\(expectedCount) 项"
            }
            return "续写批次 · 共 \(expectedCount) 章"
        }

        var publishConfirmationMessage: String {
            let novel = representative.novelTitle?.isEmpty == false ? representative.novelTitle! : "未知小说"
            return "将按批次编号从小到大，把这个批次中可发布的草稿发布为《\(novel)》的正式章节。已有单独发布的草稿会自动跳过；标题优先使用 AI 标题，缺失时按正式章节序号回退。"
        }
    }

    @State private var items: [AiGeneration] = []
    @State private var totalCount = 0
    @State private var displayedQuery: [String] = []
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

    private var query: [String] { [taskID ?? "", kindFilter, scopeFilter, statusFilter, novelID ?? ""] }

    // 批量
    @State private var selectionMode = false
    @State private var selectedIds = Set<String>()
    @State private var batchBusy = false
    @State private var lastDeletedIds: [String] = []
    @State private var pendingDangerousOperation: AdminDangerousOperation?
    @State private var expandedBatchIDs = Set<String>()
    @State private var pendingBatchPublish: GenerationDisplayGroup?
    @State private var publishingBatchID: String?

    // 详情
    @State private var viewing: AiGeneration?
    @State private var pendingDelete: AiGeneration?
    @State private var busyItemId: String?

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading(taskID == nil ? (novelID == nil ? "已生成内容" : "本书草稿与发布") : "本次任务结果",
                                  detail: "审阅草稿、核对批次，再发布为正式章节。")
            if taskID == nil {
                filterSection.disabled(hasPendingAction)
            }
            if let errorMessage, !items.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
            if isTransitioning {
                Label(isLoading ? "正在读取新条件，以下仍是上一次的结果" : "以下仍是上一次的结果，请重试读取",
                      systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            if selectionMode && !items.isEmpty {
                selectionBar.disabled(isTransitioning || isLoading || hasPendingAction)
            }
            if !lastDeletedIds.isEmpty {
                Button {
                    Task { await restoreDeleted() }
                } label: {
                    Label("撤销上次删除（\(lastDeletedIds.count) 条）", systemImage: "arrow.uturn.backward")
                        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                }
                .buttonStyle(.borderless)
                .disabled(isLoading || hasPendingAction)
            }
            if taskID != nil && !isTransitioning {
                if taskLinkage == "unavailable" {
                    AccountSettingsNote("旧任务未记录精确关联，暂时没有可安全归属到本次任务的内容。")
                } else if taskLinkage == "legacy_batch" {
                    AccountSettingsNote("本次结果按历史批次关联。")
                }
            }
            generationResults
                .opacity(isTransitioning ? 0.45 : 1)
                .disabled(isTransitioning)
        }
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
                .disabled(isLoading || isTransitioning || hasPendingAction || items.isEmpty)
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
        .confirmationDialog(
            "整批发布续写草稿",
            isPresented: Binding(
                get: { pendingBatchPublish != nil },
                set: { if !$0 { pendingBatchPublish = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingBatchPublish
        ) { batch in
            Button("整批发布 \(batch.draftCount) 章") {
                pendingBatchPublish = nil
                Task { await publishBatch(batch) }
            }
            Button("取消", role: .cancel) { pendingBatchPublish = nil }
        } message: { batch in
            Text(batch.publishConfirmationMessage)
        }
        .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
            guard operation.action == .batchDeleteAIGenerations else { return }
            Task { await batchDelete(operation) }
        }
    }

    private var isTransitioning: Bool {
        !items.isEmpty && displayedQuery != query
    }

    private var hasPendingAction: Bool {
        batchBusy || busyItemId != nil || publishingBatchID != nil
    }

    private var selectionBar: some View {
        AppAdaptiveRow(spacing: 12) {
            Text("已选 \(selectedIds.count) 条")
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.profileMuted)
            Spacer(minLength: 8)
            Button("全选") { selectedIds = Set(items.map { $0.id }) }
                .frame(minHeight: AppLayout.minimumTouchTarget)
            Button("删除所选", role: .destructive) { requestBatchDelete() }
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .disabled(selectedIds.isEmpty)
        }
        .buttonStyle(.borderless)
    }

    @ViewBuilder
    private var generationResults: some View {
        if isLoading && items.isEmpty {
            ProgressView("加载中…")
                .frame(maxWidth: .infinity, minHeight: 160)
        } else if let errorMessage, items.isEmpty {
            ContentUnavailableView {
                Label("加载失败", systemImage: "wifi.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("重试") { Task { await load() } }
            }
        } else if items.isEmpty {
            ContentUnavailableView {
                Label("暂无内容", systemImage: "tray")
            } description: {
                Text("当前筛选条件下没有 AI 生成内容。")
            }
        } else {
            AdminWorkspaceSection("内容（\(totalCount)）") {
                ForEach(Array(displayGroups.enumerated()), id: \.element.id) { index, group in
                    if group.isBatch {
                        generationBatchRow(group).readingSpaceEntrance(index)
                        if expandedBatchIDs.contains(group.id) {
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { childIndex, item in
                                generationRow(item, isBatchChild: true)
                                    .readingSpaceEntrance(childIndex)
                                    .transition(batchChildTransition)
                            }
                        }
                    } else if let item = group.items.first {
                        generationRow(item).readingSpaceEntrance(index)
                    }
                }
                if offset + pageSize < totalCount {
                    Button {
                        Task { await loadMore() }
                    } label: {
                        HStack(spacing: 8) {
                            if loadingMore { ProgressView().controlSize(.small) }
                            Text("加载更多（\(items.count)/\(totalCount)）")
                        }
                        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
                    }
                    .buttonStyle(.borderless)
                    .disabled(isLoading || loadingMore || isTransitioning || errorMessage != nil || hasPendingAction)
                }
            }
        }
    }

    // MARK: - 筛选

    private var filterSection: some View {
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

    private func generationBatchRow(_ group: GenerationDisplayGroup) -> some View {
        let item = group.representative
        let isExpanded = expandedBatchIDs.contains(group.id)

        return HStack(alignment: .top, spacing: 10) {
            if selectionMode {
                selectionControl(ids: group.itemIDs, label: "\(item.novelTitle ?? "此小说")续写批次")
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(item.novelTitle ?? "作品名称未提供")
                    .font(serifFont(.title3, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                AppAdaptiveRow {
                    Text(group.progressText)
                    Spacer(minLength: 8)
                    Text(AdminFormat.relativeTime(group.latestCreatedAt))
                }
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                AppAdaptiveRow {
                    if group.draftCount > 0 {
                        AdminStatusBadge("\(group.draftCount) 个草稿", tint: AppTheme.warning)
                    }
                    if group.publishedCount > 0 {
                        AdminStatusBadge("\(group.publishedCount) 已发布", tint: AppTheme.success)
                    }
                }
                AccountSettingsNote("发布时按批次编号从小到大排列；已单独发布的草稿会自动跳过。")
                AppAdaptiveRow(spacing: 12) {
                    Button {
                        toggleBatchExpansion(group.id)
                    } label: {
                        Label(isExpanded ? "收起章节" : "查看章节",
                              systemImage: isExpanded ? "chevron.up" : "chevron.down")
                            .contentTransition(reduceMotion ? .opacity : .symbolEffect(.replace))
                            .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                    }
                    .accessibilityValue(isExpanded ? "已展开" : "已收起")
                    Spacer(minLength: 8)
                    if publishingBatchID == group.batchID {
                        Label {
                            Text("整批发布中…")
                        } icon: {
                            ProgressView().controlSize(.small)
                        }
                        .font(.subheadline)
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                    } else if group.draftCount > 0 {
                        Button("整批发布", systemImage: "paperplane.fill") { requestBatchPublish(group) }
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                            .disabled(hasPendingAction)
                    }
                }
                .font(.subheadline.weight(.medium))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 6)
        .buttonStyle(.borderless)
    }

    private func generationTitle(_ item: AiGeneration) -> String {
        for title in [item.draftTitle, item.chapterTitle] {
            if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        }
        return AdminFormat.aiTaskKind(item.kind ?? "")
    }

    private func generationRow(_ item: AiGeneration, isBatchChild: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if selectionMode {
                selectionControl(ids: [item.id], label: item.novelTitle ?? "此项")
            }
            VStack(alignment: .leading, spacing: 8) {
                AppAdaptiveRow {
                    Text(AdminFormat.aiTaskKind(item.kind ?? ""))
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Spacer(minLength: 8)
                    AdminStatusBadge(item.isDraft ? "草稿" : item.isPublished ? "已发布" : "已拒绝",
                                     tint: item.isDraft ? AppTheme.warning : item.isPublished ? AppTheme.success : ReadingSpace.profileMuted)
                }
                Text(generationTitle(item))
                    .font(serifFont(.body, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let novel = item.novelTitle, !novel.isEmpty {
                    Text(novel)
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                AppAdaptiveRow {
                    if isBatchChild, let batchIndex = item.batchIndex, batchIndex > 0 {
                        Text("批次第 \(batchIndex) 项")
                    }
                    Spacer(minLength: 8)
                    Text(AdminFormat.relativeTime(item.createdAt ?? 0))
                }
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
                if let result = item.result, !result.isEmpty {
                    Text(result)
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .lineSpacing(3)
                        .appTextLineLimit(2)
                }
                if let quality = item.quality, let warning = quality.warnings.first {
                    Label("质量提示 · \(quality.warnings.count) 项", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                    Text(warning.message)
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(2)
                }
                HStack(spacing: 10) {
                    Button("查看") { viewing = item }
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                        .disabled(hasPendingAction)
                        .accessibilityHint("打开全文与可用的草稿操作")
                    Spacer(minLength: 8)
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
                            Button("删除", systemImage: "trash", role: .destructive) { pendingDelete = item }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.title3)
                                .foregroundStyle(ReadingSpace.profileMuted)
                                .frame(width: 44, height: 44)
                        }
                        .disabled(hasPendingAction)
                        .accessibilityLabel("内容操作")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
        .padding(.leading, isBatchChild ? 14 : 0)
        .overlay(alignment: .leading) {
            if isBatchChild {
                Rectangle().fill(ReadingSpace.profileLine).frame(width: 1)
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(.borderless)
    }

    private func selectionControl(ids: [String], label: String) -> some View {
        let selectedCount = ids.filter { selectedIds.contains($0) }.count
        let isFullySelected = selectedCount == ids.count
        let isPartiallySelected = selectedCount > 0 && !isFullySelected

        return Button {
            toggleSelect(ids)
        } label: {
            Image(
                systemName: isFullySelected
                    ? "checkmark.circle.fill"
                    : isPartiallySelected ? "minus.circle.fill" : "circle"
            )
                .font(.title3)
                .foregroundStyle(isFullySelected || isPartiallySelected ? AppTheme.primary : AppTheme.textSecondary)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .disabled(batchBusy || publishingBatchID != nil)
        .accessibilityLabel(isFullySelected ? "取消选择\(label)" : "选择\(label)")
        .accessibilityValue("已选择 \(selectedCount) / \(ids.count) 条")
        .accessibilityAddTraits(isFullySelected ? .isSelected : [])
    }

    private func toggleSelect(_ ids: [String]) {
        let ids = ids.filter { !$0.isEmpty }
        guard !ids.isEmpty else { return }
        if ids.allSatisfy({ selectedIds.contains($0) }) {
            ids.forEach { selectedIds.remove($0) }
        } else {
            ids.forEach { selectedIds.insert($0) }
        }
    }

    private func toggleBatchExpansion(_ id: String) {
        withAnimation(reduceMotion ? nil : AppMotion.state) {
            if expandedBatchIDs.contains(id) {
                expandedBatchIDs.remove(id)
            } else {
                expandedBatchIDs.insert(id)
            }
        }
    }

    private var batchChildTransition: AnyTransition {
        reduceMotion ? .identity : .opacity
    }

    private func requestBatchPublish(_ batch: GenerationDisplayGroup) {
        guard batch.draftCount > 0, batch.batchID != nil, batch.novelID != nil else {
            actionError = "该批次没有可发布的草稿或缺少关联小说"
            return
        }
        guard publishingBatchID == nil, !batchBusy else { return }
        pendingBatchPublish = batch
    }

    private func publishBatch(_ batch: GenerationDisplayGroup) async {
        guard let batchID = batch.batchID,
              let novelID = batch.novelID,
              !batchID.isEmpty,
              !novelID.isEmpty,
              batch.draftCount > 0,
              publishingBatchID == nil,
              !batchBusy else { return }

        publishingBatchID = batchID
        defer { publishingBatchID = nil }
        do {
            let response = try await AdminAPI.aiPublishBatch(batchId: batchID, novelId: novelID)
            let count = response.published?.count ?? 0
            if count > 0 {
                AppFeedback.success("已整批发布 \(count) 章")
            } else {
                AppFeedback.warning("没有可发布的草稿")
            }
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var displayGroups: [GenerationDisplayGroup] {
        var grouped: [String: [AiGeneration]] = [:]
        var order: [String] = []

        for item in items {
            let batchID = normalizedBatchID(item.batchId)
            let key = batchID.map { "batch|\($0)" } ?? "item|\(item.id)"
            if grouped[key] == nil { order.append(key) }
            grouped[key, default: []].append(item)
        }

        return order.compactMap { key in
            guard let values = grouped[key], !values.isEmpty else { return nil }
            let sorted = values.sorted(by: generationOrder)
            let first = sorted[0]
            let batchID = normalizedBatchID(first.batchId)
            let expectedCount = max(
                sorted.count,
                sorted.compactMap(\.batchCount).max() ?? 0
            )
            let isBatch = first.kind == "continue"
                && batchID != nil
                && (expectedCount > 1 || sorted.count > 1)

            return GenerationDisplayGroup(
                id: isBatch ? "batch|\(batchID!)" : first.id,
                batchID: isBatch ? batchID : nil,
                items: sorted,
                expectedCount: isBatch ? expectedCount : sorted.count
            )
        }
    }

    private func normalizedBatchID(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func generationOrder(_ lhs: AiGeneration, _ rhs: AiGeneration) -> Bool {
        let leftIndex = lhs.batchIndex ?? Int.max
        let rightIndex = rhs.batchIndex ?? Int.max
        if leftIndex != rightIndex { return leftIndex < rightIndex }

        let leftCreated = lhs.createdAt ?? 0
        let rightCreated = rhs.createdAt ?? 0
        if leftCreated != rightCreated { return leftCreated < rightCreated }
        return lhs.id < rhs.id
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
            let linkage: String?
            if let taskID, !taskID.isEmpty {
                let taskResult = try await AdminAPI.aiTaskGenerations(id: taskID)
                linkage = taskResult.linkage
                result = AiGenerationsResponse(items: taskResult.items, total: taskResult.items.count, limit: taskResult.items.count, offset: 0)
            } else {
                linkage = nil
                result = try await AdminAPI.aiGenerations(
                    kind: ticket.query[1],
                    scope: ticket.query[2],
                    status: ticket.query[3],
                    limit: pageSize,
                    offset: 0,
                    novelId: ticket.query[4]
                )
            }
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            if let novelID, result.novelId != novelID {
                throw APIError.http(status: 409, message: "当前服务端不支持按作品查看草稿，请更新服务端后重试。")
            }
            let changesQuery = displayedQuery != ticket.query
            withAnimation(changesQuery && !reduceMotion ? AppMotion.micro : nil) {
                items = result.items
                selectedIds.formIntersection(items.map(\.id))
                totalCount = result.total ?? items.count
                offset = 0
                taskLinkage = linkage
                displayedQuery = ticket.query
            }
            errorMessage = nil
            requests.finish(ticket, succeeded: true)
            isLoading = false
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        guard !isLoading, !loadingMore, !isTransitioning, errorMessage == nil, offset + pageSize < totalCount,
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
                offset: next,
                novelId: ticket.query[4]
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: query) else { return }
            if let novelID, result.novelId != novelID {
                throw APIError.http(status: 409, message: "服务端未确认作品筛选，请刷新后重试。")
            }
            let existing = Set(items.map(\.id))
            withAnimation(reduceMotion ? nil : AppMotion.micro) {
                items += result.items.filter { !existing.contains($0.id) }
            }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showMetadata = false
    @State private var showQualityDetails = false
    @State private var showRewriteTools = false
    @State private var showTitleCandidates = false
    @State private var editorIsFocused = false
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case title, rewrite }

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
    @State private var contentRevision = ""
    @State private var quality: AiWritingQuality?
    @State private var qualityNotice: String?
    @State private var selectedRange: NSRange?
    @State private var rewriteMode = "polish"
    @State private var rewriteInstruction = ""
    @State private var rewriteTaskID: String?
    @State private var rewriteTaskStatus = ""
    @State private var rewriteSuggestion: AiRewriteTaskResult?
    @State private var rewriteSelectedText = ""
    @State private var rewriteBaseRevision = ""
    @State private var rewriteApplyOperationID = ""
    @State private var rewriteBusy = false
    @State private var rewritePollTask: Task<Void, Never>?
    private let maxRewriteScalars = 6_000

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

    private var canRewriteSelection: Bool {
        guard isPublishableDraft, !isEditing || !isDirty, let selectedSavedText else { return false }
        return selectedSavedText.unicodeScalars.count <= maxRewriteScalars
    }

    private var selectedSavedText: String? {
        guard let selectedRange, selectedRange.location >= 0, selectedRange.length > 0,
              selectedRange.location + selectedRange.length <= (savedText as NSString).length else { return nil }
        return (savedText as NSString).substring(with: selectedRange)
    }

    private var rewriteSuggestionIsApplicable: Bool {
        guard let suggestion = rewriteSuggestion,
              suggestion.draftId == item.id,
              let baseRevision = suggestion.baseRevision,
              !baseRevision.isEmpty,
              baseRevision == contentRevision,
              !(isEditing && isDirty) else { return false }
        return true
    }

    private var rewriteSuggestionLengthNotice: String? {
        guard let suggestion = rewriteSuggestion,
              suggestion.mode == "shorten",
              suggestion.startUTF16 == 0,
              suggestion.endUTF16 == (currentText as NSString).length,
              suggestion.selectedText == currentText,
              let text = suggestion.suggestion,
              let targetWords = quality?.targetWords,
              targetWords > 0 else { return nil }
        // Match the server's JavaScript whitespace exclusion and Unicode scalar count.
        let bodyCharacters = text.unicodeScalars.reduce(0) { count, scalar in
            switch scalar.value {
            case 0x0009...0x000D, 0x0020, 0x00A0, 0x1680, 0x2000...0x200A,
                 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
                return count
            default:
                return count + 1
            }
        }
        guard Double(bodyCharacters) > Double(targetWords) * 1.3 else { return nil }
        return "精简建议仍超过目标 \(targetWords) 字的三成，请核对篇幅后决定是否应用；原稿尚未修改。"
    }

    var body: some View {
        NavigationStack {
            AgentPanelPage {
                detailHeading
                draftBody
                if isEditableDraft { draftActions }
                if quality != nil || qualityNotice != nil { qualitySection }
                if isPublishableDraft {
                    rewriteSection
                    publicationSection
                } else if item.isPublished {
                    Button {
                        clearInputFocus()
                        Task { await unpublish() }
                    } label: {
                        actionLabel("撤销发布", symbol: "arrow.uturn.backward", working: savingAction == "unpublish")
                    }
                    .buttonStyle(AgentPanelButtonStyle())
                    .disabled(saving)
                }
                if let actionError {
                    AgentPanelNotice(actionError, isError: true)
                }
                metadataSection
            }
            .disabled(saving)
            .transaction { transaction in
                if reduceMotion { transaction.animation = nil }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { requestClose() }.disabled(saving)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { clearInputFocus() }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
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
            contentRevision = item.contentRevision ?? ""
            quality = item.quality
            qualityNotice = nil
            selectedRange = nil
            rewriteTaskID = nil
            rewriteTaskStatus = ""
            rewriteSuggestion = nil
            publishTitle = item.draftTitle ?? ""
        }
        .onDisappear {
            rewritePollTask?.cancel()
            // 系统下滑关闭不会经过工具栏按钮；仍要把已保存正文的刷新信号交给父列表。
            notifyClose(didMutate)
        }
    }

    private func notifyClose(_ refresh: Bool) {
        guard !didNotifyClose else { return }
        didNotifyClose = true
        onClose(refresh)
    }

    private var detailTitle: String {
        for title in [item.draftTitle, item.chapterTitle] {
            if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        }
        return "生成内容"
    }

    private var detailHeading: some View {
        VStack(alignment: .leading, spacing: 12) {
            AgentPanelHeading(detailTitle, detail: item.novelTitle ?? "")
            AppAdaptiveRow {
                Text(AdminFormat.aiTaskKind(item.kind ?? ""))
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                Spacer(minLength: 8)
                AdminStatusBadge(item.isDraft ? "草稿" : item.isPublished ? "已发布" : "已拒绝",
                                 tint: item.isDraft ? AppTheme.warning : item.isPublished ? AppTheme.success : ReadingSpace.profileMuted)
            }
            if isEditing && isDirty {
                Label("有未保存修改", systemImage: "pencil")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.warning)
            }
        }
    }

    private var draftBody: some View {
        AgentPanelSection("正文") {
            if isEditing {
                AgentPanelField("草稿正文", isFocused: editorIsFocused) {
                    DraftSelectionTextView(text: $editorText, selectedRange: $selectedRange, isFocused: $editorIsFocused)
                        .frame(minHeight: 340)
                }
            } else {
                Text(savedText.isEmpty ? "（无内容）" : savedText)
                    .font(.body)
                    .foregroundStyle(ReadingSpace.ink)
                    .lineSpacing(7)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
    }

    private var draftActions: some View {
        AppAdaptiveRow(spacing: 12) {
            if !isEditing {
                Button("编辑草稿") {
                    editorText = savedText
                    isEditing = true
                }
                .buttonStyle(AgentPanelButtonStyle())
            } else {
                Button {
                    clearInputFocus()
                    Task { await saveDraft() }
                } label: {
                    actionLabel("保存修改", symbol: "checkmark", working: savingAction == "draft")
                }
                .buttonStyle(AgentPanelButtonStyle(prominent: true))
                .disabled(saving)
                Button("放弃编辑") {
                    clearInputFocus()
                    editorText = savedText
                    isEditing = false
                }
                .buttonStyle(AgentPanelButtonStyle())
                .disabled(saving)
            }
        }
    }

    private var metadataSection: some View {
        DisclosureGroup(isExpanded: $showMetadata) {
            VStack(alignment: .leading, spacing: 16) {
                if let novel = item.novelTitle, !novel.isEmpty {
                    AgentPanelFact(title: "小说", value: novel)
                }
                if let chapter = item.chapterTitle, !chapter.isEmpty {
                    AgentPanelFact(title: "章节", value: chapter)
                }
                if let model = item.model, !model.isEmpty {
                    AgentPanelFact(title: "模型", value: model)
                }
                AgentPanelFact(title: "内容 ID", value: item.id)
            }
            .padding(.top, 12)
        } label: {
            Text("来源与模型").font(serifFont(.title3, .medium))
        }
    }

    private var rewriteSection: some View {
        DisclosureGroup(isExpanded: $showRewriteTools) {
            VStack(alignment: .leading, spacing: 16) {
                AccountSettingsNote("先点“编辑草稿”，在正文中选择一段；改写建议会单独生成，应用前仍需确认。")
                if let quality, quality.needsShortening {
                    shorteningAction(targetWords: quality.targetWords)
                }
                AgentPanelField("改写模式") {
                    Picker("模式", selection: $rewriteMode) {
                        Text("润色").tag("polish")
                        Text("扩写").tag("expand")
                        Text("精简").tag("shorten")
                        Text("自定义").tag("custom")
                    }
                    .pickerStyle(.menu)
                    .disabled(rewriteBusy)
                }
                if rewriteMode == "custom" || rewriteMode == "shorten" || !rewriteInstruction.isEmpty {
                    AgentPanelField("改写要求", isFocused: focusedField == .rewrite) {
                        TextField(rewriteMode == "custom" ? "改写说明（最多 2000 字符）" : "补充要求（选填，最多 2000 字符）", text: $rewriteInstruction, axis: .vertical)
                            .lineLimit(2...5)
                            .focused($focusedField, equals: .rewrite)
                            .disabled(rewriteBusy)
                    }
                }
                if let selectedSavedText {
                    LabeledContent("当前选区", value: "\(selectedSavedText.unicodeScalars.count) 字符")
                        .font(.footnote)
                    if selectedSavedText.unicodeScalars.count > maxRewriteScalars {
                        Text("选区超过 6000 字符，请缩小范围后生成建议。")
                            .font(.footnote).foregroundStyle(AppTheme.warning)
                    }
                }
                if rewriteInstruction.unicodeScalars.count > 2_000 {
                    Text("改写要求超过 2000 字符，请缩短后生成建议。")
                        .font(.footnote).foregroundStyle(AppTheme.warning)
                }
                Button {
                    clearInputFocus()
                    Task { await startRewrite() }
                } label: {
                    actionLabel("生成改写建议", symbol: "wand.and.stars", working: rewriteBusy)
                }
                .buttonStyle(AgentPanelButtonStyle())
                .disabled(!canRewriteSelection || saving || rewriteBusy || rewriteInstruction.unicodeScalars.count > 2_000 || (rewriteMode == "custom" && rewriteInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                if !rewriteTaskStatus.isEmpty {
                    AccountSettingsNote(rewriteTaskStatus)
                }
                if let rewriteSuggestion {
                    rewriteComparison(rewriteSuggestion)
                }
            }
            .padding(.top, 12)
        } label: {
            Text("选段改写").font(serifFont(.title3, .medium))
        }
    }

    private func shorteningAction(targetWords: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(savedText.unicodeScalars.count <= maxRewriteScalars ? "精简至目标篇幅" : "选择一段精简") {
                showRewriteTools = true
                prepareShortening(targetWords: targetWords)
            }
            .buttonStyle(AgentPanelButtonStyle())
            .disabled(saving || rewriteBusy || (isEditing && isDirty))
            AccountSettingsNote(savedText.unicodeScalars.count <= maxRewriteScalars
                ? "准备全文选区与约 \(targetWords) 字的精简要求，点击“生成改写建议”后再查看和应用。"
                : "全文超过单次改写的 6000 字符上限（含空白与换行），请在正文中选一段精简。")
        }
    }

    private func rewriteComparison(_ suggestion: AiRewriteTaskResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            AgentPanelSection("原选段") {
                Text(suggestion.selectedText ?? "")
                    .font(.body)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .textSelection(.enabled)
                    .lineSpacing(5)
            }
            AgentPanelSection("改写建议") {
                Text(suggestion.suggestion ?? "")
                    .font(.body)
                    .foregroundStyle(ReadingSpace.ink)
                    .textSelection(.enabled)
                    .lineSpacing(5)
            }
            if let rewriteSuggestionLengthNotice {
                Label(rewriteSuggestionLengthNotice, systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(AppTheme.warning)
            }
            if !rewriteSuggestionIsApplicable {
                Label("草稿正文已变化或有未保存修改，这条建议不可应用，请重新选择选段。", systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(AppTheme.warning)
            }
            AppAdaptiveRow(spacing: 12) {
                Button("复制建议") {
                    UIPasteboard.general.string = suggestion.suggestion ?? ""
                }
                .buttonStyle(AgentPanelButtonStyle())
                .disabled((suggestion.suggestion ?? "").isEmpty)
                Button {
                    clearInputFocus()
                    Task { await applyRewrite() }
                } label: {
                    actionLabel("应用到草稿", symbol: "checkmark", working: rewriteBusy)
                }
                .buttonStyle(AgentPanelButtonStyle(prominent: true))
                .disabled(rewriteBusy || !rewriteSuggestionIsApplicable)
            }
        }
    }

    private var publicationSection: some View {
        AgentPanelSection("发布为正式章节") {
            AgentPanelField("章节标题", isFocused: focusedField == .title) {
                TextField("章节标题", text: $publishTitle)
                    .focused($focusedField, equals: .title)
            }
            DisclosureGroup(isExpanded: $showTitleCandidates) {
                VStack(alignment: .leading, spacing: 10) {
                    Button {
                        clearInputFocus()
                        Task { await generateTitles() }
                    } label: {
                        actionLabel("AI 生成标题", symbol: "sparkles", working: generatingTitles)
                    }
                    .buttonStyle(AgentPanelButtonStyle())
                    .disabled(generatingTitles)
                    ForEach(titleCandidates, id: \.self) { title in
                        Button { publishTitle = title } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Text(title).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                if publishTitle == title {
                                    Image(systemName: "checkmark").accessibilityHidden(true)
                                }
                            }
                            .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(publishTitle == title ? AppTheme.primary : ReadingSpace.ink)
                        .accessibilityAddTraits(publishTitle == title ? .isSelected : [])
                    }
                }
                .padding(.top, 12)
            } label: {
                Text("候选标题").font(.subheadline.weight(.medium))
            }
            Button {
                clearInputFocus()
                Task { await publish() }
            } label: {
                actionLabel("发布", symbol: "paperplane.fill", working: savingAction == "publish")
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true))
            .disabled(publishTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || publishStatusUnknown)
        }
    }

    private func clearInputFocus() {
        focusedField = nil
        editorIsFocused = false
    }

    private func actionLabel(_ title: String, symbol: String, working: Bool) -> some View {
        HStack(spacing: 8) {
            if working { ProgressView().controlSize(.small).accessibilityHidden(true) }
            else { Image(systemName: symbol).accessibilityHidden(true) }
            Text(title)
        }
        .accessibilityValue(working ? "正在处理" : "")
    }

    private var qualitySection: some View {
        DisclosureGroup(isExpanded: $showQualityDetails) {
            VStack(alignment: .leading, spacing: 12) {
                if let quality {
                    LabeledContent("已保存正文", value: "约 \(quality.bodyCharacters) 字")
                    if quality.targetWords > 0 {
                        LabeledContent("目标篇幅", value: "约 \(quality.targetWords) 字")
                    }
                    ForEach(Array(quality.warnings.enumerated()), id: \.offset) { _, warning in
                        Label(warning.message, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if isEditing && isDirty {
                        AccountSettingsNote("提示依据已保存正文；保存修改后更新。")
                    }
                }
                if let qualityNotice { AccountSettingsNote(qualityNotice) }
            }
            .padding(.top, 12)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text("篇幅与质量提示").font(serifFont(.title3, .medium))
                if let quality {
                    Text("\(quality.warnings.count) 项提示 · 已保存正文约 \(quality.bodyCharacters) 字")
                        .font(.footnote)
                        .foregroundStyle(quality.warnings.isEmpty ? ReadingSpace.profileMuted : AppTheme.warning)
                } else if qualityNotice != nil {
                    Text("质量提示暂未更新")
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
        }
    }

    private func prepareShortening(targetWords: Int) {
        guard isPublishableDraft, targetWords > 0, !saving, !rewriteBusy, !(isEditing && isDirty) else { return }
        editorText = savedText
        isEditing = true
        rewriteMode = "shorten"
        rewriteTaskID = nil
        rewriteSuggestion = nil
        rewriteApplyOperationID = ""
        if savedText.unicodeScalars.count <= maxRewriteScalars {
            selectedRange = NSRange(location: 0, length: (savedText as NSString).length)
            rewriteInstruction = "将本章精简至约 \(targetWords) 字，保留关键事实、人物关系、叙事视角和事件顺序，删除重复表达与无效铺陈，不新增剧情，只返回精简后的正文。"
            rewriteTaskStatus = "已准备全文精简，请查看要求后点击“生成改写建议”。"
        } else {
            selectedRange = nil
            rewriteInstruction = "本章目标约 \(targetWords) 字。请精简当前选段，保留关键事实、人物关系、叙事视角和事件顺序，删除重复表达与无效铺陈，不新增剧情，只返回这个选段的精简正文。"
            rewriteTaskStatus = "请先在正文中选择不超过 6000 字符的一段，再生成精简建议。"
        }
        actionError = nil
    }

    private func refreshQuality(for text: String, received: AiWritingQuality? = nil) async {
        quality = received
        qualityNotice = nil
        guard received == nil else { return }
        do {
            let latest = try await AdminAPI.aiGeneration(id: item.id).item
            guard savedText == text else { return }
            if latest.result == text {
                quality = latest.quality
            } else {
                qualityNotice = "服务端正文已变化，请重新打开草稿查看最新质量提示。"
            }
        } catch {
            guard savedText == text else { return }
            qualityNotice = "正文已保存，质量提示暂未更新，请重新打开草稿查看。"
        }
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
            contentRevision = response.contentRevision ?? contentRevision
            selectedRange = nil
            rewriteSuggestion = nil
            rewriteTaskID = nil
            isEditing = false
            didMutate = true
            actionError = nil
            await refreshQuality(for: committed, received: response.quality)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func startRewrite() async {
        guard !saving, !rewriteBusy else { return }
        if let selectedSavedText, selectedSavedText.unicodeScalars.count > maxRewriteScalars {
            actionError = "选区超过 6000 字符，请缩小范围后生成建议"
            return
        }
        guard rewriteInstruction.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count <= 2_000 else {
            actionError = "改写要求超过 2000 字符，请缩短后重试"
            return
        }
        guard canRewriteSelection, let selectedRange else {
            actionError = isEditing && isDirty ? "请先保存正文，再重新选择选段" : "请在已保存正文中选择一段"
            return
        }
        let text = savedText as NSString
        guard selectedRange.location >= 0, selectedRange.location + selectedRange.length <= text.length else {
            actionError = "选段已失效，请重新选择"
            return
        }
        if contentRevision.isEmpty {
            do {
                let latest = try await AdminAPI.aiGeneration(id: item.id).item
                guard latest.isDraft, let latestText = latest.result, latestText == savedText else {
                    actionError = "草稿正文已变化，请重新读取后选择"
                    return
                }
                contentRevision = latest.contentRevision ?? ""
            } catch {
                actionError = AppCopy.friendlyError(error)
                return
            }
        }
        guard !contentRevision.isEmpty else {
            actionError = "当前服务端不支持正文版本校验，请更新服务端后重试"
            return
        }
        rewriteSelectedText = text.substring(with: selectedRange)
        rewriteBaseRevision = contentRevision
        rewriteSuggestion = nil
        rewriteTaskStatus = "任务已提交，等待建议…"
        rewriteBusy = true
        defer { rewriteBusy = false }
        do {
            let requestID = UUID().uuidString
            let response = try await AdminAPI.aiRewriteDraft(
                id: item.id,
                baseRevision: contentRevision,
                startUTF16: selectedRange.location,
                endUTF16: selectedRange.location + selectedRange.length,
                selectedText: rewriteSelectedText,
                mode: rewriteMode,
                instruction: rewriteInstruction.trimmingCharacters(in: .whitespacesAndNewlines),
                clientRequestID: requestID
            )
            rewriteTaskID = response.taskId
            await pollRewriteTask(response.taskId)
        } catch {
            rewriteTaskStatus = "改写任务提交失败"
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func pollRewriteTask(_ taskID: String) async {
        rewritePollTask?.cancel()
        rewritePollTask = Task { @MainActor in
            for attempt in 0..<200 where !Task.isCancelled {
                if attempt > 0 { try? await Task.sleep(nanoseconds: 3_000_000_000) }
                guard !Task.isCancelled else { return }
                do {
                    let task = try await AdminAPI.aiTask(id: taskID).task
                    rewriteTaskStatus = task.step?.isEmpty == false ? task.step! : "任务状态：\(AdminFormat.aiTaskStatus(task.status ?? ""))"
                    if ["completed", "failed", "cancelled"].contains(task.status ?? "") {
                        if task.status == "completed", let data = task.result?.data(using: .utf8), let result = try? JSONDecoder().decode(AiRewriteTaskResult.self, from: data) {
                            rewriteSuggestion = result
                            rewriteTaskStatus = "改写建议已生成，请确认后应用"
                        } else if task.status != "completed" {
                            actionError = task.error?.isEmpty == false ? task.error! : "改写建议未生成"
                        }
                        rewritePollTask = nil
                        return
                    }
                } catch {
                    if attempt >= 4 {
                        rewriteTaskStatus = "任务仍在服务器运行，查询暂时中断；请稍后重试"
                        rewritePollTask = nil
                        return
                    }
                }
            }
            rewritePollTask = nil
        }
        await rewritePollTask?.value
    }

    private func applyRewrite() async {
        guard let taskID = rewriteTaskID, let suggestion = rewriteSuggestion, let baseRevision = suggestion.baseRevision, !baseRevision.isEmpty else {
            actionError = "改写建议已失效，请重新生成"
            return
        }
        guard suggestion.draftId == item.id else {
            actionError = "改写建议与当前草稿不匹配"
            return
        }
        guard rewriteSuggestionIsApplicable else {
            actionError = "草稿正文已变化或有未保存修改，这条建议不可应用，请重新选择选段"
            return
        }
        rewriteBusy = true
        if rewriteApplyOperationID.isEmpty { rewriteApplyOperationID = UUID().uuidString }
        defer { rewriteBusy = false }
        do {
            let response = try await AdminAPI.aiApplyRewrite(draftID: item.id, taskID: taskID, baseRevision: baseRevision, operationID: rewriteApplyOperationID)
            guard let result = response.result else {
                actionError = "应用结果缺少正文，请刷新草稿确认"
                return
            }
            savedText = result
            editorText = result
            contentRevision = response.contentRevision ?? contentRevision
            selectedRange = nil
            rewriteSuggestion = nil
            rewriteTaskStatus = "改写已应用到草稿"
            rewriteApplyOperationID = ""
            isEditing = false
            didMutate = true
            await refreshQuality(for: result, received: response.quality)
        } catch {
            // 应用请求可能在服务端已提交后才丢响应；用同一 operationId 重放，禁止生成第二次替换。
            do {
                let response = try await AdminAPI.aiApplyRewrite(draftID: item.id, taskID: taskID, baseRevision: baseRevision, operationID: rewriteApplyOperationID)
                guard let result = response.result else { throw error }
                savedText = result
                editorText = result
                contentRevision = response.contentRevision ?? contentRevision
                selectedRange = nil
                rewriteSuggestion = nil
                rewriteTaskStatus = "改写已应用到草稿"
                rewriteApplyOperationID = ""
                isEditing = false
                didMutate = true
                await refreshQuality(for: result, received: response.quality)
            } catch {
                actionError = AppCopy.friendlyError(error)
            }
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
                contentRevision = response.contentRevision ?? contentRevision
                quality = response.quality
                qualityNotice = nil
                selectedRange = nil
                rewriteSuggestion = nil
                rewriteTaskID = nil
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

/// 可编辑且回传真实 NSRange 的正文编辑器；NSRange 使用 UTF-16 坐标，和服务端改写契约一致。
private struct DraftSelectionTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selectedRange: NSRange?
    @Binding var isFocused: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, selectedRange: $selectedRange, isFocused: $isFocused)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.isEditable = isEnabled
        view.isSelectable = true
        view.isScrollEnabled = true
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = UIColor(ReadingSpace.ink)
        view.tintColor = UIColor(AppTheme.primary)
        view.accessibilityLabel = "草稿正文"
        view.text = text
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        uiView.isEditable = isEnabled
        uiView.font = .preferredFont(forTextStyle: .body)
        uiView.textColor = UIColor(ReadingSpace.ink)
        uiView.tintColor = UIColor(AppTheme.primary)
        if uiView.text != text {
            uiView.text = text
            let length = (text as NSString).length
            let location = min(uiView.selectedRange.location, length)
            uiView.selectedRange = NSRange(location: location, length: 0)
        }
        if let selectedRange, selectedRange.location + selectedRange.length <= (text as NSString).length, uiView.selectedRange != selectedRange {
            uiView.selectedRange = selectedRange
        }
        if (!isFocused || !isEnabled) && uiView.isFirstResponder {
            uiView.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        @Binding var text: String
        @Binding var selectedRange: NSRange?
        @Binding var isFocused: Bool

        init(text: Binding<String>, selectedRange: Binding<NSRange?>, isFocused: Binding<Bool>) {
            _text = text
            _selectedRange = selectedRange
            _isFocused = isFocused
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            isFocused = false
        }

        func textViewDidChange(_ textView: UITextView) {
            text = textView.text
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            // 键盘收起后 UIKit 可能清空高亮，保留选段供下面的改写工具使用。
            guard textView.isFirstResponder || textView.selectedRange.length > 0 else { return }
            selectedRange = textView.selectedRange.length > 0 ? textView.selectedRange : nil
        }
    }
}
