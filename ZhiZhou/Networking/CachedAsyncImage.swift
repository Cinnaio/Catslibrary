import SwiftUI
import UIKit
import ImageIO
import CryptoKit

/// 统一图片缓存（内存 + 磁盘），避免封面在滚动/重访时反复下载。
enum ImageCache {
    /// 保留已解码的缩略图，避免 List 行重建后再次依赖网络或 URLCache 才能显示封面。
    /// NSCache 会在内存紧张时自动淘汰，磁盘 URLCache 仍作为跨启动的第二层缓存。
    static let decodedImageCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 256
        cache.totalCostLimit = 32 * 1024 * 1024
        return cache
    }()

    static let sharedCache: URLCache = {
        // 封面使用缩略图解码；控制 URLCache 上限，避免长期滚动把设备缓存顶到数百 MB。
        URLCache(memoryCapacity: 64 * 1024 * 1024,
                 diskCapacity: 192 * 1024 * 1024,
                 diskPath: "ZhiZhouImageCache")
    }()

    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        #if DEBUG && targetEnvironment(simulator)
        VisualAudit.configure(config)
        #endif
        config.urlCache = sharedCache
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        // Per-request policies below let cover images prefer local URLCache data,
        // while other images continue to follow their response cache directives.
        config.requestCachePolicy = .useProtocolCachePolicy
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 40
        return URLSession(configuration: config)
    }()

    /// 按账号隔离站点封面，授权 Cookie 刷新不会让封面缓存失效。
    /// 其他来源仍按 Cookie 隔离；所有身份信息以摘要写入缓存键。
    static func cacheKey(for url: URL) -> String {
        let token = isAPIURL(url) ? APIClient.shared.imageCacheIdentity : ""
        let cookies = (isAPIURL(url) ? [] : (HTTPCookieStorage.shared.cookies(for: url) ?? []))
            .sorted { $0.name == $1.name ? $0.value < $1.value : $0.name < $1.name }
        let cookieHeader = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"] ?? ""
        let credentials = "\(token)\n\(cookieHeader)"
        let fingerprint = SHA256.hash(data: Data(credentials.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "\(url.absoluteString)|\(fingerprint)"
    }

    static func request(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        // Cover images are reused directly from URLCache after their first successful fetch.
        // Cache keys remain partitioned by the credentials used to fetch each image.
        request.cachePolicy = isCoverURL(url) ? .returnCacheDataElseLoad : .useProtocolCachePolicy
        if isAPIURL(url) { request.httpShouldHandleCookies = false }
        if isAPIURL(url), let token = APIClient.shared.token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private static func isAPIURL(_ url: URL) -> Bool {
        guard let baseURL = ServerConfig.shared.baseURL,
              let base = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let candidate = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return false
        }
        return base.scheme?.lowercased() == candidate.scheme?.lowercased()
            && base.host?.lowercased() == candidate.host?.lowercased()
            && base.port == candidate.port
    }

    private static func isCoverURL(_ url: URL) -> Bool {
        isAPIURL(url) && url.path.hasPrefix("/api/cover/")
    }
}

/// 合并同一封面的并发请求：列表行被回收时，不让它的取消动作中断其他行正在等待的下载。
private actor ImageRequestCache {
    static let shared = ImageRequestCache()

    private var inFlight: [String: Task<Data?, Never>] = [:]

    func data(for url: URL) async -> Data? {
        let key = ImageCache.cacheKey(for: url)
        if let task = inFlight[key] {
            return await task.value
        }

        let task: Task<Data?, Never> = Task {
            do {
                let (data, response) = try await ImageCache.session.data(for: ImageCache.request(for: url))
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    return nil
                }
                return data
            } catch {
                return nil
            }
        }
        inFlight[key] = task
        let data = await task.value
        inFlight[key] = nil
        return data
    }
}

