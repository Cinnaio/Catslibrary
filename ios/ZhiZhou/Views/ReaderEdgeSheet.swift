import SwiftUI

struct ReaderEdgeSheet: View {
    let store: ReaderEdgeStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.authorized {
                    Form {
                        if let notice = store.runtimeNotice {
                            Section { Text(notice).foregroundStyle(AppTheme.danger) }
                        }
                        if store.data != nil, store.catalog != nil {
                            Section { ReaderEdgeStage(store: store) }
                                .listRowSeparator(.hidden)
                            ReaderEdgeSettingsSections(store: store)
                            Section {
                                NavigationLink {
                                    ReaderEdgeHistoryView(store: store)
                                } label: {
                                    LabeledContent("本机记录", value: "\(store.data?.history.count ?? 0) 条")
                                }
                            } footer: {
                                Text("只保存在当前设备，按账号隔离，最多保留最近 30 条。收起面板可继续阅读；离开阅读器不保留未结束的会话。")
                            }
                        }
                        if let notice = store.storageNotice {
                            Section {
                                Text(notice).foregroundStyle(AppTheme.warning)
                                Button("重试保存与读取") { store.retryStorage() }
                            }
                        }
                        if let notice = store.audioNotice {
                            Section { Text(notice).foregroundStyle(AppTheme.warning) }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(AppTheme.background)
                } else {
                    ContentUnavailableView("节拍指令已关闭", systemImage: "lock",
                                           description: Text("当前账号的成人内容权限尚未确认。"))
                }
            }
            .navigationTitle("节拍指令")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("收起") { dismiss() }
                        .accessibilityHint("返回阅读，已开始的会话继续运行")
                }
            }
        }
        .tint(AppTheme.primary)
    }
}

