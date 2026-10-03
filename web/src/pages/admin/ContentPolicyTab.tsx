import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '@/lib/api'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useConfirm, useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export default function ContentPolicyTab() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { refreshPolicy } = useContentPolicy()
  const [adultContentEnabled, setAdultContentEnabled] = useState(false)
  const [turnstileConfigured, setTurnstileConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const settings = await adminApi.contentPolicy.settings()
      setAdultContentEnabled(settings.adultContentEnabled)
      setTurnstileConfigured(Boolean(settings.turnstileConfigured))
    } catch (err) {
      toast((err as Error).message || '内容安全设置加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function updateAdultContent(enabled: boolean) {
    if (!enabled) {
      const confirmed = await confirm({
        title: '关闭成人内容模式',
        message: '关闭后，所有读者都会被强制切回安全模式，限制级作品不再显示。',
        items: ['前台的成人模式切换入口会隐藏', '已选择成人模式的读者将在下次配置刷新时回到安全模式'],
        okText: '关闭模式',
        danger: true,
      })
      if (!confirmed) return
    }

    setSaving(true)
    try {
      const settings = await adminApi.contentPolicy.update(enabled)
      setAdultContentEnabled(settings.adultContentEnabled)
      await refreshPolicy()
      toast(settings.adultContentEnabled ? '成人内容模式已启用' : '成人内容模式已关闭', 'success')
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--content-policy"
      title="内容安全"
      description="控制读者是否可以主动切换并查看限制级内容。"
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || saving}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <Card className="admin-panel-card content-policy-panel">
        <CardHeader>
          <CardTitle>成人内容模式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="content-policy-row">
            <label htmlFor="adult-content-enabled" className="content-policy-row__copy">
              <span className="content-policy-row__label">允许读者切换成人内容模式</span>
              <span className="content-policy-row__hint">关闭时隐藏前台入口，并过滤被识别为限制级的作品与分类。</span>
            </label>
            <Switch
              id="adult-content-enabled"
              checked={adultContentEnabled}
              disabled={loading || saving}
              onCheckedChange={(enabled) => void updateAdultContent(enabled)}
            />
          </div>
          <p className="content-policy-status" role="status">
            {loading
              ? '正在读取站点内容策略…'
              : saving
                ? '正在保存…'
                : adultContentEnabled
                  ? '读者仍默认处于安全模式，需自行确认后才能查看限制级内容。'
                  : '成人内容模式已全站关闭，读者无法解除限制。'}
          </p>
          <p className="content-policy-status">Turnstile：{turnstileConfigured ? '已配置' : '尚未配置，成人验证不会放行'}。<Link to="/admin/site-settings?view=security">前往安全验证配置</Link></p>
        </CardContent>
      </Card>
    </AdminPage>
  )
}
