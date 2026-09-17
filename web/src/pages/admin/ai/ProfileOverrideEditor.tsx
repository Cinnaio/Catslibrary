/**
 * 人工画像校正：在自动画像之上叠加一层人工修订。
 *
 * 这一层的语义容易误解，UI 必须如实表达：
 * - 人工层**绑定**在某个自动画像版本上（baseProfileRevision）。自动画像一变，
 *   人工层不是被删掉，而是被后端**跳过**（effectiveOrigin 退回 automatic，并给出
 *   exclusionReason）。所以保存前若自动画像已更新，后端会 409；界面要说明这回事，
 *   而不是让操作者以为「点了保存就一定生效」。
 * - 「已保存」不等于「正在生效」：只有 effectiveOrigin === 'manual' 才是真的在用。
 *   两者必须分开显示，否则会出现「我明明改了却没生效」的困惑。
 */
import { useState } from 'react'
import { aiApi, newOperationId, type AiEffectiveProfile, type AiProfileKind, type ApiError } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { CircleAlert, Loader2 } from 'lucide-react'

const KIND_LABELS: Record<AiProfileKind, string> = {
  style: '风格画像',
  plot: '情节状态',
  relationship: '关系画像',
}

/** 人工层被跳过的原因 → 给操作者看得懂的解释。 */
const EXCLUSION_REASONS: Record<string, string> = {
  base_changed: '自动画像在保存后已重新提取，校正已停用。请核对新画像后重新保存。',
  source_changed: '自动画像的取样来源变了（例如起点章节不同），校正已停用。',
  empty: '校正内容为空，已退回自动画像。',
  automatic_missing: '当前没有可用的自动画像，校正无处挂靠。',
  automatic_stale: '自动画像已落后于最新章节，校正暂不生效。',
  automatic_beyond_anchor: '自动画像取自起点之后的章节，不适用于当前起点。',
  automatic_legacy_unknown: '自动画像来源不明（旧数据），校正暂不生效。',
  automatic_source_changed: '自动画像的取样来源已变化，校正暂不生效。',
}

function exclusionText(reason?: string): string {
  if (!reason) return ''
  if (EXCLUSION_REASONS[reason]) return EXCLUSION_REASONS[reason]
  if (reason.startsWith('automatic_')) return '自动画像当前不可用，校正暂不生效。'
  return '校正当前未生效。'
}

export default function ProfileOverrideEditor(props: {
  novelId: string
  kind: AiProfileKind
  /** 上一次读取的完整回包；人工层的修订号与基准版本都从这里取 */
  effective: AiEffectiveProfile
  /** 保存/删除成功后让父级重读画像 */
  onChanged: () => void
  disabled?: boolean
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const override = props.effective.manualOverride
  const active = props.effective.effectiveOrigin === 'manual'
  const label = KIND_LABELS[props.kind]
  // 自动层不可用时后端会直接 422 拒绝保存，故提前禁用并说明，别让操作者白填
  const canBind = props.effective.eligibility === 'usable'

  async function save() {
    const content = draft.trim()
    if (!content) {
      toast('校正内容不能为空', 'error')
      return
    }
    setBusy(true)
    const operationId = newOperationId(`ai-profile-${props.kind}-override`)
    try {
      await aiApi.writing.saveProfileOverride(props.novelId, props.kind, {
        content,
        // 没有人工层时修订号是 0；有则是当前修订号
        expectedRevision: override?.revision ?? 0,
        baseProfileRevision: props.effective.baseProfileRevision,
        operationId,
      })
      toast(`${label}校正已保存并生效`, 'success')
      setEditing(false)
      props.onChanged()
    } catch (err) {
      const status = (err as ApiError).status
      if (status === 409) {
        toast('自动画像或校正已被其他操作改变，已为你刷新，请核对后重新保存', 'error')
        props.onChanged()
      } else {
        toast((err as Error).message || '保存校正失败', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `删除${label}校正？`,
      message: '删除后该画像回到自动提取的内容，人工修订不可恢复。',
      okText: '删除校正',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await aiApi.writing.deleteProfileOverride(props.novelId, props.kind, {
        expectedRevision: override?.revision ?? 0,
        operationId: newOperationId(`ai-profile-${props.kind}-override-delete`),
      })
      toast(`已删除${label}校正，回到自动画像`, 'success')
      setEditing(false)
      props.onChanged()
    } catch (err) {
      if ((err as ApiError).status === 409) {
        toast('校正已被其他管理员修改，已为你刷新', 'error')
        props.onChanged()
      } else {
        toast((err as Error).message || '删除校正失败', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--admin-inset)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">人工校正</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {override ? (
            active ? (
              <span className="rounded-full border border-[var(--color-success)]/35 bg-[var(--color-success)]/10 px-2 py-0.5 text-[11px] text-[var(--color-success)]">
                校正生效中 · 版本 {override.revision}
              </span>
            ) : (
              <span className="rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[11px] text-[var(--color-warning)]">
                校正已保存但未生效
              </span>
            )
          ) : (
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
              未校正 · 使用自动画像
            </span>
          )}
        </span>
      </div>

      {override && !active && (
        <p className="flex items-start gap-1.5 text-[0.72rem] leading-relaxed text-[var(--color-warning)]">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{exclusionText(props.effective.exclusionReason)}</span>
        </p>
      )}

      {editing ? (
        <div className="grid gap-2">
          <Label htmlFor={`profile-override-${props.kind}`} className="text-xs">
            校正内容（保存后整段替换自动画像）
          </Label>
          <Textarea
            id={`profile-override-${props.kind}`}
            className="min-h-[10rem] field-sizing-fixed resize-y text-sm leading-6 shadow-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`在自动画像基础上修订${label}；保存后这段内容会整段替换自动画像用于续写。`}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.7rem] text-muted-foreground">
              自动画像更新后，本校正会自动停用（可重新读取后再保存）
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void save()}>
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    保存中
                  </>
                ) : (
                  '保存校正'
                )}
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
            {props.effective.effectiveOrigin === 'manual'
              ? '续写正在使用这段人工校正。'
              : props.effective.effectiveOrigin === 'automatic'
                ? '续写使用自动提取的画像；如需局部修订可另存人工校正。'
                : '当前没有可用的画像内容；先提取一次，再考虑人工校正。'}
          </p>
          <span className="flex gap-1.5">
            {override && (
              <Button size="sm" variant="outline" disabled={busy || props.disabled} onClick={() => void remove()}>
                删除校正
              </Button>
            )}
            <Button
              size="sm"
              variant={active ? 'outline' : 'default'}
              disabled={busy || props.disabled || !canBind}
              title={canBind ? undefined : '当前没有可绑定的自动画像，无法保存校正'}
              onClick={() => {
                // 以当前生效内容为起点：校正生效中则接着改校正，否则以自动画像为底
                setDraft(props.effective.effectiveContent)
                setEditing(true)
              }}
            >
              {override ? '编辑校正' : '人工校正'}
            </Button>
          </span>
        </div>
      )}

      {!canBind && !editing && (
        <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
          当前自动画像不可用，人工校正无处挂靠：请先提取或重新提取该画像。
        </p>
      )}
    </div>
  )
}
