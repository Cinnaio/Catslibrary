#if DEBUG && targetEnvironment(simulator)
import Foundation
import SwiftUI
import UIKit
import ZhiZhouCore

enum VisualAudit {
    static var enabled: Bool { ProcessInfo.processInfo.environment["ZHIZHOU_UI_AUDIT"] == "1" }
    static var scenario: String { ProcessInfo.processInfo.environment["ZHIZHOU_UI_SCENARIO"] ?? "normal" }
    static var userID: String { ProcessInfo.processInfo.environment["ZHIZHOU_UI_ACCOUNT"] ?? "audit-reader" }
    static var appearance: ColorScheme? {
        guard enabled else { return nil }
        return ProcessInfo.processInfo.environment["ZHIZHOU_UI_APPEARANCE"] == "dark" ? .dark : .light
    }
    static let timestamp: Int64 = 1_788_739_200_000
    static var chapterContent: String {
        if scenario == "thought-anchor" {
            return "新插入的开场。\n她把信纸  展开，字迹仍然清晰。\n后面的故事继续。"
        }
        return Array(repeating: "山路从窗前蜿蜒而过，清晨的风翻动了桌上的书页。她把信纸展开，字迹仍然清晰，仿佛写信的人刚刚离开。远处响起钟声，新的一天开始了。", count: 18).joined(separator: "\n\n")
    }

    static var user: User {
        User(id: userID, username: "reader", displayName: "林间读者", role: "admin", status: "active",
             createdAt: timestamp, updatedAt: timestamp, lastLoginAt: timestamp,
             bio: "读到一段喜欢的文字，就多停留一会儿。", avatarUrl: nil)
    }

    static func configure(_ configuration: URLSessionConfiguration) {
        if enabled { configuration.protocolClasses = [VisualAuditProtocol.self] }
    }

    static var books: [Novel] {
        (1...4).map { index in
            Novel(
                id: "audit-book-\(index)",
                title: ["山中来信", "长街灯火里的旧日时光", "海边书店", "春山可望"][index - 1],
                author: ["林溪", "陈雨", "周清", "江宁"][index - 1],
                description: "山里的邮局，每周只送一次信。林溪回到故乡后，在旧书架里发现了一封没有寄出的信。\n\n她沿着信上的地址，走过村口的小桥和开满白花的院子。那些以为早已忘记的往事，也随着脚步一点一点清晰起来。\n\n这是一段关于书信、归途与重逢的故事。",
                coverUrl: "", categories: ["文学", "故事"], status: "ongoing", sourceUrl: "",
                chapterCount: 12, remoteChapterCount: 12, updateCheckedAt: timestamp,
                createdAt: timestamp, updatedAt: timestamp
            )
        }
    }

    static func chapters(for novelID: String) -> [ChapterMeta] {
        (1...12).map { order in
            ChapterMeta(id: "\(novelID)-chapter-\(order)", novelId: novelID,
                        title: "第 \(order) 章 \(order == 1 ? "一封没有寄出的信" : "山路上的回声")",
                        order: order, wordCount: 1860, sourceUrl: "", createdAt: timestamp)
        }
    }

    static func imageData(avatar: Bool) -> Data {
        let size = avatar ? CGSize(width: 144, height: 144) : CGSize(width: 240, height: 336)
        return UIGraphicsImageRenderer(size: size).jpegData(withCompressionQuality: 0.85) { context in
            (avatar ? UIColor.systemTeal : UIColor(red: 0.85, green: 0.91, blue: 0.85, alpha: 1)).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let title = avatar ? "林" : "山中\n来信"
            let font = UIFont(name: "SongtiSC-Bold", size: avatar ? 68 : 48) ?? .systemFont(ofSize: 48)
            (title as NSString).draw(in: CGRect(x: 40, y: avatar ? 26 : 62, width: 165, height: 150), withAttributes: [
                .font: font, .foregroundColor: UIColor(red: 0.12, green: 0.27, blue: 0.22, alpha: 1),
            ])
            if !avatar {
                ("林溪 著" as NSString).draw(at: CGPoint(x: 42, y: 260), withAttributes: [
                    .font: UIFont.systemFont(ofSize: 15), .foregroundColor: UIColor.darkGray,
                ])
            }
        }
    }
}

