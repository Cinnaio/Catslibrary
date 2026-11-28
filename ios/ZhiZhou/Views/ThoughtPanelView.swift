import Foundation
import SwiftUI

/// 阅读器中的段评面板：展示当前段落的讨论，并负责输入、校验和删除操作。
struct ThoughtPanelView: View {
    let sourceContext: SourceThoughtPanelContext?
    @State private var sourceFilter = "all"
    let chapterTitle: String
    let selectedText: String
    let contextNotice: String?
    let thoughts: [Thought]
    let currentUserID: String?
    let defaultDisplayName: String
    let isLoading: Bool
    let isSubmitting: Bool
    let loadError: String?
    let canCompose: Bool
    let onRetry: () -> Void
    let onSubmit: (String, String) async throws -> Void
    let onDelete: (String) async throws -> Void
    let panelTitle: String

    private let onClose: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding private var draft: String
    @State private var submitError: String?
    @State private var pendingDelete: Thought?
    @State private var deletingIDs: Set<String> = []
    @FocusState private var composerFocused: Bool

    init(
        chapterTitle: String,
        selectedText: String,
        draft: Binding<String>,
        thoughts: [Thought],
        currentUserID: String?,
        defaultDisplayName: String,
        isLoading: Bool,
        isSubmitting: Bool,
        loadError: String?,
        canCompose: Bool,
        onRetry: @escaping () -> Void,
        onSubmit: @escaping (String, String) async throws -> Void,
        onDelete: @escaping (String) async throws -> Void,
        panelTitle: String = "本段想法",
        contextNotice: String? = nil,
        sourceContext: SourceThoughtPanelContext? = nil,
        onClose: (() -> Void)? = nil
    ) {
        self.sourceContext = sourceContext
        self.chapterTitle = chapterTitle
        self.selectedText = selectedText
        self.contextNotice = contextNotice
        self._draft = draft
        self.thoughts = thoughts
        self.currentUserID = currentUserID
        self.defaultDisplayName = defaultDisplayName
        self.isLoading = isLoading
        self.isSubmitting = isSubmitting
        self.loadError = loadError
        self.canCompose = canCompose
        self.onRetry = onRetry
        self.onSubmit = onSubmit
        self.onDelete = onDelete
        self.panelTitle = panelTitle
        self.onClose = onClose
    }

