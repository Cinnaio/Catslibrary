![Cat’s Library：猫咪、书页与暖灯相伴的安静书房](docs/assets/readme/hero.webp)

<div align="center">

**藏一些故事，留一处安静。**

自托管的中文小说阅读与 AI 创作空间 · Web & iOS

当前正式版本：**1.0.0** · [发布与下载](https://github.com/Cinnaio/zhi-zhou/releases/tag/v1.0.0)

[快速开始](#快速开始) · [文档](docs/README.md) · [部署指南](docs/deployment.md) · [iOS 客户端](ios/README.md) · [更新记录](CHANGELOG.md)

</div>

## 阅读 · 收藏 · 创作

![三只猫分别阅读、整理书架和陪伴写作，代表阅读、收藏与创作](docs/assets/readme/features.webp)

| 安静地读 | 慢慢地藏 | 自由地写 |
| :---: | :---: | :---: |
| 自定义主题、字体与排版<br>让每一页都读得舒服 | 导入作品、多源抓取与连载追更<br>把喜欢的故事放进自己的书库 | AI 续写、情节大纲与故事记忆<br>让灵感接着生长 |

书架、书签与阅读进度跨端同步，配合内容审核、账户权限和备份恢复，打理属于自己的阅读空间。

## 快速开始

准备根目录 **`.node-version` 指定的 Node.js** 和可连接的 **PostgreSQL 14+**，在仓库根目录运行：

```bash
npm install
npm run dev
```

打开 **[localhost:5173/install](http://localhost:5173/install)**，跟随安装向导连接数据库并创建首个管理员，首次连接时自动执行迁移。

也可以将 [.env.example](.env.example) 复制为 `.env` 后填写配置。开发环境 Web 使用 `5173`、API 使用 `8787`，`/api` 请求自动代理。

## 打理你的书房

| 想做什么 | 从这里开始 |
| --- | --- |
| 本地开发、查看项目结构与命令 | [开发指南](docs/development.md) |
| 部署自己的阅读站 | [部署指南](docs/deployment.md) |
| 配置 AI、追更与备份 | [功能与配置](docs/configuration.md) |
| 构建与安装 iOS 客户端 | [iOS 开发说明](ios/README.md) |
| 查阅专题、已知问题与发布状态 | [文档导航](docs/README.md) |

<div align="center">

<sub>React · Vite · Tailwind CSS · Hono · PostgreSQL · SwiftUI</sub>

</div>
