import Foundation

/// A chapter URL on the app's own site. Web-specific locations keep their original URL behavior.
public struct ReaderChapterLink: Hashable, Sendable {
    public let novelID: String
    public let chapterID: String

    public init?(url: URL, site: URL) {
        guard let route = URLComponents(url: url, resolvingAgainstBaseURL: true),
              let reader = APIRequestURL.resolve("/read", relativeTo: site),
              let base = URLComponents(url: reader, resolvingAgainstBaseURL: false),
              let scheme = base.scheme?.lowercased(), scheme == "https" || scheme == "http",
              route.scheme?.lowercased() == scheme,
              let host = base.host?.lowercased(), route.host?.lowercased() == host,
              route.user == nil, route.password == nil,
              route.query == nil, route.fragment == nil else { return nil }

        let defaultPort = scheme == "https" ? 443 : 80
        let prefix = base.percentEncodedPath + "/"
        guard (route.port ?? defaultPort) == (base.port ?? defaultPort),
              route.percentEncodedPath.hasPrefix(prefix) else { return nil }

        var path = route.percentEncodedPath.dropFirst(prefix.count)
        if path.last == "/" { path.removeLast() }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard segments.count == 2,
              let novelID = segments[0].removingPercentEncoding,
              let chapterID = segments[1].removingPercentEncoding,
              !["", ".", ".."].contains(novelID), !["", ".", ".."].contains(chapterID) else { return nil }
        self.novelID = novelID
        self.chapterID = chapterID
    }
}
