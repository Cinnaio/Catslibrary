import SwiftUI
import UIKit

/// 站点公告：编辑并保存站点头部公告（GET/PUT /api/admin/site，最长 240 字）。
struct AdminAnnouncementView: View {
    @State private var text = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var actionError: String?

    private let maxLength = 240

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
                VStack(spacing: 0) {
                    TextEditor(text: $text)
                        .padding(10)
                        .scrollContentBackground(.hidden)
                        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(AppTheme.border, lineWidth: 1)
                        )
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                    HStack {
                        Text("\(text.count)/\(maxLength)")
                            .font(.caption)
                            .foregroundStyle(text.count > maxLength ? AppTheme.danger : AppTheme.textSecondary)
                        Spacer()
                        Button {
                            Task { await save() }
                        } label: {
                            if isSaving {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Text("保存")
                                    .fontWeight(.medium)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.primary)
                        .disabled(isSaving || text.count > maxLength)
                    }
                    .padding(16)

                    Text("公告显示在网站头部与 App 首页，留空表示不展示。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)

                    Spacer()
                }
            }
        }
        .pageBackground()
        .navigationTitle("站点公告")
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
            text = try await AdminAPI.announcement()
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = String(text.prefix(maxLength))
            _ = try await AdminAPI.setAnnouncement(saved)
            text = saved
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }
}
