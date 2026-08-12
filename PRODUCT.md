# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **读者（主要用户）**：访问公开站点浏览、搜索、阅读小说，收藏到书架，在阅读器中沉浸式阅读
- **管理员**：通过后台运营台管理小说库、章节、爬虫抓取任务、内容审核、用户与注册设置、解析规则

## Product Purpose

知舟是一个自托管的 AI 中文小说阅读站。读者获得干净、沉浸的阅读体验；管理员通过 Web 运营台完成书库管理、多源抓取、内容审核的全链路工作流。项目源自 Novel-KV 全量重写。

## Positioning

自建小说书库 + 阅读。与直接在浏览器看小说或使用通用阅读器不同，知舟允许用户完全掌控书源、抓取配置和书库数据，同时提供统一的阅读界面和管理后台。

## Operating Context

- **部署**：自托管（Node.js + PostgreSQL），通过 /install 向导完成初始配置
- **管理流程**：管理员登录 → 运营台（侧边栏导航）→ 小说管理 / 章节管理 / 爬虫抓取 / 任务管理 / 内容审核 / 账户设置 / 解析规则
- **阅读流程**：首页浏览 → 小说详情 → 章节阅读器（支持翻页、主题切换）
- **抓取流程**：输入 URL → 分析源站 → 检测章节 → 配置选择器 → 启动抓取 → 任务卡片实时追踪
- **技术栈**：React 19 + Hono（Node.js）+ PostgreSQL + TypeScript + Vite 7 + Tailwind CSS 4，monorepo（web/ + api/）

## Capabilities and Constraints

- 8 个后台管理 tab：总览、小说管理、章节管理、爬虫抓取、任务管理、内容审核、账户与注册、解析规则
- 爬虫抓取中心支持 PO18 站点预设 + 自定义选择器
- 发现小说：搜索/榜单浏览 + 一键抓取
- 书源管理：Legado 社区书源池导入
- 自动轮询任务状态（活跃 4s / 空闲 20s）
- shadcn/ui 组件体系（Tailwind v4 + Radix UI）
- 暗色/亮色主题切换

## Brand Commitments

- 产品名：知舟（Zhi Zhou）
- 中文优先界面
- 品牌视觉方向未最终确定，当前采用"奶茶·奶油"暖色调设计系统作为基底

## Evidence on Hand

- 完整可运行的 web 前端（React 19 + Vite 7）
- 完整的 API 后端（Hono on Node.js + PostgreSQL）
- 已实现的设计系统：tokens.css 定义 light/dark 双主题色板，shadcn.css 桥接语义色
- 设计风格描述："Warm, human, minimalist. Like reading on paper in good light."

## Product Principles

1. **书库完全可控**：用户拥有书源、抓取逻辑和数据的全部控制权
2. **沉浸阅读**：阅读界面干净无干扰，尊重长时间阅读场景
3. **管理高效**：运营台信息密度高但层次清晰，减少操作路径
4. **自托管优先**：部署简单，不依赖第三方服务

## Accessibility & Inclusion

无特定无障碍标准要求。界面以中文为主，面向中文用户群体。
