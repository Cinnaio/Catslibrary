import SwiftUI
import ImageIO
import UIKit
import Photos

/// 只在当前阅读会话内持有图片；由资源尺寸预留空间，加载和重试不会改变正文高度。
struct ReaderMediaView: View {
    let path: String
    let caption: String
    let aspectRatio: CGFloat
    var maximumHeight: CGFloat? = nil
    var captionStyle: CaptionStyle = .standard

    enum CaptionStyle: Equatable {
        case standard
        case trailingFootnote
    }
    @State private var loadedImage: UIImage?
    @State private var loadedKey = ""
    @State private var loadedDataSize: Int = 0
    @State private var errorMessage: String?
    @State private var retry = 0

    private var identity: String { "\(path):\(ContentAccessStore.shared.revision)" }
    private var currentImage: UIImage? { loadedKey == identity ? loadedImage : nil }

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { geometry in
                let height = min(geometry.size.width / max(aspectRatio, 0.1), maximumHeight ?? .greatestFiniteMagnitude)
                ZStack {
                    AppTheme.controlFill
                    if let image = currentImage {
                        ImagePreviewButton(
                            image: image,
                            caption: caption,
                            accessibilityLabel: caption.isEmpty ? "放大查看插图" : "放大查看插图：\(caption)",
                            accessRevision: ContentAccessStore.shared.revision,
                            byteCount: loadedDataSize
                        ) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .frame(width: geometry.size.width, height: height)
                        }
                        .id(identity)
                    } else if let errorMessage {
                        VStack(spacing: 8) {
                            Text(errorMessage).font(.caption).multilineTextAlignment(.center)
                            Button("重新加载图片", systemImage: "arrow.clockwise") { retry += 1 }
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                        }
                        .padding(12)
                    } else {
                        ProgressView("正在加载图片…").font(.caption)
                    }
                }
                .frame(width: geometry.size.width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .aspectRatio(max(aspectRatio, 0.1), contentMode: .fit)
            .frame(maxHeight: maximumHeight)
            if !caption.isEmpty {
                Text(caption)
                    .font(captionStyle == .trailingFootnote ? .caption2 : .caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .multilineTextAlignment(captionStyle == .trailingFootnote ? .trailing : .center)
                    .fixedSize(horizontal: false, vertical: true)
                    // CJK fallback fonts may have no italic face. Slant the
                    // entire caption uniformly instead of only Latin glyphs.
                    .transformEffect(CGAffineTransform(
                        a: 1, b: 0,
                        c: captionStyle == .trailingFootnote ? -0.18 : 0,
                        d: 1, tx: 0, ty: 0
                    ))
                    .frame(maxWidth: .infinity, alignment: captionStyle == .trailingFootnote ? .trailing : .center)
            }
        }
        .task(id: "\(identity):\(retry)") {
            let key = identity
            loadedImage = nil
            loadedKey = ""
            errorMessage = nil
            do {
                let data = try await ReaderMediaAPI.image(path: path)
                let image = await Task.detached(priority: .utility) { Self.decode(data) }.value
                try Task.checkCancellation()
                guard let image else { throw APIError.invalidResponse }
                guard key == identity else { return }
                loadedImage = image
                loadedKey = key
                loadedDataSize = data.count
            } catch is CancellationError {
            } catch {
                guard key == identity, !Task.isCancelled else { return }
                errorMessage = AppCopy.friendlyError(error)
            }
        }
        .accessibilityIdentifier("reader.media.\(path)")
    }

    nonisolated private static func decode(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 2400,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}

struct ImagePreviewButton<Label: View>: View {
    let image: UIImage
    let caption: String
    let accessibilityLabel: String
    let accessRevision: UUID
    var byteCount: Int? = nil
    @ViewBuilder let label: () -> Label

    @State private var previewOpen = false
    @State private var saveStatus: ImageSaveStatus = .ready
    @State private var saveMessage: String?

    private var hasImageAccess: Bool { accessRevision == ContentAccessStore.shared.revision }

