import AuthenticationServices
import Foundation
import UIKit

enum NativePasskeyError: LocalizedError, Equatable {
    case unavailable
    case invalidConfiguration
    case invalidChallenge
    case invalidCredential
    case cancelled
    case authorizationFailed
    case presentationUnavailable

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "当前站点暂未开放 Passkey。"
        case .invalidConfiguration:
            return "Passkey 服务配置不完整，请联系管理员。"
        case .invalidChallenge:
            return "Passkey 验证请求已失效，请重试。"
        case .invalidCredential:
            return "设备没有返回有效的 Passkey 凭据。"
        case .cancelled:
            return "已取消 Passkey 验证。"
        case .authorizationFailed:
            return "Passkey 验证失败，请重试。"
        case .presentationUnavailable:
            return "当前页面暂时无法唤起设备验证，请重试。"
        }
    }
}

@MainActor
private final class PasskeyAuthorizationCoordinator: NSObject,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    private let anchor: ASPresentationAnchor
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    init(anchor: ASPresentationAnchor) {
        self.anchor = anchor
    }

    func perform(requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: requests)
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        finish(.success(authorization))
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        if let authorizationError = error as? ASAuthorizationError,
           authorizationError.code == .canceled {
            finish(.failure(NativePasskeyError.cancelled))
        } else {
            finish(.failure(NativePasskeyError.authorizationFailed))
        }
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        let continuation = self.continuation
        self.continuation = nil
        controller = nil
        continuation?.resume(with: result)
    }
}

@MainActor
final class PasskeyService {
    static let shared = PasskeyService()

    private init() {}

    var relyingPartyIdentifier: String? {
        ServerConfig.shared.baseURL?.host?.lowercased()
    }

    func configuration() async throws -> PasskeyConfigResponse {
        try await APIClient.shared.get("/api/auth/passkeys/config")
    }

    func login(username: String, remember: Bool) async throws -> LoginResponse {
        let config = try await ensureAvailable()
        guard config.configured else { throw NativePasskeyError.invalidConfiguration }

        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let optionsBody: Data
        if normalizedUsername.isEmpty {
            optionsBody = Data("{}".utf8)
        } else {
            optionsBody = try APIClient.shared.jsonBody(["username": normalizedUsername])
        }
        let options: PasskeyAuthenticationOptions = try await APIClient.shared.post(
            "/api/auth/passkeys/login/options",
            body: optionsBody
        )
        let assertion = try await makeAssertion(options: options)
        let response = PasskeyAssertionResponse(
            id: assertion.credentialID.base64URLEncoded,
            rawId: assertion.credentialID.base64URLEncoded,
            type: "public-key",
            response: PasskeyAssertionResponseBody(
                clientDataJSON: assertion.rawClientDataJSON.base64URLEncoded,
                authenticatorData: assertion.rawAuthenticatorData.base64URLEncoded,
                signature: assertion.signature.base64URLEncoded,
                userHandle: assertion.userID?.base64URLEncoded
            )
        )
        let body = try APIClient.shared.jsonBody(
            PasskeyLoginVerifyRequest(challenge: options.challenge, response: response, remember: remember)
        )
        return try await APIClient.shared.post("/api/auth/passkeys/login/verify", body: body)
    }

    func register(currentPassword: String, name: String) async throws -> PasskeyItem? {
        let config = try await ensureAvailable()
        guard config.registrationEnabled else { throw NativePasskeyError.unavailable }
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }

