import CryptoKit
import Foundation

/// 章节数据的持久化缓存。
///
/// 缓存键使用完整请求 URL 的 SHA-256，既能区分不同服务器/章节/安全模式，
/// 又不会把用户内容或过长 query 写进文件名。缓存只存服务端已成功解码前的原始 JSON，
/// 由 APIClient 在网络失败时负责按请求类型解码和回退。
actor ChapterDiskCache {
    static let shared = ChapterDiskCache()

    private let fileManager: FileManager
    private let directoryURL: URL
    private let maxBytes: Int64

    init(
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

    func data(for key: String) -> Data? {
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }

        // 最近使用的文件优先保留，读取失败不影响正文回退。
        try? fileManager.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: url.path
        )
        return data
    }

    func contains(_ key: String) -> Bool {
        fileManager.fileExists(atPath: fileURL(for: key).path)
    }

    func store(_ data: Data, for key: String) {
        guard !key.isEmpty, Int64(data.count) <= maxBytes else { return }

        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true
            )
            try data.write(to: fileURL(for: key), options: [.atomic])
            evictIfNeeded()
        } catch {
            // 缓存失败不能影响在线阅读；下次请求仍会从服务端获取。
        }
    }

    func removeAll() {
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