    var body: some View {
        Button(action: openPreview) {
            label().contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityActions {
            if saveStatus == .ready {
                Button("保存到相册", action: saveImageToAlbum)
            }
        }
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contextMenu {
            Button("查看大图", systemImage: "arrow.up.left.and.arrow.down.right", action: openPreview)
            Button(saveStatus.title, systemImage: saveStatus.icon, action: saveImageToAlbum)
                .disabled(saveStatus != .ready)
        } preview: {
            let scale = min(280 / image.size.width, 340 / image.size.height)
            Image(uiImage: image)
                .resizable()
                .frame(width: image.size.width * scale, height: image.size.height * scale)
        }
        .imageSaveNotice($saveMessage, isActive: !previewOpen)
        .fullScreenCover(isPresented: $previewOpen) {
            if hasImageAccess {
                ImagePreview(
                    image: image, caption: caption, byteCount: byteCount,
                    saveStatus: $saveStatus, onSave: saveImageToAlbum
                )
                .imageSaveNotice($saveMessage)
            }
        }
        .onChange(of: hasImageAccess) { _, hasAccess in
            if !hasAccess {
                previewOpen = false
                saveMessage = nil
            }
        }
    }

    private func openPreview() {
        guard hasImageAccess else { return }
        previewOpen = true
    }

    private func saveImageToAlbum() {
        guard saveStatus == .ready, hasImageAccess else { return }
        saveStatus = .saving

        Task {
            defer {
                if saveStatus == .saving { saveStatus = .ready }
            }
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard hasImageAccess else { return }
            guard status == .authorized || status == .limited else {
                saveMessage = "未获得相册权限，请在系统设置中允许 Cat’s Library 添加照片。"
                AppFeedback.error()
                return
            }

            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest.creationRequestForAsset(from: image)
                }
                guard hasImageAccess else { return }
                saveStatus = .saved
                if !previewOpen { saveMessage = "已保存到相册。" }
                AppFeedback.success()
            } catch {
                guard hasImageAccess else { return }
                saveMessage = "保存失败，请稍后重试。"
                AppFeedback.error()
            }
        }
    }
}

private enum ImageSaveStatus: Equatable {
    case ready
    case saving
    case saved

    var title: String {
        switch self {
        case .ready: return "保存到相册"
        case .saving: return "正在保存…"
        case .saved: return "已保存"
        }
    }

    var icon: String { self == .saved ? "checkmark" : "arrow.down.to.line" }
}

