import SwiftUI

/// 内容安全：成人内容开关（GET/PUT /api/admin/content-policy）。
struct AdminPolicyView: View {
    @State private var adultEnabled = false
    @State private var savedValue = false
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var actionError: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("加载中…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("加载失败", systemImage: "wifi.slash")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                List {
                    Section {
                        HStack(spacing: 8) {
                            Toggle("允许成人内容", isOn: $adultEnabled)
                                .disabled(isSaving)
                                .onChange(of: adultEnabled) { _, newValue in
                                    // 加载完成前的赋值与回滚赋值都不算用户操作，避免误保存/死循环
                                    guard !isLoading, newValue != savedValue else { return }
                                    Task { await save(newValue) }
                                }
                            if isSaving {
                                AdminInlineProgress()
                            }
                        }
                    } footer: {
                        Text("开启后站点可展示 PO18 预设内容。本 App 客户端固定 contentMode = safe，仅提供管理开关；App Store 上架前请保持关闭。")
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .pageBackground()
        .navigationTitle("内容安全")
        .navigationBarTitleDisplayMode(.large)
        .task { await load() }
        .alert("操作未完成", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            adultEnabled = try await AdminAPI.contentPolicy()
            savedValue = adultEnabled
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save(_ enabled: Bool) async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await AdminAPI.setContentPolicy(enabled: enabled)
            savedValue = enabled
        } catch {
            actionError = AppCopy.friendlyError(error)
            // 回滚开关到上次保存值，保持与服务端一致
            adultEnabled = savedValue
        }
    }
}
