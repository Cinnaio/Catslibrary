import { accountEmailRoutes } from './routes/account-email'
import { securityAdminRoutes, securityPublicRoutes } from './routes/security'
import { SecurityError } from './services/security-policy'
import { AccountError } from './services/account-security'
import { Hono } from 'hono'
import { escHtml } from '@shared/utils'
import { loadConfig } from './config'
import { cors } from './middlewares/cors'
import { authRoutes } from './routes/auth'
import { novelsRoutes } from './routes/novels'
import { chaptersRoutes } from './routes/chapters'
import { categoriesRoutes } from './routes/categories'
import { progressRoutes } from './routes/progress'
import { coverRoutes } from './routes/cover'
import { avatarRoutes } from './routes/avatar'
import { bookshelfRoutes } from './routes/bookshelf'
import { bookmarksRoutes } from './routes/bookmarks'
import { thoughtsRoutes } from './routes/thoughts'
import { ratingsRoutes } from './routes/ratings'
import { commentsRoutes } from './routes/comments'
import { scrapeRoutes } from './routes/scrape'
import { aiRoutes } from './routes/ai'
import { createAgentRoutes } from './routes/ai-agent'
import { adminRoutes } from './routes/admin'
import { adminUsersRoutes } from './routes/admin-users'
import { downloadLogsRoutes } from './routes/download-logs'
import { setupRoutes } from './routes/setup'
import { contentPolicyRoutes } from './routes/content-policy'
import { adminSiteRoutes, siteRoutes } from './routes/site'
import { adminOperationRoutes } from './routes/admin-operations'
import { contentRatingRoutes } from './routes/content-ratings'
import { contentRatingRuleCandidateRoutes } from './routes/content-rating-rule-candidates'
import { contentRatingAiRoutes } from './routes/content-rating-ai'
import { bookImportRoutes } from './routes/book-import'
import { supplementarySourceRoutes } from './routes/supplementary-source'
import { adminSiteSettingsRoutes, publicSiteSettingsRoutes } from './routes/site-settings'
import { backupRoutes } from './routes/backups'
import { backupMaintenance } from './middlewares/backup-maintenance'
import { csrfProtection, browserSecurityHeaders } from './middlewares/browser-security'
import { readingDataRoutes } from './routes/reading-data'
import { readingStatsRoutes } from './routes/reading-stats'
import { passkeyRoutes } from './routes/passkeys'
import { buildInfo } from './services/build-info'
import { checkReadiness } from './services/readiness'

/** 全局应用：中间件装配 + 路由注册（阶段化增量挂载）。 */
export const app = new Hono()

app.use('*', browserSecurityHeaders())
app.use('/api/*', cors())
app.use('/api/*', csrfProtection())
app.use('/api/*', async (c, next) => {
  c.header('X-Robots-Tag', 'noindex, follow')
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie, Authorization, X-Content-Access', { append: true })
  await next()
})

// 安装引导守卫：数据库未配置时仅放行健康检查与安装向导（/api/setup/*）
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health' || c.req.path === '/api/ready' || c.req.path.startsWith('/api/setup/')) return next()
  if (!loadConfig().configured) {
    return c.json({ error: '数据库尚未初始化，请先配置 DATABASE_URL', needsSetup: true }, 503)
  }
  await next()
})

// 统一错误出口：细节只进服务端日志，客户端只拿通用信息
app.use('/api/*', async (c, next) => {
  if (!loadConfig().configured || c.req.path === '/api/ready' || c.req.path.startsWith('/api/setup/')) return next()
  return backupMaintenance()(c, next)
})
app.onError((err, c) => {
  if (err instanceof SecurityError) { c.header('Retry-After', String(err.retryAfter)); return c.json({error:err.message,code:err.code},err.status) }
  if (err instanceof AccountError) return c.json({ error: err.message }, err.status)
  console.error('[api]', err)
  return c.json({ error: '服务器内部错误' }, 500)
})

app.get('/api/health', (c) => {
  return c.json({ ok: true, name: 'Cat’s Library', esc: escHtml('<b>&</b>'), version: buildInfo.apiVersion, release: buildInfo.releaseSha })
})

app.get('/api/ready', async c => {
  const state = await checkReadiness()
  return c.json(state, state.ready ? 200 : 503)
})

app.route('/api/auth', accountEmailRoutes)
app.route('/api/security', securityPublicRoutes)
app.route('/api/admin/security', securityAdminRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/auth/passkeys', passkeyRoutes)
app.route('/api/novels', novelsRoutes)
app.route('/api/chapters', chaptersRoutes)
app.route('/api/categories', categoriesRoutes)
app.route('/api/progress', progressRoutes)
app.route('/api/cover', coverRoutes)
app.route('/api/avatar', avatarRoutes)
app.route('/api/bookshelf', bookshelfRoutes)
app.route('/api/bookmarks', bookmarksRoutes)
app.route('/api/thoughts', thoughtsRoutes)
app.route('/api/ratings', ratingsRoutes)
app.route('/api/comments', commentsRoutes)
app.route('/api/scrape', scrapeRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/ai/agent', createAgentRoutes(request => app.fetch(request)))
app.route('/api/admin', adminRoutes)
app.route('/api/admin-users', adminUsersRoutes)
app.route('/api/download-logs', downloadLogsRoutes)
app.route('/api/setup', setupRoutes)
app.route('/api/content-policy', contentPolicyRoutes)
app.route('/api/site', siteRoutes)
app.route('/api/admin/site', adminSiteRoutes)
app.route('/api/admin/operations', adminOperationRoutes)
app.route('/api/admin/content-ratings', contentRatingRoutes)
app.route('/api/admin/content-rating-rule-candidates', contentRatingRuleCandidateRoutes)
app.route('/api/admin/content-rating-ai', contentRatingAiRoutes)
app.route('/api/book-import', bookImportRoutes)
app.route('/api/supplementary-sources', supplementarySourceRoutes)
app.route('/api/site-settings', publicSiteSettingsRoutes)
app.route('/api/admin/site-settings', adminSiteSettingsRoutes)
app.route('/api/admin/backups', backupRoutes)
app.route('/api/reading-data', readingDataRoutes)
app.route('/api/reading-stats', readingStatsRoutes)
