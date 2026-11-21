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
    @State private var workingPasskeyID: String?
    @FocusState private var focusedField: RegistrationField?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private enum RegistrationField: Hashable { case password, name }

    var body: some View {
        AccountSettingsList {
            AccountSettingsHeading("免密码登录", detail: "Passkey 由设备或密码管理器保护，Cat’s Library 不会接触你的生物识别信息。")
                .padding(.bottom, 28)

            if let errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    AccountSettingsNote(errorMessage, isError: true)
                    Button { Task { await load() } } label: {
                        AccountSettingsActionLabel(title: "重新加载", symbol: "arrow.clockwise", isWorking: isLoading)
                    }
                    .disabled(isLoading)
                }
                .padding(.bottom, 20)
            }
            if isLoading && configuration == nil && errorMessage == nil {
                ProgressView("加载 Passkey 设置…")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .padding(.vertical, 16)
            }

            if let configuration, !configuration.enabled {
                unavailableSection("当前站点未开放 Passkey 登录。")
            } else if let configuration, !configuration.configured {
                unavailableSection("当前站点尚未完成 Passkey 部署配置，请联系管理员。")
            } else if configuration != nil {
                registeredPasskeysSection
                if let error = PasskeyService.shared.localAvailabilityError {
                    unavailableSection(error.localizedDescription)
                        .padding(.top, 28)
                } else {
                    registrationSection
                        .padding(.top, 28)
                }
            }
        }
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

    private func unavailableSection(_ message: String) -> some View {
        AccountSettingsSection("暂不可用") {
            Label {
                Text(message).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "person.badge.key.slash").accessibilityHidden(true)
            }
            .font(.subheadline)
            .foregroundStyle(ReadingSpace.ink)
            AccountSettingsNote("密码登录和现有登录设备不受影响。")
        }
    }

    @ViewBuilder
    private var registeredPasskeysSection: some View {
        Text("已注册的 Passkey")
            .font(.system(.title3, design: .serif).weight(.medium))
            .foregroundStyle(ReadingSpace.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 8)
        if passkeys.isEmpty {
            if isLoading && errorMessage == nil {
                ProgressView("读取已注册的 Passkey…")
                    .font(.footnote)
                    .padding(.vertical, 16)
            } else if errorMessage == nil {
                AccountSettingsNote("还没有注册 Passkey。")
                    .padding(.vertical, 16)
            }
        } else {
            ForEach(Array(passkeys.enumerated()), id: \.element.id) { index, passkey in
                passkeyRow(passkey)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button { editingPasskey = passkey } label: {
                            Label("改名", systemImage: "pencil")
                        }
                        .tint(AppTheme.primary)
                        Button(role: .destructive) { pendingRevoke = passkey } label: {
                            Label("撤销", systemImage: "trash")
                        }
                    }
                    .accessibilityIdentifier("passkey.item.\(passkey.id)")
                    .readingSpaceEntrance(index)
            }
        }
    }

    @ViewBuilder
    private var registrationSection: some View {
        if configuration?.registrationEnabled == true {
            AccountSettingsSection("注册此设备") {
                AccountSettingsField("当前密码", isFocused: focusedField == .password) {
                    SecureField("当前密码", text: $currentPassword)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .password)
                        .submitLabel(.next)
                        .onSubmit { focusedField = .name }
                }
                AccountSettingsField("设备名称（可选）", isFocused: focusedField == .name) {
                    TextField("例如：我的 iPhone", text: $deviceName)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .name)
                        .submitLabel(.done)
                        .onSubmit { if !currentPassword.isEmpty { Task { await register() } } }
                }
                AccountSettingsNote("注册前需要再次输入当前密码，随后由系统弹出 Face ID、Touch ID 或设备密码验证。")
                Button { Task { await register() } } label: {
                    AccountSettingsActionLabel(
                        title: "在此设备注册 Passkey", symbol: "person.badge.key",
                        isWorking: isBusy && workingPasskeyID == nil, prominent: true
                    )
                }
                .disabled(currentPassword.isEmpty || isBusy)
                .accessibilityIdentifier("passkey.register")
            }
        } else {
            AccountSettingsSection("注册此设备") {
                AccountSettingsNote("管理员暂未开放新增 Passkey。")
            }
        }
    }

    private func passkeyRow(_ passkey: PasskeyItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                let heading = dynamicTypeSize >= .xxxLarge
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
                heading {
                    Text(passkey.name.isEmpty ? "未命名设备" : passkey.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(ReadingSpace.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if passkey.backupState {
                        Label("已同步", systemImage: "checkmark.icloud")
                            .font(.caption)
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                Menu {
                    Button { editingPasskey = passkey } label: { Label("改名", systemImage: "pencil") }
                    Button(role: .destructive) { pendingRevoke = passkey } label: { Label("撤销", systemImage: "trash") }
                } label: {
                    Group {
                        if workingPasskeyID == passkey.id { ProgressView() }
                        else { Image(systemName: "ellipsis") }
                    }
                    .font(.body)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("管理 \(passkey.name.isEmpty ? "未命名设备" : passkey.name)")
                .accessibilityValue(workingPasskeyID == passkey.id ? "正在更新 Passkey" : "")
            }
            if !passkey.deviceName.isEmpty {
                AccountSettingsNote(passkey.deviceName)
            }
            AccountSettingsNote("注册于 \(formattedDate(passkey.createdAt))")
            if passkey.lastUsedAt > 0 {
                AccountSettingsNote("最后使用 \(formattedDate(passkey.lastUsedAt))")
            }
        }
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) { ReadingSpace.profileLine.frame(height: 0.5).accessibilityHidden(true) }
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
        focusedField = nil
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
        workingPasskeyID = passkey.id
        errorMessage = nil
        defer { isBusy = false; workingPasskeyID = nil }
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
        workingPasskeyID = passkey.id
        errorMessage = nil
        defer {
            isBusy = false
            workingPasskeyID = nil
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
            AccountSettingsPage {
                AccountSettingsHeading("为密钥命名", detail: "使用容易辨认的名称，方便在多台设备间管理。")
                AccountSettingsField("Passkey 名称") {
                    TextField("例如：iPhone", text: $name)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled()
                }
            }
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
