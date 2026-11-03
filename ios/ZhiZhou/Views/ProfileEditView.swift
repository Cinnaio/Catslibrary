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

    init(user: User) {
        self.user = user
        _displayName = State(initialValue: user.displayName)
        _bio = State(initialValue: user.bio ?? "")
    }

    var body: some View {
        Form {
            Section {
                NavigationLink {
                    ProfileAvatarEditor()
                } label: {
                    HStack(spacing: 16) {
                        ProfileAvatar(user: appState.user ?? user, size: 64)
                        Text("头像")
                    }
                    .padding(.vertical, 6)
                }
                LabeledContent("用户名", value: user.username)
            }
            Section {
                TextField("昵称", text: $displayName)
                    .textContentType(.nickname)
                    .autocorrectionDisabled()
                    .accessibilityLabel("昵称")
            } header: {
                Text("昵称")
            } footer: {
                characterCount(displayName, limit: 20)
            }
            Section {
                TextField("个人简介", text: $bio, axis: .vertical)
                    .lineLimit(3...6)
                    .accessibilityLabel("个人简介")
            } header: {
                Text("简介")
            } footer: {
                characterCount(bio, limit: 80)
            }
            if let message = errorMessage ?? validationError {
                Section {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.danger)
                }
            }
        }
        .disabled(isSaving)
        .scrollDismissesKeyboard(.interactively)
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("个人资料")
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

    private var hasChanges: Bool {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines) != user.displayName ||
        bio.trimmingCharacters(in: .whitespacesAndNewlines) != (user.bio ?? "")
    }

    private var validationError: String? {
        AccountPolicy.profileError(displayName: displayName, bio: bio)
    }

    private func characterCount(_ value: String, limit: Int) -> some View {
        Text("\(value.utf16.count)/\(limit)")
            .monospacedDigit()
            .foregroundStyle(value.utf16.count > limit ? AppTheme.danger : AppTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel("已输入 \(value.utf16.count) 个字符，最多 \(limit) 个")
    }

    private func save() async {
        guard !isSaving, validationError == nil else { return }
        isSaving = true
        errorMessage = nil
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
        Form {
            Section {
                HStack {
                    Spacer()
                    Group {
                        if let preview {
                            Image(uiImage: preview).resizable().scaledToFill()
                        } else if let user = appState.user {
                            ProfileAvatar(user: user, size: 144)
                        }
                    }
                    .frame(width: 144, height: 144)
                    .clipShape(Circle())
                    .overlay {
                        if isPreparing { ProgressView().tint(AppTheme.primary) }
                    }
                    .accessibilityLabel("头像预览")
                    Spacer()
                }
                .padding(.vertical, 24)
                .listRowBackground(Color.clear)
            }
            Section {
                Button("选择照片", systemImage: "photo.on.rectangle") { showPhotoPicker = true }
                Button("恢复默认头像", systemImage: "person.crop.circle", role: .destructive) {
                    showRemoveConfirm = true
                }
            }
            .disabled(isSaving || isPreparing || appState.isUpdatingAccount)
            if let errorMessage {
                Section {
                    Text(errorMessage).font(.footnote).foregroundStyle(AppTheme.danger)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .navigationTitle("头像")
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
