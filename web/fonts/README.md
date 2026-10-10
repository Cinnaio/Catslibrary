# 本地阅读字体

保留项目原有的 Noto Serif SC Regular / Bold OTF，另从官方 Noto CJK 仓库取得同为 2.003 版本的 Black OTF，分别提供 400 / 700 / 900 字重。Black 来源：https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/SubsetOTF/SC/NotoSerifSC-Black.otf 。字体版权及 SIL Open Font License 1.1 见 [OFL.txt](OFL.txt)，各生成字体也保留原有版权与授权元数据。

应用只发布 `web/src/assets/fonts/` 的 WOFF2 分片，OTF 源文件不在 public 目录，不随应用构建复制到静态站点。Vite 为字体输出带内容哈希的 `/assets/` 地址，沿用现有 Node 静态资源入口；不需要新增 `/fonts/` 反代配置。

每档提供原有 Regular / Bold 的全部 7,814 个字符映射。分组为拉丁字母与符号、公开首页固定用字、GB2312 一级常用字及其他字符；正文用字每片最多 512 个。通过 `unicode-range` 按需请求，`font-display: swap` 保留立即可读的系统字体回退。Black 按同一字符集合生成，额外源字形不加入当前阅读字体包。

生成脚本会逐片检查映射、核对总字符覆盖、保留版权和授权元数据，并输出 CSS。正常 `npm ci` / `npm run build` 直接使用已提交产物，不要求 Python 或联网下载字体。

需要重新生成时，在独立 Python 环境中安装 `fonttools==4.60.2` 和 `brotli==1.2.0`，从项目根目录执行：

```bash
python scripts/build-reader-fonts.py
```

`--weights Regular` 可只重新压缩某档，但会读取并验证所有档的已有分片，因此只适用于已有完整产物的目录。分组规则或首页用字变化时应重新生成全部档。
