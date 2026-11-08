import CryptoKit
import Foundation

/// Settings and completed records only. Live sessions never survive reader exit.
struct ReaderEdgeLocalStore {
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? URL.applicationSupportDirectory.appendingPathComponent("reader-edge-v1", isDirectory: true)
    }

    private func file(for context: ReaderEdgeContext) throws -> URL {
        // Encode the tuple to avoid delimiter collisions; never store tokens in paths or data.
        let key = try JSONEncoder().encode([context.server, context.userID])
        let hash = SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash).appendingPathExtension("json")
    }

    func read(_ context: ReaderEdgeContext) throws -> String? {
        let url = try file(for: context)
        do {
            return try String(contentsOf: url, encoding: .utf8)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return nil
        }
    }

    func write(_ data: ReaderEdgeData, context: ReaderEdgeContext) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var directoryURL = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directoryURL.setResourceValues(values)
        try JSONEncoder().encode(data).write(to: file(for: context), options: [.atomic, .completeFileProtection])
    }
}
