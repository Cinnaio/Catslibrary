import SwiftUI
import ZhiZhouCore
import UIKit

/// 用户与邀请码：注册模式、邀请码管理、用户管理（GET/POST /api/admin-users）。
struct AdminUsersView: View {
    @Environment(AppState.self) private var appState
    @State private var accountOperation: AccountOperation?
    @State private var overviewRequests = ListRequestGuard<String>()
    @State private var overview: AdminUsersResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var registerMode = "invite"
    @State private var savedMode = "invite"
    @State private var isSavingMode = false
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
            .sheet(item: $accountOperation) { operation in
                AdminAccountActionSheet(operation: operation) { Task { await load() } }
            }
    }

    /// 对话框与确认层（拆开以控制单表达式类型检查规模）。
    private var dialogsHost: some View {
        listHost
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
            if let errorMessage, overview != nil {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }
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
                        .disabled(isSavingMode || appState.user?.isSuperAdmin != true)
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
                        .foregroundStyle(AppTheme.textSecondary)
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
        .appListStyle(.settings)
        .navigationTitle("账户与注册")
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
                        .foregroundStyle(AppTheme.textSecondary)
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
                        .appTextLineLimit(1)
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
                        .appTextLineLimit(1)
                    if user.isAdmin {
                        AdminStatusBadge(user.roleLabel, tint: AppTheme.primary, systemImage: "person.badge.key")
                    }
                    if user.isDisabled {
                        AdminStatusBadge("已禁用", tint: AppTheme.danger, systemImage: "nosign")
                    }
                }
                Text("@\(user.username) · \(user.thoughtCount) 想法 · \(AdminFormat.relativeTime(user.lastLoginAt > 0 ? user.lastLoginAt : user.createdAt))")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(2)
            }
            Menu {
                contextActions(for: user)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .disabled(accountOperation != nil)
            .accessibilityLabel("用户操作")
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func contextActions(for user: AdminUser) -> some View {
        if ["reader", "admin", "super_admin"].contains(user.role) && user.id != appState.user?.id && (appState.user?.isSuperAdmin == true || (appState.user?.isAdmin == true && user.role == "reader")) {
            if appState.user?.isSuperAdmin == true {
                Button("调整角色") { accountOperation = AccountOperation(user: user, action: "user-role") }
            }
            Button(user.isDisabled ? "恢复账号" : "禁用账号") { accountOperation = AccountOperation(user: user, action: "user-status") }
            Button("发送密码重置邮件") { accountOperation = AccountOperation(user: user, action: "reset-password") }
                .disabled(user.emailVerified != true || user.isDisabled)
            Button("撤销登录会话") { accountOperation = AccountOperation(user: user, action: "revoke-sessions") }
            Button("删除用户", role: .destructive) { accountOperation = AccountOperation(user: user, action: "delete-user") }
        } else {
            Text(user.id == appState.user?.id ? "本人密码请在账户与安全中修改" : "仅超级管理员可管理")
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
        guard !isSavingMode else { return }
        let ticket = overviewRequests.begin("users")
        isLoading = true
        defer {
            if overviewRequests.accepts(ticket, query: "users") { isLoading = false }
            overviewRequests.finish(ticket)
        }
        do {
            let r = try await AdminAPI.usersOverview()
            guard !Task.isCancelled, overviewRequests.accepts(ticket, query: "users") else { return }
            overview = r
            registerMode = r.settings.registerMode
            savedMode = registerMode
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, overviewRequests.accepts(ticket, query: "users") else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func saveRegisterMode(_ mode: String) async {
        guard !isSavingMode else { return }
        let ticket = overviewRequests.begin("users")
        isLoading = false
        isSavingMode = true
        defer { isSavingMode = false; overviewRequests.finish(ticket) }
        do {
            try await AdminAPI.setRegisterMode(mode)
            savedMode = mode
        } catch {
            actionError = AppCopy.friendlyError(error)
            registerMode = savedMode
        }
    }

}
