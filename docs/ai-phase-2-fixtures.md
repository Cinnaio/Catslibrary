# 第二批 B6 固定夹具

夹具的机器可执行定义在 API 仓库的 [`phase2-fixtures.ts`](../../zhi-zhou/api/src/services/ai/phase2-fixtures.ts)，测试在 [`phase2-fixtures.test.ts`](../../zhi-zhou/api/src/services/ai/phase2-fixtures.test.ts)。它们只使用仓库自写的短文本，不读取生产小说、真实账号或外部图片，也不会调用文本或图像供应商。

## 续写六组

| ID | 场景 | 章节数 | 预期文本调用 |
| --- | --- | ---: | ---: |
| `writing-history-anchor` | 历史起点 | 1 | 1 |
| `writing-long-tail` | 长章末尾 | 1 | 1 |
| `writing-multi-relations` | 多人关系 | 1 | 1 |
| `writing-timeline` | 时间线核对 | 1 | 1 |
| `writing-low-conflict` | 低冲突节奏 | 1 | 1 |
| `writing-multi-chapter-goals` | 多章目标 | 3 | 3 |

每组都带固定起点、有限上下文、`writingBrief V1` 和每章目标。测试会用服务端同一套 Unicode 标量与章节范围校验重新规范化，并确认每个目标只属于本批范围。

## 封面六组

| ID | 场景 | prompt 模式 | 渲染书名 | 构图 | 预期调用 |
| --- | --- | --- | --- | --- | --- |
| `cover-title-layer` | 文字层 | `auto` | 是 | 环境叙事 | 文本 2、图像 1 |
| `cover-exact-prompt` | 完整描述词 | `exact` | 否 | 关键物件 | 文本 0、图像 1 |
| `cover-duo-relationship` | 双人物关系 | `auto` | 是 | 双人关系 | 文本 2、图像 1 |
| `cover-environment` | 环境叙事 | `auto` | 是 | 环境叙事 | 文本 2、图像 1 |
| `cover-symbolic-object` | 关键物件 | `auto` | 否 | 关键物件 | 文本 2、图像 1 |
| `cover-long-prompt` | 长描述词编辑 | `exact` | 否 | 非对称构图 | 文本 0、图像 1 |

auto 夹具只填简介和分类，`prompt` 保持空值；测试会确认两次文本调用分别用于题材判定和画面描述。`exact` 固定为完整描述词语义，构图至少四种且描述词不超过服务端上限。

## 固定调用预算

自动夹具的声明预算是：续写文本 8 次、封面文本 8 次、封面图像 6 次。每个 auto 封面固定两次文本调用（题材判定 + 画面描述），每个 exact 封面不调用文本；这是验证调用次数与任务来源的上限基线，不是费用估算；没有真实模型授权时不写入金额。

在 API 仓库执行：

```text
npm run test -- --run src/services/ai/phase2-fixtures.test.ts
```

该命令只运行三条确定性结构检查，不产生上游网络请求。
