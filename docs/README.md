# 文档导航

[项目首页](../README.md) · [更新记录](../CHANGELOG.md)

## 从这里开始

| 文档 | 内容 |
| --- | --- |
| [开发指南](development.md) | 环境准备、启动、技术栈、目录结构与常用命令 |
| [部署指南](deployment.md) | GitHub Actions 发布、服务器准备、反向代理与出站代理 |
| [功能与配置](configuration.md) | AI 端点、插画想法、追更、备份、字体与会话防护 |
| [iOS 开发](../ios/README.md) | 原生客户端构建、测试与安装 |
| [发布与版本管理](releasing.md) | 版本来源、候选记录与实际交付状态 |
| [产品说明](product.md) | 产品定位与能力边界（历史说明，具体能力以实现为准） |
| [设计规范](../DESIGN.md) | 当前视觉体系与组件约定 |
| [已知问题](known-issues.md) | 已定位问题、原因及处理边界 |

## 专题与历史记录

以下专题保留原路径，便于已有链接继续访问。带日期的方案、预览及验收文档记录当时状态，当前发布情况见[发布记录](releasing.md)。

- [账户与邮件安全](account-security.md)：角色、账户邮件与安全配置
- [通行密钥](passkey-implementation-contract-2026-10-19.md)：Passkey 实现契约
- [导入审核](book-import-review.md)与[冲突处理](import-conflict-resolution.md)：书籍导入流程
- [追更与书源](novel-update-sources.md)：来源管理与更新规则
- [AI 故事记忆](ai-story-memory.md)与[用量统计](ai-upstream-usage.md)：AI 专题
- [章节插画](chapter-illustrations.md)：图片生成与章节配图
- [内容访问保护](r18-access-protection.md)：访问策略与验证边界
- [备份与版本回滚设计](backup-and-restore-design-2026-10-08.md)：本地与 SFTP 优先的备份方案、云盘扩展、自动调度、回滚及日志设计
- [备份功能落地说明](backup-and-restore-implementation-2026-10-08.md)：首版功能、部署配置、灾备工具及验证记录
- [组件展示页](component-gallery.md)与[后台样式系统](admin-style-system.md)：组件开发参考
- [iOS 并仓说明](ios-monorepo.md)：源码布局与构建边界

其余方案、验证记录与预览保留在本目录及 `previews/`；设计素材位于 `assets/` 和 `design-assets/`。
