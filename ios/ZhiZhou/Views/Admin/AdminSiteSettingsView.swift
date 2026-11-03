import SwiftUI

/// First mobile stage exposes configuration health; secrets and branding edits remain in Web.
struct AdminSiteSettingsView: View {
    @State private var branding: AdminSiteBranding?
    @State private var security: AdminTurnstileStatus?
    @State private var loading = false
    @State private var error: String?
    @State private var requestID = UUID()
    var body: some View {
        List {
            if let error { LoadErrorNotice(message: error, isLoading: loading) { Task { await load() } } }
            if loading && branding == nil { ProgressView("读取站点设置…") }
            if let branding {
                Section("站点信息") {
                    LabeledContent("站点名称", value: branding.name)
                    LabeledContent("标语", value: branding.tagline)
                    LabeledContent("首页标题", value: branding.homeTitle)
                    Text(branding.description).foregroundStyle(.secondary)
                    LabeledContent("Logo", value: branding.logoUrl)
                    LabeledContent("网站图标", value: branding.faviconUrl)
                }
            }
            if let security {
                Section("安全验证") {
                    LabeledContent("Turnstile", value: security.configured ? "已配置" : "未就绪")
                    LabeledContent("密钥", value: security.secretSet ? "已设置" : "未设置")
                    LabeledContent("加密环境", value: security.encryptionReady ? "已就绪" : "未就绪")
                    LabeledContent("密钥可读取", value: security.secretReadable ? "是" : "否")
                    LabeledContent("允许域名", value: security.hostnames.joined(separator: "、"))
                    ForEach(["siteKey", "secret", "hostnames"], id: \.self) { key in
                        LabeledContent(sourceTitle(key), value: sourceLabel(security.sources[key] ?? "default"))
                    }
                }
            }
            Section {
                AdminWebLink(title: "在 Web 编辑站点信息", path: "/admin/site-settings?view=branding")
                AdminWebLink(title: "在 Web 配置安全验证", path: "/admin/site-settings?view=security")
            } footer: { Text("浏览器需单独登录管理员账号。此页只读，不显示验证密钥。") }
        }
        .appListStyle(.settings)
        .navigationTitle("站点设置")
        .refreshable { await load() }
        .task(id: ContentAccessStore.shared.accountRevision) { branding = nil; security = nil; error = nil; await load() }
    }
    private func sourceTitle(_ key: String) -> String {
        switch key { case "siteKey": return "站点 Key 来源"; case "secret": return "密钥来源"; default: return "域名来源" }
    }
    private func sourceLabel(_ value: String) -> String {
        switch value { case "environment": return "部署环境"; case "database": return "管理后台"; default: return "默认值" }
    }
    private func load() async {
        guard let token = APIClient.shared.token else { return }
        let id = UUID(); requestID = id; loading = true
        defer { if requestID == id { loading = false } }
        do {
            async let brand: AdminSiteBranding = AdminAPI.parityRequest("GET", "/api/admin/site-settings/branding", token: token)
            async let turnstile: AdminTurnstileStatus = AdminAPI.parityRequest("GET", "/api/admin/site-settings/turnstile", token: token)
            let (b, s) = try await (brand, turnstile)
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            branding = b; security = s; error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
