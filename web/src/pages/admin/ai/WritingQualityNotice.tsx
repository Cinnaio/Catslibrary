import type { WritingQualityReport } from '@shared/ai-writing-quality'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'

export default function WritingQualityNotice({ quality }: { quality?: WritingQualityReport }) {
  if (!quality?.warnings.length) return null
  return (
    <aside aria-label="生成质量提示" className="shrink-0 rounded-lg border border-admin-border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">发布前请检查</p>
        <AdminStatusBadge tone="warning">{quality.warnings.length} 项提示</AdminStatusBadge>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {quality.warnings.map((warning) => (
          <li key={warning.code}>{warning.message}</li>
        ))}
      </ul>
      {quality.editedSinceGeneration && <p className="mt-2 text-muted-foreground">正文已修改，篇幅按当前草稿检查；上游结束状态保留原始生成记录。</p>}
    </aside>
  )
}