private struct ReaderEdgeStage: View {
    let store: ReaderEdgeStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var session: ReaderEdgeSession? { store.session }
    private var chance: Int {
        session?.chance ?? store.data.map { store.catalog?.baseChance(for: $0.settings) ?? 0 } ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                ReaderEdgePulse(session: session)
                Text(session?.phaseTitle ?? "准备开始").font(.subheadline.weight(.medium))
                Spacer(minLength: 4)
                Text("许可率 \(chance)%").font(.caption).foregroundStyle(.secondary)
            }
            if let session {
                Text(session.status == .finished ? (store.catalog?.endings[session.ending ?? ""] ?? "本次结束") : session.command)
                    .font(SongtiFont.font(.title2, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                ProgressView(value: session.progress).accessibilityHidden(true)
            } else {
                Text("设置好规则后开始这一局。").font(.title3)
            }
            if store.data?.settings.hiddenRemaining == true && session != nil {
                Text("剩余时间已隐藏").font(.subheadline).foregroundStyle(.secondary)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(readerEdgeTime(session?.remainingMs ?? Double(store.data?.settings.minutes ?? 0) * 60_000))
                        .font(.system(.title, design: .rounded).monospacedDigit())
                        .accessibilityLabel("剩余时间")
                        .accessibilityValue(readerEdgeTime(session?.remainingMs ?? Double(store.data?.settings.minutes ?? 0) * 60_000))
                    if let session, session.isActive {
                        Text("本条 \(Int(ceil(session.phaseRemainingMs / 1000))) 秒")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
            if let session, session.edges > 0 {
                Text("已申报 \(session.edges) 次").font(.caption).foregroundStyle(.secondary)
            }
            if let hint = session?.pauseHint {
                Text(hint).font(.footnote).foregroundStyle(.secondary)
            }
            actions
            if session?.canDeclare == true {
                Button("中途没忍住？点这里") { store.reportCompletion() }
                    .font(.footnote).frame(minHeight: 44)
            }
        }
        .padding(.vertical, 8)
    }

    private var actions: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            if let session, session.isActive {
                if session.status == .permit {
                    Button("按下了", systemImage: "checkmark") { store.reportCompletion() }
                        .buttonStyle(.borderedProminent)
                } else if session.status == .running || session.status == .cooldown {
                    Button("忍住了", systemImage: "checkmark") { store.declareEdge() }
                        .buttonStyle(.borderedProminent).disabled(!session.canDeclare)
                }
                Button(session.status == .paused ? "继续" : "暂停",
                       systemImage: session.status == .paused ? "play.fill" : "pause.fill") {
                    session.status == .paused ? store.resume() : store.pause()
                }
                Button("结束", role: .destructive) { store.quit() }
            } else {
                Button(session == nil ? "开始这一局" : "再来一次", systemImage: "play.fill") { store.start() }
                    .buttonStyle(.borderedProminent).disabled(!store.ready)
                if session != nil { Button("清掉结果") { store.reset() } }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

private struct ReaderEdgeSettingsSections: View {
    let store: ReaderEdgeStore

    var body: some View {
        if let settings = store.data?.settings, let catalog = store.catalog {
            Section {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { presets(settings) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 8) { presets(settings) }
                }
                Stepper("时长：\(settings.minutes) 分钟", value: binding(\.minutes, fallback: settings.minutes), in: 1...180)
                Picker("难度", selection: binding(\.difficulty, fallback: settings.difficulty)) {
                    ForEach(catalog.difficulties) { option in
                        Text("\(option.label) · \(option.chance ?? 0)%").tag(option.id)
                    }
                }
                optionSummary(catalog.difficulties, selected: settings.difficulty)
                Picker("结局", selection: binding(\.finale, fallback: settings.finale)) {
                    ForEach(catalog.finales) { Text($0.label).tag($0.id) }
                }
                optionSummary(catalog.finales, selected: settings.finale)
                Picker("口吻", selection: binding(\.tone, fallback: settings.tone)) {
                    ForEach(catalog.tones) { Text($0.label).tag($0.id) }
                }
                DisclosureGroup("指令类型") {
                    ForEach(catalog.categories) { category in
                        Toggle(category.label, isOn: Binding(
                            get: { store.data?.settings.categories[category.id] == true },
                            set: { store.updateCategory(category.id, enabled: $0) }
                        ))
                    }
                }
                Stepper("许可时长：\(settings.permitSeconds) 秒", value: binding(\.permitSeconds, fallback: settings.permitSeconds), in: 5...60)
                if settings.finale == "overtime" {
                    Stepper("单次加时：\(settings.overtimeSeconds) 秒", value: binding(\.overtimeSeconds, fallback: settings.overtimeSeconds), in: 15...300, step: 15)
                }
                Toggle("自定义许可率", isOn: Binding(
                    get: { store.data?.settings.customChance != nil },
                    set: { store.update(\.customChance, $0 ? catalog.baseChance(for: settings) : nil) }
                ))
                if settings.customChance != nil {
                    Stepper("许可率：\(settings.customChance ?? 0)%", value: Binding(
                        get: { store.data?.settings.customChance ?? 0 },
                        set: { store.update(\.customChance, $0) }
                    ), in: 0...100)
                }
                Stepper("等待最短：\(settings.holdMin) 秒", value: binding(\.holdMin, fallback: settings.holdMin), in: 3...120)
                Stepper("等待最长：\(settings.holdMax) 秒", value: binding(\.holdMax, fallback: settings.holdMax), in: settings.holdMin...120)
                Toggle("较长的指令", isOn: Binding(
                    get: { store.data?.settings.segmentLength == "long" },
                    set: { store.update(\.segmentLength, $0 ? "long" : "standard") }
                ))
            } header: {
                Text("这一局的规则")
            } footer: {
                if store.active { Text("本次规则已固定，结束后可重新调整。") }
            }
            .disabled(store.active || !store.ready)

            Section {
                Toggle("节拍声", isOn: binding(\.sound, fallback: settings.sound, rule: false))
                Toggle("红色时的心跳", isOn: binding(\.heartbeat, fallback: settings.heartbeat, rule: false))
                    .disabled(!settings.sound)
                Toggle("语音播报", isOn: binding(\.speech, fallback: settings.speech, rule: false))
                Toggle("隐藏剩余时间", isOn: binding(\.hiddenRemaining, fallback: settings.hiddenRemaining, rule: false))
            } header: {
                Text("声音与显示")
            } footer: {
                Text("声音默认关闭，并遵守系统静音设置。语音只提示状态变化；切后台、耳机断连或音频中断会暂停。")
            }
        }
    }

    @ViewBuilder
    private func presets(_ settings: ReaderEdgeSettings) -> some View {
        ForEach([3, 5, 10, 20], id: \.self) { minutes in
            Button { store.update(\.minutes, minutes) } label: {
                Text("\(minutes) 分钟").font(.subheadline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(settings.minutes == minutes ? AppTheme.primaryLight : AppTheme.controlFill,
                                in: RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(settings.minutes == minutes ? .isSelected : [])
        }
    }

    @ViewBuilder
    private func optionSummary(_ options: [ReaderEdgeOption], selected: String) -> some View {
        if let summary = options.first(where: { $0.id == selected })?.summary {
            Text(summary).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func binding<Value>(_ key: WritableKeyPath<ReaderEdgeSettings, Value>, fallback: Value, rule: Bool = true) -> Binding<Value> {
        Binding(get: { store.data?.settings[keyPath: key] ?? fallback },
                set: { store.update(key, $0, rule: rule) })
    }
}

private struct ReaderEdgeHistoryView: View {
    let store: ReaderEdgeStore
    @State private var visibleCount = 10
    @State private var confirmClear = false

    var body: some View {
        Group {
            if store.authorized {
                List {
                    if let notice = store.storageNotice {
                        Section {
                            Text(notice).foregroundStyle(AppTheme.warning)
                            Button("重试保存与读取") { store.retryStorage() }
                        }
                    }
                    let history = store.data?.history ?? []
                    if history.isEmpty {
                        ContentUnavailableView("暂无本机记录", systemImage: "clock",
                                               description: Text("完成或主动结束一局后，记录会保存在这里。"))
                    } else {
                        ForEach(Array(history.prefix(visibleCount))) { record in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(store.catalog?.endings[record.ending] ?? "本次结束").font(.headline)
                                    Spacer()
                                    Text(readerEdgeTime(record.elapsedMs)).monospacedDigit()
                                }
                                Text(Date(timeIntervalSince1970: record.finishedAt / 1000), format: .dateTime.month().day().hour().minute())
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text("\(difficulty(record.difficulty)) · \(record.minutes) 分钟 · 申报 \(record.edges) 次")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        if history.count > visibleCount { Button("再显示 10 条") { visibleCount += 10 } }
                        Section {
                            Button("清空本机记录", role: .destructive) { confirmClear = true }
                                .disabled(!store.canClearHistory)
                        } footer: {
                            Text("仅清除当前设备、当前账号的节拍记录，保留设置。")
                        }
                    }
                }
            } else {
                ContentUnavailableView("记录已隐藏", systemImage: "lock")
            }
        }
        .navigationTitle("本机记录")
        .navigationBarTitleDisplayMode(.inline)
        .alert("清空本机记录？", isPresented: $confirmClear) {
            Button("取消", role: .cancel) {}
            Button("清空", role: .destructive) { store.clearHistory() }
        } message: {
            Text("仅清除当前账号在这台设备上的节拍记录，设置会保留。")
        }
    }

    private func difficulty(_ value: String) -> String {
        store.catalog?.difficulties.first { $0.id == value }?.label ?? value
    }
}

func readerEdgeColor(_ session: ReaderEdgeSession?) -> Color {
    guard let session, session.isAdvancing else { return AppTheme.textSecondary }
    switch session.phase {
    case .go: return AppTheme.success
    case .slow: return AppTheme.warning
    case .stop: return AppTheme.danger
    }
}

struct ReaderEdgePulse: View {
    let session: ReaderEdgeSession?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if !reduceMotion, let session, session.status == .running, session.bpm > 0 {
            TimelineView(.animation(minimumInterval: 1.0 / 20)) { timeline in
                let period = 60 / Double(session.bpm)
                let position = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
                Circle().fill(readerEdgeColor(session))
                    .frame(width: 8, height: 8)
                    .scaleEffect(0.85 + 0.3 * sin(position * .pi))
            }
            .frame(width: 10, height: 10)
            .accessibilityHidden(true)
        } else {
            Circle().fill(readerEdgeColor(session))
                .frame(width: 8, height: 8)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
        }
    }
}
