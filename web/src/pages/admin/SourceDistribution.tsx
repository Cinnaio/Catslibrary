import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FOLLOWUP_LABELS, SOURCE_LABELS, type FollowupCategory, type SourceAnalyticsResponse, type SourceCategory } from '@shared/source-analytics'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import EmptyState from '@/components/shared/EmptyState'
import SearchSelect from '@/components/shared/SearchSelect'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import styles from './source-analytics.module.css'

export type SourceBookFilter = FollowupCategory | 'attention'

interface SourceDistributionProps {
  data: SourceAnalyticsResponse
  view: string
  loading: boolean
  onViewChange: (view: string) => void
  onSelectBooks: (site: string, category?: SourceBookFilter, source?: SourceCategory) => void
}

const n = (value: number) => value.toLocaleString('zh-CN')
const percentage = (count: number, total: number) => `${((count / Math.max(total, 1)) * 100).toFixed(1)}%`
const siteLabel = (site: string) => site === '__none__' ? '无有效来源' : site

const columns: readonly AdminColumn[] = [
  { key: 'site', label: '源站', primary: true },
  { key: 'total', label: '作品数 / 占比', width: '18%' },
  { key: 'configured', label: '配置完整', width: '12%' },
  { key: 'enabled', label: '已开启追更', width: '14%' },
  { key: 'attention', label: '待处理', width: '18%' },
  { key: 'actions', label: '操作', width: '13rem', actions: true },
]

