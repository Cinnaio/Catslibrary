import Foundation

struct PasskeyConfigResponse: Codable, Equatable {
    let enabled: Bool
    let registrationEnabled: Bool
    let configured: Bool
    let rpName: String
}

struct PasskeyItem: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let createdAt: Int64
    let lastUsedAt: Int64
    let deviceName: String
    let transports: [String]
    let backupEligible: Bool
    let backupState: Bool
}

struct PasskeyListResponse: Codable {
    let passkeys: [PasskeyItem]
}

struct PasskeyResponse: Codable {
    let passkey: PasskeyItem?
}

struct PasskeyAuthenticationOptions: Decodable {
    let challenge: String
    let rpId: String?
    let allowCredentials: [PasskeyCredentialDescriptor]?
}

struct PasskeyCredentialDescriptor: Decodable {
    let id: String
}

struct PasskeyRegistrationOptions: Decodable {
    let challenge: String
    let rp: PasskeyRelyingParty
    let user: PasskeyRegistrationUser
}

struct PasskeyRelyingParty: Decodable {
    let id: String
    let name: String
}

struct PasskeyRegistrationUser: Decodable {
    let id: String
    let name: String
    let displayName: String?
}
