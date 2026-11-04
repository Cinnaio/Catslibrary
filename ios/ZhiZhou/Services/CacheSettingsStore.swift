import Foundation
import Observation
import ZhiZhouCore

@MainActor
@Observable
final class CacheSettingsStore {
    static let shared = CacheSettingsStore()
    private(set) var policy = CacheStoragePolicy.load()
    private(set) var isApplying = false

    func setMegabytes(_ megabytes: Int) async throws {
        guard !isApplying else { return }
        isApplying = true
        defer { isApplying = false }
        // A failed migration must leave the old budget/data intact.
        try await OfflineReadingStore.shared.migrateLegacyDownloads()
        let next = CacheStoragePolicy(megabytes: megabytes)
        UserDefaults.standard.set(next.megabytes, forKey: CacheStoragePolicy.defaultsKey)
        ImageCache.sharedCache.diskCapacity = Int(next.imageBytes)
        await ChapterDiskCache.shared.setMaxBytes(next.chapterBytes)
        policy = next
        FontStore.shared.refresh()
    }
}
