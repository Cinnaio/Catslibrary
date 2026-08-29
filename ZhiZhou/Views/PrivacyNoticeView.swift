import SwiftUI

/// 应用内的简明隐私说明；正式上架前仍需补充主体、联系方式和公开隐私政策链接。
struct PrivacyNoticeView: View {
    var body: some View {
        List {
            Section("我们收集什么") {
                Text("只有在你打开“帮助改进知舟”后，应用才会发送匿名安装标识摘要、应用版本、系统/设备型号，以及不含正文的功能事件、错误、性能和 MetricKit 诊断数据。")
                Text("不会主动收集小说正文、搜索关键词、密码、登录令牌、用户 ID、IP 地址或通讯录。")
            }

            Section("为什么收集") {
                Text("用于统计功能使用情况、发现崩溃和性能问题、判断不同 iPhone/iPad 设备上的兼容性，并帮助远程处理问题。")
            }

            Section("你的控制权") {
                Text("开关默认关闭。你可以随时关闭；关闭时尚未发送到服务器的本地诊断队列会被清除。已发送的数据按照服务端保留策略处理。")
            }

            Section("上线前说明") {
                Text("正式发布前，运营方还需要在公开隐私政策中补充数据处理主体、联系方式、保存期限、用户删除/咨询渠道和 App Store Connect 隐私问卷。")
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("隐私说明")
        .navigationBarTitleDisplayMode(.inline)
    }
}
