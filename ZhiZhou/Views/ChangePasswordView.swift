import SwiftUI
import ZhiZhouCore

struct ChangePasswordView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case current, new, confirmation }

    var body: some View {
        Form {
            Section("当前密码") {
                SecureField("当前密码", text: $currentPassword)
                    .textContentType(.password)
                    .focused($focusedField, equals: .current)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .new }
            }
            Section {
                SecureField("新密码", text: $newPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .new)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .confirmation }
                SecureField("再次输入新密码", text: $confirmation)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirmation)
                    .submitLabel(.done)
                    .onSubmit { if validationError == nil { Task { await save() } } }
            } header: {
                Text("新密码")
            } footer: {
                Text("至少 8 个字符。修改后，其他设备需要重新登录。")
            }
            if let message = errorMessage ?? visibleValidationError {
                Section {
                    Text(message).font(.footnote).foregroundStyle(AppTheme.danger)
                }
            }
        }
        .disabled(isSaving)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .scrollDismissesKeyboard(.interactively)
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("修改密码")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isSaving)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView().accessibilityLabel("正在修改密码")
                } else {
                    Button("保存") { Task { await save() } }
                        .disabled(validationError != nil || appState.isUpdatingAccount)
                }
            }
        }
    }

    private var validationError: String? {
        AccountPolicy.passwordError(current: currentPassword, new: newPassword, confirmation: confirmation)
    }

    private var visibleValidationError: String? {
        guard !newPassword.isEmpty && !confirmation.isEmpty else { return nil }
        return validationError
    }

    private func save() async {
        guard !isSaving, validationError == nil else { return }
        isSaving = true
        errorMessage = nil
        focusedField = nil
        defer { isSaving = false }
        do {
            try await appState.changePassword(current: currentPassword, new: newPassword, confirmation: confirmation)
            currentPassword = ""
            newPassword = ""
            confirmation = ""
            AppFeedback.success("密码已修改")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }
}
