# 页面按需加载与本地阅读字体

## 行为变化

- 小说详情、阅读器、书架、个人页和登录页按路由加载。公开页面的等待状态位于内容区，页头继续显示。
- 后台注册表只同步提供导航元数据，各业务模块通过独立动态导入加载。管理员鉴权通过后才渲染模块；下载期间保留后台壳与导航。
- 流量分析和 AI 用量共用的图表依赖自动拆为共享分块，首页和后台总览不提前下载。
- 移除 Google Fonts 的预连接与样式请求。400 / 700 / 900 三档 Noto Serif SC 均从本站的带内容哈希 WOFF2 地址加载，按字符范围下载，保留 `font-display: swap`。
- 保留原有 Regular / Bold OTF，补充官方同版本 Black 字体；源文件与授权说明放在 `web/fonts/`，不发布 OTF。生成脚本及已生成分片均纳入 Git，正常构建无需安装字体生成工具。

## 构建结果

以下为相同 Vite 生产构建中单个入口分块的大小，不把异步分块或字体文件计作入口 JS，也不等同于完整页面网络流量。

| 分块 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 首页入口 JS | 616.32 kB | 485.37 kB |
| 后台壳 JS | 1,022.08 kB | 44.56 kB |
| 图表共享 JS | 包含在后台包中 | 351.05 kB，按需加载 |

生成的每档字体包含 16 片，覆盖原有阅读字体的全部 7,814 个字符。首页固定用字单独分片，避免短标题分散请求多片正文用字。生产浏览器中的空书库夹具首屏字体流量从第一版分片的 1,210,220 字节降到 316,644 字节；这是同一夹具下字体分片方案的对比，不是对原 Google Fonts 流量或真实书库的估算。

## 验证与运行方法

- 前端全量 79 个文件、476 项测试通过；类型检查、修改文件 ESLint 和生产构建通过，JS 无超过 500 kB 的分块。新增回归检查鉴权前不加载模块、后台模块加载保留导航、公开页面加载保留页头。
- `scripts/build-reader-fonts.py` 逐片检查字符映射与总覆盖，并核对版权、授权及授权地址元数据。生成环境依赖和流程见 [字体说明](../web/fonts/README.md)。
- `scripts/check-web-loading.mjs` 在生产预览中检查 1440 / 390px × 明暗主题：首页不下载后台、阅读器与图表；总览不下载 AI、备份或图表；跳转流量分析时才请求图表，刻意阻塞下载期间后台导航仍可用；三档本地字体可解码，页面无外部资源请求、脚本错误或横向溢出。
- 既有阅读器插图浏览器检查验证桌面和手机上的上传预览、保存、大图、移动、删除、撤销和退出，以及段落索引保持。

```bash
npm run build --workspace=@zhi-zhou/web -- --manifest
npm run preview --workspace=@zhi-zhou/web -- --host 127.0.0.1 --port 5188 --strictPort
# 在另一个终端中运行：
WEB_LOADING_CHECK_BASE=http://127.0.0.1:5188 node scripts/check-web-loading.mjs
READER_CHECK_BASE=http://127.0.0.1:5188 node scripts/check-chapter-illustrations.mjs
```

浏览器检查使用 API 夹具，不操作真实账号、章节或付费 AI。JS 已按模块拆分；现有全局样式仍保留共享入口，未把后台样式从阅读器共享弹窗中拆走。

字体授权来源：[Noto CJK Serif 官方许可证](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE)。
