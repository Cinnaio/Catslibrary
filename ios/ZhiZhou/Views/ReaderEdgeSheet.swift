import SwiftUI

struct ReaderEdgeSheet: View {
    let store: ReaderEdgeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            ReaderPanelPage {
                ReaderPanelHeading("节拍指令")
                if store.authorized {
                    if let notice = store.runtimeNotice {
                        ReaderPanelNote(notice, color: AppTheme.danger)
                    }
                    if store.data != nil, store.catalog != nil {
                        ReaderEdgeStage(store: store)
                        if let session = store.session, session.isActive, session.settings.bank {
                            ReaderEdgeBankSection(store: store, session: session)
                        }
                        ReaderEdgeSettingsSections(store: store)
                        ReaderPanelSection("本机记录") {
                            NavigationLink {
                                ReaderEdgeHistoryView(store: store)
                            } label: {
                                let layout = dynamicTypeSize >= .xxxLarge
                                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                                    : AnyLayout(HStackLayout(spacing: 12))
                                layout {
                                    Label("查看记录", systemImage: "clock.arrow.circlepath")
                                    if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                                    HStack(spacing: 8) {
                                        Text("\(store.data?.history.count ?? 0) 条").monospacedDigit()
                                        Image(systemName: "chevron.right").font(.caption).accessibilityHidden(true)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(ReaderPanelButtonStyle())
                            ReaderPanelNote("只保存在当前设备，按账号隔离，最多保留最近 30 条。收起面板可继续阅读；离开阅读器不保留未结束的会话。")
                        }
                    }
                    if let notice = store.storageNotice {
                        VStack(alignment: .leading, spacing: 12) {
                            ReaderPanelNote(notice, color: AppTheme.warning)
                            Button("重试保存与读取", systemImage: "arrow.clockwise") { store.retryStorage() }
                                .buttonStyle(ReaderPanelButtonStyle())
                        }
                    }
                    if let notice = store.audioNotice {
                        ReaderPanelNote(notice, color: AppTheme.warning)
                    }
                } else {
                    ContentUnavailableView("节拍指令已关闭", systemImage: "lock",
                                           description: Text("当前账号的成人内容权限尚未确认。"))
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("收起") { dismiss() }
                        .accessibilityHint("返回阅读，已开始的会话继续运行")
                }
            }
        }
        .tint(AppTheme.primary)
        .presentationBackground(ReadingSpace.profilePaper)
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
            let layout = dynamicTypeSize >= .xxxLarge
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
            layout {
                HStack(spacing: 8) {
                    ReaderEdgePulse(session: session)
                    Text(session?.phaseTitle ?? "准备开始").font(.subheadline.weight(.medium))
                }
                if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                Text("许可率 \(chance)%").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            }
            if let session {
                if session.settings.acts, let act = store.catalog?.acts[session.act] {
                    Text(session.feedback.sprinting ? "\(act) · 冲刺" : act)
                        .font(.caption.weight(.medium)).foregroundStyle(ReadingSpace.profileMuted)
                }
                Text(session.status == .finished ? (store.catalog?.endings[session.ending ?? ""] ?? "本次结束") : session.command)
                    .font(serifFont(.title2, .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                ProgressView(value: session.progress).accessibilityHidden(true)
            } else {
                Text("设置好规则后开始这一局。").font(serifFont(.title3, .medium))
            }
            if store.data?.settings.hiddenRemaining == true && session != nil {
                Text("剩余时间已隐藏").font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            } else {
                layout {
                    Text(readerEdgeTime(session?.remainingMs ?? Double(store.data?.settings.minutes ?? 0) * 60_000))
                        .font(.system(.title, design: .rounded).monospacedDigit())
                        .accessibilityLabel("剩余时间")
                        .accessibilityValue(readerEdgeTime(session?.remainingMs ?? Double(store.data?.settings.minutes ?? 0) * 60_000))
                    if let session, session.isActive {
                        Text("本条 \(Int(ceil(session.phaseRemainingMs / 1000))) 秒")
                            .font(.caption.monospacedDigit()).foregroundStyle(ReadingSpace.profileMuted)
                    }
                }
            }
            if let session, session.edges > 0 {
                Text("已申报 \(session.edges) 次").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                if session.grinds > 0 {
                    Text("其中磨着 \(session.grinds) 次").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            if let hint = session?.feedback.timingHint {
                Text(hint).font(.footnote)
                    .foregroundStyle(session?.feedback.timing == "late" ? AppTheme.success : AppTheme.textSecondary)
            }
            if let hint = session?.pauseHint {
                Text(hint).font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
            }
            ReaderEdgeActions(store: store)
            if session?.canDeclare == true {
                Button("中途没忍住？点这里") { store.reportCompletion() }
                    .font(.footnote).frame(minHeight: 44)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .foregroundStyle(ReadingSpace.ink)
        .padding(.bottom, 24)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ReadingSpace.profileLine).frame(height: 1).accessibilityHidden(true)
        }
    }
}

private struct ReaderEdgeActions: View {
    let store: ReaderEdgeStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let session = store.session, session.status == .running || session.status == .cooldown {
                if dynamicTypeSize >= .xxxLarge {
                    VStack(alignment: .leading, spacing: 8) { declarations(session) }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { declarations(session) }
                        VStack(alignment: .leading, spacing: 8) { declarations(session) }
                    }
                }
            }
            lifecycleActions
        }
        .buttonStyle(ReaderPanelButtonStyle())
    }

    @ViewBuilder
    private func declarations(_ session: ReaderEdgeSession) -> some View {
        Button("忍住了", systemImage: "checkmark") { store.declareEdge() }
            .buttonStyle(ReaderPanelButtonStyle(prominent: true))
            .frame(minHeight: 44)
            .disabled(!session.canDeclare)
        if session.settings.timing, let option = store.catalog?.declarations.first(where: { $0.id == "grind" }) {
            Button(option.label, systemImage: "flame") { store.declareEdge(.grind) }
                .frame(minHeight: 44)
                .accessibilityHint(option.summary ?? "")
                .disabled(!session.canDeclare)
        }
    }

    private var lifecycleActions: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            if let session = store.session, session.isActive {
                if session.status == .permit {
                    Button("按下了", systemImage: "checkmark") { store.reportCompletion() }
                        .buttonStyle(ReaderPanelButtonStyle(prominent: true))
                }
                Button(session.status == .paused ? "继续" : "暂停",
                       systemImage: session.status == .paused ? "play.fill" : "pause.fill") {
                    session.status == .paused ? store.resume() : store.pause()
                }
                Button("结束", role: .destructive) { store.quit() }
            } else {
                Button(store.session == nil ? "开始这一局" : "再来一次", systemImage: "play.fill") { store.start() }
                    .buttonStyle(ReaderPanelButtonStyle(prominent: true)).disabled(!store.ready)
                if store.session != nil { Button("清掉结果") { store.reset() } }
            }
        }
    }
}

