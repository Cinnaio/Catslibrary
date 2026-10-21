import Foundation
import SwiftUI

/// 阅读器中的段评面板：展示当前段落的讨论，并负责输入、校验和删除操作。
struct ThoughtPanelView: View {
    let chapterTitle: String
    let paragraphExcerpt: String
    let selectedText: String
    let thoughts: [Thought]
    let currentUserID: String?
    let defaultDisplayName: String
    let isLoading: Bool
    let loadError: String?
    let canCompose: Bool
    let onRetry: () -> Void
    let onSubmit: (String, String) async throws -> Void
    let onDelete: (String) async throws -> Void
    let panelTitle: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var draft = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var pendingDelete: Thought?
    @State private var deletingIDs: Set<String> = []
    @FocusState private var composerFocused: Bool

    init(
        chapterTitle: String,
        paragraphExcerpt: String,
        selectedText: String,
        thoughts: [Thought],
        currentUserID: String?,
        defaultDisplayName: String,
        isLoading: Bool,
        loadError: String?,
        canCompose: Bool,
        onRetry: @escaping () -> Void,
        onSubmit: @escaping (String, String) async throws -> Void,
        onDelete: @escaping (String) async throws -> Void,
        panelTitle: String = "本段段评"
    ) {
        self.chapterTitle = chapterTitle
        self.paragraphExcerpt = paragraphExcerpt
        self.selectedText = selectedText
        self.thoughts = thoughts
        self.currentUserID = currentUserID
        self.defaultDisplayName = defaultDisplayName
        self.isLoading = isLoading
        self.loadError = loadError
        self.canCompose = canCompose
        self.onRetry = onRetry
        self.onSubmit = onSubmit
        self.onDelete = onDelete
        self.panelTitle = panelTitle
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    paragraphHeader
                    thoughtsContent
                    if dynamicTypeSize.isAccessibilitySize { composer }
                }
                .padding(.horizontal, AppLayout.pageInset)
                .padding(.top, 12)
                .padding(.bottom, 20)
                .frame(maxWidth: AppLayout.readableWidth)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !dynamicTypeSize.isAccessibilitySize { composer }
            }
            .pageBackground(.browsing)
            .navigationTitle(panelTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationBackground(AppTheme.canvas)
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

    private var paragraphHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            metadataLayout {
                Label(
                    selectedText.isEmpty ? "评论这一段" : "评论选中文字",
                    systemImage: selectedText.isEmpty ? "text.quote" : "character.cursor.ibeam"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.primary)

                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }

                Text(chapterTitle)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
            }

            Text(selectedText.isEmpty ? paragraphExcerpt : selectedText)
                .font(.callout)
                .foregroundStyle(AppTheme.textSecondary)
                .appTextLineLimit(3)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            Rectangle().fill(AppTheme.border).frame(width: 2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            selectedText.isEmpty
                ? "段落摘录：\(paragraphExcerpt)"
                : "选中文字：\(selectedText)"
        )
    }

    @ViewBuilder
    private var thoughtsContent: some View {
        if isLoading && thoughts.isEmpty {
            HStack(spacing: 10) {
                ProgressView()
                    .tint(AppTheme.primary)
                Text("正在加载段评…")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 30)
        } else if let loadError, thoughts.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(AppTheme.warning)
                Text("段评暂时加载失败")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(loadError)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
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
            VStack(spacing: 8) {
                Image(systemName: "text.bubble")
                    .font(.title3)
                    .foregroundStyle(AppTheme.textMuted)
                Text("这一段还没有段评")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppTheme.textSecondary)
                Text("写下你的第一条想法吧")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 26)
        } else {
            VStack(spacing: 10) {
                ForEach(thoughts) { thought in
                    thoughtRow(thought)
                    Divider()
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
                            .foregroundStyle(AppTheme.textSecondary)
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
        HStack(alignment: .top, spacing: 10) {
            ThoughtAvatar(name: authorName(for: thought), url: avatarURL(for: thought))

            VStack(alignment: .leading, spacing: 8) {
                Text(authorName(for: thought))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if !isGeneratedImagePlaceholder(thought) {
                    Text(thought.thoughtText)
                        .font(.callout)
                        .foregroundStyle(AppTheme.textPrimary)
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
                        .foregroundStyle(AppTheme.textMuted)
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
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func isGeneratedImagePlaceholder(_ thought: Thought) -> Bool {
        guard thought.imageUrl?.isEmpty == false else { return false }
        return ["根据这段文字生成的插画", "根据这段文字生成的插图"]
            .contains(thought.thoughtText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canCompose {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("写下你的想法…", text: $draft, axis: .vertical)
                        .focused($composerFocused)
                        .font(.body)
                        .lineLimit(1...4)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                        .appFieldSurface(isFocused: composerFocused)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: composerFocused)
                        .disabled(isSubmitting)
                        .onChange(of: draft) { _, value in
                            if value.count > 300 { draft = String(value.prefix(300)) }
                        }
                        .accessibilityLabel("段评内容")

                    Button {
                        Task { await submit() }
                    } label: {
                        Group {
                            if isSubmitting {
                                ProgressView()
                                    .tint(AppTheme.textMuted)
                            } else {
                                Image(systemName: "arrow.up")
                            }
                        }
                        .frame(width: AppLayout.minimumTouchTarget, height: AppLayout.minimumTouchTarget)
                        .foregroundStyle(canSubmit ? AppTheme.onPrimary : AppTheme.textMuted)
                        .background(canSubmit ? AppTheme.primary : AppTheme.controlFill, in: Circle())
                    }
                    .font(.title3.weight(.semibold))
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .accessibilityLabel(isSubmitting ? "正在发布段评" : "发布段评")
                }

                if draft.count >= 240 {
                    Text("\(draft.count)/300")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(AppTheme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if let submitError {
                    Text(submitError)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .appTextLineLimit(2)
                }
            } else {
                Label(currentUserID == nil ? "登录后才能发布段评" : "此处仅供查看已有段评", systemImage: "person.crop.circle")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, AppLayout.pageInset)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: AppLayout.readableWidth)
        .frame(maxWidth: .infinity)
        .background(AppTheme.canvas)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var canSubmit: Bool {
        !isSubmitting
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var metadataLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
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
        guard canCompose else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            submitError = "写点内容再发布。"
            AppFeedback.warning("写点内容再发布")
            return
        }

        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }

        do {
            try await onSubmit(
                text,
                resolvedDisplayName
            )
            draft = ""
            composerFocused = false
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

private struct ThoughtAvatar: View {
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
                AppTheme.primaryLight
                Text(String(name.first ?? "匿"))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.primary)
            }
        }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
            .overlay {
                Circle()
                    .strokeBorder(AppTheme.border.opacity(0.45), lineWidth: 0.5)
            }
            .accessibilityHidden(true)
    }
}