private final class VisualAuditProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var currentUser = VisualAudit.user
    private static var removedRecent = false
    private static var catalogRequests = 0
    private static var refreshFailureServed = false
    private static var restoreRequests = 0
    private static var mediaRequests = 0
    private static var bookmark: [String: Any]?
    private static var otherSessionRemoved = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "GET"
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func queryValue(_ name: String) -> String? { query.first { $0.name == name }?.value }
        let payload = Self.requestBody(request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        var status = 200
        var body: Any = ["success": true]
        var image: Data?
        switch (method, path) {
        case (_, let path) where path.hasPrefix("/api/cover/"):
            image = VisualAudit.imageData(avatar: false)
        case (_, let path) where path.hasPrefix("/api/avatar/"):
            image = VisualAudit.imageData(avatar: true)
        case ("GET", "/api/auth/register-status"):
            body = ["mode": "open"]
        case ("GET", "/api/auth/me"):
            Self.restoreRequests += 1
            if VisualAudit.scenario == "restore-error", Self.restoreRequests == 1 {
                status = 503
                body = ["error": "暂时无法恢复会话"]
            } else {
                body = ["user": Self.json(Self.currentUser)]
            }
        case ("POST", "/api/auth/login"), ("POST", "/api/auth/register"):
            body = ["user": Self.json(Self.currentUser), "token": "audit-token"]
        case ("PUT", "/api/auth/me"):
            let old = Self.currentUser
            Self.currentUser = User(id: old.id, username: old.username,
                displayName: payload["displayName"] as? String ?? old.displayName,
                role: old.role, status: old.status, createdAt: old.createdAt,
                updatedAt: old.updatedAt + 1, lastLoginAt: old.lastLoginAt,
                bio: payload["bio"] as? String ?? old.bio, avatarUrl: nil)
            body = ["user": Self.json(Self.currentUser)]
        case ("POST", "/api/auth/change-password"):
            if payload["currentPassword"] as? String != "current-password" {
                status = 401
                body = ["error": "当前密码不正确"]
            } else {
                body = ["user": Self.json(Self.currentUser), "token": "audit-new-token"]
            }
        case ("PUT", "/api/auth/avatar"), ("DELETE", "/api/auth/avatar"):
            body = ["user": Self.json(Self.currentUser)]
        case ("GET", "/api/auth/reader-settings"):
            body = ["settings": [:], "updatedAt": [:], "device": queryValue("device") ?? "ios"]
        case ("GET", "/api/auth/sessions"):
            var sessions: [[String: Any]] = [["id": "audit-current", "deviceName": "iOS", "createdAt": VisualAudit.timestamp, "expiresAt": VisualAudit.timestamp + 86_400_000, "current": true]]
            if !Self.otherSessionRemoved {
                sessions.append(["id": "audit-web", "deviceName": "Web 浏览器", "createdAt": VisualAudit.timestamp, "expiresAt": VisualAudit.timestamp + 86_400_000, "current": false])
            }
            body = ["sessions": sessions]
        case ("DELETE", "/api/auth/sessions"):
            Self.otherSessionRemoved = true
        case ("POST", "/api/auth/logout-all"):
            break
        case ("GET", "/api/bookmarks"):
            body = ["bookmarks": Self.bookmark.map { [$0] } ?? []]
        case ("POST", "/api/bookmarks"):
            let novelID = payload["novelId"] as? String ?? "audit-book-1"
            let chapterID = payload["chapterId"] as? String ?? "audit-book-1-chapter-1"
            let chapter = VisualAudit.chapters(for: novelID).first { $0.id == chapterID }!
            Self.bookmark = ["id": "audit-bookmark", "novelId": novelID, "novelTitle": "山中来信", "chapterId": chapterID,
                             "chapterTitle": chapter.title, "chapterOrder": chapter.order, "note": payload["note"] as? String ?? "", "timestamp": VisualAudit.timestamp]
            body = ["bookmark": Self.bookmark!]
        case ("DELETE", "/api/bookmarks"):
            Self.bookmark = nil
        case ("GET", "/api/ai/status"):
            let enabled = VisualAudit.scenario == "parity"
            body = ["configured": enabled, "features": ["recap": enabled, "catchup": enabled],
                    "quota": ["used": 0, "limit": 10, "resetAt": VisualAudit.timestamp], "catchupStaleDays": 7]
        case ("GET", "/api/ai/recap"):
            body = ["recap": "", "cached": false]
        case ("POST", "/api/ai/recap"):
            if payload["chapterId"] as? String == "audit-book-1-chapter-1" {
                body = ["recap": "她沿着旧信上的地址回到山里，找到了那间多年未开的邮局。", "cached": false]
            } else {
                status = 400
                body = ["error": "前情提要必须读取上一章"]
            }
        case ("POST", "/api/ai/catchup"):
            body = ["recap": "她沿着旧信上的地址回到山里，找到了那间多年未开的邮局。", "cached": false]
        case ("GET", "/api/ai/settings"):
            body = ["settings": ["recapEnabled": true, "dailyQuota": 10]]
        case ("GET", "/api/ai/tasks"):
            body = ["items": [], "total": 0]
        case ("GET", "/api/novels"):
            Self.catalogRequests += 1
            let search = queryValue("search") ?? ""
            if VisualAudit.scenario == "refresh-error", !search.isEmpty, !Self.refreshFailureServed {
                Self.refreshFailureServed = true
                status = 503
                body = ["error": "暂时无法刷新书单"]
            } else {
                var books = search.isEmpty ? VisualAudit.books : VisualAudit.books.filter { $0.title.contains(search) }
                if let filter = queryValue("status"), !filter.isEmpty { books = books.filter { $0.status == filter } }
                if queryValue("sort") == "title" { books.sort { $0.title < $1.title } }
                body = ["novels": books.map(Self.json), "total": books.count, "page": 1,
                        "limit": 20, "totalPages": 1, "hasMore": false, "availableCategories": ["文学", "故事"]]
            }
        case ("GET", let path) where path.hasPrefix("/api/novels/"):
            body = ["novel": Self.json(VisualAudit.books.first { path.hasSuffix($0.id) } ?? VisualAudit.books[0])]
        case ("GET", "/api/chapters"):
            body = ["chapters": VisualAudit.chapters(for: queryValue("novelId") ?? VisualAudit.books[0].id).map(Self.json)]
        case ("GET", let path) where path.hasSuffix("/illustrations"):
            let chapterID = path.components(separatedBy: "/")[3]
            // Match real decoded chapter IDs; a %255F/%252D URL must fail instead of being hidden by the fixture.
            guard VisualAudit.books.flatMap({ VisualAudit.chapters(for: $0.id) }).contains(where: { $0.id == chapterID }) else {
                let response = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil,
                                               headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: Data("{\"error\":\"章节不存在\"}".utf8))
                client?.urlProtocolDidFinishLoading(self)
                return
            }
            let items: [[String: Any]] = VisualAudit.scenario.hasPrefix("media") ? [[
                "id": "audit-illustration", "chapterId": chapterID, "assetId": "audit-asset",
                "width": 600, "height": 400, "caption": "山路与清晨", "size": "full",
                "chapterRevision": "audit-revision", "version": 1, "order": 1, "deleted": false,
                "anchor": ["position": "start", "paragraphIndex": 0, "paragraphText": "", "paragraphHash": "",
                           "previousText": "", "nextText": "", "sourceIndex": 0, "sourceHash": ""],
            ]] : []
            body = ["illustrations": items, "chapterRevision": "audit-revision", "contentHash": IllustrationAnchor.contentHash(VisualAudit.chapterContent)]
        case ("GET", let path) where path.contains("/illustrations/") && path.hasSuffix("/image"):
            Self.mediaRequests += 1
            if VisualAudit.scenario == "media-retry", Self.mediaRequests == 1 {
                status = 503
                body = ["error": "图片暂时无法加载"]
            } else {
                image = VisualAudit.imageData(avatar: false)
            }
        case ("GET", let path) where path.hasPrefix("/api/thoughts/image/"):
            image = VisualAudit.imageData(avatar: false)
        case ("GET", let path) where path.hasPrefix("/api/chapters/"):
            let chapter = VisualAudit.books.flatMap { VisualAudit.chapters(for: $0.id) }.first { path.hasSuffix($0.id) }!
            body = ["chapter": Self.json(ChapterFull(
                id: chapter.id, novelId: chapter.novelId, title: chapter.title, order: chapter.order,
                wordCount: chapter.wordCount, sourceUrl: "", createdAt: VisualAudit.timestamp,
                content: VisualAudit.chapterContent
            ))]
        case ("GET", "/api/bookshelf"):
            let book = VisualAudit.books[0]
            let offset = Int(queryValue("offset") ?? "0") ?? 0
            let thoughtCount = VisualAudit.scenario == "parity" ? 51 : 0
            let thoughts: [[String: Any]] = (offset..<min(offset + 50, max(offset, thoughtCount))).map { index in
                ["id": "library-thought-\(index)", "novelId": book.id, "chapterId": "\(book.id)-chapter-1",
                 "novelTitle": book.title, "chapterTitle": "第一章", "selectedText": "山路从窗前蜿蜒而过",
                 "thoughtText": "我的阅读想法 \(index + 1)", "createdAt": VisualAudit.timestamp]
            }
            body = [
                "favorites": [],
                "recent": VisualAudit.scenario == "empty" || Self.removedRecent ? [] : [[
                    "novelId": book.id, "chapterId": "\(book.id)-chapter-1", "novelTitle": book.title,
                    "chapterTitle": "第 1 章 一封没有寄出的信", "chapterOrder": 1,
                    "scrollPercent": 0.42, "updatedAt": VisualAudit.timestamp,
                ]],
                "thoughts": thoughts,
                "totals": ["favorites": 0, "thoughts": thoughtCount],
            ] as [String: Any]
        case ("GET", "/api/progress"):
            if VisualAudit.scenario == "parity" {
                body = ["progress": ["novelId": "audit-book-1", "chapterId": "audit-book-1-chapter-2", "scrollPercent": 0.42,
                                     "updatedAt": Int64(Date().addingTimeInterval(-30 * 86_400).timeIntervalSince1970 * 1000)]]
            } else { body = ["progress": NSNull()] }
        case ("DELETE", "/api/progress"):
            Self.removedRecent = true
        case ("GET", "/api/thoughts"):
            let chapterID = queryValue("chapterId") ?? ""
            var thoughts: [[String: Any]] = VisualAudit.scenario.hasPrefix("media") ? [[
                "id": "audit-thought", "novelId": "audit-book-1", "chapterId": chapterID,
                "paragraphIndex": 0, "paragraphHash": "", "selectedText": "山路从窗前蜿蜒而过",
                "thoughtText": "来自 Web 的图片想法", "displayName": "林间读者", "status": "visible",
                "reportCount": 0, "createdAt": VisualAudit.timestamp, "updatedAt": VisualAudit.timestamp,
                "userId": VisualAudit.userID, "avatarUrl": "", "imageUrl": "/api/thoughts/image/audit-thought",
            ]] : []
            if VisualAudit.scenario == "thought-anchor" {
                thoughts = [["id": "moved-thought", "novelId": "audit-book-1", "chapterId": chapterID,
                             "paragraphIndex": 0, "paragraphHash": IllustrationAnchor.contentHash("她把信纸  展开，字迹仍然清晰。"),
                             "selectedText": "信纸 展开", "thoughtText": "挂在原引用上的想法", "displayName": "林间读者", "status": "visible",
                             "reportCount": 0, "createdAt": VisualAudit.timestamp, "updatedAt": VisualAudit.timestamp,
                             "userId": VisualAudit.userID, "avatarUrl": ""]]
            }
            body = ["thoughts": thoughts, "counts": [:], "chapterId": chapterID, "total": thoughts.count] as [String: Any]
        case ("POST", "/api/progress"), ("PUT", "/api/auth/reader-settings"), ("POST", "/api/auth/logout"):
            break
        default:
            status = 404
            body = ["error": "此审查场景没有对应数据"]
        }
        let data = image ?? (try! JSONSerialization.data(withJSONObject: body))
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": image == nil ? "application/json" : "image/jpeg"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func json<T: Encodable>(_ value: T) -> Any {
        try! JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    private static func requestBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
#endif