private struct ReaderEdgeBankSection: View {
    let store: ReaderEdgeStore
    let session: ReaderEdgeSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ReaderPanelSection("时间银行") {
            ReaderPanelFact(title: "可用余额", value: "\(session.bank) 点")
            ForEach(session.feedback.spends) { option in
                let metadata = store.catalog?.spends.first { $0.id == option.id }
                Button { store.spend(option.kind) } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        let layout = dynamicTypeSize >= .xxxLarge
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
                        layout {
                            Text(metadata?.label ?? option.id)
                            if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                            Text("\(option.cost) 点").monospacedDigit()
                        }
                        Text(option.note ?? metadata?.summary ?? "")
                            .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .multilineTextAlignment(.leading)
                }
                .buttonStyle(ReaderPanelButtonStyle())
                .disabled(option.note != nil || !store.ready)
                .accessibilityHint(option.note ?? metadata?.summary ?? "")
            }
            ReaderPanelNote(store.catalog?.rules.first { $0.id == "bank" }?.summary ?? "")
        }
    }
}

private struct ReaderEdgeSettingsSections: View {
    let store: ReaderEdgeStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if let settings = store.data?.settings, let catalog = store.catalog {
            Group {
                ReaderPanelSection("这一局的规则") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8),
                                             count: dynamicTypeSize >= .xxxLarge ? 2 : 4), spacing: 8) {
                        presets(settings)
                    }
                    Stepper("时长：\(settings.minutes) 分钟", value: binding(\.minutes, fallback: settings.minutes), in: 1...180)
                        .frame(minHeight: 44)
                    choice("难度", options: catalog.difficulties,
                           selection: binding(\.difficulty, fallback: settings.difficulty), showsChance: true)
                    optionSummary(catalog.difficulties, selected: settings.difficulty)
                    if let chance = settings.customChance {
                        ReaderPanelNote("当前按自定义许可率 \(chance)% 计算，难度的概率已被覆盖。")
                    }
                    choice("结局", options: catalog.finales,
                           selection: binding(\.finale, fallback: settings.finale))
                    optionSummary(catalog.finales, selected: settings.finale)
                    choice("口吻", options: catalog.tones,
                           selection: binding(\.tone, fallback: settings.tone))
                    if store.active { ReaderPanelNote("本次规则已固定，结束后可重新调整。") }
                }
                ReaderPanelSection("节奏与许可") {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(catalog.categories) { category in
                                Toggle(category.label, isOn: Binding(
                                    get: { store.data?.settings.categories[category.id] == true },
                                    set: { store.updateCategory(category.id, enabled: $0) }
                                ))
                                .frame(minHeight: 44)
                            }
                        }
                        .padding(.top, 12)
                    } label: {
                        Text("指令类型").frame(minHeight: 44)
                    }
                    Stepper("许可时长：\(settings.permitSeconds) 秒", value: binding(\.permitSeconds, fallback: settings.permitSeconds), in: 5...60)
                        .frame(minHeight: 44)
                    if settings.finale == "overtime" {
                        Stepper("单次加时：\(settings.overtimeSeconds) 秒", value: binding(\.overtimeSeconds, fallback: settings.overtimeSeconds), in: catalog.overtimeMinSeconds...catalog.overtimeMaxSeconds)
                            .frame(minHeight: 44)
                        ReaderPanelNote("单次加时 \(catalog.overtimeMinSeconds)–\(catalog.overtimeMaxSeconds) 秒。")
                    }
                    Toggle("自定义许可率", isOn: Binding(
                        get: { store.data?.settings.customChance != nil },
                        set: { store.update(\.customChance, $0 ? catalog.baseChance(for: settings) : nil) }
                    ))
                    .frame(minHeight: 44)
                    if settings.customChance != nil {
                        Stepper("许可率：\(settings.customChance ?? 0)%", value: Binding(
                            get: { store.data?.settings.customChance ?? 0 },
                            set: { store.update(\.customChance, $0) }
                        ), in: 0...100)
                        .frame(minHeight: 44)
                    }
                    Stepper("等待最短：\(settings.holdMin) 秒", value: binding(\.holdMin, fallback: settings.holdMin), in: 3...120)
                        .frame(minHeight: 44)
                    Stepper("等待最长：\(settings.holdMax) 秒", value: binding(\.holdMax, fallback: settings.holdMax), in: settings.holdMin...120)
                        .frame(minHeight: 44)
                    Toggle("较长的指令", isOn: Binding(
                        get: { store.data?.settings.segmentLength == "long" },
                        set: { store.update(\.segmentLength, $0 ? "long" : "standard") }
                    ))
                    .frame(minHeight: 44)
                    ReaderPanelNote("每条指令持续更久，红色同样会拉长。")
                }
                ReaderPanelSection("附加规则") {
                    ruleToggle("acts", key: \.acts, settings: settings, catalog: catalog)
                    ruleToggle("bank", key: \.bank, settings: settings, catalog: catalog)
                    ruleToggle("timing", key: \.timing, settings: settings, catalog: catalog)
                }
            }
            .disabled(store.active || !store.ready)

            ReaderPanelSection("声音与显示") {
                Toggle("节拍声", isOn: binding(\.sound, fallback: settings.sound, rule: false))
                    .frame(minHeight: 44)
                Toggle("红色时的心跳", isOn: binding(\.heartbeat, fallback: settings.heartbeat, rule: false))
                    .frame(minHeight: 44)
                    .disabled(!settings.sound)
                Toggle("语音播报", isOn: binding(\.speech, fallback: settings.speech, rule: false))
                    .frame(minHeight: 44)
                Toggle("隐藏剩余时间", isOn: binding(\.hiddenRemaining, fallback: settings.hiddenRemaining, rule: false))
                    .frame(minHeight: 44)
                ReaderPanelNote("声音默认关闭，并遵守系统静音设置。语音只提示状态变化；切后台、耳机断连或音频中断会暂停。")
            }
        }
    }

    private func choice(_ title: String, options: [ReaderEdgeOption], selection: Binding<String>, showsChance: Bool = false) -> some View {
        let selected = options.first { $0.id == selection.wrappedValue }
        let label = selected.map { showsChance ? "\($0.label) · \($0.chance ?? 0)%" : $0.label } ?? selection.wrappedValue
        return VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline).foregroundStyle(ReadingSpace.ink)
            Menu {
                Picker(title, selection: selection) {
                    ForEach(options) { option in
                        Text(showsChance ? "\(option.label) · \(option.chance ?? 0)%" : option.label).tag(option.id)
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    Text(label).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.caption).accessibilityHidden(true)
                }
                .multilineTextAlignment(.leading)
            }
            .buttonStyle(ReaderPanelButtonStyle())
            .accessibilityLabel(title)
            .accessibilityValue(label)
        }
    }

    @ViewBuilder
    private func ruleToggle(_ id: String, key: WritableKeyPath<ReaderEdgeSettings, Bool>,
                            settings: ReaderEdgeSettings, catalog: ReaderEdgeCatalog) -> some View {
        if let rule = catalog.rules.first(where: { $0.id == id }) {
            Toggle(isOn: binding(key, fallback: settings[keyPath: key])) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(rule.label)
                    if let summary = rule.summary {
                        Text(summary).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(minHeight: 44)
        }
    }

    @ViewBuilder
    private func presets(_ settings: ReaderEdgeSettings) -> some View {
        ForEach([3, 5, 10, 20], id: \.self) { minutes in
            Button { store.update(\.minutes, minutes) } label: {
                Text("\(minutes) 分钟").font(.subheadline.weight(.medium))
                    .foregroundStyle(settings.minutes == minutes ? ReadingSpace.onSummary : ReadingSpace.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(settings.minutes == minutes ? ReadingSpace.summary : ReadingSpace.profileFill,
                                in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(settings.minutes == minutes ? .isSelected : [])
        }
    }

    @ViewBuilder
    private func optionSummary(_ options: [ReaderEdgeOption], selected: String) -> some View {
        if let summary = options.first(where: { $0.id == selected })?.summary {
            ReaderPanelNote(summary)
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ReaderPanelPage {
            ReaderPanelHeading("本机记录", detail: "只保存在当前设备，按账号隔离，最多保留最近 30 条。")
            if store.authorized {
                if let notice = store.storageNotice {
                    VStack(alignment: .leading, spacing: 12) {
                        ReaderPanelNote(notice, color: AppTheme.warning)
                        Button("重试保存与读取", systemImage: "arrow.clockwise") { store.retryStorage() }
                            .buttonStyle(ReaderPanelButtonStyle())
                    }
                }
                let history = store.data?.history ?? []
                if history.isEmpty {
                    ContentUnavailableView("暂无本机记录", systemImage: "clock",
                                           description: Text("完成或主动结束一局后，记录会保存在这里。"))
                } else {
                    if let totals = store.historyTotals {
                        ReaderEdgeHistorySummary(totals: totals)
                    }
                    ReaderPanelSection("最近记录") {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(Array(history.prefix(visibleCount).enumerated()), id: \.element.id) { index, record in
                                VStack(alignment: .leading, spacing: 8) {
                                    let layout = dynamicTypeSize >= .xxxLarge
                                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
                                    layout {
                                        Text(store.catalog?.endings[record.ending] ?? "本次结束")
                                            .font(serifFont(.headline, .medium))
                                        if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
                                        Text(readerEdgeTime(record.elapsedMs)).font(.subheadline.monospacedDigit())
                                    }
                                    Text(Date(timeIntervalSince1970: record.finishedAt / 1000), format: .dateTime.month().day().hour().minute())
                                        .font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
                                    Text("\(difficulty(record.difficulty)) · \(record.minutes) 分钟 · 申报 \(record.edges) 次")
                                        .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                                    if record.grinds > 0 || record.spent > 0 {
                                        Text("磨着 \(record.grinds) 次 · 兑现 \(record.spent) 点")
                                            .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                                    }
                                    if record.overtime > 0 {
                                        Text("加时 \(record.overtime) 轮").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                                    }
                                }
                                .foregroundStyle(ReadingSpace.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.bottom, 18)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(ReadingSpace.profileLine).frame(height: 1).accessibilityHidden(true)
                                }
                                .accessibilityElement(children: .combine)
                                .readingSpaceEntrance(index)
                            }
                        }
                        .animation(reduceMotion ? nil : AppMotion.state, value: visibleCount)
                        if history.count > visibleCount {
                            Button("再显示 10 条", systemImage: "chevron.down") { visibleCount += 10 }
                                .buttonStyle(ReaderPanelButtonStyle())
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Button("清空本机记录", role: .destructive) { confirmClear = true }
                            .buttonStyle(ReaderPanelButtonStyle())
                            .disabled(!store.canClearHistory)
                        ReaderPanelNote("仅清除当前设备、当前账号的节拍记录，保留设置。")
                    }
                }
            } else {
                ContentUnavailableView("记录已隐藏", systemImage: "lock")
            }
        }
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

private struct ReaderEdgeHistorySummary: View {
    let totals: ReaderEdgeTotals

    var body: some View {
        ReaderPanelSection("最近记录汇总") {
            ReaderPanelFact(title: "总局数", value: "\(totals.sessions)")
            ReaderPanelFact(title: "总申报", value: "\(totals.edges) 次")
            ReaderPanelFact(title: "磨着不停", value: "\(totals.grinds) 次")
            ReaderPanelFact(title: "银行兑现", value: "\(totals.spent) 点")
            ReaderPanelFact(title: "拿到许可", value: "\(totals.permitted) 局")
            ReaderPanelFact(title: "最长坚持", value: readerEdgeTime(totals.longestMs))
        }
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
