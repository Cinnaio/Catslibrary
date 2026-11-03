import Foundation

public enum ReaderQuery {
    public static func encode(_ params: [String: String]) -> String {
        params.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) ?? value)"
        }
        .joined(separator: "&")
    }

    private static let queryValueAllowed: CharacterSet = {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+#?")
        return allowed
    }()
}
