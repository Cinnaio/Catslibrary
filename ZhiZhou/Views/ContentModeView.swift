import SwiftUI
import WebKit

struct ContentModeView: View {
    @State private var access = ContentAccessStore.shared
    @State private var showUnlock = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                LabeledContent("当前模式", value: access.mode == "adult" ? "R18 · 在线阅读" : "安全模式")
                if access.mode == "adult" {
                    Button("关闭 R18 阅读模式", role: .destructive) {
                        Task {
                            do { try await access.lock() }
                            catch { errorMessage = "本机已切回安全模式，但服务端撤销失败，请联网后重试：\(AppCopy.friendlyError(error))" }
                        }
                    }
                } else {
                    if access.needsLockRetry {
                        Button("重试撤销服务端授权") {
                            Task {
                                do { try await access.lock(); errorMessage = nil }
                                catch { errorMessage = AppCopy.friendlyError(error) }
                            }
                        }
                    }
                    Button("开启 R18 阅读模式", systemImage: "lock.open") { showUnlock = true }
                        .disabled(!access.adultContentEnabled || !access.configured || access.needsLockRetry)
                }
            } footer: {
                Text("开启前需要确认已年满 18 岁并完成人机验证。授权仅对当前登录会话有效。限制级作品仅支持在线阅读，暂不支持离线下载。")
            }
            if let notice = access.notice {
                Section { Text(notice).foregroundStyle(AppTheme.textSecondary) }
            }
            if !access.adultContentEnabled || !access.configured {
                Section {
                    Text(!access.adultContentEnabled ? "站点暂未开放成人内容。" : "站点尚未配置成人模式验证，请联系管理员。")
                        .foregroundStyle(AppTheme.textSecondary)
                    Button("刷新状态") { Task { await refresh() } }
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(AppTheme.danger) }
            }
        }
        .appListStyle(.settings)
        .navigationTitle("内容模式")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(access.isBusy)
        .task { await refresh() }
        .sheet(isPresented: $showUnlock) {
            AdultReaderUnlockView()
        }
    }

    private func refresh() async {
        do { try await access.refreshPolicy(); errorMessage = nil }
        catch { errorMessage = AppCopy.friendlyError(error) }
    }
}

private struct AdultReaderUnlockView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var access = ContentAccessStore.shared
    @State private var confirmed = false
    @State private var challengeToken = ""
    @State private var widgetID = UUID()
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("限制级作品可能包含成人主题。请确认你已年满 18 岁，并愿意查看此类内容。")
                    Toggle("我已年满 18 岁", isOn: $confirmed)
                }
                Section("人机验证") {
                    if confirmed {
                        AdultTurnstileView { result in
                            switch result {
                            case .success(let token): challengeToken = token; errorMessage = nil
                            case .failure(let error): challengeToken = ""; errorMessage = error.localizedDescription
                            }
                        }
                        .id(widgetID)
                        .frame(height: 180)
                        Button("重新验证") { challengeToken = ""; errorMessage = nil; widgetID = UUID() }
                    } else {
                        Text("确认成年后加载验证。")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(AppTheme.danger) }
                }
                Section {
                    Button(access.isBusy ? "正在验证…" : "确认并开启") {
                        Task {
                            do {
                                try await access.unlock(challengeToken: challengeToken, confirmed: confirmed)
                                dismiss()
                            } catch {
                                errorMessage = AppCopy.friendlyError(error)
                                challengeToken = ""
                                widgetID = UUID()
                            }
                        }
                    }
                    .disabled(!confirmed || challengeToken.isEmpty || access.isBusy)
                } footer: {
                    Text("人机验证不等于年龄验证。限制级章节不会保存为离线内容。")
                }
            }
            .appListStyle(.settings)
            .navigationTitle("开启 R18 阅读")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(access.isBusy)
                }
            }
            .onChange(of: confirmed) { _, _ in challengeToken = ""; widgetID = UUID() }
            .interactiveDismissDisabled(access.isBusy)
        }
    }
}

/// 网页只负责生成验证 token；登录凭证始终留在原生网络层。
private struct AdultTurnstileView: UIViewRepresentable {
    let onResult: (Result<String, Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onResult: onResult) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "adultChallenge")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        if let url = context.coordinator.challengeURL { view.load(URLRequest(url: url)) }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.active = false
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "adultChallenge")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let challengeURL = ServerConfig.shared.baseURL?.appendingPathComponent("api/content-policy/native-challenge")
        let onResult: (Result<String, Error>) -> Void
        var active = true
        init(onResult: @escaping (Result<String, Error>) -> Void) { self.onResult = onResult }

        private func isChallenge(_ url: URL?) -> Bool {
            guard let url, let expected = challengeURL else { return false }
            return url.scheme == expected.scheme && url.host == expected.host && url.port == expected.port && url.path == expected.path
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard active, message.frameInfo.isMainFrame, isChallenge(message.frameInfo.request.url),
                  let payload = message.body as? [String: String] else { return }
            if payload["status"] == "success", let token = payload["token"], !token.isEmpty, token.count <= 2048 {
                onResult(.success(token))
            } else {
                onResult(.failure(APIError.network("验证失败或已过期，请重新验证。")))
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            let allowed = action.targetFrame?.isMainFrame == true
                ? isChallenge(url)
                : (isChallenge(url) || (url.scheme == "https" && url.host == "challenges.cloudflare.com"))
            decisionHandler(allowed ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
                if active { onResult(.failure(APIError.network("验证页面不可用，请刷新站点状态后重试。"))) }
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if active { onResult(.failure(error)) }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if active { onResult(.failure(error)) }
        }
    }
}
