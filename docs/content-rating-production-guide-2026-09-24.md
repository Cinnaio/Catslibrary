# 内容分级生产部署与核验

- 更新：2026-09-24
- 范围：`R18 ≡ content_rating = 'restricted'`、成人分类标签与文本规则初判、存量自动预填
- 状态：代码与自动化测试已完成；真实生产库仍需按下文核验

## 发布后的行为

读者的成人内容总开关、个人安全/成人模式与 18 岁确认继续生效。作品是否属于 R18 只看 `novels.content_rating`：`restricted` 隐藏于安全模式，`general` 与 `unknown` 可见。`unknown` 表示**待标注**，不是“已认证安全”。

新建作品时，API 根据成人分类标签（精确匹配）或标题、简介中的限制级文本特征初判；命中写 `restricted`，否则写 `unknown`，绝不自动写 `general`。后台表单默认发送的 `unknown` 也会触发初判。作品仍为 `unknown` 时，后台编辑、源站元数据同步或分类维护会补判；人工指定的 `general` / `restricted` 优先保留。

每次 API 启动，迁移完成后、监听端口前，都会对仍为 `unknown` 的存量作品运行一次预填。预填只把规则命中的书改为 `restricted`，不覆盖已标注作品，也不刷新 `updated_at`。首次安装向导连接已有库时同样运行预填。预填失败会阻止 API 正常对外提供服务。

分类栏另按显式成人标签集合过滤；它不再复用作品的文本正则。LLM 判级未纳入这次发布。

## 发布顺序

1. 在部署环境取得包含本次改动的代码。若在服务器上从源码构建，运行 `npm ci` 和 `npm run build`。构建会把数据库迁移复制到 `api/dist/migrations`；不能省略。
2. 停止旧 API，启动新 API。启动流程依次执行迁移、自动预填，完成后才监听端口。优先在新 API 正常启动后再发布新前端资源。
3. 在启动日志中确认出现 `content rating prefill: scanned=..., applied=..., unknown=...`，且随后出现 `listening on ...`。首次部署应同时看到 `032_novel_content_rating.sql` 被应用，或迁移日志显示已是最新。
4. 用后台「小说管理 → 仅看未标注」复核剩余 `unknown`；误判作品应明确改成 `general`，不能仅用脚本退回 `unknown`（下次 API 启动仍可能重新判为 `restricted`）。

**不要只执行迁移就发布新前端。** 新前端只读分级字段；迁移刚完成时旧书默认全为 `unknown`。自动预填必须成功，API 才能开放访问。

历史测试库在 2026-09-24 有 398 本：旧文本规则命中 202 本，追加标签规则预计再覆盖 128 本，剩余约 68 本待标注。这些是当日旧库快照，**不是生产库保证值**。实际部署以日志和查询为准。

## 核验

在能连接生产数据库的服务器上执行：

```sql
SELECT content_rating, COUNT(*) FROM novels GROUP BY content_rating ORDER BY content_rating;
SELECT COUNT(*) FROM novels WHERE content_rating = 'unknown';
```

再用后台和前台检查三类样本：一部成人标签作品应为 `restricted` 并从安全模式消失；一部人工标成 `general` 的作品应保留可见；一部仍为 `unknown` 的作品应出现在待标注列表。切换到已确认的成人模式后，`restricted` 作品应可见。安全模式分类栏不应出现成人标签。

如需先查看当前库未标注书会命中哪些规则，可在能连库的服务器运行：

```bash
npx tsx scripts/prefill-content-rating.ts --dry-run
```

这个命令只读；新 API 首次成功启动后通常已自动预填，所以此时命中数应为 0。独立脚本的正式执行与 `--undo` 是运维补救工具，不是常规发布步骤；`--undo` 会把原本隐藏的作品放回 `unknown`，应先评估前台可见性，并在下一次自动预填前完成明确的人工标注。

## 当前边界

规则初判是枚举法，不能证明剩余 `unknown` 作品安全。中等置信标签（如 `兄妹`、`强制`）可能包含题材歧义；其自动命中项需要人工抽检。若将来增加 LLM 初判，应先记录判定来源、模型版本和理由，再设计人工复核流程。当前版本不做 LLM 判级。
