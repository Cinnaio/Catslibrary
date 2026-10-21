import SwiftUI
import ImageIO
import UIKit

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
    @State private var errorMessage: String?
    @State private var retry = 0
    @State private var previewOpen = false

    private var identity: String { "\(path):\(ContentAccessStore.shared.revision)" }
    private var currentImage: UIImage? { loadedKey == identity ? loadedImage : nil }

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { geometry in
                let height = min(geometry.size.width / max(aspectRatio, 0.1), maximumHeight ?? .greatestFiniteMagnitude)
                ZStack {
                    AppTheme.controlFill
                    if let image = currentImage {
                        Button { previewOpen = true } label: {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .frame(width: geometry.size.width, height: height)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(caption.isEmpty ? "放大查看插图" : "放大查看插图：\(caption)")
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
            } catch is CancellationError {
            } catch {
                guard key == identity, !Task.isCancelled else { return }
                errorMessage = AppCopy.friendlyError(error)
            }
        }
        .onChange(of: identity) { _, _ in previewOpen = false }
        .accessibilityIdentifier("reader.media.\(path)")
        .fullScreenCover(isPresented: $previewOpen) {
            if let image = currentImage {
                ReaderImagePreview(image: image, caption: caption)
            }
        }
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

private struct ReaderImagePreview: View {
    let image: UIImage
    let caption: String
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
                        .frame(width: size.width, height: size.height)
                        .clipShape(RoundedRectangle(cornerRadius: dismissCornerRadius, style: .continuous))
                        .scaleEffect(currentZoom * dismissScale)
                        .offset(
                            x: panOffset.width + dragOffset.width,
                            y: panOffset.height + dragOffset.height
                        )
                        .accessibilityLabel(caption.isEmpty ? "插图大图" : caption)
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

                    // 底部插图说明浮层
                    if !caption.isEmpty && showChrome && dragOffset.height == 0 {
                        VStack {
                            Spacer()
                            Text(caption)
                                .font(.footnote)
                                .foregroundStyle(Color.white.opacity(0.92))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(.ultraThinMaterial, in: Capsule())
                                .environment(\.colorScheme, .dark)
                                .padding(.bottom, 24)
                                .padding(.horizontal, 20)
                                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                        }
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
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        dismiss()
                    }
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.primary)
                }
            }
            .toolbar(showChrome ? .visible : .hidden, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
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
