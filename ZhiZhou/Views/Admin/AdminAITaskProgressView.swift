import SwiftUI

/// AI 任务的统一进度卡：优先展示真实阶段与 current/total，没有可靠百分比时使用不确定进度。
struct AdminAITaskProgressView: View {
    let task: AiTaskInfo
    var compact = false
    var showsPromptPreview = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: task.isRunning ? 1 : 60)) { context in
            VStack(alignment: .leading, spacing: compact ? 7 : 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Label {
                        Text(AdminFormat.aiTaskKind(task.kind ?? ""))
                    } icon: {
                        Image(systemName: taskIcon)
                    }
                    .font(compact ? .subheadline.weight(.medium) : .headline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)

                    Spacer(minLength: 8)

                    AdminStatusBadge(
                        AdminFormat.aiTaskStatus(task.status ?? ""),
                        tint: statusTint,
                        systemImage: statusIcon
                    )
                }

                HStack(spacing: 8) {
                    Text(progressLabel)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    if let elapsed = elapsedLabel(at: context.date) {
                        Label(elapsed, systemImage: "clock")
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)

                progressIndicator

                if !displayStep.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 5, weight: .bold))
                            .padding(.top, 5)
                        Text(displayStep)
                            .lineLimit(compact ? 2 : 3)
                            .multilineTextAlignment(.leading)
                    }
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                }

                if let error = task.error?.trimmingCharacters(in: .whitespacesAndNewlines), !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .lineLimit(compact ? 2 : 4)
                }

                if showsPromptPreview, let prompt = promptPreview {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("实时生成内容")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                        Text(prompt)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .lineLimit(compact ? 2 : 4)
                            .lineSpacing(2)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
        .padding(.vertical, compact ? 2 : 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var progressIndicator: some View {
        Group {
            if let fraction = progressFraction {
                ProgressView(value: fraction, total: 1)
            } else if task.isRunning {
                ProgressView()
            } else {
                ProgressView(value: 0, total: 1)
            }
        }
        .progressViewStyle(.linear)
        .tint(statusTint)
    }

    private var progressFraction: Double? {
        if task.status == "completed" { return 1 }
        guard let total = task.total, total > 0, let current = task.current else { return nil }
        if task.isRunning && current <= 0 { return nil }
        return min(1, max(0, Double(current) / Double(total)))
    }

    private var progressLabel: String {
        guard let total = task.total, total > 0, let current = task.current else {
            return AdminFormat.aiTaskStatus(task.status ?? "")
        }
        let safeCurrent = min(total, max(0, current))
        if task.status == "completed" {
            return "已完成 \(safeCurrent)/\(total)"
        }
        return "\(safeCurrent)/\(total)"
    }

    private var displayStep: String {
        let step = task.step?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !step.isEmpty else {
            return task.isRunning ? "正在处理…" : AdminFormat.aiTaskStatus(task.status ?? "")
        }
        // 服务端会在失败诊断中把 prompt 放进 step；进度卡只保留用户需要知道的阶段。
        if step.hasPrefix("正在生成封面（prompt：") {
            return "正在调用图像模型"
        }
        return step
    }

    private var promptPreview: String? {
        guard let prompt = task.prompt?.trimmingCharacters(in: .whitespacesAndNewlines),
              !prompt.isEmpty,
              prompt != "生成封面描述词" else { return nil }
        return prompt
    }

    private var taskIcon: String {
        switch task.kind ?? "" {
        case "cover", "cover_prompt": return "photo.on.rectangle.angled"
        case "continue": return "arrow.triangle.2.circlepath"
        case "write_outline": return "list.bullet.rectangle"
        case "write_chapter": return "book.closed"
        default: return "sparkles"
        }
    }

    private var statusIcon: String {
        switch task.status ?? "" {
        case "queued": return "clock"
        case "running": return "sparkles"
        case "completed": return "checkmark"
        case "failed": return "exclamationmark.triangle"
        case "cancelled": return "xmark"
        default: return "circle"
        }
    }

    private var statusTint: Color {
        switch task.status ?? "" {
        case "completed": return AppTheme.success
        case "failed", "cancelled": return AppTheme.danger
        case "queued", "running": return AppTheme.primary
        default: return AppTheme.textSecondary
        }
    }

    private func elapsedLabel(at now: Date) -> String? {
        guard let createdAt = task.createdAt, createdAt > 0 else { return nil }
        let endAt: Int64
        if task.isRunning {
            endAt = Int64(now.timeIntervalSince1970 * 1000)
        } else {
            endAt = task.finishedAt ?? task.updatedAt ?? createdAt
        }
        let seconds = max(0, Int((endAt - createdAt) / 1000))
        let value: String
        if seconds < 60 {
            value = "\(seconds) 秒"
        } else if seconds < 3600 {
            value = "\(seconds / 60) 分 \(seconds % 60) 秒"
        } else {
            value = "\(seconds / 3600) 小时 \(seconds % 3600 / 60) 分"
        }
        return task.isRunning ? "已用 \(value)" : "用时 \(value)"
    }

    private var accessibilitySummary: String {
        [
            AdminFormat.aiTaskKind(task.kind ?? ""),
            AdminFormat.aiTaskStatus(task.status ?? ""),
            progressLabel,
            displayStep,
        ].joined(separator: "，")
    }
}
