import SwiftUI

/// 应用内的简明隐私说明；正式上架前仍需补充主体、联系方式和公开隐私政策链接。
struct PrivacyNoticeView: View {
    var body: some View {
        AccountSettingsPage {
            AccountSettingsHeading("隐私说明", detail: "有关数据处理主体、收集范围、保存期限及删除或咨询渠道，请以运营方发布的公开隐私政策为准。")
            AccountSettingsSection("上线前说明") {
                AccountSettingsNote("正式发布前，运营方还需要在公开隐私政策中补充数据处理主体、联系方式、保存期限、用户删除/咨询渠道和 App Store Connect 隐私问卷。")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectHidden(true, for: .top)
        .accessibilityIdentifier("profile.privacy")
    }
}
