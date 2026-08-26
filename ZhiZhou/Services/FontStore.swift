import CoreText
import CryptoKit
import Foundation
import Observation
import UIKit

extension Notification.Name {
    static let zhiZhouFontStoreDidChange = Notification.Name("ZhiZhou.FontStore.didChange")
}

enum RemoteFontAsset: String, CaseIterable, Identifiable {
    case regular = "NotoSerifSC-Regular.otf"
    case bold = "NotoSerifSC-Bold.otf"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .regular: return "宋体 Regular"
        case .bold: return "宋体 Bold"
        }
    }

    var postScriptName: String {
        switch self {
        case .regular: return "NotoSerifSC-Regular"
        case .bold: return "NotoSerifSC-Bold"
        }
    }

    var remoteURL: URL {
        URL(string: "\(ServerConfig.serverURL)/fonts/\(rawValue)")!
    }

    /// 用于避免缓存损坏文件或被错误的 HTML 响应替代。
    var sha256: String {
        switch self {
        case .regular:
            return "b328106fab689870861986818ecdc94826059ec80ff8e552053a34c16f7c7b71"
        case .bold:
            return "b265e5b787f9386e809c90b5cb69c83211e86e562d0c0cc78f188973cf1e8406"
        }
    }
}

@MainActor
@Observable
final class FontStore {
    static let shared = FontStore()

    struct StorageSnapshot: Equatable {
        var appBundleBytes: Int64 = 0
        var documentsBytes: Int64 = 0
        var applicationSupportBytes: Int64 = 0
        var cachesBytes: Int64 = 0
        var fontBytes: Int64 = 0
        var imageCacheBytes: Int64 = 0

        var totalDataBytes: Int64 {
            documentsBytes + applicationSupportBytes + cachesBytes
        }

        var otherApplicationSupportBytes: Int64 {
            max(0, applicationSupportBytes - fontBytes)
        }
    }

    enum FontStoreError: LocalizedError {
        case invalidResponse
        case unsupportedFont
        case checksumMismatch(String)
        case registrationFailed(String)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                return "字体服务器返回了无效响应"
            case .unsupportedFont:
                return "下载的文件不是受支持的字体"
            case .checksumMismatch(let name):
                return "字体文件校验失败：\(name)"
            case .registrationFailed(let name):
                return "字体注册失败：\(name)"
            }
        }
    }

    var storage = StorageSnapshot()
    var isDownloading = false
    var lastError: String?
    var hasDownloadedFonts = false

    private let fileManager = FileManager.default

    private init() {
        refresh()
    }

    func downloadedBytes(for asset: RemoteFontAsset) -> Int64 {
        guard let values = try? localURL(for: asset).resourceValues(forKeys: [.fileSizeKey]) else {
            return 0
        }
        return Int64(values.fileSize ?? 0)
    }

    func refresh() {
        let documents = directoryURL(for: .documentDirectory)
        let support = directoryURL(for: .applicationSupportDirectory)
        let caches = directoryURL(for: .cachesDirectory)

        storage = StorageSnapshot(
            appBundleBytes: directorySize(Bundle.main.bundleURL),
            documentsBytes: directorySize(documents),
            applicationSupportBytes: directorySize(support),
            cachesBytes: directorySize(caches),
            fontBytes: directorySize(fontDirectoryURL),
            imageCacheBytes: Int64(ImageCache.sharedCache.currentDiskUsage)
        )
        hasDownloadedFonts = RemoteFontAsset.allCases.allSatisfy {
            isValidCachedFile(for: $0)
        }
    }

    /// App 启动时注册已经下载过的字体，避免每次启动都重新下载。
    func registerCachedFonts() {
        var didRegister = false
        for asset in RemoteFontAsset.allCases {
            guard isValidCachedFile(for: asset) else { continue }
            do {
                try register(asset, at: localURL(for: asset))
                didRegister = true
            } catch {
                lastError = error.localizedDescription
            }
        }
        refresh()
        if didRegister {
            postFontChange()
        }
    }

    func downloadAndRegisterFonts() async {
        guard !isDownloading else { return }
        isDownloading = true
        lastError = nil
        defer {
            isDownloading = false
            refresh()
        }

        do {
            try fileManager.createDirectory(
                at: fontDirectoryURL,
                withIntermediateDirectories: true
            )

            for asset in RemoteFontAsset.allCases {
                let url = try await downloadIfNeeded(asset)
                try register(asset, at: url)
            }
            postFontChange()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func deleteDownloadedFonts() {
        for asset in RemoteFontAsset.allCases {
            let url = localURL(for: asset)
            guard fileManager.fileExists(atPath: url.path) else { continue }
            _ = CTFontManagerUnregisterFontsForURL(url as CFURL, .process, nil)
            try? fileManager.removeItem(at: url)
        }
        refresh()
        postFontChange()
    }

    func clearCaches() {
        ImageCache.sharedCache.removeAllCachedResponses()
        APIClient.shared.clearMemoryCaches()
        refresh()
    }

    private var fontDirectoryURL: URL {
        directoryURL(for: .applicationSupportDirectory)
            .appendingPathComponent("Fonts", isDirectory: true)
    }

    private func localURL(for asset: RemoteFontAsset) -> URL {
        fontDirectoryURL.appendingPathComponent(asset.rawValue, isDirectory: false)
    }

    private func directoryURL(for directory: FileManager.SearchPathDirectory) -> URL {
        fileManager.urls(for: directory, in: .userDomainMask)[0]
    }

    private func downloadIfNeeded(_ asset: RemoteFontAsset) async throws -> URL {
        let destination = localURL(for: asset)
        if isValidCachedFile(for: asset) {
            return destination
        }

        let (temporaryURL, response) = try await URLSession.shared.download(from: asset.remoteURL)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw FontStoreError.invalidResponse
        }
        guard CTFontManagerIsSupportedFont(temporaryURL as CFURL) else {
            throw FontStoreError.unsupportedFont
        }
        guard checksum(of: temporaryURL) == asset.sha256 else {
            throw FontStoreError.checksumMismatch(asset.rawValue)
        }

        let stagingURL = destination.appendingPathExtension("download")
        try? fileManager.removeItem(at: stagingURL)
        try fileManager.moveItem(at: temporaryURL, to: stagingURL)
        try? fileManager.removeItem(at: destination)
        try fileManager.moveItem(at: stagingURL, to: destination)
        return destination
    }

    private func register(_ asset: RemoteFontAsset, at url: URL) throws {
        // 已注册时 CoreText 可能返回失败，先用 PostScript 名判断，避免重复注册误报。
        if UIFont(name: asset.postScriptName, size: 12) != nil {
            return
        }
        guard CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) else {
            throw FontStoreError.registrationFailed(asset.rawValue)
        }
    }

    private func isValidCachedFile(for asset: RemoteFontAsset) -> Bool {
        let url = localURL(for: asset)
        guard fileManager.fileExists(atPath: url.path) else { return false }
        return checksum(of: url) == asset.sha256
    }

    private func checksum(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func directorySize(_ url: URL) -> Int64 {
        guard let enumerator = fileManager.enumerator(
            at: url,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return 0
        }

        var total: Int64 = 0
        for case let fileURL as URL in enumerator {
            guard let values = try? fileURL.resourceValues(
                forKeys: [.isRegularFileKey, .fileSizeKey]
            ), values.isRegularFile == true else {
                continue
            }
            total += Int64(values.fileSize ?? 0)
        }
        return total
    }

    private func postFontChange() {
        NotificationCenter.default.post(name: .zhiZhouFontStoreDidChange, object: nil)
    }
}
