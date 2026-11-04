import Foundation

public struct AdminRecentBook: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let author: String
    public let visitedAt: Int64

    public init(id: String, title: String, author: String, visitedAt: Int64) {
        self.id = id; self.title = title; self.author = author; self.visitedAt = visitedAt
    }
}

public struct AdminWritingDraft: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let values: [String: String]
    public let updatedAt: Int64

    public init(id: String, values: [String: String], updatedAt: Int64) {
        self.id = id; self.values = values; self.updatedAt = updatedAt
    }
}

/// Input drafts are distinct from server-generated content and never submit a job on restore.
/// Every read/write requires an explicit owner, including saves from disappearing views.
public struct AdminWorkspaceLocalStore {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func recentBooks(userID: String) -> [AdminRecentBook] {
        read([AdminRecentBook].self, key: key("recent", userID)) ?? []
    }

    public func record(_ book: AdminRecentBook, userID: String) {
        guard !userID.isEmpty, !book.id.isEmpty else { return }
        let rest = recentBooks(userID: userID).filter { $0.id != book.id }
        write(Array(([book] + rest).prefix(8)), key: key("recent", userID))
    }

    public func drafts(userID: String) -> [AdminWritingDraft] {
        let values = read([String: AdminWritingDraft].self, key: key("writing", userID)) ?? [:]
        return values.values.sorted { $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt }
    }

    public func draft(contextID: String, userID: String) -> AdminWritingDraft? {
        drafts(userID: userID).first { $0.id == contextID }
    }

    public func save(_ draft: AdminWritingDraft, userID: String) {
        guard !userID.isEmpty else { return }
        var values = Dictionary(uniqueKeysWithValues: drafts(userID: userID).map { ($0.id, $0) })
        values[draft.id] = draft
        write(values, key: key("writing", userID))
    }

    public func removeDraft(contextID: String, userID: String) {
        let retained = drafts(userID: userID).filter { $0.id != contextID }
        write(Dictionary(uniqueKeysWithValues: retained.map { ($0.id, $0) }), key: key("writing", userID))
    }

    private func key(_ kind: String, _ userID: String) -> String {
        let encoded = Data(userID.utf8).base64EncodedString()
        return "zhizhou.adminWorkspace.v1.\(kind).\(encoded)"
    }

    private func read<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: key)
    }
}
