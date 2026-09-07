import SwiftUI

struct ProfilePrivacyView: View {
    @State private var diagnosticsEnabled = AppObservability.shared.isDiagnosticsEnabled

    var body: some View {
        List {
            Section {
                NavigationLink {
                    PrivacyNoticeView()
                } label: {
                    Label("隐私说明", systemImage: "hand.raised")
                }
            }
            Section {
                Toggle("帮助改进知舟", isOn: $diagnosticsEnabled)
                    .onChange(of: diagnosticsEnabled) { _, enabled in
                        AppObservability.shared.setDiagnosticsEnabled(enabled)
                        AppFeedback.success(enabled ? "匿名诊断已开启" : "匿名诊断已关闭")
                    }
            } header: {
                Text("诊断")
            } footer: {
                Text("可选发送匿名的功能事件、性能指标和崩溃诊断；不会发送小说正文、搜索词、密码或账号信息。关闭后，尚未发送的本地诊断记录会立即清除。")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("隐私与诊断")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ProfileAboutView: View {
    #if DEBUG
    @AppStorage("zhizhou.allowInvalidCert") private var allowInvalidCert = false
    #endif

    var body: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    BrandMark()
                    Text("知舟")
                        .font(serifFont(.title2, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                }
                .padding(.vertical, 12)
                .listRowBackground(Color.clear)
                LabeledContent("版本", value: version)
            }
            Section("服务器") {
                Text(ServerConfig.serverURL)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            #if DEBUG
            Section {
                Toggle("信任无效证书", isOn: $allowInvalidCert)
                    .onChange(of: allowInvalidCert) { _, value in
                        APIClient.shared.allowsInvalidCertificates = value
                    }
            } header: {
                Text("开发设置")
            } footer: {
                Text("仅用于自签名或过期证书排查。")
            }
            #endif
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("关于知舟")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var version: String {
        let marketing = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "\(marketing) (\(build))"
    }
}
