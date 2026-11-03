import Foundation

/// API paths already contain escaped IDs and query values. Preserve their encoding exactly once.
public enum APIRequestURL {
    public static func resolve(_ path: String, relativeTo base: URL) -> URL? {
        guard let route = URLComponents(string: path), route.scheme == nil, route.host == nil,
              var result = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        var routePath = route.percentEncodedPath
        if routePath.hasPrefix("/") { routePath.removeFirst() }
        if routePath.hasSuffix("/") { routePath.removeLast() }
        var basePath = result.percentEncodedPath
        if basePath.hasSuffix("/") { basePath.removeLast() }
        result.percentEncodedPath = basePath + "/" + routePath
        result.percentEncodedQuery = route.percentEncodedQuery
        result.percentEncodedFragment = route.percentEncodedFragment
        return result.url
    }
}
