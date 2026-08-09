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
import { adminRoutes } from './routes/admin'
import { adminUsersRoutes } from './routes/admin-users'
import { downloadLogsRoutes } from './routes/download-logs'
import { setupRoutes } from './routes/setup'

/** 全局应用：中间件装配 + 路由注册（阶段化增量挂载）。 */
export const app = new Hono()

app.use('/api/*', cors())

// 安装引导守卫：数据库未配置时仅放行健康检查与安装向导（/api/setup/*）
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health' || c.req.path.startsWith('/api/setup/')) return next()
  if (!loadConfig().configured) {
    return c.json({ error: '数据库尚未初始化，请先配置 DATABASE_URL', needsSetup: true }, 503)
  }
  await next()
})

// 统一错误出口：细节只进服务端日志，客户端只拿通用信息
app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: '服务器内部错误' }, 500)
})

app.get('/api/health', (c) => {
  return c.json({ ok: true, name: '知舟', esc: escHtml('<b>&</b>') })
})

app.route('/api/auth', authRoutes)
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
app.route('/api/admin', adminRoutes)
app.route('/api/admin-users', adminUsersRoutes)
app.route('/api/download-logs', downloadLogsRoutes)
app.route('/api/setup', setupRoutes)
