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
        self.directoryURL = directoryURL ?? fileManager.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("ZhiZhouChapters", isDirectory: true)
        self.maxBytes = max(1, maxBytes)
    }

    public func data(for key: String) -> Data? {
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }

        try? fileManager.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: url.path
        )
        return data
    }

    public func contains(_ key: String) -> Bool {
        fileManager.fileExists(atPath: fileURL(for: key).path)
    }

    public func store(_ data: Data, for key: String) {
        guard !key.isEmpty, Int64(data.count) <= maxBytes else { return }

        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true
            )
            try data.write(to: fileURL(for: key), options: [.atomic])
            evictIfNeeded()
        } catch {
            // 缓存失败不能影响在线阅读。
        }
    }

    public func removeAll() {
        try? fileManager.removeItem(at: directoryURL)
    }

    private func fileURL(for key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return directoryURL.appendingPathComponent(digest, isDirectory: false)
    }

    private func evictIfNeeded() {
        guard let urls = try? fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        var entries: [(url: URL, size: Int64, date: Date)] = []
        var total: Int64 = 0

        for url in urls {
            guard let values = try? url.resourceValues(
                forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
            ), values.isRegularFile == true else { continue }
            let size = Int64(values.fileSize ?? 0)
            entries.append((url, size, values.contentModificationDate ?? .distantPast))
            total += size
        }

        guard total > maxBytes else { return }
        for entry in entries.sorted(by: { $0.date < $1.date }) {
            guard total > maxBytes else { break }
            try? fileManager.removeItem(at: entry.url)
            total -= entry.size
        }
    }
}
