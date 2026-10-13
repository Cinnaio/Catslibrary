import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Image as ImageIcon } from 'lucide-react'
import type { Novel } from '@shared/types'
import { novelsApi } from '@/lib/api'
import { useConfirm, useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import CustomSelect from '@/components/admin/CustomSelect'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { useDialogFocus, useDialogHotkeys } from '@/hooks/useDialogHotkeys'

export type ContentRating = 'general' | 'restricted' | 'unknown'

export interface NovelDraft {
  title: string
  author: string
  status: string
  contentRating: ContentRating
  description: string
  coverUrl: string
  categories: string
  sourceUrl: string
}

const EMPTY_DRAFT: NovelDraft = {
  title: '',
  author: '',
  status: 'ongoing',
  contentRating: 'unknown',
  description: '',
  coverUrl: '',
  categories: '',
  sourceUrl: '',
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

const CONTENT_RATING_OPTIONS = [
  { value: 'unknown', label: '未标注（自动初判）' },
  { value: 'general', label: '一般作品' },
  { value: 'restricted', label: '限制级' },
]

function parseCategories(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

interface NovelEditorDialogProps {
  open: boolean
  editing: Novel | null
  existingNovels: Novel[]
  onClose: () => void
  onSaved: () => void
}

export default function NovelEditorDialog({
  open,
  editing,
  existingNovels,
  onClose,
  onSaved,
}: NovelEditorDialogProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [saving, setSaving] = useState(false)

  const [draft, setDraft] = useState<NovelDraft>(() =>
    editing
      ? {
          title: editing.title || '',
          author: editing.author || '',
          status: editing.status || 'ongoing',
          contentRating: (editing.contentRating as ContentRating) || 'unknown',
          description: editing.description || '',
          coverUrl: editing.coverUrl || '',
          categories: (editing.categories || []).join(', '),
          sourceUrl: editing.sourceUrl || '',
        }
      : EMPTY_DRAFT,
  )

  useEffect(() => {
    if (open) {
      setDraft(
        editing
          ? {
              title: editing.title || '',
              author: editing.author || '',
              status: editing.status || 'ongoing',
              contentRating: (editing.contentRating as ContentRating) || 'unknown',
              description: editing.description || '',
              coverUrl: editing.coverUrl || '',
              categories: (editing.categories || []).join(', '),
              sourceUrl: editing.sourceUrl || '',
            }
          : EMPTY_DRAFT,
      )
    }
  }, [open, editing])

  async function handleSave() {
    if (saving) return
    const title = draft.title.trim()
    const author = draft.author.trim()
    const sourceUrl = draft.sourceUrl.trim()
    if (!title || !author) {
      toast('标题和作者为必填项', 'error')
      return
    }

    const dup = existingNovels.find(
      (n) => n.id !== (editing ? editing.id : null) && (n.title === title || (sourceUrl && n.sourceUrl === sourceUrl)),
    )
    if (dup) {
      const ok = await confirm({
        title: '发现重复小说',
        message: '已存在同名小说，仍要继续保存吗？',
        okText: '继续保存',
        danger: false,
        items: [dup.title],
      })
      if (!ok) return
    }

    const data = {
      title,
      author,
      description: draft.description.trim(),
      coverUrl: draft.coverUrl.trim(),
      categories: parseCategories(draft.categories),
      status: draft.status,
      ...(!editing || draft.contentRating !== (editing.contentRating || 'unknown')
        ? { contentRating: draft.contentRating, ...(editing ? { contentRatingRevision: editing.contentRatingRevision || 0 } : {}) }
        : {}),
      sourceUrl,
    }

    setSaving(true)
    try {
      if (editing) {
        await novelsApi.update(editing.id, data)
        toast('小说已更新', 'success')
      } else {
        await novelsApi.create(data)
        toast('小说已创建', 'success')
      }
      onClose()
      onSaved()
    } catch (err) {
      toast('保存失败: ' + ((err as Error).message || '请检查网络和认证令牌'), 'error')
    } finally {
      setSaving(false)
    }
  }

  useDialogHotkeys({ open, onSubmit: handleSave, submitting: saving })
  useDialogFocus(open, '#novel-title')

  const effectiveCover = draft.coverUrl && !/noimg\.jpg/i.test(draft.coverUrl) ? draft.coverUrl : ''

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <AdminDialogContent variant="editor" className="novel-editor-dialog sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="editor-modal__title">{editing ? '编辑小说信息' : '添加新小说'}</DialogTitle>
        </DialogHeader>
        <AdminDialogBody>
          <div className="novel-editor-workbench">
            {/* 左侧：实体书影封面展台 */}
            <div className="novel-editor-sidebar">
              <div className="novel-editor-cover-frame">
                {effectiveCover ? (
                  <img src={effectiveCover} alt={draft.title || '封面预览'} className="novel-editor-cover-img" />
                ) : (
                  <div className="novel-editor-cover-placeholder">
                    <span className="novel-editor-cover-serif-initial">{draft.title ? draft.title.charAt(0) : '书'}</span>
                    <span className="novel-editor-cover-spine" />
                    <span className="novel-editor-cover-meta">{draft.author || '知舟书库'}</span>
                  </div>
                )}
              </div>
              <div className="novel-editor-cover-actions">
                <span className="novel-editor-cover-badge">书影展示</span>
                {editing && (
                  <Link to={`/admin/ai?tab=illustrations&novelId=${encodeURIComponent(editing.id)}`} className="novel-editor-ai-link">
                    <Sparkles className="size-3.5" />
                    AI 绘制新封面
                  </Link>
                )}
              </div>
            </div>

            {/* 右侧：表单网格 */}
            <div className="novel-editor-form-grid">
              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-title">标题</Label>
                <Input
                  id="novel-title"
                  type="text"
                  placeholder="小说标题"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>

              <div className="form-group novel-editor__field">
                <Label htmlFor="novel-author">作者</Label>
                <Input
                  id="novel-author"
                  type="text"
                  placeholder="作者名"
                  value={draft.author}
                  onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                />
              </div>

              <div className="form-group novel-editor__field">
                <Label id="novel-status-label">连载状态</Label>
                <CustomSelect
                  aria-labelledby="novel-status-label"
                  options={STATUS_OPTIONS}
                  value={draft.status}
                  onChange={(v) => setDraft({ ...draft, status: v })}
                />
              </div>

              <div className="form-group novel-editor__field">
                <Label id="novel-rating-label">内容分级</Label>
                <CustomSelect
                  aria-labelledby="novel-rating-label"
                  options={CONTENT_RATING_OPTIONS}
                  value={draft.contentRating}
                  onChange={(v) => setDraft({ ...draft, contentRating: v as ContentRating })}
                />
              </div>

              <div className="form-group novel-editor__field">
                <Label htmlFor="novel-categories">分类标签</Label>
                <Input
                  id="novel-categories"
                  type="text"
                  placeholder="修真, 仙侠, 穿越"
                  value={draft.categories}
                  onChange={(e) => setDraft({ ...draft, categories: e.target.value })}
                />
              </div>

              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-cover-url">来源封面 URL</Label>
                <Input
                  id="novel-cover-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.coverUrl}
                  onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })}
                />
              </div>

              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-source-url">源站网址（可选）</Label>
                <Input
                  id="novel-source-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.sourceUrl}
                  onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                />
              </div>

              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-description">简介内容</Label>
                <Textarea
                  id="novel-description"
                  rows={4}
                  className="min-h-[110px]"
                  placeholder="填写作品简介…"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </div>
          </div>
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
