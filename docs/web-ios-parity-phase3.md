# Web / iOS 第三阶段：管理端对齐

## 实现范围

本阶段沿用最初对齐清单的管理端范围。继续排除作品评分与作品评论；已有审核后台保持原有能力。

| 功能 | iOS 入口与行为 | 服务端契约 |
| --- | --- | --- |
| 后台分组 | 监控、内容库、内容生产、运行监控、内容治理、平台运营；搜索仍覆盖全部模块 | 与 Web admin-registry 的功能归属一致，保留原生 NavigationLink |
| 任务中心 | 抓取任务、AI 任务、下载记录、已生成内容；复用原任务页的取消、重试和内容关联 | 现有 scrape / ai/tasks / download-logs |
| 调用与用量 | AI 调用与出站请求两个入口；趋势与调用明细支持近 7 / 30 / 90 天；明细继续加载 | ai/audit/trend 的 days；ai/audit/calls 的 from / to / type / offset |
| 单本追更 | 小说操作菜单 → 追更设置；启停、1 / 3 / 6 / 12 / 24 小时档位、最近和下次检查、任务入口 | scrape action=followup / followup-save |
| 书籍导入 | 后台内容库 → 书籍导入；URL 预览、目标选择、元数据替换勾选、章节差异、确认提交、结果及个人导入历史 | book-import/preview、:runId/target、:runId/commit、history |
| 操作审计 | 状态、动作和操作者筛选；按 50 条分页，展示动作、对象数、响应、重放次数、错误和操作编号 | GET admin/operations |
| 站点设置 | 读取品牌文本与资源地址、Turnstile 就绪状态、密钥设置状态和配置来源；提供 Web 编辑入口 | GET admin/site-settings/branding、turnstile |
| 备份与恢复 | 只读计划、工具就绪状态、存储目标、最近任务、版本副本失败原因和日志；Web 管理入口 | GET admin/backups/overview、versions、logs |

## 行为边界

- 新增管理请求绑定启动时的 token。异步结果检查请求代次、取消状态与账号；新增分页页在账号切换时清空列表。分页 offset 按服务端实际返回数推进，显示记录按 ID 去重，空页停止继续加载。
- AI 趋势显示所选范围的全部调用类型，类型过滤作用于明细。用户汇总接口仅提供累计数据，页面明确标注为累计前 50 位，不伪装成所选时间范围。调用明细冻结 from/to，翻页时不会把新产生的记录插到分页窗口前部。
- 自动追更由服务端调度，App 不在后台启动定时任务。只有已有抓取配置的连载作品可启用；已有设置仍可关闭。刷新检查状态不会覆盖正在编辑的开关和频率。
- 导入读取快照后才允许提交。没有匹配作品时新建，唯一匹配时默认合并，多同名候选且没有目标时必须明确选择合并目标，与 Web 一致；切换目标重新读取差异并重置选择。默认只选服务端推荐的新章节和空缺元数据；冲突及未变章节不可勾选，已有正文改动需明确勾选。
- 导入复用 AdminDangerousOperation 确认组件，冻结 runId、章节和字段选择，并带稳定 Idempotency-Key。更改选择或预览才更新 key。未知提交结果提示先检查个人导入历史，不自动新建重复任务。服务端仍负责预览后内容变化的冲突判断。
- 本阶段原生导入仅支持 URL；TXT / JSON / EPUB 文件导入、历史撤回提供 Web 入口。站点品牌编辑、安全验证凭据修改、备份写操作及完整恢复继续在 Web 完成。
- Web 链接仅指向应用配置的站点管理路径，不携带 App token；浏览器单独登录。页面不读取或展示原始验证密钥，也不自动执行任何线上导入、追更设置修改或恢复。
- 保留原生列表、表单、菜单、确认弹层及大字体布局；筛选在原生 Sheet 中，不为表单固定高度。

## 验证

- 本地既有 admin-operation-smoke、navigation-smoke、reader-smoke、reader-settings-sync-smoke、image-cache-smoke、content-rating-smoke 共 6 份检查通过；新增导入动作已纳入危险操作注册检查。18 个改动 Swift 文件语法解析无错误，git diff --check 通过；这些是源码检查。
- Web/API 仓库未修改。既有 scrape（12）、site-settings（17）、backups（14）、book-import（19）、admin-operation-audit（2）共 64 项测试通过。这些验证服务端契约，不能代替 iOS 客户端交互测试。
- 新增 8 项原生 UI 用例：任务中心下载记录、追更保存重读、导入预览/冲突禁选/提交/历史、同名导入目标确认、51 条审计分页、时间范围切换、备份失败重试与大字体只读历史、站点配置状态。固定夹具校验导入章节选择和幂等键，以及调用明细时间参数。
- Windows 无 Swift/Xcode。本地 Swift 语法解析和源码检查不能证明 Swift 类型检查、模拟器交互或设备视觉验收。需在 macOS 执行 Release 构建和现有 frontend-audit 工作流，并覆盖 iPhone / iPad、Dynamic Type、账号失效、筛选连续切换、分页失败、导入超时/冲突和 Web 单独登录。

版本保持 0.1.0 / build 16。本阶段随独立的管理端对齐提交交付；之前生成的 IPA 不包含本阶段功能，安装验收需使用包含该提交且成功完成 macOS 构建的新工件。
