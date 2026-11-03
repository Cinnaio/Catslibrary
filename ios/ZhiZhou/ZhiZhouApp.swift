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
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "zhizhou.telemetry.consent.v1")
        defaults.removeObject(forKey: "zhizhou.telemetry.install-id.v1")
        defaults.removeObject(forKey: "zhizhou.telemetry.queue.v1")
        fontStore.registerCachedFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(readerSettings)
                .environment(fontStore)
                .environment(offlineReadingStore)
                .background(GlobalKeyboardDismissal())
                .task(id: appState.user?.id) { await ContentAccessStore.shared.revalidate() }
                #if DEBUG && targetEnvironment(simulator)
                .preferredColorScheme(VisualAudit.appearance)
                #endif
                .onChange(of: scenePhase) { _, phase in
                    if phase == .inactive || phase == .background {
                        ContentAccessStore.shared.suspend()
                    } else if phase == .active {
                        Task { await ContentAccessStore.shared.revalidate() }
                    }
                    guard phase == .active || phase == .background else { return }
                    Task { @MainActor in
                        await ReaderSettingsStore.shared.flush()
                        await ReaderProgressStore.shared.flush()
                        await ReadingStatsStore.shared.flush()
                    }
                }
                .overlay(alignment: .top) {
                    AppFeedbackOverlay(center: feedbackCenter)
                        .safeAreaPadding(.top, 8)
                }
        }
    }
}
