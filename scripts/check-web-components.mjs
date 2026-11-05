import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireWeb = createRequire(path.join(repo, 'web/package.json'))
const ts = requireWeb('typescript')
// CSS 解析器使用现有 Vite 声明的依赖，避免依赖偶然的 node_modules 提升布局。
const postcss = createRequire(requireWeb.resolve('vite'))('postcss')
const root = path.join(repo, 'web/src')
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
const files = walk(root)
const sources = files.filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
const components = sources.filter((file) => relative(file).startsWith('components/') && file.endsWith('.tsx'))
const failures = []
const graph = new Map()
const consumers = new Map()
const styles = new Map()
const deprecated =
  /components\/admin\/(?:AdminWorkspace|CustomSelect|CustomTimePicker|AdminFormField|AdminEmptyState|AsyncStates|AdminDialog|Pagination)(?:\.|$)/

function resolve(specifier, owner) {
  const target = specifier.startsWith('@/')
    ? path.join(root, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(owner), specifier)
      : undefined
  if (!target) return undefined
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => target + ext).find((file) => fs.existsSync(file) && fs.statSync(file).isFile())
}

for (const file of sources) {
  const source = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const edges = []
  const ownedStyles = []
  const publicLayer = /^components\/(?:ui|shared)\//.test(relative(file))
  function checkImport(specifier) {
    const target = resolve(specifier, file)
    if ((specifier.startsWith('.') || specifier.startsWith('@/')) && !target) {
      failures.push(`${relative(file)}: unresolved import ${specifier}`)
      return
    }
    if (!target) return
    const targetName = relative(target)
    if (deprecated.test(targetName)) failures.push(`${relative(file)}: deprecated component ${targetName}`)
    if (
      publicLayer &&
      /^(?:pages\/|components\/(?:admin|reader|identity)\/|lib\/(?:api|storage|admin-|reader-utils)|context\/(?!ThemeContext))/.test(targetName)
    ) {
      failures.push(`${relative(file)}: public layer imports business dependency ${targetName}`)
    }
    if (target.endsWith('.css')) ownedStyles.push(targetName)
    else {
      edges.push(target)
      consumers.set(target, [...(consumers.get(target) || []), relative(file)])
    }
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      checkImport(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      checkImport(node.arguments[0].text)
    if (!relative(file).startsWith('pages/dev/') && ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer) {
      function legacyClass(value) {
        if ((ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isTemplateHead(value)) && /(?:^|\s)btn(?:\s|$)/.test(value.text))
          failures.push(`${relative(file)}: duplicated legacy button implementation`)
        ts.forEachChild(value, legacyClass)
      }
      legacyClass(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (relative(file) === 'pages/dev/gallery-catalog.ts') {
    function verifySource(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['ui', 'admin'].includes(node.expression.text) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const target = path.join(root, 'components', node.expression.text, `${node.arguments[0].text}.tsx`)
        if (!fs.existsSync(target)) failures.push(`Gallery references missing source: ${relative(target)}`)
      }
      if (ts.isStringLiteral(node) && /^(components|styles|pages)\/.+\.(tsx?|css)$/.test(node.text) && !fs.existsSync(path.join(root, node.text)))
        failures.push(`Gallery references missing source: ${node.text}`)
      ts.forEachChild(node, verifySource)
    }
    verifySource(ast)
  }
  graph.set(file, edges)
  styles.set(file, ownedStyles)
  if (relative(file).startsWith('components/shared/') && !ownedStyles.length)
    failures.push(`${relative(file)}: shared visual component has no stylesheet owner`)
}

// 检查所有 CSS 的语法与本地 @import，避免组件搬迁后仅靠另一条路由补齐样式。
for (const file of files.filter((file) => file.endsWith('.css'))) {
  const css = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file })
  css.walkAtRules('import', (rule) => {
    const specifier = rule.params.match(/^['"]([^'"]+)['"]/)?.[1]
    if (specifier?.startsWith('.') && !fs.existsSync(path.resolve(path.dirname(file), specifier)))
      failures.push(`${relative(file)}: missing stylesheet ${specifier}`)
  })
  if (relative(file).startsWith('components/shared/')) {
    css.walkDecls((decl) => {
      if (/--admin-/.test(decl.value)) failures.push(`${relative(file)}: shared style depends on admin token ${decl.value}`)
    })
  }
}

const globalImports = postcss.parse(fs.readFileSync(path.join(root, 'styles/global.css'), 'utf8'))
const foundations = new Set(['tailwindcss', 'tw-animate-css', './tokens.css', './admin/tokens.css', './base.css', './shadcn.css'])
globalImports.walkAtRules('import', (rule) => {
  const dependency = rule.params.match(/^['"]([^'"]+)['"]/)?.[1]
  if (!foundations.has(dependency)) failures.push(`global.css imports a non-foundation stylesheet: ${dependency}`)
})

const active = new Set(),
  done = new Set()
function findCycles(file, chain = []) {
  if (active.has(file)) {
    failures.push(`component cycle: ${[...chain, file].map(relative).join(' -> ')}`)
    return
  }
  if (done.has(file)) return
  active.add(file)
  for (const next of graph.get(file) || []) if (relative(next).startsWith('components/')) findCycles(next, [...chain, file])
  active.delete(file)
  done.add(file)
}
for (const file of components) findCycles(file)

const rootReasons = {
  AccountMenu: '账户导航与会话动作',
  AdultUnlockDialog: '内容策略验证流程',
  AppErrorBoundary: '应用异常与整页恢复',
  CatchupRecap: '小说阅读回顾业务',
  ContentPolicyStatus: '内容访问检查状态',
  ContentRestrictionNotice: '分级门禁与解锁入口',
  feedback: '应用级确认与通知上下文',
  icons: '共享 SVG 图形，不包含业务状态',
  Layout: '路由布局与页面外壳适配',
  NovelCard: '小说目录与阅读/收藏状态',
  NovelCoverStatus: '小说封面业务标记',
  PageSeo: '路由 SEO 与品牌配置',
  PageState: '控制整页外壳的异常呈现，区别于面板空态',
  ReadingDataPanel: '账户阅读数据检查与恢复',
  ReadingStatsPanel: '账户阅读统计',
  ReauthenticationDialog: '敏感操作近期身份确认',
  RouteLoading: '路由切换与外壳占位',
  SiteBrandingSync: '站点品牌同步',
  SiteNotice: '站点公告与工作区位置',
  ThemeMenu: '应用主题偏好入口',
  TurnstileTestWidget: '站点验证码配置诊断',
  VisitTracker: '访问统计副作用',
}
function classify(file) {
  const name = relative(file)
  if (name.startsWith('components/ui/')) return ['基础控件', '保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础']
  if (name.startsWith('components/shared/')) return ['通用组合', '迁移／共享：无业务取数，使用方提供状态与动作']
  if (name.startsWith('components/identity/')) return ['业务适配', '保留：账户资源地址与基础头像呈现分离']
  if (name.startsWith('components/admin/')) return ['后台场景', '保留／拆分：管理操作、数据表面或具体作品流程']
  if (name.startsWith('components/reader/')) return ['阅读场景', '保留：阅读状态、虚拟化、图片、触摸或阅读设置契约']
  if (name.startsWith('components/workspace/')) return ['工作区场景', '保留：共享外壳或作品上下文导航']
  const reason = rootReasons[path.basename(file, '.tsx')]
  if (!reason) failures.push(`Unclassified component: ${name}`)
  return ['应用／业务', `保留：${reason || '缺少分类依据'}`]
}

const inventory = components.map((file) => {
  const [layer, decision] = classify(file)
  return { file: relative(file), layer, decision, consumers: [...new Set(consumers.get(file) || [])], styles: styles.get(file) || [] }
})

if (process.argv.includes('--inventory')) {
  const rows = inventory.map(
    (item) =>
      `| \`${item.file}\` | ${item.layer} | ${item.consumers.length} | ${item.styles.length ? item.styles.map((style) => `\`${style}\``).join('、') : '组合已带样式的原语／模块内工具类；场景布局由所属入口加载'} | ${item.decision} |`,
  )
  fs.writeFileSync(
    path.join(repo, 'docs/component-inventory.md'),
    `# 生产组件归属清单\n\n由 \`node scripts/check-web-components.mjs --inventory\` 从当前源码生成；${components.length} 个组件文件，${sources.filter((file) => !relative(file).startsWith('pages/dev/')).length} 个生产源码模块。使用方数量包含开发展厅，不包含测试。表格记录保留或迁移依据，不表示所有控件需要重写；组件内部页面级子组件按所属页面／工作流保留。\n\n| 文件 | 层级 | 使用方 | 样式所有权 | 结论 |\n| --- | --- | ---: | --- | --- |\n${rows.join('\n')}\n`,
  )
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log(`Component boundaries, imports, styles and classification passed: ${components.length} components, ${sources.length} source modules.`)