/// 封面预取：限并发（默认 4）并按 URL 去重。
actor CoverPrefetcher {
    static let shared = CoverPrefetcher()

    private var active = 0
    private var queued: [URL] = []
    private var queueHead = 0
    private var seen: Set<String> = []
    private let maxConcurrent = 4
    /// seen 上限：防止长会话分页累积无限增长
    private let seenLimit = 500

    func prefetch(_ items: [Novel]) {
        for novel in items {
            guard let url = APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt) else { continue }
            let key = ImageCache.cacheKey(for: url)
            if seen.count >= seenLimit { seen.removeAll(keepingCapacity: true) }
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            queued.append(url)
        }
        pump()
    }

    private func pump() {
        while active < maxConcurrent, !queued.isEmpty {
            guard queueHead < queued.count else {
                queued.removeAll(keepingCapacity: true)
                queueHead = 0
                break
            }
            let url = queued[queueHead]
            queueHead += 1
            active += 1
            Task {
                _ = await ImageRequestCache.shared.data(for: url)
                active -= 1
                pump()
            }
        }
        if queueHead == queued.count {
            queued.removeAll(keepingCapacity: true)
            queueHead = 0
        }
    }
}

/// 带持久缓存的图片加载视图：后台按显示尺寸解码缩略图。
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    @State private var image: UIImage?
    @State private var loadedKey: String?
    @State private var loadFailed = false
    @State private var retryToken = 0
    @Environment(\.displayScale) private var displayScale

    let url: URL?
    let targetSize: CGSize
    let showsRetry: Bool
    let content: (Image) -> Content
    let placeholder: () -> Placeholder

    init(
        url: URL?,
        targetSize: CGSize = CGSize(width: 120, height: 168),
        showsRetry: Bool = true,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.targetSize = targetSize
        self.showsRetry = showsRetry
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let displayedImage = (loadedKey == taskKey ? image : nil)
                ?? ImageCache.decodedImageCache.object(forKey: taskKey as NSString) {
                content(Image(uiImage: displayedImage))
            } else {
                ZStack {
                    placeholder()
                    if loadFailed && showsRetry {
                        Button {
                            retryToken &+= 1
                        } label: {
                            Label("重试", systemImage: "arrow.clockwise")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .appMaterialBackground(.thinMaterial, fallback: AppTheme.controlFill, in: Capsule())
                        }
                        .buttonStyle(ScaleButtonStyle(pressedScale: 0.94))
                        .foregroundStyle(AppTheme.textPrimary)
                        .accessibilityLabel("封面加载失败，重试")
                    }
                }
            }
        }
        .task(id: "\(taskKey)-\(retryToken)") {
            guard let url else {
                image = nil
                loadedKey = nil
                loadFailed = false
                return
            }
            let key = taskKey
            if loadedKey == key, image != nil { return }
            if loadedKey != nil && loadedKey != key {
                // URL 或访问凭证变化时，不把上一张图短暂显示在新资源位置。
                image = nil
                loadedKey = nil
            }
            loadFailed = false
            let maxPixel = max(targetSize.width, targetSize.height) * displayScale
            guard !Task.isCancelled else { return }
            if let cached = ImageCache.decodedImageCache.object(forKey: key as NSString) {
                image = cached
                loadedKey = key
                return
            }
            if let img = await Self.fetch(url, maxPixel: maxPixel) {
                guard !Task.isCancelled else { return }
                ImageCache.decodedImageCache.setObject(img, forKey: key as NSString, cost: Self.imageCost(img))
                image = img
                loadedKey = key
            } else if !Task.isCancelled {
                loadFailed = true
            }
        }
    }

    private var taskKey: String {
        let pixelWidth = Int((targetSize.width * displayScale).rounded(.up))
        let pixelHeight = Int((targetSize.height * displayScale).rounded(.up))
        let imageKey = url.map { ImageCache.cacheKey(for: $0) } ?? ""
        return "\(imageKey)-\(pixelWidth)x\(pixelHeight)"
    }

    nonisolated private static func imageCost(_ image: UIImage) -> Int {
        guard let cgImage = image.cgImage else { return 1 }
        return max(1, cgImage.bytesPerRow * cgImage.height)
    }

    nonisolated private static func fetch(_ url: URL, maxPixel: CGFloat) async -> UIImage? {
        guard let data = await ImageRequestCache.shared.data(for: url) else { return nil }
        return downsample(data: data, maxPixel: maxPixel)
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
