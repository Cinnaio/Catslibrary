# 搜索收录范围与部署说明

首页与 content_rating=general 的小说详情允许收录。作品详情的初始 HTML 包含标题、作者、完整简介与首页链接；首页初始 HTML 提供最新24本 general 作品链接。React 启动后沿用现有页面交互。restricted / unknown 作品不向初始 HTML 暴露作品元数据，且与章节、个人页面、认证、安装、后台及带查询参数的页面一起返回 noindex, follow。不存在的作品和未知页面返回404；数据库失败返回503与 noindex。

部署设置 SITE_URL 为正式站点 origin，默认 web/dist 由 Node 一并读取，可通过 WEB_DIST_DIR 指定前端产物目录。canonical 与 sitemap 仅使用这个配置，不信任请求 Host 或转发 Host。未设置或非法 SITE_URL 时保持 noindex；开发 Vite 与纯静态 fallback 同样保持 noindex。具体反代配置见 README 的部署章节。

/sitemap.xml 返回分页索引，/sitemaps/novels-N.xml 每份最多1000本作品，第一页额外包含首页，详情使用 updated_at 作为 lastmod。实时查询 general 分级，HTML 与 sitemap 均 no-store。robots.txt 保留指定 AI 爬虫的禁用策略，并允许公开页面渲染所需 API 抓取；所有 API 附带 noindex HTTP 头。robots 不代替鉴权或限流。

客户端在路由变化时重置 meta 与 canonical；general 详情加载完成后更新其描述和索引状态。React StrictMode 首次执行不会误清除服务端已经输出的 general 索引规则。查询参数页保持 noindex，并在公开页指向不带参数的 canonical。

实现不修改内容分级、权限、数据库迁移与现有 reader API。默认不开放章节收录。正式域名和当前反代配置没有在本次任务中取得，线上请求与搜索引擎实际收录仍需部署后核验。

验证：20项服务端 SEO / sitemap / API 测试、3项 SPA 元数据测试与11项既有首页回归通过。前后端类型检查、生产构建和 git diff --check 通过；构建保留已有大分块警告，小说详情保留现有 React Hooks 警告。

构建后执行 `npx tsx --tsconfig api/tsconfig.json scripts/check-seo.ts` 可复现本地 HTTP 检查。脚本使用虚构作品和模拟查询，不连接真实数据库；检查默认 web/dist 路径、general 详情初始 HTML / 响应头、构建 JS/CSS 可读取及 robots 的 sitemap 声明。
