import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiApi, type AiProviderPreset } from '@/lib/api'
import { Button } from '@/components/ui/button'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import styles from './novel-analysis.module.css'

const DEFAULT = '__default__'
export default function AnalysisModelSelect({ value, onChange, disabled = false, active = true, label = '分析模型预设' }: {
  value: string; onChange: (id: string) => void; disabled?: boolean; active?: boolean; label?: string
}) {
  const [presets, setPresets] = useState<AiProviderPreset[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!active) return
    let alive = true
    void Promise.allSettled([aiApi.providerPresets(), aiApi.status()]).then(([saved, current]) => {
      if (!alive) return
      if (saved.status === 'fulfilled') setPresets(saved.value.presets.filter(preset => preset.scope === 'text'))
      if (current.status === 'fulfilled') setDefaultModel(current.value.model)
      setError(saved.status === 'rejected' || current.status === 'rejected'); setLoaded(true)
    })
    return () => { alive = false }
  }, [active, refresh])
  const missing = !!value && !presets.some(preset => preset.id === value)
  const options = [
    { value: DEFAULT, label: '跟随默认', sub: defaultModel || '当前文本服务' },
    ...presets.map(preset => ({ value: preset.id, label: `${preset.name} · ${preset.model}`, disabled: !preset.hasApiKey,
      note: preset.hasApiKey ? undefined : '未配置密钥' })),
    ...(missing ? [{ value, label: loaded ? '原预设不可用，请重新选择' : '正在读取原预设…', disabled: true }] : []),
  ]
  return <div className={styles.modelSelection}>
    <FormField label={label}>
      <SearchSelect value={value || DEFAULT} options={options} onChange={id => onChange(id === DEFAULT ? '' : id)}
        disabled={disabled} placeholder={label} aria-label={label} matchTriggerWidth />
    </FormField>
    <div className={styles.modelHelp}>
      <span>{!loaded ? '正在读取模型…' : error ? '模型列表读取失败。' : '仅用于新建或继续分析。'}</span>
      <Button type="button" variant="link" size="sm" disabled={disabled} onClick={() => setRefresh(version => version + 1)} aria-label={`刷新${label}`}>刷新</Button>
      <Link to="/admin/ai?sub=config">管理预设</Link>
    </div>
  </div>
}
