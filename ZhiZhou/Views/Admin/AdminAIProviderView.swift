import SwiftUI

/// 供应商配置：文本 / 图像供应商（baseUrl / model / apiKey）+ 连通性测试。
struct AdminAIProviderView: View {
    @State private var textBaseUrl = ""
    @State private var textModel = ""
    @State private var textApiKey = ""
    @State private var textHasKey = false
    @State private var imageBaseUrl = ""
    @State private var imageModel = ""
    @State private var imageApiKey = ""
    @State private var imageHasKey = false
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var saving = false
    @State private var savingScope: String?
    @State private var testing = false
    @State private var testResult: AiTestResponse?
    @State private var actionError: String?
    @State private var savedText: [String]?
    @State private var savedImage: [String]?
    @State private var loadingRequest = false

    private var hasUnsavedChanges: Bool {
        (savedText.map { $0 != [textBaseUrl, textModel] } ?? false)
            || (savedImage.map { $0 != [imageBaseUrl, imageModel] } ?? false)
            || !textApiKey.isEmpty || !imageApiKey.isEmpty
    }

    var body: some View {
        Form {
            if isLoading {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage {
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
            } else {
                providerSection(
                    title: "文本供应商",
                    baseUrl: $textBaseUrl,
                    model: $textModel,
                    apiKey: $textApiKey,
                    hasKey: textHasKey,
                    saveScope: "text"
                )
                providerSection(
                    title: "图像供应商",
                    baseUrl: $imageBaseUrl,
                    model: $imageModel,
                    apiKey: $imageApiKey,
                    hasKey: imageHasKey,
                    saveScope: "image"
                )

                Section("连通性测试") {
                    Button {
                        Task { await test() }
                    } label: {
                        if testing {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                        } else {
                            Label("测试文本供应商", systemImage: "bolt")
                        }
                    }
                    .disabled(testing)

                    if let testResult {
                        if testResult.ok == true {
                            Label("连接成功", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(AppTheme.success)
                            if let model = testResult.model, !model.isEmpty {
                                LabeledContent("模型") {
                                    Text(model)
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                            LabeledContent("耗时") {
                                Text("\(testResult.elapsedMs ?? 0) ms")
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            if let reply = testResult.reply, !reply.isEmpty {
                                Text(reply)
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .appTextLineLimit(3)
                            }
                        } else {
                            Label("连接失败", systemImage: "xmark.octagon")
                                .foregroundStyle(AppTheme.danger)
                            if let error = testResult.error, !error.isEmpty {
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.danger)
                            }
                        }
                    }
                }

            }
        }
        .scrollContentBackground(.hidden)
        .disabled(saving)
        .appListStyle(.settings)
        .navigationTitle("供应商配置")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func providerSection(
        title: String,
        baseUrl: Binding<String>,
        model: Binding<String>,
        apiKey: Binding<String>,
        hasKey: Bool,
        saveScope: String
    ) -> some View {
        Section(title) {
            TextField("Base URL", text: baseUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("模型", text: model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField(hasKey ? "已设置密钥（留空不修改）" : "API Key", text: apiKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                Task { await save(scope: saveScope, baseUrl: baseUrl.wrappedValue, model: model.wrappedValue, apiKey: apiKey.wrappedValue, clearKey: false) }
            } label: {
                if savingScope == saveScope {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("保存", systemImage: "checkmark.circle")
                }
            }
            .disabled(saving)
            Button("清空密钥", role: .destructive) {
                Task { await save(scope: saveScope, baseUrl: baseUrl.wrappedValue, model: model.wrappedValue, apiKey: "", clearKey: true) }
            }
            .font(.subheadline)
            .disabled(saving)
        }
    }

    private func load() async {
        guard !loadingRequest, !saving else { return }
        guard !hasUnsavedChanges else {
            actionError = "有未保存的修改，请先保存供应商配置再刷新。"
            return
        }
        loadingRequest = true
        isLoading = true
        defer { isLoading = false; loadingRequest = false }
        do {
            let r = try await AdminAPI.aiSettings()
            guard !Task.isCancelled else { return }
            textBaseUrl = r.providerConfig?.baseUrl ?? ""
            textModel = r.providerConfig?.model ?? ""
            textHasKey = r.providerConfig?.hasApiKey ?? false
            imageBaseUrl = r.imageProviderConfig?.baseUrl ?? ""
            imageModel = r.imageProviderConfig?.model ?? ""
            imageHasKey = r.imageProviderConfig?.hasApiKey ?? false
            savedText = [textBaseUrl, textModel]
            savedImage = [imageBaseUrl, imageModel]
            errorMessage = nil
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save(scope: String, baseUrl: String, model: String, apiKey: String, clearKey: Bool) async {
        guard !saving, !loadingRequest else { return }
        saving = true
        savingScope = scope
        defer {
            saving = false
            savingScope = nil
        }
        do {
            var patch: [String: Any] = [
                "scope": scope,
                "baseUrl": baseUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                "model": model.trimmingCharacters(in: .whitespacesAndNewlines),
            ]
            if clearKey {
                patch["apiKey"] = ""
            } else if !apiKey.isEmpty {
                patch["apiKey"] = apiKey
            }
            let r = try await AdminAPI.saveAiProvider(patch)
            if scope == "text" {
                textHasKey = r.providerConfig?.hasApiKey ?? false
                textApiKey = ""
                savedText = [textBaseUrl, textModel]
            } else {
                imageHasKey = r.imageProviderConfig?.hasApiKey ?? false
                imageApiKey = ""
                savedImage = [imageBaseUrl, imageModel]
            }
            AppFeedback.success(scope == "text" ? "文本供应商已保存" : "图像供应商已保存")
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func test() async {
        testing = true
        defer { testing = false }
        do {
            testResult = try await AdminAPI.testAi()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
