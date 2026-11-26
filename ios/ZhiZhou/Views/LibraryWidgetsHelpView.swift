import SwiftUI

struct LibraryWidgetsHelpView: View {
    private var store: LibraryWidgetStore { .shared }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text("桌面上的书房").font(serifFont(.largeTitle, .semibold)).foregroundStyle(ReadingSpace.ink)
                Text("一页没读完的书，一句舍不得放下的话。")
                    .foregroundStyle(ReadingSpace.profileMuted)
                description("继续阅读", symbol: "book", text: "显示最近读过的书和章节，点一下回到阅读位置。")
                description("收藏的句子", symbol: "quote.opening", text: "轮换最近保存的 20 则个人划句，点一下回到原章节。阅读时选中句子并保存想法，就能留下它。")
                VStack(alignment: .leading, spacing: 12) {
                    Text("放到桌面或锁屏").font(.headline)
                    Text("在主屏幕添加小组件时，搜索 Cat’s Library，选择「继续阅读」或「收藏的句子」。也可以在锁屏的小组件区域添加。")
                    Text("支持小号、中号桌面组件，以及锁屏的文字与矩形组件。")
                }
                VStack(alignment: .leading, spacing: 12) {
                    if store.sharingAvailable {
                        if let date = store.updatedAt {
                            Text("内容更新于 \(date.formatted(date: .omitted, time: .shortened))").font(.subheadline)
                        } else { Text("打开一本书或留下一则划句后，在这里同步。") }
                        if let error = store.lastError { Text(error).foregroundStyle(.red).font(.subheadline) }
                        Button { store.refresh(force: true) } label: {
                            Label(store.isRefreshing ? "正在同步…" : "更新小组件内容", systemImage: "arrow.clockwise")
                        }.buttonStyle(.bordered).disabled(store.isRefreshing)
                    } else {
                        Text("当前安装包未启用小组件的数据共享。请使用带书房小组件及共享权限的安装包。")
                    }
                    Text("小组件仅展示安全模式可见的作品。系统决定实际刷新时间；打开 App 会更新内容，离线保留的内容最多使用 24 小时。退出账号后会清除共享内容并请求系统刷新。")
                        .font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
                }
            }.padding(24).frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity)
        }.background(ReadingSpace.profilePaper).readingSpaceNavigation().task { store.refresh() }
    }
    private func description(_ title: String, symbol: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol).font(serifFont(.title3, .semibold)).foregroundStyle(AppTheme.primary)
            Text(text).foregroundStyle(ReadingSpace.ink)
        }
    }
}
