import SwiftUI

@main
@MainActor
struct ZhiZhouApp: App {
    @Environment(\.scenePhase) private var scenePhase

    private let appState = AppState.shared
    private let readerSettings = ReaderSettingsStore.shared
    private let fontStore = FontStore.shared
    private let offlineReadingStore = OfflineReadingStore.shared
    private let feedbackCenter = AppFeedbackCenter.shared

    init() {
        fontStore.registerCachedFonts()
        AppObservability.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(readerSettings)
                .environment(fontStore)
                .environment(offlineReadingStore)
                .background(GlobalKeyboardDismissal())
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active || phase == .background else { return }
                    Task { @MainActor in
                        await ReaderSettingsStore.shared.flush()
                        await ReaderProgressStore.shared.flush()
                        await AppObservability.shared.flush()
                    }
                }
                .overlay(alignment: .top) {
                    AppFeedbackOverlay(center: feedbackCenter)
                        .safeAreaPadding(.top, 8)
                }
        }
    }
}
