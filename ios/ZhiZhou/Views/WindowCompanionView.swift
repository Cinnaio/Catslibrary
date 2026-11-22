import SwiftUI

struct WindowCompanionView: View {
    private enum Framing: Hashable {
        case full, portrait
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var framing: Framing = .full
    @State private var greeting = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("窗边")
                    .font(serifFont(.title, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .accessibilityAddTraits(.isHeader)

                Picker("取景", selection: $framing) {
                    Text("全身").tag(Framing.full)
                    Text("半身").tag(Framing.portrait)
                }
                .pickerStyle(.segmented)

                if framing == .portrait, !reduceMotion {
                    Button {
                        greeting &+= 1
                    } label: {
                        Text("打个招呼")
                            .frame(minHeight: AppLayout.minimumTouchTarget)
                    }
                    .buttonStyle(.bordered)
                }

                artwork
            }
            .padding(.horizontal, 22)
            .padding(.top, 16)
            .padding(.bottom, 32)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceNavigation()
        .profileDestinationNavigation()
    }

    private var artwork: some View {
        Group {
            switch framing {
            case .full:
                Image(decorative: "WindowCompanionFull")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 440)
            case .portrait:
                WindowCompanionPortrait(greeting: greeting)
                    .frame(maxWidth: 340)
                    .padding([.horizontal, .top], 18)
            }
        }
        .frame(maxWidth: .infinity)
        .background(framing == .full ? Color.black : ReadingSpace.profileFill)
        .clipShape(.rect(cornerRadius: ReadingSpace.panelRadius))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(framing == .full ? "奶白裙装和浅樱色猫尾的全身立绘" : "有猫耳和浅樱色花饰的半身立绘")
        .accessibilityAddTraits(.isImage)
    }
}

struct WindowCompanionPortrait: View {
    private static let aspectRatio: CGFloat = 1086.0 / 1448.0

    var greeting = 0
    var coverCrop: CGSize?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var greeted = false
    @State private var appearanceGreeting = 0

    private var canAnimate: Bool {
        visible && scenePhase == .active && !reduceMotion
    }

    var body: some View {
        Group {
            if canAnimate {
                Color.clear.keyframeAnimator(
                    initialValue: Pose(), trigger: appearanceGreeting &+ greeting
                ) { _, pose in
                    layers(pose)
                } keyframes: { _ in
                    KeyframeTrack(\.blink) {
                        LinearKeyframe(0.0, duration: 0.11)
                        LinearKeyframe(1.0, duration: 0.07)
                        LinearKeyframe(1.0, duration: 0.045)
                        LinearKeyframe(0.0, duration: 0.09)
                    }
                    KeyframeTrack(\.ear) {
                        CubicKeyframe(1.0, duration: 0.15)
                        CubicKeyframe(-0.24, duration: 0.14)
                        CubicKeyframe(0.0, duration: 0.16)
                    }
                }
            } else {
                layers(Pose())
            }
        }
        .aspectRatio(Self.aspectRatio, contentMode: .fit)
        .frame(width: coverCrop?.width, height: coverCrop.map { $0.width / Self.aspectRatio })
        .frame(height: coverCrop?.height, alignment: .top)
        .clipped()
        .onScrollVisibilityChange(threshold: 0.2) { visible = $0 }
        .onChange(of: greeting) { _, _ in greeted = true }
        .onDisappear { greeted = false }
        .task(id: canAnimate) {
            guard canAnimate, !greeted else { return }
            do {
                try await Task.sleep(for: .milliseconds(280))
            } catch {
                return
            }
            guard !Task.isCancelled, !greeted else { return }
            greeted = true
            appearanceGreeting &+= 1
        }
    }

    private func layers(_ pose: Pose) -> some View {
        GeometryReader { geometry in
            let size = geometry.size
            let scale = size.width / 1086.0

            ZStack(alignment: .topLeading) {
                Image(decorative: "WindowCompanionPortrait")
                    .resizable()
                    .frame(width: size.width, height: size.height)

                if pose.blink > 0 {
                    // Closed eyes are registered to the open portrait. Only this tile fades in.
                    Image(decorative: "WindowCompanionBlink")
                        .resizable()
                        .frame(width: scale * 264, height: scale * 224)
                        .mask {
                            RoundedRectangle(cornerRadius: 21 * scale)
                                .padding(8 * scale)
                                .blur(radius: 4 * scale)
                        }
                        .opacity(pose.blink)
                        .offset(x: scale * 624, y: scale * 342)
                }
            }
            .distortionEffect(
                ShaderLibrary.windowCompanionMotion(
                    .float2(Float(size.width), Float(size.height)), .float(Float(pose.ear))
                ),
                maxSampleOffset: CGSize(width: 18 * scale, height: 13 * scale),
                isEnabled: abs(pose.ear) > 0.001
            )
        }
        .accessibilityHidden(true)
    }

    private struct Pose {
        var blink = 0.0
        var ear = 0.0
    }
}
