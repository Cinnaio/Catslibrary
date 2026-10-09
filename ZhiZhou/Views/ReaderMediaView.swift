import SwiftUI
import ImageIO
import UIKit

/// 只在当前阅读会话内持有图片；由资源尺寸预留空间，加载和重试不会改变正文高度。
struct ReaderMediaView: View {
    let path: String
    let caption: String
    let aspectRatio: CGFloat
    var maximumHeight: CGFloat? = nil
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
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
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
    @State private var zoom: CGFloat = 1
    @GestureState private var magnification: CGFloat = 1

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let scale = min(4, max(1, zoom * magnification))
                ScrollView([.horizontal, .vertical]) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geometry.size.width * scale, height: geometry.size.height * scale)
                        .accessibilityLabel(caption.isEmpty ? "插图大图" : caption)
                }
                .gesture(MagnifyGesture()
                    .updating($magnification) { value, state, _ in state = value.magnification }
                    .onEnded { value in zoom = min(4, max(1, zoom * value.magnification)) })
                .accessibilityAction(named: "放大") { zoom = min(4, zoom + 1) }
                .accessibilityAction(named: "缩小") { zoom = max(1, zoom - 1) }
            }
            .navigationTitle("图片预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
