import SwiftUI

struct AccountOperation: Identifiable {
    let id = UUID()
    let user: AdminUser
    let action: String
    var title: String {
        switch action {
        case "user-role": return "调整角色"
        case "user-status": return user.isDisabled ? "恢复账号" : "禁用账号"
        case "reset-password": return "发送密码重置邮件"
        case "revoke-sessions": return "撤销登录会话"
        default: return "删除用户"
        }
    }
}

struct AdminAccountActionSheet: View {
    let operation: AccountOperation
    let onSuccess: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var reason = ""
    @State private var role = "reader"
    @State private var confirmUsername = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("目标账号") {
                    LabeledContent("用户名", value: operation.user.username)
                    LabeledContent("当前角色", value: operation.user.roleLabel)
                    if operation.action == "user-role" {
                        Picker("目标角色", selection: $role) {
                            Text("读者").tag("reader")
                            Text("管理员").tag("admin")
                            Text("超级管理员").tag("super_admin")
                        }
                    }
                }
                Section {
                    TextField("操作原因（必填）", text: $reason, axis: .vertical)
                    if operation.action == "delete-user" {
                        TextField("输入完整用户名确认删除", text: $confirmUsername)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                } header: {
                    Text("操作确认")
                } footer: {
                    Text(operation.action == "reset-password"
                         ? "发送到用户已验证的邮箱。用户通过邮件设置新密码后才撤销旧密码和登录会话。"
                         : operation.action == "delete-user"
                         ? "永久删除用户及其书架、书签、想法和阅读进度，无法撤销。"
                         : "提交时重新检查角色与状态；操作会撤销目标账号的全部会话和待确认邮件链接。")
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(AppTheme.danger) } }
            }
            .appListStyle(.settings)
            .disabled(busy)
            .navigationTitle(operation.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "处理中…" : "确认") { Task { await submit() } }
                        .disabled(busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || reason.count > 500 ||
                                  (operation.action == "user-role" && role == operation.user.role) ||
                                  (operation.action == "delete-user" && confirmUsername != operation.user.username))
                }
            }
            .interactiveDismissDisabled(busy)
            .onAppear { role = operation.user.role }
        }
    }

    @MainActor private func submit() async {
        guard !busy, let owner = appState.user?.id else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do {
            var values: [String: String] = [:]
            if operation.action == "user-role" { values["role"] = role }
            if operation.action == "user-status" { values["status"] = operation.user.isDisabled ? "active" : "disabled" }
            if operation.action == "delete-user" { values["confirmUsername"] = confirmUsername }
            try await AdminAPI.mutateAccount(user: operation.user, action: operation.action, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines), values: values)
            guard appState.user?.id == owner else { return }
            AppFeedback.success(operation.action == "reset-password" ? "重置邮件已发送" : "账号操作已完成")
            onSuccess(); dismiss()
        } catch { errorMessage = AppCopy.friendlyError(error) }
    }
}
