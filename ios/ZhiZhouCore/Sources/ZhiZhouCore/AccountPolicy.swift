import Foundation

public enum AccountPolicy {
    public static func profileError(displayName: String, bio: String) -> String? {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "请填写昵称" }
        // The service limits JavaScript strings by UTF-16 code units.
        if name.utf16.count > 20 { return "昵称不能超过 20 个字符" }
        if bio.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 80 {
            return "简介不能超过 80 个字符"
        }
        return nil
    }

    public static func passwordError(current: String, new: String, confirmation: String) -> String? {
        if current.isEmpty { return "请填写当前密码" }
        if new.utf16.count < 8 { return "新密码至少需要 8 个字符" }
        if new == current { return "新密码不能与当前密码相同" }
        if new != confirmation { return "两次输入的新密码不一致" }
        return nil
    }

    public static func shouldInvalidateSession(
        method: String, path: String, statusCode: Int, errorMessage: String?
    ) -> Bool {
        guard statusCode == 401 else { return false }
        // This endpoint also uses 401 for a rejected current password.
        if method == "POST", path == "/api/auth/change-password",
           errorMessage == "当前密码不正确" {
            return false
        }
        return true
    }
}

/// Delay responses rejected during password rotation until the replacement token is installed.
public struct SessionRotationGuard {
    private var rotatingToken: String?
    private var rejectedToken: String?

    public init() {}

    public mutating func begin(token: String) -> Bool {
        guard !token.isEmpty, rotatingToken == nil else { return false }
        rotatingToken = token
        rejectedToken = nil
        return true
    }

    public mutating func deferInvalidation(for token: String) -> Bool {
        guard rotatingToken == token else { return false }
        rejectedToken = token
        return true
    }

    public mutating func finish(token: String, currentToken: String?) -> String? {
        guard rotatingToken == token else { return nil }
        let rejected = rejectedToken
        rotatingToken = nil
        rejectedToken = nil
        return rejected == currentToken ? rejected : nil
    }
}