        let optionsBody = try APIClient.shared.jsonBody(["currentPassword": currentPassword])
        let options: PasskeyRegistrationOptions = try await APIClient.shared.request(
            "POST",
            "/api/auth/passkeys/register/options",
            body: optionsBody,
            auth: true,
            expectedToken: token
        )
        let registration = try await makeRegistration(options: options)
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = try APIClient.shared.jsonBody(
            PasskeyRegistrationVerifyRequest(
                challenge: options.challenge,
                response: registration,
                name: cleanName.isEmpty ? nil : cleanName
            )
        )
        let result: PasskeyResponse = try await APIClient.shared.request(
            "POST",
            "/api/auth/passkeys/register/verify",
            body: body,
            auth: true,
            expectedToken: token
        )
        return result.passkey
    }

    func list() async throws -> [PasskeyItem] {
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }
        let response: PasskeyListResponse = try await APIClient.shared.request(
            "GET",
            "/api/auth/passkeys",
            auth: true,
            expectedToken: token
        )
        return response.passkeys
    }

    func rename(id: String, name: String) async throws -> PasskeyItem? {
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else {
            throw APIError.http(status: 400, message: "名称不能为空")
        }
        let body = try APIClient.shared.jsonBody(["name": cleanName])
        let path = "/api/auth/passkeys/\(Self.pathComponent(id))"
        let response: PasskeyResponse = try await APIClient.shared.request(
            "PATCH",
            path,
            body: body,
            auth: true,
            expectedToken: token
        )
        return response.passkey
    }

    func revoke(id: String) async throws {
        guard let token = APIClient.shared.token else { throw APIError.unauthorized }
        let path = "/api/auth/passkeys/\(Self.pathComponent(id))"
        let _: EmptyResponse = try await APIClient.shared.request(
            "DELETE",
            path,
            auth: true,
            expectedToken: token
        )
    }

    private func ensureAvailable() async throws -> PasskeyConfigResponse {
        let config = try await configuration()
        guard config.enabled else { throw NativePasskeyError.unavailable }
        guard config.configured, relyingPartyIdentifier != nil else {
            throw NativePasskeyError.invalidConfiguration
        }
        return config
    }

    private func makeAssertion(
        options: PasskeyAuthenticationOptions
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialAssertion {
        guard let rpId = options.rpId?.lowercased(),
              let relyingPartyIdentifier,
              rpId == relyingPartyIdentifier else {
            throw NativePasskeyError.invalidConfiguration
        }
        guard let challenge = Data(base64URL: options.challenge) else {
            throw NativePasskeyError.invalidChallenge
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: rpId
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        if let allowCredentials = options.allowCredentials {
            let descriptors = try allowCredentials.map { descriptor in
                guard let credentialID = Data(base64URL: descriptor.id) else {
                    throw NativePasskeyError.invalidCredential
                }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: credentialID)
            }
            request.allowedCredentials = descriptors
        }

        let authorization = try await perform(request: request)
        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw NativePasskeyError.invalidCredential
        }
        return assertion
    }

    private func makeRegistration(
        options: PasskeyRegistrationOptions
    ) async throws -> PasskeyRegistrationResponse {
        guard let relyingPartyIdentifier,
              options.rp.id.lowercased() == relyingPartyIdentifier else {
            throw NativePasskeyError.invalidConfiguration
        }
        guard let challenge = Data(base64URL: options.challenge),
              let userID = Data(base64URL: options.user.id) else {
            throw NativePasskeyError.invalidChallenge
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: relyingPartyIdentifier
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user.name,
            userID: userID
        )
        request.displayName = options.user.displayName ?? options.user.name
        request.userVerificationPreference = .required
        request.attestationPreference = .none

        let authorization = try await perform(request: request)
        guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw NativePasskeyError.invalidCredential
        }
        guard let rawAttestationObject = registration.rawAttestationObject else {
            throw NativePasskeyError.invalidCredential
        }
        return PasskeyRegistrationResponse(
            id: registration.credentialID.base64URLEncoded,
            rawId: registration.credentialID.base64URLEncoded,
            type: "public-key",
            response: PasskeyRegistrationResponseBody(
                clientDataJSON: registration.rawClientDataJSON.base64URLEncoded,
                attestationObject: rawAttestationObject.base64URLEncoded
            )
        )
    }

    private func perform(request: ASAuthorizationRequest) async throws -> ASAuthorization {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
            let anchor = scene.windows.first(where: \.isKeyWindow) ?? scene.windows.first else {
            throw NativePasskeyError.presentationUnavailable
        }
        let coordinator = PasskeyAuthorizationCoordinator(anchor: anchor)
        return try await coordinator.perform(requests: [request])
    }

    private static func pathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

private struct PasskeyLoginVerifyRequest: Encodable {
    let challenge: String
    let response: PasskeyAssertionResponse
    let remember: Bool
}

private struct PasskeyRegistrationVerifyRequest: Encodable {
    let challenge: String
    let response: PasskeyRegistrationResponse
    let name: String?

    enum CodingKeys: String, CodingKey { case challenge, response, name }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(challenge, forKey: .challenge)
        try container.encode(response, forKey: .response)
        try container.encodeIfPresent(name, forKey: .name)
    }
}

private struct PasskeyAssertionResponse: Encodable {
    let id: String
    let rawId: String
    let type: String
    let response: PasskeyAssertionResponseBody
}

private struct PasskeyAssertionResponseBody: Encodable {
    let clientDataJSON: String
    let authenticatorData: String
    let signature: String
    let userHandle: String?

    enum CodingKeys: String, CodingKey { case clientDataJSON, authenticatorData, signature, userHandle }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(clientDataJSON, forKey: .clientDataJSON)
        try container.encode(authenticatorData, forKey: .authenticatorData)
        try container.encode(signature, forKey: .signature)
        try container.encodeIfPresent(userHandle, forKey: .userHandle)
    }
}

private struct PasskeyRegistrationResponse: Encodable {
    let id: String
    let rawId: String
    let type: String
    let response: PasskeyRegistrationResponseBody
}

private struct PasskeyRegistrationResponseBody: Encodable {
    let clientDataJSON: String
    let attestationObject: String
}

private extension Data {
    init?(base64URL value: String) {
        var normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        self.init(base64Encoded: normalized)
    }

    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
