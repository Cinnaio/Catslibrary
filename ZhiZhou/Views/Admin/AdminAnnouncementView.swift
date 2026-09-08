import SwiftUI

/// 站点公告：编辑并保存站点头部公告（GET/PUT /api/admin/site，最长 240 字）。
struct AdminAnnouncementView: View {
    @State private var text = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var savedText: String?
    @FocusState private var isEditing: Bool

    private let maxLength = 240

    var body: some View {
        Group {
            if isLoading {
                ProgressView("加载中…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("加载失败", systemImage: "wifi.slash")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                Form {
                    Section("公告内容") {
                        TextEditor(text: $text)
                            .font(.body)
                            .frame(minHeight: 180)
                            .focused($isEditing)
                            .disabled(isSaving)
                            .accessibilityLabel("公告内容")
                    }
                    Section {
                        Text("\(text.count)/\(maxLength)")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(text.count > maxLength ? AppTheme.danger : AppTheme.textSecondary)
                    }
                }
                .appListStyle(.settings)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .pageBackground(.settings)
        .navigationTitle("站点公告")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    isEditing = false
                    Task { await save() }
                } label: {
                    if isSaving { ProgressView() } else { Text("保存") }
                }
                .disabled(isLoading || isSaving || errorMessage != nil || text.count > maxLength || savedText == text)
                .accessibilityLabel(isSaving ? "正在保存公告" : "保存公告")
            }
        }
        .task { await load() }
        .alert("操作未完成", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            text = try await AdminAPI.announcement()
            savedText = text
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = String(text.prefix(maxLength))
            _ = try await AdminAPI.setAnnouncement(saved)
            text = saved
            savedText = saved
            AppFeedback.success("公告已保存")
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }
}
