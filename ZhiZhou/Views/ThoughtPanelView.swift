import Foundation
import SwiftUI

/// 阅读器中的段评面板：展示当前段落的讨论，并负责输入、校验和删除操作。
struct ThoughtPanelView: View {
    let chapterTitle: String
    let paragraphExcerpt: String
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
    @State private var draft = ""
    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var pendingDelete: Thought?
    @State private var deletingIDs: Set<String> = []
    @FocusState private var focusedField: ComposerField?

    private enum ComposerField: Hashable {
        case thought
    }

    init(
        chapterTitle: String,
        paragraphExcerpt: String,
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
        VStack(alignment: .leading, spacing: 8) {
            Text(chapterTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.primary)

            Text(paragraphExcerpt)
                .font(.callout)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(5)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            AppTheme.primaryLight,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("段落摘录：\(paragraphExcerpt)")
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
                ThoughtAvatar(name: authorName(for: thought))

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
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(AppTheme.border.opacity(0.45), lineWidth: 0.5)
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()

            if canCompose {
                TextField("显示名称（可选）", text: $displayName)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: displayName) { _, value in
                        if value.count > 20 {
                            displayName = String(value.prefix(20))
                        }
                    }

                TextEditor(text: $draft)
                    .focused($focusedField, equals: .thought)
                    .frame(minHeight: 78, maxHeight: 126)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(
                        AppTheme.surface,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(AppTheme.border.opacity(0.5), lineWidth: 0.5)
                    }
                    .onChange(of: draft) { _, value in
                        if value.count > 300 {
                            draft = String(value.prefix(300))
                        }
                    }

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
                                .tint(AppTheme.primary)
                        } else {
                            Label("发布", systemImage: "arrow.up.circle.fill")
                        }
                    }
                    .buttonStyle(.glass(AppTheme.glassProminent))
                    .tint(AppTheme.primary)
                    .disabled(
                        isSubmitting
                            || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
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
        .padding(.top, 2)
        .padding(.bottom, 10)
        .background(.regularMaterial)
    }

    private func authorName(for thought: Thought) -> String {
        let value = thought.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "匿名读者" : value
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

    var body: some View {
        Text(String(name.first ?? "匿"))
            .font(.caption.weight(.bold))
            .foregroundStyle(AppTheme.primary)
            .frame(width: 34, height: 34)
            .background(AppTheme.primaryLight, in: Circle())
            .accessibilityHidden(true)
    }
}
