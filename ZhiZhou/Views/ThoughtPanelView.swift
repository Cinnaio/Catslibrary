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

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = ""
    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var pendingDelete: Thought?
    @State private var deletingIDs: Set<String> = []
    @FocusState private var focusedField: ComposerField?

    private enum ComposerField: Hashable {
        case displayName
        case thought
    }

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
        onDelete: @escaping (String) async throws -> Void
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
        _displayName = State(initialValue: String(defaultDisplayName.prefix(20)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    paragraphHeader
                    thoughtsContent
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
            .background(Color.clear)
            .navigationTitle("本段段评")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
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
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(
                    selectedText.isEmpty ? "评论这一段" : "评论选中文字",
                    systemImage: selectedText.isEmpty ? "text.quote" : "character.cursor.ibeam"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.primary)

                Spacer(minLength: 8)

                Text(chapterTitle)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                    .lineLimit(1)
            }

            if !selectedText.isEmpty {
                Text("「\(selectedText)」")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(AppTheme.primaryDeep)
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)
            }

            Text(paragraphExcerpt)
                .font(selectedText.isEmpty ? .callout : .caption)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(selectedText.isEmpty ? 5 : 3)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            AppTheme.surface,
            in: RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                .strokeBorder(AppTheme.border.opacity(0.55), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            selectedText.isEmpty
                ? "段落摘录：\(paragraphExcerpt)"
                : "选中文字：\(selectedText)，所在段落：\(paragraphExcerpt)"
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
                Button("重试", action: onRetry)
                    .buttonStyle(.glass(AppTheme.glassClear))
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
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        Button("重试", action: onRetry)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                    }
                }
            }
        }
    }

    private func thoughtRow(_ thought: Thought) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                ThoughtAvatar(
                    name: authorName(for: thought),
                    url: avatarURL(for: thought)
                )

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(authorName(for: thought))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                            .lineLimit(1)

                        Spacer(minLength: 8)

                        Text(Self.relativeTime(for: thought.createdAt))
                            .font(.caption2)
                            .foregroundStyle(AppTheme.textMuted)
                            .lineLimit(1)
                    }

                    if !thought.selectedText.isEmpty {
                        Text("「\(thought.selectedText)」")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .lineLimit(2)
                    }
                }
            }

            Text(thought.thoughtText)
                .font(.callout)
                .foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            if currentUserID == thought.userId {
                HStack {
                    Spacer()
                    Button(role: .destructive) {
                        pendingDelete = thought
                    } label: {
                        if deletingIDs.contains(thought.id) {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Label("删除", systemImage: "trash")
                        }
                    }
                    .font(.caption.weight(.medium))
                    .disabled(deletingIDs.contains(thought.id))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            AppTheme.surface,
            in: RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                .strokeBorder(AppTheme.border.opacity(0.45), lineWidth: 0.5)
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canCompose {
                HStack(spacing: 10) {
                    Label("署名", systemImage: "person.crop.circle")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AppTheme.textSecondary)

                    TextField("匿名读者", text: $displayName)
                        .font(.subheadline)
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.trailing)
                        .focused($focusedField, equals: .displayName)
                        .accessibilityLabel("段评署名")
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .appFieldSurface(
                    isFocused: focusedField == .displayName,
                    cornerRadius: 12
                )
                .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: focusedField)
                .onChange(of: displayName) { _, value in
                    if value.count > 20 {
                        displayName = String(value.prefix(20))
                    }
                }

                TextField("写下你对这段文字的想法…", text: $draft, axis: .vertical)
                    .focused($focusedField, equals: .thought)
                    .font(.body)
                    .lineLimit(2...5)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(minHeight: 62, alignment: .topLeading)
                    .appFieldSurface(
                        isFocused: focusedField == .thought,
                        cornerRadius: AppTheme.controlCornerRadius
                    )
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: focusedField)
                    .onChange(of: draft) { _, value in
                        if value.count > 300 {
                            draft = String(value.prefix(300))
                        }
                    }
                    .accessibilityLabel("段评内容")

                if let submitError {
                    Text(submitError)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .lineLimit(2)
                }

                HStack(alignment: .center, spacing: 12) {
                    Text("\(draft.count)/300")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(AppTheme.textMuted)

                    Spacer()

                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Label("发布", systemImage: "arrow.up")
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(canSubmit ? Color.white : AppTheme.textMuted)
                    .padding(.horizontal, 15)
                    .frame(minHeight: 44)
                    .background(
                        canSubmit ? AppTheme.primary : AppTheme.surfaceSecondary,
                        in: Capsule()
                    )
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.97))
                    .disabled(!canSubmit)
                    .accessibilityLabel(isSubmitting ? "正在发布段评" : "发布段评")
                }
            } else {
                Label("登录后才能发布段评", systemImage: "person.crop.circle")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(AppTheme.background)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var canSubmit: Bool {
        !isSubmitting
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func authorName(for thought: Thought) -> String {
        let value = thought.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "匿名读者" : value
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
                displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            draft = ""
            focusedField = nil
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
