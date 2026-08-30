import CryptoKit
import Foundation

/// 章节数据的持久化缓存。
public actor ChapterDiskCache {
    public static let shared = ChapterDiskCache()

    private let fileManager: FileManager
    private let directoryURL: URL
    private let maxBytes: Int64

    public init(
        directoryURL: URL? = nil,
        maxBytes: Int64 = 64 * 1024 * 1024,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        if let directoryURL {
            // Test/custom locations remain self-contained while still exercising
            // the same versioned, account-scoped layout as the shared cache.
            self.directoryURL = directoryURL.appendingPathComponent("v2", isDirectory: true)
        } else {
            let cachesURL = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            // v1 used one flat directory and could not be associated with an
            // account. Remove it once so an upgrade cannot leave stale unscoped
            // chapter data behind on the device.
            let legacyURL = cachesURL.appendingPathComponent("ZhiZhouChapters", isDirectory: true)
            try? fileManager.removeItem(at: legacyURL)
            self.directoryURL = cachesURL.appendingPathComponent("ZhiZhouChaptersV2", isDirectory: true)
        }
        self.maxBytes = max(1, maxBytes)
    }

    /// Read a chapter from one account's namespace.
    /// The default scope keeps the Core API source-compatible for standalone users/tests.
    public func data(for key: String, scope: String = "default") -> Data? {
        let url = fileURL(for: key, scope: scope)
        guard let data = try? Data(contentsOf: url) else { return nil }

        try? fileManager.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: url.path
        )
        return data
    }

    public func contains(_ key: String, scope: String = "default") -> Bool {
        fileManager.fileExists(atPath: fileURL(for: key, scope: scope).path)
    }

    public func remove(_ key: String, scope: String = "default") {
        guard !key.isEmpty else { return }
        try? fileManager.removeItem(at: fileURL(for: key, scope: scope))
    }

    public func store(_ data: Data, for key: String, scope: String = "default") {
        guard !key.isEmpty, Int64(data.count) <= maxBytes else { return }

        do {
            let scopeURL = scopeDirectoryURL(for: scope)
            try fileManager.createDirectory(
                at: scopeURL,
                withIntermediateDirectories: true
            )
            try data.write(to: fileURL(for: key, scope: scope), options: [.atomic])
            evictIfNeeded()
        } catch {
            // 缓存失败不能影响在线阅读。
        }
    }

    /// Remove all account namespaces. Used by the explicit storage-management action.
    public func removeAll() {
        try? fileManager.removeItem(at: directoryURL)
    }

    /// Remove only one account namespace, leaving other accounts' offline data intact.
    public func removeAll(scope: String) {
        try? fileManager.removeItem(at: scopeDirectoryURL(for: scope))
    }

    private func scopeDirectoryURL(for scope: String) -> URL {
        let digest = SHA256.hash(data: Data(scope.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return directoryURL.appendingPathComponent(digest, isDirectory: true)
    }

    private func fileURL(for key: String, scope: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return scopeDirectoryURL(for: scope).appendingPathComponent(digest, isDirectory: false)
    }

    private func evictIfNeeded() {
        guard let scopeURLs = try? fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        var entries: [(url: URL, size: Int64, date: Date)] = []
        var total: Int64 = 0

        for scopeURL in scopeURLs {
            guard let scopeValues = try? scopeURL.resourceValues(forKeys: [.isDirectoryKey]),
                  scopeValues.isDirectory == true,
                  let urls = try? fileManager.contentsOfDirectory(
                      at: scopeURL,
                      includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
                      options: [.skipsHiddenFiles]
                  )
            else { continue }

            for url in urls {
                guard let values = try? url.resourceValues(
                    forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
                ), values.isRegularFile == true else { continue }
                let size = Int64(values.fileSize ?? 0)
                entries.append((url, size, values.contentModificationDate ?? .distantPast))
                total += size
            }
        }

        guard total > maxBytes else { return }
        for entry in entries.sorted(by: { $0.date < $1.date }) {
            guard total > maxBytes else { break }
            try? fileManager.removeItem(at: entry.url)
            total -= entry.size
        }
    }
}
