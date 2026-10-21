import SwiftUI

struct PasskeySettingsView: View {
    @State private var configuration: PasskeyConfigResponse?
    @State private var passkeys: [PasskeyItem] = []
    @State private var isLoading = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var currentPassword = ""
    @State private var deviceName = ""
    @State private var pendingRevoke: PasskeyItem?
    @State private var editingPasskey: PasskeyItem?
    @State private var requestID = UUID()

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                        Task { await load() }
                    }
                }
            }

            if isLoading && configuration == nil {
                ProgressView("加载 Passkey 设置…")
            }

            if let configuration, !configuration.enabled {
                unavailableSection("当前站点未开放 Passkey 登录。")
            } else if let configuration, !configuration.configured {
                unavailableSection("当前站点尚未完成 Passkey 部署配置，请联系管理员。")
            } else if configuration != nil {
                registeredPasskeysSection
                if let error = PasskeyService.shared.localAvailabilityError {
                    unavailableSection(error.localizedDescription)
                } else {
                    registrationSection
                }
            }
        }
        .appListStyle(.settings)
        .navigationTitle("Passkey")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(isBusy)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $editingPasskey) { passkey in
            PasskeyRenameSheet(passkey: passkey) { name in
                Task { await rename(passkey, name: name) }
            }
        }
        .confirmationDialog(
            "撤销此 Passkey？",
            isPresented: Binding(
                get: { pendingRevoke != nil },
                set: { if !$0 { pendingRevoke = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingRevoke
        ) { passkey in
            Button("撤销 Passkey", role: .destructive) {
                Task { await revoke(passkey) }
            }
            Button("取消", role: .cancel) {}
        } message: { passkey in
            Text("撤销后，使用这台设备的 Passkey 将无法再登录此账号。")
        }
    }

    @ViewBuilder
    private func unavailableSection(_ message: String) -> some View {
        Section {
            Label(message, systemImage: "person.badge.key.slash")
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        } footer: {
            Text("密码登录和现有登录设备不受影响。")
        }
    }

    private var registeredPasskeysSection: some View {
        Section {
            if passkeys.isEmpty {
                Label("还没有注册 Passkey", systemImage: "person.badge.key")
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(passkeys) { passkey in
                    passkeyRow(passkey)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button {
                                editingPasskey = passkey
                            } label: {
                                Label("改名", systemImage: "pencil")
                            }
                            .tint(AppTheme.primary)

                            Button(role: .destructive) {
                                pendingRevoke = passkey
                            } label: {
                                Label("撤销", systemImage: "trash")
                            }
                        }
                        .accessibilityIdentifier("passkey.item.\(passkey.id)")
                }
            }
        } header: {
            Text("已注册的 Passkey")
        } footer: {
            Text("Passkey 由设备或密码管理器保护，知舟不会接触你的生物识别信息。")
        }
    }

    private var registrationSection: some View {
        Group {
            if configuration?.registrationEnabled == true {
                Section {
                    SecureField("当前密码", text: $currentPassword)
                        .textContentType(.password)
                    TextField("设备名称（可选）", text: $deviceName)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled()
                    Button {
                        Task { await register() }
                    } label: {
                        Label("在此设备注册 Passkey", systemImage: "person.badge.key")
                    }
                    .disabled(currentPassword.isEmpty || isBusy)
                    .accessibilityIdentifier("passkey.register")
                } header: {
                    Text("注册此设备")
                } footer: {
                    Text("注册前需要再次输入当前密码，随后由系统弹出 Face ID、Touch ID 或设备密码验证。")
                }
            } else {
                Section {
                    Label("管理员暂未开放新增 Passkey", systemImage: "lock")
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
        }
    }

    private func passkeyRow(_ passkey: PasskeyItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(passkey.name.isEmpty ? "未命名设备" : passkey.name)
                    .font(.body.weight(.medium))
                Spacer(minLength: 8)
                if passkey.backupState {
                    Text("已同步")
                        .font(.caption)
                        .foregroundStyle(AppTheme.primary)
                }
            }
            Text("注册于 \(formattedDate(passkey.createdAt))")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if passkey.lastUsedAt > 0 {
                Text("最后使用 \(formattedDate(passkey.lastUsedAt))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !passkey.deviceName.isEmpty {
                Text(passkey.deviceName)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    private func formattedDate(_ milliseconds: Int64) -> String {
        Date(timeIntervalSince1970: Double(milliseconds) / 1000)
            .formatted(date: .abbreviated, time: .shortened)
    }

    private func load() async {
        guard !isBusy else { return }
        let id = UUID()
        requestID = id
        isLoading = true
        defer {
            if requestID == id { isLoading = false }
        }
        do {
            let configuration = try await PasskeyService.shared.configuration()
            guard !Task.isCancelled, requestID == id else { return }
            self.configuration = configuration
            if configuration.enabled && configuration.configured {
                passkeys = try await PasskeyService.shared.list()
            } else {
                passkeys = []
            }
            guard !Task.isCancelled, requestID == id else { return }
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, requestID == id else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func register() async {
        guard !isBusy, !currentPassword.isEmpty else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let passkey = try await PasskeyService.shared.register(
                currentPassword: currentPassword,
                name: deviceName
            )
            if let passkey {
                passkeys.insert(passkey, at: 0)
            } else {
                passkeys = try await PasskeyService.shared.list()
            }
            currentPassword = ""
            deviceName = ""
            AppFeedback.success("Passkey 已注册")
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }

    private func rename(_ passkey: PasskeyItem, name: String) async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            if let updated = try await PasskeyService.shared.rename(id: passkey.id, name: name) {
                replace(updated)
            }
            AppFeedback.success("Passkey 名称已更新")
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }

    private func revoke(_ passkey: PasskeyItem) async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer {
            isBusy = false
            pendingRevoke = nil
        }
        do {
            try await PasskeyService.shared.revoke(id: passkey.id)
            passkeys.removeAll { $0.id == passkey.id }
            AppFeedback.success("Passkey 已撤销")
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }

    private func replace(_ passkey: PasskeyItem) {
        guard let index = passkeys.firstIndex(where: { $0.id == passkey.id }) else { return }
        passkeys[index] = passkey
    }
}

private struct PasskeyRenameSheet: View {
    @Environment(\.dismiss) private var dismiss
    let passkey: PasskeyItem
    let onSave: (String) -> Void
    @State private var name: String

    init(passkey: PasskeyItem, onSave: @escaping (String) -> Void) {
        self.passkey = passkey
        self.onSave = onSave
        _name = State(initialValue: passkey.name)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Passkey 名称") {
                    TextField("例如：iPhone", text: $name)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled()
                }
            }
            .appListStyle(.settings)
            .navigationTitle("重命名")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !cleanName.isEmpty else { return }
                        onSave(cleanName)
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
