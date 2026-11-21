import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import ZhiZhouCore

struct ProfileEditView: View {
    let user: User
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var displayName: String
    @State private var bio: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showDiscardConfirm = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case displayName, bio }

    init(user: User) {
        self.user = user
        _displayName = State(initialValue: user.displayName)
        _bio = State(initialValue: user.bio ?? "")
    }

    var body: some View {
        AccountSettingsPage {
            AccountSettingsHeading("个人资料", detail: "用户名：\(user.username)")

            avatarLink

            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    AccountSettingsField("昵称", isFocused: focusedField == .displayName) {
                        TextField("填写昵称", text: $displayName)
                            .textContentType(.nickname)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .displayName)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .bio }
                            .accessibilityLabel("昵称")
                            .accessibilityIdentifier("profile.edit.displayName")
                    }
                    characterCount(displayName, limit: 20)
                }

                VStack(alignment: .leading, spacing: 8) {
                    AccountSettingsField("简介", isFocused: focusedField == .bio) {
                        TextField("写一句关于自己的介绍", text: $bio, axis: .vertical)
                            .lineLimit(3...6)
                            .focused($focusedField, equals: .bio)
                            .accessibilityLabel("个人简介")
                            .accessibilityIdentifier("profile.edit.bio")
                    }
                    characterCount(bio, limit: 80)
                }

                if let message = errorMessage ?? validationError {
                    AccountSettingsNote(message, isError: true)
                }
            }
        }
        .disabled(isSaving)
        .scrollEdgeEffectHidden(true, for: .top)
        .presentationBackground(ReadingSpace.profilePaper)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(hasChanges || isSaving || appState.isUpdatingAccount)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") {
                    if hasChanges { showDiscardConfirm = true } else { dismiss() }
                }
                .disabled(isSaving || appState.isUpdatingAccount)
            }
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView().accessibilityLabel("正在保存资料")
                } else {
                    Button("保存") { Task { await save() } }
                        .disabled(!hasChanges || validationError != nil || appState.isUpdatingAccount)
                }
            }
        }
        .confirmationDialog("放弃未保存的资料修改？", isPresented: $showDiscardConfirm, titleVisibility: .visible) {
            Button("放弃修改", role: .destructive) { dismiss() }
        }
    }

    private var avatarLink: some View {
        NavigationLink {
            ProfileAvatarEditor()
        } label: {
            VStack(spacing: 12) {
                ProfileAvatar(user: appState.user ?? user, size: 96)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(ReadingSpace.onSummary)
                            .frame(width: 30, height: 30)
                            .background(ReadingSpace.summary, in: Circle())
                            .overlay { Circle().strokeBorder(ReadingSpace.profilePaper, lineWidth: 3) }
                    }
                    .accessibilityHidden(true)
                Text("更换头像")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppTheme.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .disabled(appState.isUpdatingAccount)
        .accessibilityLabel("更换头像")
        .accessibilityHint("选择照片或恢复默认头像，头像单独保存")
        .accessibilityIdentifier("profile.edit.avatar")
    }

    private var hasChanges: Bool {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines) != user.displayName ||
        bio.trimmingCharacters(in: .whitespacesAndNewlines) != (user.bio ?? "")
    }

    private var validationError: String? {
        AccountPolicy.profileError(displayName: displayName, bio: bio)
    }

    private func characterCount(_ value: String, limit: Int) -> some View {
        Text("\(value.utf16.count) / \(limit)")
            .font(.caption.monospacedDigit())
            .foregroundStyle(value.utf16.count > limit ? AppTheme.danger : ReadingSpace.profileMuted)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel("已输入 \(value.utf16.count) 个字符，最多 \(limit) 个")
    }

    private func save() async {
        guard !isSaving, validationError == nil else { return }
        isSaving = true
        errorMessage = nil
        focusedField = nil
        defer { isSaving = false }
        do {
            try await appState.updateProfile(displayName: displayName, bio: bio)
            AppFeedback.success("个人资料已保存")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }
}

