import SwiftUI

/// 画像内容默认收起，任务进度常显；完整画像、阶段内容与当前注入资格各自表达。
struct AdminAIProfileRow: View {
    let label: String
    let value: String
    let status: String
    let statusNote: String
    let origin: String
    let busy: Bool
    let progress: AiMemoryProgress?
    let task: AiMemoryTask?
    let startedAt: Date?
    let pausing: Bool
    let error: String?
    let disabled: Bool
    let action: () -> Void
    let pause: (() -> Void)?
    let edit: () -> Void
    let empty: String

    @State private var expanded = false
    @State private var showDetails = false

    private var running: Bool {
        if busy { return true }
        if let task { return task.isRunning }
        return progress?.running == true && progress?.paused != true
    }
    private var paused: Bool { !running && (task?.status == "cancelled" || progress?.paused == true) }
    private var failed: Bool { !running && task?.status == "failed" }
    private var usable: Bool { status == "usable" && !value.isEmpty }
    private var total: Int {
        // 新任务刚排队时，进度 GET 可能仍带着上一轮的完整检查点。
        if task?.isRunning == true, (task?.total ?? 0) == 0, progress?.complete == true { return 0 }
        return max(0, progress?.totalChapters ?? task?.total ?? 0)
    }
    private var processed: Int { min(total, max(0, progress?.processedChapters ?? task?.current ?? 0)) }
    private var hasProgress: Bool { progress != nil || task != nil || busy }
    private var tint: Color { failed ? AppTheme.danger : paused ? AppTheme.warning : usable && !running ? AppTheme.success : AppTheme.primary }

    private var stateLabel: String {
        if pausing { return "正在暂停" }
        if running { return task?.status == "queued" ? "等待分析" : "分析中" }
        if failed { return "更新失败" }
        if paused { return "已暂停" }
        if usable { return "✓ 可用于续写" }
        if progress?.complete == false { return "部分完成" }
        return value.isEmpty ? "未提取" : "待更新"
    }

    private var actionLabel: String {
        if failed { return "重试剩余章节" }
        if paused || progress?.complete == false { return "继续分析" }
        return value.isEmpty ? "提取画像" : "更新画像"
    }

    private var step: String {
        if pausing { return "正在暂停，已保存的进度会保留" }
        if task?.status == "queued" { return "任务已提交，等待分析" }
        if running {
            if task?.livePreview?.phase == "thinking" { return "正在梳理章节内容" }
            if let step = task?.step, !step.isEmpty, !step.hasPrefix("已保存 ") { return step }
            if total > processed { return "正在分析剩余章节" }
            return total > 0 ? "正在整理并保存完整档案" : "正在提取画像特征"
        }
        if failed { return "分析未完成，已保存进度保留" }
        if paused { return "进度已保留，可继续分析" }
        if usable { return "完整画像可用于本次续写" }
        if progress?.complete == false { return "完整更新后用于续写" }
        return statusNote
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AppAdaptiveRow {
                Text(label).font(.subheadline.weight(.medium)).foregroundStyle(AppTheme.textPrimary)
                Spacer(minLength: 8)
                Text(stateLabel).font(.caption).foregroundStyle(tint)
            }

            if hasProgress {
                progressContent
            } else if !statusNote.isEmpty && status != "usable" {
                Text(statusNote).font(.caption).foregroundStyle(AppTheme.warning)
            }

            if !running && !value.isEmpty {
                DisclosureGroup(isExpanded: $expanded) {
                    Text(value).font(.caption).foregroundStyle(AppTheme.textSecondary)
                        .textSelection(.enabled)
                } label: {
                    Text("查看画像").font(.caption)
                }
                if !origin.isEmpty {
                    Text(origin).font(.caption2).foregroundStyle(AppTheme.textSecondary)
                }
            } else if !hasProgress && value.isEmpty {
                Text(empty).font(.caption).foregroundStyle(AppTheme.textSecondary)
            }

            if let message = error ?? (failed ? task?.error : nil), !message.isEmpty {
                Text(message).font(.caption).foregroundStyle(AppTheme.danger)
            }

            AppAdaptiveRow {
                if running {
                    if let pause {
                        Button(pausing ? "正在暂停…" : "暂停", action: pause)
                            .disabled(pausing || busy)
                    }
                } else {
                    Button(actionLabel, action: action).disabled(disabled)
                    Spacer(minLength: 12)
                    Button("人工校正", action: edit).disabled(disabled)
                }
            }
            .font(.caption)
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }

    private var progressContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            if total > 0 {
                AppAdaptiveRow {
                    Text("已保存 \(processed) / \(total) 章")
                    Spacer(minLength: 8)
                    Text("\(Int(Double(processed) / Double(total) * 100))%")
                }
                .font(.caption).monospacedDigit().foregroundStyle(AppTheme.textSecondary)
            }
            AdminAIProgressBar(
                fraction: total > 0 ? Double(processed) / Double(total) : nil,
                isRunning: running && !pausing,
                tint: tint,
                label: "\(label)已保存章节进度"
            )
            Text(step).font(.caption).foregroundStyle(AppTheme.textSecondary)
            if running && !usable {
                Text("正在更新，完整保存后用于续写")
                    .font(.caption2).foregroundStyle(AppTheme.textSecondary)
            } else if !running && !usable && progress?.complete != false && !statusNote.isEmpty {
                Text(statusNote).font(.caption2).foregroundStyle(AppTheme.warning)
            }
            if running, let startedAt {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text("已等待 \(max(0, Int(context.date.timeIntervalSince(startedAt)))) 秒")
                        .font(.caption2).monospacedDigit().foregroundStyle(AppTheme.textSecondary)
                }
            }
            if task != nil || progress != nil {
                DisclosureGroup("阶段详情", isExpanded: $showDetails) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("章节分析：\(total > 0 ? "已保存 \(processed) / \(total) 章" : "正在读取进度")")
                        Text("完整档案：\(usable ? (running ? "现有画像仍可使用，新画像更新中" : "可用于续写") : "尚未就绪")")
                        if let preview = task?.livePreview?.preview, !preview.isEmpty {
                            Text("正在生成的内容 · 尚未保存").foregroundStyle(AppTheme.primary)
                            Text(preview).appTextLineLimit(8).textSelection(.enabled)
                        } else if let preview = progress?.previewContent, !preview.isEmpty, !usable {
                            Text("阶段内容 · 尚非完整画像").foregroundStyle(AppTheme.primary)
                            Text(preview).appTextLineLimit(8).textSelection(.enabled)
                        }
                    }
                    .foregroundStyle(AppTheme.textSecondary)
                }
                .font(.caption)
            }
        }
    }
}
