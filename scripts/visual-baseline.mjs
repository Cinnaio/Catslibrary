/**
 * 后台视觉基线截图工具。
 *
 * 用途：布局重构前存档「改动前」的渲染结果，改动后逐张对比，弥补当前
 * 没有任何视觉回归测试的缺口。仅作为开发期工具，不参与构建。
 *
 * 用法：
 *   node scripts/visual-baseline.mjs <outDir> [tab]
 *   node scripts/visual-baseline.mjs .visual/novels-before novels
 *
 * 环境变量：
 *   BASE_URL  默认 http://localhost:5173
 *   CHROME    指定 Chrome/Edge 可执行文件路径
 *   AUTH_TOKEN 管理员会话 token（后台页需登录，缺省只能截到 AdminGate 登录卡）
 */
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const AUTH_TOKEN = process.env.AUTH_TOKEN || ''
const TOKEN_KEY = 'user_session_token'
const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

/** 视口矩阵：桌面/窄屏 × 浅色/深色，覆盖 tab 的主要布局分支。 */
const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 1000 },
  { name: 'tablet', width: 900, height: 1000 },
  { name: 'mobile', width: 400, height: 900 },
]
const THEMES = ['light', 'dark']

/** fullPage 在长列表下会产出超高图（查看器有 2000px 上限），限制像素高度。 */
const MAX_PAGE_HEIGHT = Number(process.env.MAX_PAGE_HEIGHT || 1800)

function resolveChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!found) throw new Error('未找到 Chrome/Edge；请用 CHROME 环境变量指定可执行文件路径')
  return found
}

async function main() {
  const outDir = path.resolve(process.argv[2] || '.visual/baseline')
  const tab = process.argv[3] || 'novels'
  const url = `${BASE_URL}/admin/${tab}`
  const executablePath = resolveChrome()

  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ executablePath, headless: true })
  const shots = []

  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        // 首帧主题由 index.html 内联脚本按 localStorage 决定，这里预置以稳定渲染
        storageState: {
          cookies: [],
          origins: [
            {
              origin: BASE_URL,
              localStorage: [{ name: 'theme', value: theme }, ...(AUTH_TOKEN ? [{ name: TOKEN_KEY, value: AUTH_TOKEN }] : [])],
            },
          ],
        },
      })
      const page = await context.newPage()
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      // 等待表格/骨架结束后再截，避免截到加载态
      await page.waitForTimeout(1200)

      const file = path.join(outDir, `${tab}-${theme}-${vp.name}.png`)
      // clip 限定高度：既保留完整宽度，又避免超长列表产出查看器打不开的图
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.screenshot({
        path: file,
        clip: { x: 0, y: 0, width: vp.width, height: Math.min(pageHeight, MAX_PAGE_HEIGHT) },
      })
      shots.push(path.relative(process.cwd(), file))
      await context.close()
    }
  }

  await browser.close()
  console.log(`已生成 ${shots.length} 张基线截图 → ${path.relative(process.cwd(), outDir)}`)
  shots.forEach((s) => console.log(`  ${s}`))
}

main().catch((err) => {
  console.error('截图失败：', err.message)
  process.exit(1)
})
