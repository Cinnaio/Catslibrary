import Foundation

struct LibraryWidgetItem: Codable, Identifiable {
    let id: String
    let novelId: String
    let title: String
    let author: String
    let chapterId: String
    let chapterTitle: String
    let chapterOrder: Int
    let text: String
    let scrollPercent: Double
}
struct LibraryWidgetContent: Codable {
    let reading: LibraryWidgetItem?
    let quotes: [LibraryWidgetItem]
}
struct LibraryWidgetSnapshot: Codable {
    let scope: String
    let savedAt: Date
    let content: LibraryWidgetContent
    static let maxAge: TimeInterval = 24 * 60 * 60
    var expiresAt: Date { savedAt.addingTimeInterval(Self.maxAge) }
    func isValid(at date: Date = Date()) -> Bool { !scope.isEmpty && savedAt <= date && expiresAt > date }
    func link(kind: String, id: String) -> URL? {
        var url = URLComponents()
        url.scheme = "catslibrary"
        url.host = "widget"
        url.path = "/\(kind)"
        url.queryItems = [URLQueryItem(name: "scope", value: scope), URLQueryItem(name: "id", value: id)]
        return url.url
    }
}

enum LibraryWidgetStorage {
    static let continueKind = "CatsLibraryContinue"
    static let quoteKind = "CatsLibraryQuote"
    static var fileURL: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "LibraryWidgetAppGroup") as? String,
              !group.isEmpty, !group.contains("$("),
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return container.appendingPathComponent("library-widget-v1.json")
    }
    static func read() -> LibraryWidgetSnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(LibraryWidgetSnapshot.self, from: data), snapshot.isValid() else { return nil }
        return snapshot
    }
    static func write(_ snapshot: LibraryWidgetSnapshot) throws {
        guard let url = fileURL else { throw CocoaError(.fileNoSuchFile) }
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func clear() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
    }
}

struct LibraryWidgetLink: Equatable {
    let kind: String
    let itemID: String
    let scope: String
    init?(url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "catslibrary", parts.host == "widget", parts.user == nil, parts.password == nil, parts.port == nil,
              ["/continue", "/quote"].contains(parts.path),
              let items = parts.queryItems,
              items.filter({ $0.name == "scope" }).count == 1,
              items.filter({ $0.name == "id" }).count == 1,
              let account = items.first(where: { $0.name == "scope" })?.value,
              account.count == 64, account.allSatisfy({ $0.isHexDigit }),
              let item = items.first(where: { $0.name == "id" })?.value,
              !item.isEmpty, item.count <= 200 else { return nil }
        kind = String(parts.path.dropFirst()); itemID = item; scope = account
    }
}
