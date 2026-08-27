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
    @State private var saveMessage: String?
    @State private var testing = false
    @State private var testResult: AiTestResponse?
    @State private var actionError: String?

    var body: some View {
        List {
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
                                    .lineLimit(3)
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

                if let saveMessage {
                    Section {
                        Label(saveMessage, systemImage: "checkmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.success)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("供应商配置")
        .navigationBarTitleDisplayMode(.large)
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
        isLoading = true
        defer { isLoading = false }
        do {
            let r = try await AdminAPI.aiSettings()
            textBaseUrl = r.providerConfig?.baseUrl ?? ""
            textModel = r.providerConfig?.model ?? ""
            textHasKey = r.providerConfig?.hasApiKey ?? false
            imageBaseUrl = r.imageProviderConfig?.baseUrl ?? ""
            imageModel = r.imageProviderConfig?.model ?? ""
            imageHasKey = r.imageProviderConfig?.hasApiKey ?? false
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save(scope: String, baseUrl: String, model: String, apiKey: String, clearKey: Bool) async {
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
            } else {
                imageHasKey = r.imageProviderConfig?.hasApiKey ?? false
                imageApiKey = ""
            }
            saveMessage = scope == "text" ? "文本供应商已保存" : "图像供应商已保存"
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
