import SwiftUI
import UIKit

/// 用户与邀请码：注册模式、邀请码管理、用户管理（GET/POST /api/admin-users）。
struct AdminUsersView: View {
    @State private var overview: AdminUsersResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var registerMode = "invite"
    @State private var savedMode = "invite"
    @State private var isSavingMode = false
    @State private var pendingRoleChange: AdminUser?
    @State private var pendingDisable: AdminUser?
    @State private var pendingReset: AdminUser?
    @State private var resetResult: ResetPasswordResponse?
    @State private var deleteTarget: AdminUser?
    @State private var busyUserId: String?
    @State private var deleteConfirmUsername = ""
    @State private var showInviteDialog = false
    @State private var inviteBusy = false
    @State private var pendingDangerousOperation: AdminDangerousOperation?

    // MARK: - Body

    var body: some View {
        dialogsHost
            .alert("操作未完成", isPresented: Binding(
                get: { actionError != nil },
                set: { if !$0 { actionError = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(actionError ?? "")
            }
            .sheet(item: $deleteTarget) { user in
                DeleteUserSheet(
                    user: user,
                    confirmUsername: $deleteConfirmUsername,
                    onDelete: {
                        deleteTarget = nil
                        Task { await delete(user: user) }
                    },
                    onCancel: {
                        deleteTarget = nil
                    }
                )
            }
    }

    /// 对话框与确认层（拆开以控制单表达式类型检查规模）。
    private var dialogsHost: some View {
        listHost
            .confirmationDialog("修改角色", isPresented: Binding(
                get: { pendingRoleChange != nil },
                set: { if !$0 { pendingRoleChange = nil } }
            ), titleVisibility: .visible) {
                if let user = pendingRoleChange {
                    Button(user.isAdmin ? "设为读者" : "设为管理员") {
                        Task { await setRole(user: user, role: user.isAdmin ? "reader" : "admin") }
                    }
                    Button("取消", role: .cancel) {}
                }
            } message: {
                if let user = pendingRoleChange {
                    Text("确认将 @\(user.username) 的角色修改为\(user.isAdmin ? "读者" : "管理员")？")
                }
            }
            .confirmationDialog("禁用账号", isPresented: Binding(
                get: { pendingDisable != nil },
                set: { if !$0 { pendingDisable = nil } }
            ), titleVisibility: .visible) {
                if let user = pendingDisable {
                    Button("禁用", role: .destructive) {
                        Task { await setStatus(user: user, status: "disabled") }
                    }
                    Button("取消", role: .cancel) {}
                }
            } message: {
                if let user = pendingDisable {
                    Text("禁用后 @\(user.username) 的所有会话将立即失效，且无法登录。")
                }
            }
            .confirmationDialog("重置密码", isPresented: Binding(
                get: { pendingReset != nil },
                set: { if !$0 { pendingReset = nil } }
            ), titleVisibility: .visible) {
                if let user = pendingReset {
                    Button("重置密码") {
                        Task { await resetPassword(for: user) }
                    }
                    Button("取消", role: .cancel) {}
                }
            } message: {
                if let user = pendingReset {
                    Text("将为 @\(user.username) 生成一次性临时密码，其现有会话将全部失效。")
                }
            }
            .alert("临时密码已生成", isPresented: Binding(
                get: { resetResult != nil },
                set: { if !$0 { resetResult = nil } }
            )) {
                if let result = resetResult {
                    Button("复制") {
                        UIPasteboard.general.string = result.tempPassword
                        AppFeedback.success("临时密码已复制")
                    }
                    Button("好", role: .cancel) {}
                }
            } message: {
                if let result = resetResult {
                    Text("用户 @\(result.username) 的临时密码：\n\(result.tempPassword)\n\n请立即转交对方，登录后建议修改密码。")
                }
            }
            .confirmationDialog("生成邀请码", isPresented: $showInviteDialog, titleVisibility: .visible) {
                Button("生成 1 个") { Task { await createInvites(count: 1) } }
                Button("生成 5 个") { Task { await createInvites(count: 5) } }
                Button("生成 10 个") { Task { await createInvites(count: 10) } }
                Button("取消", role: .cancel) {}
            } message: {
                Text("一次性生成多个未使用邀请码。")
            }
            .adminDangerousOperationConfirmation($pendingDangerousOperation) { operation in
                guard operation.action == .clearInvites else { return }
                Task { await clearInvites(operationID: operation.operationID, codes: operation.targetIDs) }
            }
    }

    /// 页面主体：恒渲染 List，加载态 / 错误态 / 内容按条件填充（与书架页同款可靠模式）。
    private var listHost: some View {
        List {
            if isLoading && overview == nil {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, overview == nil {
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
            } else if let overview {
                Section("注册模式") {
                    HStack(spacing: 8) {
                        Picker("注册模式", selection: $registerMode) {
                            Text("开放注册").tag("open")
                            Text("邀请制").tag("invite")
                            Text("关闭注册").tag("closed")
                        }
                        .pickerStyle(.menu)
                        .disabled(isSavingMode)
                        .onChange(of: registerMode) { _, newMode in
                            // 加载完成前的赋值与回滚赋值不算用户操作，避免误保存
                            guard newMode != savedMode else { return }
                            Task { await saveRegisterMode(newMode) }
                        }
                        if isSavingMode {
                            AdminInlineProgress()
                        }
                    }
                    Text("开放注册无需邀请码；邀请制需邀请码注册；关闭注册停止新用户注册。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                }

                inviteSection(overview.invites)

                Section("用户（\(overview.users.count)）") {
                    ForEach(overview.users) { user in
                        userRow(user)
                            .contextMenu {
                                contextActions(for: user)
                            }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("用户与邀请码")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("生成邀请码") { showInviteDialog = true }
                    Button("清理已使用/已禁用", role: .destructive) { requestClearInvites() }
                } label: {
                    if inviteBusy {
                        AdminInlineProgress()
                    } else {
                        Label("邀请码操作", systemImage: "plus")
                    }
                }
                .disabled(inviteBusy)
            }
        }
    }

    // MARK: - 邀请码

    private func inviteSection(_ invites: [AdminInvite]) -> some View {
        Section {
            if invites.isEmpty {
                Text("暂无邀请码")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(invites) { invite in
                    inviteRow(invite)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !invite.isUsed && !invite.isDisabled {
                                Button("禁用") { Task { await disableInvite(invite) } }
                                    .tint(AppTheme.warning)
                            }
                        }
                }
            }
        } header: {
            Text("邀请码（\(invites.count)）")
        } footer: {
            Text("点按邀请码可复制；生成与清理入口在右上角。")
        }
    }

    private func inviteRow(_ invite: AdminInvite) -> some View {
        Button {
            UIPasteboard.general.string = invite.code
            AppFeedback.success("邀请码已复制")
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(invite.code)
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(AdminFormat.dateTime(invite.createdAt))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Spacer()
                if invite.isDisabled {
                    Text("已禁用")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.danger)
                } else if invite.isUsed {
                    Text("已使用 · \(invite.usedByName)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                } else {
                    Text("未使用")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.success)
                }
            }
        }
    }

    private func disableInvite(_ invite: AdminInvite) async {
        do {
            try await AdminAPI.disableInvite(code: invite.code)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func createInvites(count: Int) async {
        guard !inviteBusy else { return }
        inviteBusy = true
        defer { inviteBusy = false }
        do {
            _ = try await AdminAPI.createInvites(count: count)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func requestClearInvites() {
        guard !inviteBusy else { return }
        let codes = (overview?.invites ?? []).filter { $0.isUsed || $0.isDisabled }.map(\.code).sorted()
        pendingDangerousOperation = AdminDangerousOperation(
            action: .clearInvites,
            kind: .batchDelete,
            targetIDs: codes,
            title: "清理邀请码",
            message: codes.isEmpty
                ? "确认时没有发现已使用或已禁用的邀请码，不会删除新出现的记录。"
                : "将删除确认时发现的 \(codes.count) 个已使用或已禁用邀请码；之后新增的记录会保留。",
            confirmLabel: codes.isEmpty ? "确认空操作" : "清理 \(codes.count) 个邀请码"
        )
    }

    private func clearInvites(operationID: String, codes: [String]) async {
        guard !inviteBusy else { return }
        inviteBusy = true
        defer { inviteBusy = false }
        do {
            try await AdminAPI.clearInvites(operationID: operationID, codes: codes)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 用户

    private func userRow(_ user: AdminUser) -> some View {
        HStack(spacing: 12) {
            avatar(for: user)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(user.displayName.isEmpty ? user.username : user.displayName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(1)
                    if user.isAdmin {
                        AdminStatusBadge("管理员", tint: AppTheme.primary, systemImage: "person.badge.key")
                    }
                    if user.isDisabled {
                        AdminStatusBadge("已禁用", tint: AppTheme.danger, systemImage: "nosign")
                    }
                }
                Text("@\(user.username) · \(user.thoughtCount) 想法 · \(AdminFormat.relativeTime(user.lastLoginAt > 0 ? user.lastLoginAt : user.createdAt))")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(2)
            }
            if busyUserId == user.id {
                AdminInlineProgress()
            } else {
                Menu {
                    contextActions(for: user)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
                .disabled(busyUserId != nil)
                .accessibilityLabel("用户操作")
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func contextActions(for user: AdminUser) -> some View {
        Button(user.isAdmin ? "设为读者" : "设为管理员") {
            pendingRoleChange = user
        }
        if user.isDisabled {
            Button("启用账号") {
                Task { await setStatus(user: user, status: "active") }
            }
        } else {
            Button("禁用账号", role: .destructive) {
                pendingDisable = user
            }
        }
        Button("重置密码") {
            pendingReset = user
        }
        Button("删除用户", role: .destructive) {
            deleteConfirmUsername = ""
            deleteTarget = user
        }
    }

    @ViewBuilder
    private func avatar(for user: AdminUser) -> some View {
        let size = CGSize(width: 40, height: 40)
        if let url = APIClient.shared.avatarURL(userId: user.id) {
            CachedAsyncImage(url: url, targetSize: size) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                avatarPlaceholder
            }
            .frame(width: size.width, height: size.height)
            .clipShape(Circle())
            .accessibilityHidden(true)
        } else {
            avatarPlaceholder
        }
    }

    private var avatarPlaceholder: some View {
        ZStack {
            AppTheme.primaryLight
            Image(systemName: "person.fill")
                .font(.footnote)
                .foregroundStyle(AppTheme.primary)
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    // MARK: - 动作

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let r = try await AdminAPI.usersOverview()
            overview = r
            registerMode = r.settings.registerMode
            savedMode = registerMode
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func saveRegisterMode(_ mode: String) async {
        isSavingMode = true
        defer { isSavingMode = false }
        do {
            try await AdminAPI.setRegisterMode(mode)
            savedMode = mode
        } catch {
            actionError = AppCopy.friendlyError(error)
            registerMode = savedMode
        }
    }

    private func setRole(user: AdminUser, role: String) async {
        guard busyUserId == nil else { return }
        busyUserId = user.id
        defer { busyUserId = nil }
        do {
            try await AdminAPI.setUserRole(id: user.id, role: role)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func setStatus(user: AdminUser, status: String) async {
        guard busyUserId == nil else { return }
        busyUserId = user.id
        defer { busyUserId = nil }
        do {
            try await AdminAPI.setUserStatus(id: user.id, status: status)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func resetPassword(for user: AdminUser) async {
        guard busyUserId == nil else { return }
        busyUserId = user.id
        defer { busyUserId = nil }
        do {
            resetResult = try await AdminAPI.resetPassword(id: user.id)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func delete(user: AdminUser) async {
        guard busyUserId == nil else { return }
        busyUserId = user.id
        defer { busyUserId = nil }
        do {
            try await AdminAPI.deleteUser(id: user.id, confirmUsername: deleteConfirmUsername)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }
}

/// 删除用户确认页：需输入目标用户名（与服务器校验一致）。
private struct DeleteUserSheet: View {
    let user: AdminUser
    @Binding var confirmUsername: String
    let onDelete: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("用户名", value: user.username)
                    LabeledContent("昵称", value: user.displayName.isEmpty ? "—" : user.displayName)
                }
                Section {
                    TextField("输入用户名以确认删除", text: $confirmUsername)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text("此操作将永久删除该用户及其评论、想法、阅读进度等全部数据，不可恢复。")
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("删除用户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("删除", role: .destructive, action: onDelete)
                        .disabled(confirmUsername.trimmingCharacters(in: .whitespaces).lowercased() != user.username.lowercased())
                }
            }
        }
        .presentationDetents([.medium])
    }
}