export default function SourceDistribution({ data, view, loading, onViewChange, onSelectBooks }: SourceDistributionProps) {
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set())
  const groups = [...data.groups].sort((a, b) => b.attention - a.attention || b.total - a.total || a.site.localeCompare(b.site))
  const changingView = data.view !== view

  function toggleSite(site: string) {
    setExpandedSites((current) => {
      const next = new Set(current)
      if (next.has(site)) next.delete(site)
      else next.add(site)
      return next
    })
  }

  return (
    <div className={styles.distribution} aria-busy={loading}>
      <div className={styles.scopeBar}>
        <SearchSelect
          aria-label="来源统计口径"
          compact
          className={styles.scopeSelect}
          matchTriggerWidth
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'primary', label: '主要来源 · 每本书计一次' },
            { value: 'all', label: '全部来源 · 按站点去重' },
          ]}
        />
        <span className={styles.snapshot} role="status">
          {changingView
            ? loading ? '正在更新统计口径…' : '口径尚未更新，以下保留上次统计'
            : <>统计于 <time dateTime={new Date(data.snapshotAt).toISOString()}>{formatDateTime(data.snapshotAt)}</time></>}
        </span>
      </div>

      <dl className={styles.overview}>
        <div>
          <dt>全库作品</dt>
          <dd>{n(data.total)}<span>本</span></dd>
        </div>
        <div>
          <dt>有效来源覆盖</dt>
          <dd>{n(data.withSource)}<span>{percentage(data.withSource, data.total)}</span></dd>
        </div>
        <div>
          <dt>已开启追更</dt>
          <dd>{n(data.followups.enabled)}<span>{percentage(data.followups.enabled, data.total)}</span></dd>
        </div>
        <div>
          <dt>待处理作品</dt>
          <dd>
            {data.attention > 0 ? (
              <Button variant="link" size="sm" className={styles.attentionMetric} disabled={changingView} aria-label={`查看全部 ${n(data.attention)} 本待处理作品`} onClick={() => onSelectBooks('', 'attention')}>
                {n(data.attention)}<span>本 · 查看作品</span>
              </Button>
            ) : <>0<span>暂无待处理项</span></>}
          </dd>
        </div>
      </dl>

      <div className={styles.ledgerHeading}>
        <h2>源站账本</h2>
        <span>按待处理数量优先排列 · {n(groups.length)} 个来源分组</span>
      </div>
      <AdminDataPanel ariaLabel="源站账本" columns={columns} density="compact">
        {!groups.length ? (
          <EmptyState message={data.total ? '暂无站点统计数据' : '书库还是空的'} hint="添加作品并配置来源后，可在这里查看来源分布与追更覆盖。" />
        ) : (
          <Table className={cn('admin-data-table admin-data-table--animated', changingView && 'admin-data-table--transitioning')}>
            <TableHeader>
              <TableRow>
                {columns.map((column) => <TableHead key={column.key} className={column.actions ? 'text-right' : undefined}>{column.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group, index) => {
                const label = siteLabel(group.site)
                const expanded = expandedSites.has(group.site)
                const detailId = `source-breakdown-${encodeURIComponent(group.site)}`
                return (
                  <Fragment key={group.site}>
                    <TableRow style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, groups.length)}ms` }}>
                      <TableCell data-primary="" data-label="源站">
                        <div className={styles.siteIdentity}>
                          <Button variant="link" size="sm" className={styles.siteName} title={group.site === '__none__' ? '缺少有效 HTTP/HTTPS 来源' : label} disabled={changingView} onClick={() => onSelectBooks(group.site)}>{label}</Button>
                        </div>
                      </TableCell>
                      <TableCell data-label="作品数 / 占比">
                        <span className="tabular-nums">{n(group.total)} 本 <span className={styles.share}>{percentage(group.total, data.total)}</span></span>
                      </TableCell>
                      <TableCell data-label="配置完整">
                        <div className={styles.siteMetric}>
                          <Button variant="link" size="sm" className={styles.metricButton} disabled={changingView || !group.configured} aria-label={`${label}：配置完整 ${group.configured} 本`} onClick={() => onSelectBooks(group.site, undefined, 'configured')}>{n(group.configured)} 本</Button>
                        </div>
                      </TableCell>
                      <TableCell data-label="已开启追更">
                        <div className={styles.siteMetric}>
                          <Button variant="link" size="sm" className={styles.metricButton} disabled={changingView || !group.followups.enabled} aria-label={`${label}：已开启 ${group.followups.enabled} 本`} onClick={() => onSelectBooks(group.site, 'enabled')}>{n(group.followups.enabled)} 本</Button>
                        </div>
                      </TableCell>
                      <TableCell data-label="待处理">
                        <div className={styles.siteMetric}>
                          {group.attention > 0 ? (
                            <Button variant="link" size="sm" className={styles.attentionButton} disabled={changingView} aria-label={`${label}：待处理 ${group.attention} 本`} onClick={() => onSelectBooks(group.site, 'attention')}>{n(group.attention)} 本待处理</Button>
                          ) : <span className={styles.siteHint}>{group.site === '__none__' ? '缺少有效来源' : '暂无待处理项'}</span>}
                        </div>
                      </TableCell>
                      <TableCell data-actions="" data-label="操作">
                        <div className={cn('admin-cell-actions', styles.siteActions)}>
                          <Button variant="ghost" size="sm" disabled={changingView} aria-label={`${label}：查看全部作品`} onClick={() => onSelectBooks(group.site)}>查看作品</Button>
                          <Button variant="ghost" size="sm" aria-label={`${label}：${expanded ? '收起' : '展开'}分类明细`} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={() => toggleSite(group.site)}>
                            分类<ChevronDown className={styles.disclosure} data-expanded={expanded} aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow data-details="">
                        <TableCell colSpan={columns.length}>
                          <div id={detailId} className={styles.breakdown} role="region" aria-label={`${label}分类明细`}>
                            <div className={styles.breakdownGroup}>
                              <h3>来源配置</h3>
                              <ul>
                                {(Object.keys(SOURCE_LABELS) as SourceCategory[]).map((category) => (
                                  <li key={category}>
                                    <Button variant="ghost" size="sm" className={styles.breakdownButton} disabled={changingView || !group[category]} aria-label={`${label}：${SOURCE_LABELS[category]} ${group[category]} 本`} onClick={() => onSelectBooks(group.site, undefined, category)}>
                                      <span>{SOURCE_LABELS[category]}</span><span>{n(group[category])} 本</span>
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className={styles.breakdownGroup}>
                              <h3>追更状态 · 各项合计 {n(group.total)} 本</h3>
                              <ul>
                                {(Object.keys(FOLLOWUP_LABELS) as FollowupCategory[]).map((category) => (
                                  <li key={category}>
                                    <Button variant="ghost" size="sm" className={styles.breakdownButton} disabled={changingView || !group.followups[category]} aria-label={`${label}：${FOLLOWUP_LABELS[category]} ${group.followups[category]} 本`} onClick={() => onSelectBooks(group.site, category)}>
                                      <span>{FOLLOWUP_LABELS[category]}</span><span>{n(group.followups[category])} 本</span>
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </AdminDataPanel>
      <p className={styles.scopeNote}>
        {data.view === 'all' ? '同一本书在不同站点分别计入，各站占比以全库作品数为分母，相加可能超过 100%。' : '每本作品按主要来源计入一个分组，占比以全库作品数为分母。'}
        {' '}概览始终统计全库；配置与追更状态按作品当前配置计算，不代表各来源均可访问。待处理仅统计已开启追更且当前未执行、存在配置不足或检查异常的作品，不代表全部缺少来源的作品。
      </p>
    </div>
  )
}