private extension View {
    func imageSaveNotice(_ message: Binding<String?>, isActive: Bool = true) -> some View {
        alert("保存到相册", isPresented: Binding(
            get: { isActive && message.wrappedValue != nil },
            set: { if !$0 { message.wrappedValue = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}

private struct ImagePreview: View {
    let image: UIImage
    let caption: String
    let byteCount: Int?
    @Binding var saveStatus: ImageSaveStatus
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var zoom: CGFloat = 1.0
    @State private var panOffset: CGSize = .zero
    @State private var lastPanOffset: CGSize = .zero
    @State private var dragOffset: CGSize = .zero
    @State private var showChrome = true
    @GestureState private var magnification: CGFloat = 1.0

    private var currentZoom: CGFloat {
        min(4.0, max(1.0, zoom * magnification))
    }

    private var backgroundOpacity: Double {
        guard dragOffset.height > 0 else { return 1.0 }
        let progress = min(1.0, Double(dragOffset.height) / 320.0)
        return max(0.1, 1.0 - progress * 0.88)
    }

    private var dismissScale: CGFloat {
        guard dragOffset.height > 0, zoom <= 1.01 else { return 1.0 }
        let progress = min(1.0, dragOffset.height / 320.0)
        return max(0.68, 1.0 - progress * 0.32)
    }

    private var dismissCornerRadius: CGFloat {
        guard dragOffset.height > 0 else { return 0 }
        return min(20, dragOffset.height / 8)
    }

    private var resolutionText: String {
        let width = image.cgImage?.width ?? Int(image.size.width * image.scale)
        let height = image.cgImage?.height ?? Int(image.size.height * image.scale)
        return "\(width)×\(height)"
    }

    private var fileSizeText: String {
        if let byteCount, byteCount > 0 {
            return ByteCountFormatter.string(fromByteCount: Int64(byteCount), countStyle: .file)
        }
        return ""
    }

    private var metadataText: String {
        let res = resolutionText
        let size = fileSizeText
        if !size.isEmpty {
            return "\(res)  \(size)"
        }
        return res
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let size = geometry.size
                ZStack {
                    // 沉浸纯黑底色，随下拉手势同步渐隐
                    Color.black
                        .opacity(backgroundOpacity)
                        .ignoresSafeArea()

                    // 插图本体，支持手势下拉缩小、位移与双击/捏合缩放
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: dismissCornerRadius, style: .continuous))
                        .scaleEffect(currentZoom * dismissScale)
                        .offset(
                            x: panOffset.width + dragOffset.width,
                            y: panOffset.height + dragOffset.height
                        )
                        .accessibilityLabel(caption.isEmpty ? "插图大图" : caption)
                        .accessibilityAction(named: showChrome ? "隐藏操作" : "显示操作") {
                            withAnimation(reduceMotion ? nil : AppMotion.structural) { showChrome.toggle() }
                        }
                        .accessibilityAction(named: "放大") {
                            withAnimation(reduceMotion ? nil : AppMotion.structural) {
                                zoom = min(4.0, zoom + 1)
                            }
                        }
                        .accessibilityAction(named: "缩小") {
                            withAnimation(reduceMotion ? nil : AppMotion.structural) {
                                zoom = max(1.0, zoom - 1)
                                if zoom <= 1.01 { panOffset = .zero }
                            }
                        }

                    // 底部元信息与操作栏浮层
                    if showChrome && dragOffset.height == 0 {
                        VStack(spacing: 12) {
                            Spacer()

                            if !caption.isEmpty {
                                Text(caption)
                                    .font(.footnote)
                                    .foregroundStyle(Color.white.opacity(0.92))
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(.ultraThinMaterial, in: Capsule())
                                    .environment(\.colorScheme, .dark)
                                    .padding(.horizontal, 20)
                            }

                            Text(metadataText)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Color.white.opacity(0.72))

                            AppAdaptiveRow(spacing: 16) {
                                ShareLink(
                                    item: Image(uiImage: image),
                                    preview: SharePreview(caption.isEmpty ? "小说插图" : caption, image: Image(uiImage: image))
                                ) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "square.and.arrow.up")
                                        Text("分享")
                                    }
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Color.white)
                                    .frame(minWidth: 110, minHeight: AppLayout.minimumTouchTarget)
                                    .background(Color.white.opacity(0.14), in: Capsule())
                                }

                                Button(action: onSave) {
                                    HStack(spacing: 6) {
                                        if saveStatus == .saving {
                                            ProgressView()
                                                .controlSize(.small)
                                                .tint(.white)
                                        } else {
                                            Image(systemName: saveStatus.icon)
                                        }
                                        Text(saveStatus.title)
                                    }
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(saveStatus == .saved ? AppTheme.primary : Color.white)
                                    .frame(minWidth: 130, minHeight: AppLayout.minimumTouchTarget)
                                    .background(
                                        saveStatus == .saved ? AppTheme.primaryLight.opacity(0.28) : Color.white.opacity(0.14),
                                        in: Capsule()
                                    )
                                }
                                .disabled(saveStatus != .ready)
                            }
                            .padding(.bottom, 22)
                        }
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                // 单击显隐控制条，双击快速缩放
                .onTapGesture(count: 2) {
                    handleDoubleTap()
                }
                .onTapGesture(count: 1) {
                    withAnimation(reduceMotion ? nil : AppMotion.state) {
                        showChrome.toggle()
                    }
                }
                // 捏合缩放手势
                .simultaneousGesture(
                    MagnifyGesture()
                        .updating($magnification) { value, state, _ in
                            state = value.magnification
                        }
                        .onEnded { value in
                            let targetZoom = min(4.0, max(1.0, zoom * value.magnification))
                            withAnimation(reduceMotion ? nil : AppMotion.structural) {
                                zoom = targetZoom
                                if zoom <= 1.01 {
                                    panOffset = .zero
                                    lastPanOffset = .zero
                                }
                            }
                        }
                )
                // 拖拽手势：放大时平移，未放大时下拉退出
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8)
                        .onChanged { value in
                            handleDragChanged(value, size: size)
                        }
                        .onEnded { value in
                            handleDragEnded(value)
                        }
                )
            }
            .navigationTitle("图片预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.white)
                            .frame(width: 32, height: 32)
                            .background(Color.white.opacity(0.18), in: Circle())
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("完成")
                    .accessibilityIdentifier("完成")
                    .accessibilityHint("关闭图片预览")
                    .opacity(showChrome ? 1 : 0)
                    .allowsHitTesting(showChrome)
                    .accessibilityHidden(!showChrome)
                }

                ToolbarItem(placement: .principal) {
                    Text("1 / 1")
                        .font(.subheadline.weight(.medium).monospacedDigit())
                        .foregroundStyle(Color.white)
                        .opacity(showChrome ? 1 : 0)
                        .accessibilityHidden(!showChrome)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }

    private func handleDoubleTap() {
        withAnimation(reduceMotion ? nil : AppMotion.structural) {
            if zoom > 1.01 {
                zoom = 1.0
                panOffset = .zero
                lastPanOffset = .zero
            } else {
                zoom = 2.5
            }
        }
    }

    private func handleDragChanged(_ value: DragGesture.Value, size: CGSize) {
        if zoom > 1.01 {
            let maxPanX = max(0, (size.width * zoom - size.width) / 2)
            let maxPanY = max(0, (size.height * zoom - size.height) / 2)
            let newX = lastPanOffset.width + value.translation.width
            let newY = lastPanOffset.height + value.translation.height
            panOffset = CGSize(
                width: min(maxPanX, max(-maxPanX, newX)),
                height: min(maxPanY, max(-maxPanY, newY))
            )
        } else {
            if value.translation.height > 0 || dragOffset != .zero {
                dragOffset = CGSize(
                    width: value.translation.width * 0.4,
                    height: value.translation.height
                )
            }
        }
    }

    private func handleDragEnded(_ value: DragGesture.Value) {
        if zoom > 1.01 {
            lastPanOffset = panOffset
        } else {
            if value.translation.height > 85 || value.predictedEndTranslation.height > 200 {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    dragOffset = CGSize(width: value.translation.width * 0.4, height: 600)
                }
                dismiss()
            } else {
                withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.82)) {
                    dragOffset = .zero
                }
            }
        }
    }
}
