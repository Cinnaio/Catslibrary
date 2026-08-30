import Foundation
import SwiftUI

/// 管理后台需要二次确认的高风险操作。动作枚举集中维护，避免新增入口时
/// 各自发明确认状态、请求标识和目标读取时机。
enum AdminDangerousAction: String {
    case batchDeleteAIGenerations = "ai-generations.batch-delete"
    case batchDeleteScrapeSources = "scrape-sources.batch-delete"
    case deleteUnreachableScrapeSources = "scrape-sources.delete-unreachable"
    case clearCompletedScrapeJobs = "scrape-jobs.clear-completed"
    case clearInvites = "admin-users.clear-invites"
    case terminateAITask = "ai-tasks.terminate"
    case terminateScrapeJob = "scrape-jobs.terminate"
    case adoptCoverCandidate = "ai-cover.adopt-candidate"
    case uploadCover = "ai-cover.upload"
    case replaceSourceMetadata = "source-sync.replace-metadata"
    case importScrapeConfigs = "scrape-configs.import"
    case importLegadoSources = "scrape-sources.import-legado"
}

enum AdminDangerousOperationKind: String {
    case batchDelete
    case terminate
    case overwrite
}

/// 点击危险入口时立即创建一次，并在确认、执行和 API 请求之间原样传递。
/// `targetIDs` 同时冻结确认时的目标，避免列表刷新或选择变化后误操作别的对象。
struct AdminDangerousOperation: Identifiable {
    let operationID: String
    let action: AdminDangerousAction
    let kind: AdminDangerousOperationKind
    let targetIDs: [String]
    let title: String
    let message: String
    let confirmLabel: String

    var id: String { operationID }

    init(
        action: AdminDangerousAction,
        kind: AdminDangerousOperationKind,
        targetIDs: [String],
        title: String,
        message: String,
        confirmLabel: String,
        operationID: String? = nil
    ) {
        self.operationID = operationID
            ?? "\(action.rawValue).\(UUID().uuidString.lowercased())"
        self.action = action
        self.kind = kind
        self.targetIDs = targetIDs
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
    }
}

private struct AdminDangerousOperationConfirmationModifier: ViewModifier {
    @Binding var operation: AdminDangerousOperation?
    let onConfirm: (AdminDangerousOperation) -> Void
    let onCancel: (AdminDangerousOperation) -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            operation?.title ?? "确认操作",
            isPresented: Binding(
                get: { operation != nil },
                set: { if !$0 { operation = nil } }
            ),
            titleVisibility: .visible,
            presenting: operation
        ) { presented in
            Button(presented.confirmLabel, role: .destructive) {
                operation = nil
                onConfirm(presented)
            }
            Button("取消", role: .cancel) {
                operation = nil
                onCancel(presented)
            }
        } message: { presented in
            Text(presented.message)
        }
    }
}

extension View {
    func adminDangerousOperationConfirmation(
        _ operation: Binding<AdminDangerousOperation?>,
        onConfirm: @escaping (AdminDangerousOperation) -> Void,
        onCancel: @escaping (AdminDangerousOperation) -> Void = { _ in }
    ) -> some View {
        modifier(AdminDangerousOperationConfirmationModifier(
            operation: operation,
            onConfirm: onConfirm,
            onCancel: onCancel
        ))
    }
}

/// 后台列表中统一使用的轻量状态标签。
struct AdminStatusBadge: View {
    let title: String
    let tint: Color
    var systemImage: String?

    init(_ title: String, tint: Color, systemImage: String? = nil) {
        self.title = title
        self.tint = tint
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage ?? "circle.fill")
                .font(.system(size: systemImage == nil ? 6 : 9, weight: .semibold))
            Text(title)
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tint.opacity(0.13), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// 用于替换正在执行操作的菜单或按钮，避免后台操作看起来像“没有响应”。
struct AdminInlineProgress: View {
    var body: some View {
        ProgressView()
            .controlSize(.small)
            .frame(width: 32, height: 32)
            .accessibilityLabel("处理中")
    }
}

/// 管理后台统一的紧凑筛选横条：多个筛选条件共享一行，超出窄屏时可横向滚动。
struct AdminFilterBar<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

/// 管理后台统一的筛选菜单按钮：保留原生 Menu 行为，视觉上收敛为轻量胶囊。
struct AdminFilterMenu<Content: View>: View {
    let title: String
    let value: String
    private let content: Content

    init(_ title: String, value: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.value = value
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            HStack(spacing: 6) {
                Text("\(title) · \(value)")
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(AppTheme.textPrimary)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(AppTheme.surface, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(AppTheme.border, lineWidth: 1)
            )
        }
        .accessibilityLabel(title)
        .accessibilityValue(value)
    }
}
