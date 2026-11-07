import SwiftUI
import WebKit
import ZhiZhouCore

struct AccountChallengeConfiguration: Decodable {
    let action: String
    let mode: String
    let configured: Bool
}

@MainActor @Observable final class AccountChallengeController {
    var action: String?
    private var continuation: CheckedContinuation<String, Error>?
    private var timeout: Task<Void, Never>?
    private var generation = 0

    func verify(_ action: String) async throws -> String {
        let ownerGeneration = generation
        let config: AccountChallengeConfiguration = try await APIClient.shared.get("/api/security/challenge?action=\(action)", auth: action == "verify-email")
        try Task.checkCancellation()
        guard generation == ownerGeneration else { throw CancellationError() }
        guard config.action == action, ["off", "observe", "enforce"].contains(config.mode) else {
            throw APIError.network("安全验证配置无效，请更新服务端后重试。")
        }
        guard config.mode == "enforce" else { return "" }
        guard config.configured else { throw APIError.network("安全验证尚未配置，请联系管理员。") }
        guard continuation == nil else { throw APIError.network("已有安全验证正在进行。") }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                self.action = action
                timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(300))
                    guard !Task.isCancelled else { return }
                    self?.finish(nil)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(nil) }
        }
    }

    func finish(_ token: String?) {
        generation += 1
        let pending = continuation
        continuation = nil
        timeout?.cancel(); timeout = nil; action = nil
        if let token, !token.isEmpty { pending?.resume(returning: token) }
        else { pending?.resume(throwing: CancellationError()) }
    }
}

struct AccountChallengeSheet: View {
    let action: String
    let finish: (String?) -> Void
    @State private var token = ""
    @State private var errorMessage: String?
    @State private var round = UUID()
    var body: some View {
        NavigationStack {
            Form {
                Section("安全验证") {
                    AccountChallengeWebView(action: action) { result in
                        switch result {
                        case .success(let value): token = value; errorMessage = nil
                        case .failure(let error): token = ""; errorMessage = error.localizedDescription
                        }
                    }.id(round).frame(height: 180)
                    Button("重新验证") { token = ""; errorMessage = nil; round = UUID() }
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(AppTheme.danger) } }
                Section {
                    Button("验证并继续") { finish(token) }.disabled(token.isEmpty)
                } footer: { Text("验证用于保护账号操作与邮件发送额度，完成后继续原来的申请。") }
            }
            .appListStyle(.settings)
            .navigationTitle("账户安全验证")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { finish(nil) } } }
        }
    }
}

private struct AccountChallengeWebView: UIViewRepresentable {
    let action: String
    let onResult: (Result<String, Error>) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action: action, onResult: onResult) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController.add(context.coordinator, name: "accountChallenge")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false; view.backgroundColor = .clear; view.scrollView.isScrollEnabled = false
        if let url = context.coordinator.url { view.load(URLRequest(url: url)) }
        else { onResult(.failure(APIError.notConfigured)) }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.active = false; view.stopLoading(); view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "accountChallenge")
    }
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let url: URL?
        let onResult: (Result<String, Error>) -> Void
        var active = true
        init(action: String, onResult: @escaping (Result<String, Error>) -> Void) {
            if let base = ServerConfig.shared.baseURL {
                var parts = URLComponents(url: base.appendingPathComponent("api/security/native-challenge"), resolvingAgainstBaseURL: false)
                parts?.queryItems = [URLQueryItem(name: "action", value: action)]
                url = base.scheme?.lowercased() == "https" ? parts?.url : nil
            } else { url = nil }
            self.onResult = onResult
        }
        private func matches(_ candidate: URL?) -> Bool {
            AdultChallengeNavigationPolicy.isChallenge(candidate, expected: url) && candidate?.query == url?.query
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard active, message.frameInfo.isMainFrame, matches(message.frameInfo.request.url), let value = message.body as? [String: String] else { return }
            if value["status"] == "success", let token = value["token"], !token.isEmpty, token.count <= 2048 { onResult(.success(token)) }
            else { onResult(.failure(APIError.network("验证失败或过期，请重新验证。"))) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let main = action.targetFrame?.isMainFrame == true
            let allowed = main ? matches(action.request.url) : AdultChallengeNavigationPolicy.allows(action.request.url, expected: url, isMainFrame: false, hasTargetFrame: action.targetFrame != nil)
            decisionHandler(allowed ? .allow : .cancel)
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
                if active { onResult(.failure(APIError.network("安全验证页面不可用，请更新服务端或稍后重试。"))) }
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
        private func report(_ error: Error) { if active && (error as NSError).code != NSURLErrorCancelled { onResult(.failure(error)) } }
    }
}
