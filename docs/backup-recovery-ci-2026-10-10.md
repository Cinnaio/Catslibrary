# 备份恢复与 CI 验证（2026-10-10）

## 修复旧版本恢复升级

真实 PostgreSQL 演练发现：`pg_restore --file` 输出将 `search_path` 设为空。恢复脚本随后拼接待执行迁移，迁移 049 使用未限定 schema 的 `CREATE TABLE`，导致从 047 归档恢复并升级时失败。现在在同一事务内、归档 SQL 之后明确设置 `SET LOCAL search_path = public`，再执行新增迁移。

原测试只删除迁移 048 的记录，实际业务 schema 未回退；新增 049 后既不能表示旧版，也无法验证真正的升级路径。现在用截至 047 的迁移初始化隔离库，再生成真实旧版本归档。演练验证恢复成功、影响报告完整、迁移升级到当前版本，以及 049 插画表已建立。

## 持续验证

新增 `npm run test:backup-integration`，脚本自行管理一次性测试环境：

- 初始化独立 PostgreSQL 集群；随机端口，只监听回环地址，所有数据库连接由脚本生成。
- 新建全链路、差异报告、演练库创建/管理和离线恢复专用库，初始化演练库保护标记。
- 使用 [rclone serve sftp](https://rclone.org/commands/rclone_serve_sftp/) 提供真实 SFTP 协议服务，只暴露临时文件目录；生成独立服务器公钥并验证主机身份。
- SFTP 使用私有 IPv4 网卡和随机端口，保持应用对回环、链路本地地址的拒绝策略。未使用测试后门或关闭主机公钥验证。
- 按文件串行执行备份目录测试；解析 Vitest JSON 报告，要求五个集成测试文件全部执行、全部通过、零跳过。
- 正常完成或测试失败均停止临时服务并清理目录；若数据库停止失败，保留目录并返回失败，避免删除仍运行的集群。

运行脚本不会读取项目部署 `.env`、复用运行时配置或已有备份主密钥。测试使用固定夹具密钥、密码和虚构业务数据，普通 API 测试继续由既有 setup 隔离部署配置。

`.github/workflows/backup-recovery.yml` 增加独立 `Backup recovery` 工作流：Ubuntu 24.04、Node 22、PostgreSQL 16 同版本服务端/客户端、rclone 和 OpenSSH 客户端。配置为每次 main 推送及 PR 执行，也支持手动触发；只授予仓库只读权限，真实备份验证无需生产 Secrets。

通过 GitHub API 确认原有 `CI` 工作流状态为 `disabled_manually`。本次没有更改它的启用状态；备份验证使用独立工作流。原有类型、lint、普通测试与构建仍可在本地执行。

## 增加的故障与灾备覆盖

- 提交后健康检查失败：确认目标数据已提交，再触发故障；使用真实保护归档执行补偿 SQL，恢复回滚前书名，保留控制日志，写入 compensated 日志并退出维护。
- 补偿连接也失败：保持维护，保留保护归档和 applying 日志，拒绝新增备份任务；已有排队任务不会继续写入。
- 部署侧 CLI 在独立进程执行：错误版本确认拒绝且目标库保持为空；真实空库恢复初始化控制区、恢复章节、失效会话，并保持源库不变。
- 维护模式下已有库离线恢复：先生成保护版本，恢复业务数据，保留历史控制日志，完成后解除维护。
- 既有真实验证继续覆盖加密归档、完整在线回滚、SQL 事务失败、旧报告拒绝、远程上传/取回/公钥拒绝、任务互斥、保留策略及中断任务识别。

## 本地运行

要求普通用户、Node ≥22、PostgreSQL 服务端和同大版本客户端（含 pg_trgm）、rclone、ssh-keygen，以及私有 IPv4 网卡。脚本优先发现 PATH 中的 initdb，再搜索 `/usr/lib/postgresql/*/bin`；工具取自相同目录。

```bash
npm run test:backup-integration

# 非默认工具位置
BACKUP_TEST_PG_BIN=/usr/lib/postgresql/18/bin \
BACKUP_TEST_RCLONE_PATH=/path/to/rclone \
npm run test:backup-integration
```

本阶段只验证隔离测试库与临时 SFTP，不对线上数据库执行回滚，不自动重启或部署线上服务。

## 验证结果

- 本机 PostgreSQL 18 同版本工具与 rclone 1.75.1：备份目录 9 个测试文件、64 项全部通过，零跳过，其中五个真实集成文件共 26 项。
- 工具不存在时脚本返回非零退出码，临时目录被清理；完整测试完成后，临时 PostgreSQL/SFTP 服务停止并删除集群目录。
- API 类型检查、构建、本次修改文件 ESLint、Prettier 和 Git diff 检查通过。

本地结果不能替代 GitHub 首次运行结果；CI 使用 PostgreSQL 16 的执行结果需在新工作流推送后查看。
