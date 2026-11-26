import SwiftUI
import WidgetKit

private struct LibraryEntry: TimelineEntry {
    let date: Date
    let snapshot: LibraryWidgetSnapshot?
    let quoteIndex: Int
}
private struct LibraryProvider: TimelineProvider {
    func placeholder(in context: Context) -> LibraryEntry { LibraryEntry(date: Date(), snapshot: nil, quoteIndex: 0) }
    func getSnapshot(in context: Context, completion: @escaping (LibraryEntry) -> Void) {
        completion(LibraryEntry(date: Date(), snapshot: LibraryWidgetStorage.read(), quoteIndex: 0))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LibraryEntry>) -> Void) {
        let now = Date(), snapshot = LibraryWidgetStorage.read()
        var entries = [LibraryEntry(date: now, snapshot: snapshot, quoteIndex: 0)]
        if let snapshot {
            // Build a bounded offline timeline; the extension never receives a session token.
            for index in 1..<12 {
                let date = now.addingTimeInterval(TimeInterval(index) * 2 * 60 * 60)
                if date >= snapshot.expiresAt { break }
                entries.append(LibraryEntry(date: date, snapshot: snapshot, quoteIndex: index))
            }
            entries.append(LibraryEntry(date: snapshot.expiresAt, snapshot: nil, quoteIndex: 0))
        }
        completion(Timeline(entries: entries, policy: .after(snapshot?.expiresAt ?? now.addingTimeInterval(60 * 60))))
    }
}

private struct LibraryWidgetView: View {
    let entry: LibraryEntry
    let isQuote: Bool
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    private var paper: Color { scheme == .dark ? Color(red: 0.11, green: 0.11, blue: 0.10) : Color(red: 0.98, green: 0.97, blue: 0.96) }
    private var ink: Color { scheme == .dark ? Color(red: 0.91, green: 0.91, blue: 0.87) : Color(red: 0.19, green: 0.18, blue: 0.16) }
    private var terracotta: Color { scheme == .dark ? Color(red: 0.84, green: 0.55, blue: 0.44) : Color(red: 0.65, green: 0.30, blue: 0.20) }
    private var snapshot: LibraryWidgetSnapshot? { entry.snapshot?.isValid(at: entry.date) == true ? entry.snapshot : nil }
    private var item: LibraryWidgetItem? {
        guard let content = snapshot?.content else { return nil }
        if !isQuote { return content.reading }
        guard !content.quotes.isEmpty else { return nil }
        return content.quotes[entry.quoteIndex % content.quotes.count]
    }
    private var link: URL? { guard let item else { return nil }; return snapshot?.link(kind: isQuote ? "quote" : "continue", id: item.id) }
    private var label: String { isQuote ? "收藏的句子" : "继续阅读" }
    private var isAccessory: Bool { family == .accessoryRectangular || family == .accessoryInline }
    var body: some View {
        Group {
            if family == .accessoryInline {
                Label(item.map { isQuote ? $0.text : $0.title } ?? "打开猫猫图书馆", systemImage: isQuote ? "quote.opening" : "book")
            } else if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 3) {
                    Label(label, systemImage: isQuote ? "quote.opening" : "book").font(.caption.bold())
                    Text(item.map { isQuote ? $0.text : $0.title } ?? "打开书房，同步你的阅读").font(.headline).lineLimit(2)
                    if let item { Text(isQuote ? item.title : item.chapterTitle).font(.caption).lineLimit(1) }
                }
            } else {
                desktop
            }
        }
        .widgetURL(link)
        .privacySensitive()
        .containerBackground(for: .widget) { isAccessory ? Color.clear : paper }
    }
    private var desktop: some View {
        HStack(alignment: .center, spacing: 18) {
            if family == .systemMedium && !isQuote {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(terracotta.opacity(0.12))
                    VStack(spacing: 12) {
                        Image(systemName: "book.closed").font(.title)
                        Text(item?.title ?? "书房").font(.system(.caption, design: .serif)).lineLimit(4).multilineTextAlignment(.center)
                    }.padding(12)
                }.frame(width: 82).foregroundStyle(terracotta)
            }
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Label(label, systemImage: isQuote ? "quote.opening" : "book").font(.caption.weight(.medium))
                    Spacer(minLength: 0)
                    Image(systemName: "leaf").font(.caption2)
                }.foregroundStyle(terracotta)
                if let item {
                    Text(isQuote ? item.text : item.title)
                        .font(.system(isQuote ? .body : .headline, design: .serif))
                        .foregroundStyle(ink).lineLimit(isQuote ? 4 : 3)
                    Spacer(minLength: 0)
                    Text(isQuote ? "—— \(item.title)" : item.chapterTitle)
                        .font(.caption).foregroundStyle(ink.opacity(0.7)).lineLimit(1)
                    if !isQuote {
                        let progress = min(1, max(0, item.scrollPercent.isFinite ? item.scrollPercent : 0))
                        ProgressView(value: progress).tint(terracotta)
                            .accessibilityLabel("本章阅读进度").accessibilityValue("\(Int(progress * 100))%")
                    }
                } else {
                    Text(isQuote ? "留下一句喜欢的话" : "书还在这里，等你回来。")
                        .font(.system(.headline, design: .serif)).foregroundStyle(ink).lineLimit(3)
                    Spacer(minLength: 0)
                    Text(snapshot == nil ? "打开书房，同步阅读内容" : isQuote ? "阅读时划句并保存想法" : "读过一本书后，在这里继续")
                        .font(.caption).foregroundStyle(ink.opacity(0.7)).lineLimit(2)
                }
            }
        }
    }
}

struct ContinueReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: LibraryWidgetStorage.continueKind, provider: LibraryProvider()) { LibraryWidgetView(entry: $0, isQuote: false) }
            .configurationDisplayName("继续阅读")
            .description("留一页书在桌面，点一下接着读。")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
struct FavoriteQuoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: LibraryWidgetStorage.quoteKind, provider: LibraryProvider()) { LibraryWidgetView(entry: $0, isQuote: true) }
            .configurationDisplayName("收藏的句子")
            .description("让自己留下的划句，偶尔回到眼前。")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
@main
struct LibraryWidgets: WidgetBundle {
    var body: some Widget { ContinueReadingWidget(); FavoriteQuoteWidget() }
}
