import Foundation

/// A profile can rule out a capability, but cannot prove the app claimed it in
/// its code signature. Missing/unreadable profiles (including store builds)
/// remain unknown and must be left to AuthenticationServices to evaluate.
public enum PasskeySigningSupport: Equatable {
    case notAuthorized
    case notDetermined

    public static func inspect(profileData: Data?) -> Self {
        guard let profileData,
              let start = profileData.range(of: Data("<plist".utf8)),
              let end = profileData.range(
                of: Data("</plist>".utf8),
                in: start.lowerBound..<profileData.endIndex
              ),
              let plist = try? PropertyListSerialization.propertyList(
                from: Data(profileData[start.lowerBound..<end.upperBound]),
                options: [], format: nil
              ),
              let profile = plist as? [String: Any],
              let entitlements = profile["Entitlements"] as? [String: Any] else {
            return .notDetermined
        }
        let key = "com.apple.developer.associated-domains"
        guard let value = entitlements[key] else { return .notAuthorized }
        guard let domains = value as? [String] else { return .notDetermined }
        return domains.isEmpty ? .notAuthorized : .notDetermined
    }
}