private struct ProfileAvatarEditor: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var showPhotoPicker = false
    @State private var pickedItem: PhotosPickerItem?
    @State private var pendingData: Data?
    @State private var preview: UIImage?
    @State private var isPreparing = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showRemoveConfirm = false

    var body: some View {
        AccountSettingsPage {
            AccountSettingsHeading("更换头像", detail: "选择照片后预览，保存后更新头像。")

            avatarPreview

            VStack(spacing: 8) {
                Button { showPhotoPicker = true } label: {
                    AccountSettingsActionLabel(title: "选择照片", symbol: "photo.on.rectangle", prominent: true)
                }
                .accessibilityIdentifier("profile.avatar.choose")

                Button(role: .destructive) { showRemoveConfirm = true } label: {
                    AccountSettingsActionLabel(title: "恢复默认头像", symbol: "person.crop.circle", destructive: true)
                }
                .accessibilityIdentifier("profile.avatar.reset")
            }
            .disabled(isSaving || isPreparing || appState.isUpdatingAccount)

            if let errorMessage {
                AccountSettingsNote(errorMessage, isError: true)
            }
        }
        .scrollEdgeEffectHidden(true, for: .top)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isSaving)
        .interactiveDismissDisabled(isSaving)
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedItem, matching: .images)
        .task(id: pickedItem) {
            guard let item = pickedItem else { return }
            isPreparing = true
            defer { if pickedItem == item { isPreparing = false } }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw APIError.http(status: 400, message: "无法读取这张照片")
                }
                let jpeg = try await Task.detached(priority: .userInitiated) {
                    try ProfileAvatarImage.jpeg(from: data)
                }.value
                try Task.checkCancellation()
                guard pickedItem == item else { return }
                pendingData = jpeg
                preview = UIImage(data: jpeg)
                errorMessage = nil
            } catch is CancellationError {
            } catch {
                guard pickedItem == item, !Task.isCancelled else { return }
                errorMessage = AppCopy.friendlyError(error)
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView().accessibilityLabel("正在保存头像")
                } else {
                    Button("保存") { Task { await saveAvatar() } }
                        .disabled(pendingData == nil || isPreparing || appState.isUpdatingAccount)
                }
            }
        }
        .confirmationDialog("恢复默认头像？", isPresented: $showRemoveConfirm, titleVisibility: .visible) {
            Button("恢复默认", role: .destructive) {
                Task { await saveAvatar(removing: true) }
            }
        }
    }

    private var avatarPreview: some View {
        VStack(spacing: 16) {
            Group {
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFill()
                } else if let user = appState.user {
                    ProfileAvatar(user: user, size: 160)
                } else {
                    Image(systemName: "person.crop.circle")
                        .resizable().scaledToFit()
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .frame(width: 160, height: 160)
            .clipShape(Circle())
            .overlay { Circle().strokeBorder(ReadingSpace.profileLine, lineWidth: 1) }
            .accessibilityHidden(true)

            HStack(spacing: 8) {
                if isPreparing {
                    ProgressView().controlSize(.small).tint(AppTheme.primary)
                        .accessibilityHidden(true)
                }
                Text(previewStatus)
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("头像预览")
        .accessibilityValue(previewStatus)
    }

    private var previewStatus: String {
        isPreparing ? "正在处理照片…" : pendingData == nil ? "当前头像" : "待保存预览"
    }

    private func saveAvatar(removing: Bool = false) async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            if removing {
                try await appState.removeAvatar()
            } else if let pendingData {
                try await appState.updateAvatar(pendingData)
            } else {
                return
            }
            AppFeedback.success(removing ? "已恢复默认头像" : "头像已更新")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            AppFeedback.error()
        }
    }
}

private enum ProfileAvatarImage {
    static func jpeg(from data: Data) throws -> Data {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 512,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw APIError.http(status: 400, message: "无法处理这张照片，请选择其他图片")
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw APIError.invalidResponse
        }
        CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length <= 1_024 * 1_024 else {
            throw APIError.http(status: 400, message: "图片处理失败，请选择其他照片")
        }
        return output as Data
    }
}