    private func closePanel() {
        if let onClose { onClose() }
        else { dismiss() }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if usesScrollingTitle { ReaderPanelHeading(panelTitle) }
                    paragraphHeader
                    if let sourceContext, sourceContext.visible {
                        sourcePicker(label: sourceContext.label)
                    }
                    discussionContent
                    if dynamicTypeSize.isAccessibilitySize { composer }
                }
                .padding(.horizontal, 22)
                .padding(.top, 8)
                .padding(.bottom, 20)
                .frame(maxWidth: AppLayout.readableWidth)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !dynamicTypeSize.isAccessibilitySize { composer }
            }
            .background { ReadingSpace.profilePaper.ignoresSafeArea() }
            .scrollEdgeEffectStyle(.soft, for: .bottom)
            .readingSpaceNavigation()
            .toolbar {
                if !usesScrollingTitle {
                    ToolbarItem(placement: .principal) {
                        Text(panelTitle)
                            .font(serifFont(.title3, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { closePanel() }
                }
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDragIndicator(.visible)
        .confirmationDialog(
            "删除这条段评？",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除", role: .destructive) {
                if let thought = pendingDelete {
                    Task { await delete(thought) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("删除后不可恢复。")
        }
    }

    private var usesScrollingTitle: Bool {
        dynamicTypeSize.isAccessibilitySize || panelTitle != "本段想法"
    }

    private var paragraphHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(chapterTitle)
                .font(.caption)
                .foregroundStyle(ReadingSpace.profileMuted)
                .appTextLineLimit(2)
                .accessibilityLabel("\(chapterTitle)，\(selectedText.isEmpty ? "本段想法" : "选中文字的想法")")
            if let contextNotice {
                Text(contextNotice)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func sourcePicker(label: String) -> some View {
        let picker = Picker("想法来源", selection: $sourceFilter) {
            Text("全部").tag("all")
            Text("本站").tag("local")
            Text(label).tag("source")
        }
        if dynamicTypeSize.isAccessibilitySize {
            picker.pickerStyle(.menu)
                .frame(minHeight: AppLayout.minimumTouchTarget)
        } else {
            picker.pickerStyle(.segmented)
                .frame(minHeight: AppLayout.minimumTouchTarget)
        }
    }

    private var discussionContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            if sourceFilter != "source" || sourceContext?.visible != true {
                thoughtsContent
            }
            if let sourceContext, sourceContext.visible {
                if sourceFilter != "local" {
                    VStack(alignment: .leading, spacing: 8) {
                        if sourceContext.loading { ProgressView("正在核对来源段落…") }
                        if let error = sourceContext.error {
                            Text(error).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                            Button(action: sourceContext.retry) {
                                Text("重试来源想法").frame(minHeight: AppLayout.minimumTouchTarget)
                            }
                        }
                        if sourceContext.counts?.available == true && sourceContext.anchor == nil {
                            if let sync = sourceContext.counts?.sync, !sync.complete {
                                Text(sync.summary).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                                Button(action: sourceContext.retry) {
                                    Text("更新同步状态").frame(minHeight: AppLayout.minimumTouchTarget)
                                }
                            } else {
                                Text("原文已变化或无法唯一定位，此段暂不显示来源想法。")
                                    .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                            }
                        }
                    }
                }
                if sourceContext.counts?.available == true, let anchor = sourceContext.anchor {
                    SourceThoughtListView(
                        anchor: anchor,
                        label: sourceContext.label,
                        isVisible: sourceFilter != "local",
                        emptyMessage: sourceFilter == "all" && thoughts.isEmpty && !isLoading && loadError == nil
                            ? "这一段还没有想法，写下你的第一条吧。" : nil
                    )
                    .id(anchor)
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: sourceFilter)
    }

    @ViewBuilder
    private var thoughtsContent: some View {
        if isLoading && thoughts.isEmpty {
            HStack(spacing: 10) {
                ProgressView()
                    .tint(AppTheme.primary)
                Text("正在加载本站想法…")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        } else if let loadError, thoughts.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(AppTheme.warning)
                Text("段评暂时加载失败")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ReadingSpace.ink)
                Text(loadError)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .multilineTextAlignment(.center)
                Button(action: onRetry) {
                    Label("重试", systemImage: "arrow.clockwise")
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        } else if thoughts.isEmpty {
            if sourceFilter == "local" || sourceContext?.visible != true {
                VStack(spacing: 8) {
                    Image(systemName: "text.bubble")
                        .font(.title3)
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Text("这一段还没有本站想法")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Text("写下你的第一条想法吧")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 26)
            }
        } else {
            VStack(spacing: 8) {
                ForEach(Array(thoughts.enumerated()), id: \.element.id) { index, thought in
                    thoughtRow(thought)
                        .readingSpaceEntrance(index)
                }

                if isLoading {
                    ProgressView()
                        .tint(AppTheme.primary)
                        .padding(.vertical, 6)
                }

                if let loadError {
                    HStack(spacing: 8) {
                        Text("更新失败：\(loadError)")
                            .font(.caption)
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .appTextLineLimit(2)
                        Spacer(minLength: 8)
                        Button(action: onRetry) {
                            Label("重试", systemImage: "arrow.clockwise")
                                .font(.subheadline.weight(.semibold))
                                .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                        }
                        .foregroundStyle(AppTheme.primary)
                    }
                }
            }
        }
    }

    private func thoughtRow(_ thought: Thought) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ThoughtAvatar(name: authorName(for: thought), url: avatarURL(for: thought))

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(authorName(for: thought))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    if sourceContext?.visible == true {
                        Text("本站")
                            .font(.caption2)
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                }

                if !isGeneratedImagePlaceholder(thought) {
                    Text(thought.thoughtText)
                        .font(.body)
                        .foregroundStyle(ReadingSpace.ink)
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }

                if thought.imageUrl?.isEmpty == false {
                    ReaderMediaView(
                        path: "/api/thoughts/image/\(ReaderMediaAPI.pathSegment(thought.id))",
                        caption: "AI 生成插画",
                        aspectRatio: 1,
                        captionStyle: .trailingFootnote
                    )
                    .frame(width: 144, alignment: .leading)
                }

                HStack(spacing: 8) {
                    Text(Self.relativeTime(for: thought.createdAt))
                        .font(.caption2)
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Spacer(minLength: 0)
                    if currentUserID == thought.userId {
                        Button(role: .destructive) {
                            pendingDelete = thought
                        } label: {
                            Group {
                                if deletingIDs.contains(thought.id) {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "trash")
                                }
                            }
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                        }
                        .font(.caption)
                        .disabled(deletingIDs.contains(thought.id))
                        .accessibilityLabel("删除段评")
                    }
                }
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func isGeneratedImagePlaceholder(_ thought: Thought) -> Bool {
        guard thought.imageUrl?.isEmpty == false else { return false }
        return ["根据这段文字生成的插画", "根据这段文字生成的插图"]
            .contains(thought.thoughtText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if canCompose {
                composerLayout {
                    TextField("写下你的想法…", text: $draft, axis: .vertical)
                        .focused($composerFocused)
                        .font(.body)
                        .lineLimit(1...4)
                        .foregroundStyle(ReadingSpace.ink)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                        .disabled(isSubmitting)
                        .onChange(of: draft) { _, value in
                            if value.count > 300 { draft = String(value.prefix(300)) }
                        }
                        .accessibilityLabel("段评内容")
                        .accessibilityIdentifier("thought.compose")

                    Button {
                        Task { await submit() }
                    } label: {
                        Text("发布到本站")
                            .opacity(isSubmitting ? 0 : 1)
                            .overlay {
                                if isSubmitting {
                                    ProgressView().tint(ReadingSpace.profileMuted)
                                }
                            }
                            .padding(.horizontal, 12)
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                            .foregroundStyle(canSubmit ? ReadingSpace.onSummary : ReadingSpace.profileMuted)
                            .background(canSubmit ? ReadingSpace.summary : ReadingSpace.profileFill, in: Capsule())
                    }
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: true)
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .accessibilityLabel(isSubmitting ? "正在发布到本站" : "发布到本站")
                    .accessibilityIdentifier("thought.publish")
                }
                .padding(6)
                .appGlassEffect(AppTheme.glass, fallback: ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 22))
                .overlay {
                    RoundedRectangle(cornerRadius: 22)
                        .strokeBorder(composerFocused ? AppTheme.primary.opacity(0.5) : .clear, lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: composerFocused)

                Text(sourceContext?.visible == true ? "其他读者可见 · 不会同步到\(sourceContext?.label ?? "书源")" : "其他读者可见")
                    .font(.caption2).foregroundStyle(ReadingSpace.profileMuted)
                if draft.count >= 240 {
                    Text("\(draft.count)/300")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if let submitError {
                    Text(submitError)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .appTextLineLimit(2)
                        .textSelection(.enabled)
                }
            } else {
                Label(currentUserID == nil ? "登录后才能发布到本站" : "此处仅供查看已有段评", systemImage: "person.crop.circle")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? 0 : 22)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: AppLayout.readableWidth)
        .frame(maxWidth: .infinity)
        .background {
            ReadingSpace.profilePaper.ignoresSafeArea(.container, edges: .bottom)
        }
    }

    private var composerLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .bottom, spacing: 8))
    }

    private var canSubmit: Bool {
        !isSubmitting
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func authorName(for thought: Thought) -> String {
        if thought.userId == currentUserID, !resolvedDisplayName.isEmpty { return resolvedDisplayName }
        let value = thought.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? (thought.userId.isEmpty ? "匿名读者" : thought.userId) : value
    }

    private var resolvedDisplayName: String {
        let name = defaultDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? (currentUserID ?? "") : name
    }

    private func avatarURL(for thought: Thought) -> URL? {
        let value = thought.avatarUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            if let absolute = URL(string: value), absolute.scheme != nil {
                return absolute
            }
            if let base = ServerConfig.shared.baseURL,
               let relative = URL(string: value, relativeTo: base)?.absoluteURL {
                return relative
            }
        }
        return APIClient.shared.avatarURL(userId: thought.userId)
    }

    private func submit() async {
        guard canCompose, !isSubmitting else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            submitError = "写点内容再发布。"
            AppFeedback.warning("写点内容再发布")
            return
        }

        submitError = nil

        do {
            try await onSubmit(
                text,
                resolvedDisplayName
            )
            draft = ""
            composerFocused = false
            if sourceFilter == "source" { sourceFilter = "all" }
        } catch is CancellationError {
            // 用户离开页面或请求被取消时，不展示干扰性的错误提示。
        } catch {
            let message = AppCopy.friendlyError(error)
            submitError = message
            AppFeedback.error(message)
        }
    }

    private func delete(_ thought: Thought) async {
        guard !deletingIDs.contains(thought.id) else { return }
        deletingIDs.insert(thought.id)
        defer { deletingIDs.remove(thought.id) }

        do {
            try await onDelete(thought.id)
            pendingDelete = nil
        } catch is CancellationError {
            // 删除请求被取消时保持当前列表不变。
        } catch {
            AppFeedback.error(AppCopy.friendlyError(error))
        }
    }

    private static func relativeTime(for milliseconds: Int64) -> String {
        let seconds = milliseconds > 10_000_000_000
            ? TimeInterval(milliseconds) / 1000
            : TimeInterval(milliseconds)
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter.localizedString(
            for: Date(timeIntervalSince1970: seconds),
            relativeTo: Date()
        )
    }
}

struct ThoughtAvatar: View {
    let name: String
    let url: URL?

    var body: some View {
        CachedAsyncImage(
            url: url,
            targetSize: CGSize(width: 36, height: 36),
            showsRetry: false
        ) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            ZStack {
                ReadingSpace.profileFill
                Text(String(name.first ?? "匿"))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.primary)
            }
        }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
            .overlay {
                Circle()
                    .strokeBorder(ReadingSpace.profileLine, lineWidth: 0.5)
            }
            .accessibilityHidden(true)
    }
}
