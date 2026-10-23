import { useEffect, useState } from 'react'
import { aiApi, type AiProviderConfig, type AiProviderPreset } from '@/lib/api'
import { useToast } from '@/components/feedback'
import AdminFormField from '@/components/admin/AdminFormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  scope: 'text' | 'image'
  draft: { baseUrl: string; model: string; apiKey: string }
  config: AiProviderConfig | null
  disabled: boolean
  dirty: boolean
  onApplied: () => void
  onBusy: (busy: boolean) => void
}

export default function AiProviderPresets({ scope, draft, config, disabled, dirty, onApplied, onBusy }: Props) {
  const { toast } = useToast()
  const [presets, setPresets] = useState<AiProviderPreset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'new' | 'copy' | 'edit' | 'delete' | null>(null)
  const [editor, setEditor] = useState({ name: '', baseUrl: '', model: '', apiKey: '' })
  const [copyCurrentKey, setCopyCurrentKey] = useState(false)
  const [reload, setReload] = useState(0)
  const label = scope === 'text' ? '文本' : '图像'
  const selected = presets.find((p) => p.id === selectedId)
  const locked = disabled || busy || loading

  useEffect(() => {
    let alive = true
    aiApi
      .providerPresets()
      .then(({ presets: all }) => {
        if (!alive) return
        setLoadError(false)
        const rows = all.filter((p) => p.scope === scope)
        setPresets(rows)
        setSelectedId(rows.find((p) => p.active)?.id || rows[0]?.id || '')
      })
      .catch((err: Error) => {
        if (alive) {
          setLoadError(true)
          toast(err.message || '加载端点预设失败', 'error')
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [scope, toast, reload, config])

  function openEditor(mode: 'new' | 'copy' | 'edit') {
    if (mode === 'edit' && selected) {
      setEditor({ name: selected.name, baseUrl: selected.baseUrl, model: selected.model, apiKey: '' })
      setCopyCurrentKey(false)
    } else if (mode === 'copy') {
      const useStoredKey = draft.apiKey === '••••••••' || !draft.apiKey
      setEditor({ name: '', baseUrl: draft.baseUrl, model: draft.model, apiKey: useStoredKey ? '' : draft.apiKey })
      setCopyCurrentKey(useStoredKey)
    } else {
      setEditor({ name: '', baseUrl: '', model: '', apiKey: '' })
      setCopyCurrentKey(false)
    }
    setDialog(mode)
  }

  async function act(action: 'save' | 'delete' | 'activate') {
    if (locked) return
    setBusy(true)
    onBusy(true)
    try {
      let result: { presets: AiProviderPreset[] }
      if (action === 'save') {
        result = await aiApi.saveProviderPreset(
          {
            scope,
            name: editor.name.trim(),
            baseUrl: editor.baseUrl.trim(),
            model: editor.model.trim(),
            ...(editor.apiKey.trim() ? { apiKey: editor.apiKey.trim() } : {}),
            ...(dialog === 'copy' && copyCurrentKey && !editor.apiKey.trim() ? { copyCurrentKey: true } : {}),
          },
          dialog === 'edit' ? selectedId : undefined,
        )
      } else if (action === 'delete') {
        result = await aiApi.deleteProviderPreset(selectedId)
      } else {
        result = await aiApi.activateProviderPreset(selectedId)
      }
      const rows = result.presets.filter((p) => p.scope === scope)
      setPresets(rows)
      setSelectedId(
        action === 'save'
          ? rows.find((p) => p.name === editor.name.trim())?.id || ''
          : action === 'delete'
            ? rows.find((p) => p.active)?.id || rows[0]?.id || ''
            : selectedId,
      )
      setDialog(null)
      setEditor({ name: '', baseUrl: '', model: '', apiKey: '' })
      toast(action === 'save' ? '端点预设已保存' : action === 'delete' ? '端点预设已删除' : `已应用${label}端点「${selected?.name}」`, 'success')
      if (action === 'activate') onApplied()
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-44 flex-1">
          <AdminFormField label="已保存端点" htmlFor={`ai-${scope}-preset`}>
            <select
              id={`ai-${scope}-preset`}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedId}
              disabled={locked || loadError}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">{loading ? '加载中…' : loadError ? '加载失败' : '选择端点预设'}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? ' · 当前使用' : ''}
                </option>
              ))}
            </select>
          </AdminFormField>
        </div>
        {loadError ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || loading}
            onClick={() => {
              setLoading(true)
              setReload((v) => v + 1)
            }}
          >
            重新加载
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => openEditor('new')}>
              新增
            </Button>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => openEditor('copy')}>
              保存当前为预设
            </Button>
          </>
        )}
      </div>
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 break-all text-xs text-muted-foreground">
            {selected.baseUrl} · {selected.model}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => openEditor('edit')}>
              编辑
            </Button>
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => setDialog('delete')}>
              删除
            </Button>
            <Button size="sm" disabled={locked || dirty} onClick={() => void act('activate')}>
              应用此端点
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {dirty ? '请先保存或撤销下方配置的修改，再应用其他端点。' : '选择后点击应用才会切换；保存或编辑预设不会改变当前服务。'}
      </p>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null)
            setEditor({ name: '', baseUrl: '', model: '', apiKey: '' })
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'delete' ? '删除端点预设' : `${dialog === 'edit' ? '编辑' : '保存'}${label}端点`}</DialogTitle>
            <DialogDescription>
              {dialog === 'delete' ? `删除「${selected?.name}」仅移除预设，当前服务配置继续有效。` : '保存名称、接口地址、模型和密钥，方便下次切换。'}
            </DialogDescription>
          </DialogHeader>
          {dialog !== 'delete' && (
            <form
              id={`ai-${scope}-preset-form`}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void act('save')
              }}
            >
              <AdminFormField label="预设名称" htmlFor={`preset-${scope}-name`}>
                <Input
                  id={`preset-${scope}-name`}
                  required
                  maxLength={80}
                  disabled={busy}
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="例如：自建 NewAPI"
                />
              </AdminFormField>
              <AdminFormField label="接口地址" htmlFor={`preset-${scope}-url`}>
                <Input
                  id={`preset-${scope}-url`}
                  type="url"
                  required
                  maxLength={2048}
                  disabled={busy}
                  value={editor.baseUrl}
                  onChange={(e) => setEditor({ ...editor, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </AdminFormField>
              <AdminFormField label="模型名称" htmlFor={`preset-${scope}-model`}>
                <Input
                  id={`preset-${scope}-model`}
                  required
                  maxLength={200}
                  disabled={busy}
                  value={editor.model}
                  onChange={(e) => setEditor({ ...editor, model: e.target.value })}
                />
              </AdminFormField>
              <AdminFormField
                label="密钥"
                htmlFor={`preset-${scope}-key`}
                hint={dialog === 'edit' ? '留空保留此预设原有密钥。' : copyCurrentKey ? '留空使用当前服务已保存的密钥。' : '密钥仅保存在服务端。'}
              >
                <Input
                  id={`preset-${scope}-key`}
                  type="password"
                  autoComplete="new-password"
                  required={dialog !== 'edit' && !copyCurrentKey}
                  disabled={busy}
                  value={editor.apiKey}
                  onChange={(e) => setEditor({ ...editor, apiKey: e.target.value })}
                />
              </AdminFormField>
            </form>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDialog(null)
                setEditor({ name: '', baseUrl: '', model: '', apiKey: '' })
              }}
            >
              取消
            </Button>
            {dialog === 'delete' ? (
              <Button variant="destructive" disabled={busy} onClick={() => void act('delete')}>
                确认删除
              </Button>
            ) : (
              <Button type="submit" form={`ai-${scope}-preset-form`} disabled={busy}>
                {busy ? '保存中…' : '保存预设'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
