import Foundation
import Security

/// 极简 Keychain 封装：登录 token 存 Keychain，不落 UserDefaults。
enum Keychain {
    #if DEBUG && targetEnvironment(simulator)
    private static let auditLock = NSLock()
    private static var auditValues: [String: String] = [:]
    #endif

    private static func baseQuery(forKey key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrAccount as String: key]
    }

    @discardableResult
    static func save(_ value: String, forKey key: String) -> Bool {
        #if DEBUG && targetEnvironment(simulator)
        if VisualAudit.enabled {
            auditLock.lock()
            defer { auditLock.unlock() }
            auditValues[key] = value
            return true
        }
        #endif
        let data = Data(value.utf8)
        let query = baseQuery(forKey: key).merging([kSecValueData as String: data]) { _, new in new }
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    static func load(_ key: String) -> String? {
        #if DEBUG && targetEnvironment(simulator)
        if VisualAudit.enabled {
            auditLock.lock()
            defer { auditLock.unlock() }
            return auditValues[key]
        }
        #endif
        var query = baseQuery(forKey: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        #if DEBUG && targetEnvironment(simulator)
        if VisualAudit.enabled {
            auditLock.lock()
            defer { auditLock.unlock() }
            auditValues.removeValue(forKey: key)
            return
        }
        #endif
        SecItemDelete(baseQuery(forKey: key) as CFDictionary)
    }
}
