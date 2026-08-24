import SwiftUI
import UIKit
import ImageIO

/// 统一图片缓存（内存 + 磁盘），避免封面在滚动/重访时反复下载。
enum ImageCache {
    static let sharedCache: URLCache = {
        URLCache(memoryCapacity: 256 * 1024 * 1024,
                 diskCapacity: 512 * 1024 * 1024)
    }()

    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = sharedCache
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 40
        return URLSession(configuration: config)
    }()
}

/// 封面预取：限并发（默认 4）并按 URL 去重。
actor CoverPrefetcher {
    static let shared = CoverPrefetcher()

    private var active = 0
    private var queued: [URL] = []
    private var seen: Set<String> = []
    private let maxConcurrent = 4

    func prefetch(_ items: [Novel]) {
        for novel in items {
            guard let url = APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt) else { continue }
            let key = url.absoluteString
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            queued.append(url)
        }
        pump()
    }

    private func pump() {
        while active < maxConcurrent, !queued.isEmpty {
            let url = queued.removeFirst()
            active += 1
            Task {
                _ = try? await ImageCache.session.data(from: url)
                active -= 1
                pump()
            }
        }
    }
}

/// 带持久缓存的图片加载视图：后台按显示尺寸解码缩略图。
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    @State private var image: UIImage?
    @State private var loadedKey: String?

    let url: URL?
    let targetSize: CGSize
    let content: (Image) -> Content
    let placeholder: () -> Placeholder

    init(
        url: URL?,
        targetSize: CGSize = CGSize(width: 120, height: 168),
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.targetSize = targetSize
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: taskKey) {
            guard let url else {
                image = nil
                loadedKey = nil
                return
            }
            let key = taskKey
            if loadedKey == key, image != nil { return }
            image = nil
            let maxPixel = max(targetSize.width, targetSize.height) * UIScreen.main.scale
            if let img = await Task.detached(priority: .userInitiated, operation: {
                await Self.fetch(url, maxPixel: maxPixel)
            }).value {
                image = img
                loadedKey = key
            }
        }
    }

    private var taskKey: String {
        "\(url?.absoluteString ?? "")-\(Int(targetSize.width))x\(Int(targetSize.height))"
    }

    nonisolated private static func fetch(_ url: URL, maxPixel: CGFloat) async -> UIImage? {
        do {
            let (data, response) = try await ImageCache.session.data(from: url)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                return nil
            }
            return downsample(data: data, maxPixel: maxPixel)
        } catch {
            guard let (data, _) = try? await ImageCache.session.data(from: url) else { return nil }
            return downsample(data: data, maxPixel: maxPixel)
        }
    }

    nonisolated private static func downsample(data: Data, maxPixel: CGFloat) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else {
            return UIImage(data: data)
        }
        let downsample: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(maxPixel, 1),
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, downsample as CFDictionary) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: cgImage)
    }
}
