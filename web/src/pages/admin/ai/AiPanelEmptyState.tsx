/**
 * AiPanelEmptyState — AI 服务各面板的空态。
 *
 * 该面板族的空态有两种语义完全不同的成因，此前一律渲染同一句话，用户无法判断
 * 究竟该「等数据」还是「去配置」：
 *   1. 未配置：文本供应商没配好，AI 功能根本不可用 —— 空是因为做不了，
 *      应给出指向 AI 配置页的动作；
 *   2. 无数据：配置正常，只是该范围内确实没有记录 —— 空是结果本身，
 *      给动作反而误导（点过去也没有更多可做的）。
 *
 * 两者还必须在视觉上可区分（图标 + 色调），否则读屏与视觉用户都要靠读文字才能
 * 分辨，属于审计 P3「空状态缺少引导与层级」的实质问题。
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Settings2 } from 'lucide-react'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { Button } from '@/components/ui/button'
import { adminTabPath } from '../admin-registry'

interface AiPanelEmptyStateProps {
  /** 未配置时显示的话术，例如「尚未配置 AI 供应商，用量统计不可用」 */
  unconfiguredMessage: string
  /** 已配置但无数据时显示的话术 */
  emptyMessage: string
  /** 供应商是否已配置；undefined 表示调用方还没拿到该信息，按无数据处理 */
  configured?: boolean
  /** 无数据时的自定义图标（默认收件箱） */
  icon?: ReactNode
  /** 无数据时追加的说明 */
  hint?: string
  /** 未配置时按钮下方的说明；各面板语义不同，不共用一句话 */
  unconfiguredHint?: string
}

export default function AiPanelEmptyState({
  unconfiguredMessage,
  emptyMessage,
  configured,
  icon,
  hint,
  unconfiguredHint = '配置文本供应商后，这里会显示数据。',
}: AiPanelEmptyStateProps) {
  if (configured === false) {
    return (
      <AdminEmptyState
        message={unconfiguredMessage}
        icon={<Settings2 className="size-8 text-primary/60" aria-hidden="true" />}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`${adminTabPath('ai')}?sub=config`}>前往 AI 配置</Link>
            </Button>
            <p className="text-xs text-muted-foreground">{unconfiguredHint}</p>
          </div>
        }
      />
    )
  }

  return (
    <AdminEmptyState
      message={emptyMessage}
      icon={icon ?? <Inbox className="size-8 opacity-40" aria-hidden="true" />}
      action={hint ? <p className="text-xs text-muted-foreground">{hint}</p> : undefined}
    />
  )
}
