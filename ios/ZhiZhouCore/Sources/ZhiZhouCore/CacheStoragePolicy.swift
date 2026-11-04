import Foundation

/// Device-local disk budget. Fonts and explicitly downloaded chapters are separate.
public struct CacheStoragePolicy: Equatable, Sendable {
    public static let defaultsKey = "zhizhou.storage.automaticCacheMB.v1"
    public static let defaultMegabytes = 256
    public static let allowedMegabytes = 32...8192
    public static let presets = [64, 128, 256, 512, 1024, 2048, 4096]
    public let megabytes: Int

    public init(megabytes: Int) {
        self.megabytes = min(Self.allowedMegabytes.upperBound, max(Self.allowedMegabytes.lowerBound, megabytes))
    }

    public static func load(from defaults: UserDefaults = .standard) -> Self {
        let saved = defaults.object(forKey: defaultsKey) as? NSNumber
        return Self(megabytes: saved?.intValue ?? defaultMegabytes)
    }

    // Decimal MB matches the storage screen's ByteCountFormatter(.file).
    public var totalBytes: Int64 { Int64(megabytes) * 1_000_000 }
    public var chapterBytes: Int64 { totalBytes / 4 }
    public var imageBytes: Int64 { totalBytes - chapterBytes }
}
