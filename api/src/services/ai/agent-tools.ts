import type { AgentActionKind, AgentSession } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { escapeLike } from '../text'
import { AiError, type AiFunctionTool, type AiToolCall } from './client'
import { generationContentRevision } from './generations'
import { getEffectiveProfileForAnchor } from './profile-overrides'
import { agentDraftTitle, prepareAgentAction, readAgentArtifact, scopedAgentDraft, type AgentApi } from './agent-actions'
import { readAgentEvents, requireAgentArtifact, trackAgentArtifact } from './agent-store'
import { parseRewriteSuggestion, parseRewriteTaskParams } from './rewrite'

type Property = { type: 'string' | 'integer'; description?: string; enum?: string[]; maxLength?: number; minimum?: number; maximum?: number }
function tool(name: string, description: string, properties: Record<string, Property> = {}, required = Object.keys(properties)): AiFunctionTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }
}
const id: Property = { type: 'string', maxLength: 160 }
const instruction: Property = { type: 'string', maxLength: 4000 }
export const AGENT_TOOLS: AiFunctionTool[] = [
  tool('read_overview', '读取当前小说、冻结的续写起点和最近章节目录。首次讨论具体情节前先取材。'),
  tool('search_chapters', '在起点之前的正式章节中搜索原文或标题，返回命中片段和章节 ID。只做字面检索，不代表没有其他相关内容。', {
    query: { type: 'string', maxLength: 100 },
  }),
  tool(
    'read_chapter',
    '按章节 ID 分段读取原文；nextOffset 非空表示未读完。不能读取其他小说或续写起点之后的章节。',
    { chapterId: id, offset: { type: 'integer', minimum: 0, maximum: 1000000 } },
    ['chapterId'],
  ),
  tool('read_story_memory', '读取截至当前起点的有效风格、情节与人物关系档案；过期或未完成的档案不能当作事实。'),
  tool('list_drafts', '列出本书草稿与已发布产出，可分页。正文必须用 read_draft 读取。', { offset: { type: 'integer', minimum: 0, maximum: 10000 } }, []),
  tool('read_draft', '读取指定草稿的当前正文和 revision，改写前必须调用。', { draftId: id }),
  tool('list_covers', '列出本书封面候选的描述词与 ID。只提供文本材料，不代表你看到了图像。'),
  tool('read_task', '读取本对话生成任务的真实进度和产出。任务未完成时不反复轮询，告知用户可稍后继续。', { taskId: id }),
  tool('read_conversation', '读取更早的对话；beforeId 来自当前记录最早的事件 ID。遇到“之前的方案”应检索，不猜测。', {
    beforeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  }),
  tool(
    'generate_draft',
    '用户要求开始生成时，启动一章续写或新写草稿。仅讨论方向时不要调用。正文不会自动发布。',
    { instruction, title: { type: 'string', maxLength: 200 }, outline: { type: 'string', maxLength: 6000 } },
    ['instruction'],
  ),
  tool(
    'rewrite_draft',
    '生成选段改写建议。selectedText 必须逐字来自 read_draft；空字符串表示整章（最多6000字）。baseRevision 必须来自该次读取。不会自动覆盖草稿。',
    { draftId: id, baseRevision: id, selectedText: { type: 'string', maxLength: 12000 }, instruction: { ...instruction, maxLength: 2000 } },
  ),
  tool('refine_rewrite', '继续调整上次尚未采纳的改写建议，保留上次版本中作者未要求修改的部分。原草稿不会改变。', {
    taskId: id,
    instruction: { ...instruction, maxLength: 2000 },
  }),
  tool('generate_cover', '按用户确定的画面要求生成一张封面候选。instruction 必须是完整画面描述，会原样提交给图像服务；现有能力是重新生成，不能承诺原图局部编辑或人物完全一致。', { instruction }),
  tool('refresh_memory', '仅在用户要求更新小说分析时创建后台档案任务；会产生模型用量。', { kind: { type: 'string', enum: ['plot', 'relationship'] } }),
  tool(
    'prepare_action',
    '创建待用户确认的操作卡。只预览，不执行。apply_rewrite 的 targetId 是改写任务 ID，publish_draft 是草稿 ID，adopt_cover 是候选 ID，restore_draft 是之前已完成操作的 ID。',
    {
      kind: { type: 'string', enum: ['apply_rewrite', 'publish_draft', 'adopt_cover', 'restore_draft'] },
      targetId: id,
      title: { type: 'string', maxLength: 200 },
    },
    ['kind', 'targetId'],
  ),
]

/** Provider schemas are hints. Every tool name and argument is checked again on the server. */
export function validateAgentCall(call: AiToolCall): Record<string, string | number> {
  if (
    !call ||
    call.type !== 'function' ||
    typeof call.id !== 'string' ||
    !call.id ||
    call.id.length > 200 ||
    !call.function ||
    typeof call.function.arguments !== 'string' ||
    call.function.arguments.length > 30000
  )
    throw new AiError('invalid', '模型返回了无效的工具调用', 422)
  const definition = AGENT_TOOLS.find((t) => t.function.name === call.function.name)
  if (!definition) throw new AiError('invalid', '模型请求了未开放的工具', 422)
  let value: unknown
  try {
    value = JSON.parse(call.function.arguments)
  } catch {
    throw new AiError('invalid', '工具参数不是有效 JSON', 422)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalid', '工具参数必须是对象', 422)
  const args = value as Record<string, string | number>
  const schema = definition.function.parameters as { properties: Record<string, Property>; required: string[] }
  for (const name of schema.required) if (!(name in args)) throw new AiError('invalid', `工具缺少参数 ${name}`, 422)
  for (const [name, v] of Object.entries(args)) {
    const p = Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined
    if (!p) throw new AiError('invalid', `工具不接受参数 ${name}`, 422)
    if (p.type === 'string' && (typeof v !== 'string' || v.length > (p.maxLength ?? 8000) || (p.enum && !p.enum.includes(v))))
      throw new AiError('invalid', `工具参数 ${name} 无效`, 422)
    if (p.type === 'integer' && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (p.minimum ?? 0) || v > (p.maximum ?? 10000)))
      throw new AiError('invalid', `工具参数 ${name} 无效`, 422)
  }
  return args
}

export const AGENT_TOOL_LABELS: Record<string, string> = {
  read_overview: '读取小说和章节目录',
  search_chapters: '检索章节依据',
  read_chapter: '阅读章节原文',
  read_story_memory: '核对故事档案',
  list_drafts: '查找草稿',
  read_draft: '读取草稿',
  list_covers: '查看封面候选',
  read_task: '读取任务结果',
  read_conversation: '查阅早前对话',
  generate_draft: '生成章节草稿',
  rewrite_draft: '生成改写建议',
  refine_rewrite: '调整上一版改写建议',
  generate_cover: '生成封面候选',
  refresh_memory: '更新小说分析',
  prepare_action: '准备采纳预览',
}
export const AGENT_GENERATION_TOOLS = new Set(['generate_draft', 'rewrite_draft', 'refine_rewrite', 'generate_cover', 'refresh_memory'])

async function anchorOrder(db: Db, session: AgentSession) {
  if (!session.afterChapterId) return 0
  const anchor = await first<{ sort_order: number }>(db, 'SELECT sort_order FROM chapters WHERE id=$1 AND novel_id=$2', [
    session.afterChapterId,
    session.novelId,
  ])
  if (!anchor) throw new AiError('conflict', '此对话的续写起点已删除，请新建对话选择起点', 409)
  return Number(anchor.sort_order)
}

export async function executeAgentTool(
  db: Db,
  session: AgentSession,
  name: string,
  a: Record<string, string | number>,
  operationId: string,
  api: AgentApi,
): Promise<Record<string, unknown>> {
  if (name === 'read_overview') {
    const novel = await first<{ title: string; author: string; description: string }>(db, 'SELECT title,author,description FROM novels WHERE id=$1', [
      session.novelId,
    ])
    const boundary = await anchorOrder(db, session)
    const chapters = await all(
      db,
      'SELECT id,title,sort_order AS "sortOrder" FROM chapters WHERE novel_id=$1 AND sort_order<=$2 ORDER BY sort_order DESC,id DESC LIMIT 25',
      [session.novelId, boundary],
    )
    return {
      novel: { ...novel, description: novel?.description?.slice(0, 6000) },
      afterChapterId: session.afterChapterId,
      chapters,
      scope: '仅覆盖当前对话的续写起点及之前章节；草稿另行读取',
    }
  }
  if (name === 'search_chapters') {
    const query = String(a.query).trim()
    if (!query) throw new AiError('invalid', '检索词不能为空', 422)
    const rows = await all<{ id: string; title: string; content: string }>(
      db,
      "SELECT id,title,content FROM chapters WHERE novel_id=$1 AND sort_order<=$2 AND (title ILIKE $3 ESCAPE '\\' OR content ILIKE $3 ESCAPE '\\') ORDER BY sort_order DESC LIMIT 8",
      [session.novelId, await anchorOrder(db, session), `%${escapeLike(query)}%`],
    )
    return {
      matches: rows.map((r) => {
        const at = Math.max(0, r.content.toLowerCase().indexOf(query.toLowerCase()))
        const offset = Math.max(0, at - 250)
        return { id: r.id, title: r.title, offset, excerpt: r.content.slice(offset, offset + 1200) }
      }),
      limited: true,
    }
  }
  if (name === 'read_chapter') {
    const r = await first<{ id: string; title: string; content: string }>(
      db,
      'SELECT id,title,content FROM chapters WHERE id=$1 AND novel_id=$2 AND sort_order<=$3',
      [a.chapterId, session.novelId, await anchorOrder(db, session)],
    )
    if (!r) throw new AiError('invalid', '章节不在当前小说与起点范围内', 404)
    const offset = Number(a.offset || 0)
    return {
      id: r.id,
      title: r.title,
      content: r.content.slice(offset, offset + 12000),
      offset,
      nextOffset: offset + 12000 < r.content.length ? offset + 12000 : null,
    }
  }
  if (name === 'read_story_memory') {
    if (!session.afterChapterId) return { profiles: [], message: '当前起点没有正式章节' }
    const profiles = []
    for (const kind of ['style', 'plot', 'relationship'] as const) {
      const p = await getEffectiveProfileForAnchor(db, { kind, novelId: session.novelId, afterChapterId: session.afterChapterId })
      profiles.push({
        kind,
        eligibility: p.eligibility,
        origin: p.effectiveOrigin,
        content: p.effectiveContent.slice(0, 10000),
        truncated: p.effectiveContent.length > 10000,
        source: p.source,
      })
    }
    return { profiles }
  }
  if (name === 'list_drafts')
    return {
      drafts: await all(
        db,
        "SELECT id,kind,status,LEFT(result,140) AS excerpt FROM ai_generations WHERE novel_id=$1 AND deleted_at=0 AND kind IN ('continue','write_chapter','write_outline') ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2",
        [session.novelId, Number(a.offset || 0)],
      ),
    }
  if (name === 'read_draft') {
    const draft = await scopedAgentDraft(db, session, String(a.draftId))
    return { id: draft.id, title: agentDraftTitle(draft), status: draft.status, content: draft.result, revision: generationContentRevision(draft.result) }
  }
  if (name === 'list_covers')
    return {
      candidates: await all(db, 'SELECT id,prompt,task_id AS "taskId" FROM ai_cover_candidates WHERE novel_id=$1 ORDER BY created_at DESC LIMIT 20', [
        session.novelId,
      ]),
    }
  if (name === 'read_task') return { ...(await readAgentArtifact(db, session, String(a.taskId))) }
  if (name === 'read_conversation') return readAgentEvents(db, session.id, Number(a.beforeId), 20)
  if (name === 'prepare_action') return { action: await prepareAgentAction(db, session, a.kind as AgentActionKind, String(a.targetId), String(a.title || '')) }
  let receipt: Record<string, unknown>
  if (name === 'generate_draft') {
    if (!String(a.instruction).trim()) throw new AiError('invalid', '请先确定本章创作要求', 422)
    receipt = await api(`/api/ai/writing/${session.afterChapterId ? 'continue' : 'chapter'}`, 'POST', {
      novelId: session.novelId,
      title: a.title || session.novelTitle,
      instruction: a.instruction,
      outline: a.outline || '',
      chapterCount: 1,
      afterChapterId: session.afterChapterId || undefined,
      contentPreferences: session.contentPreferences,
      operationId,
    })
  } else if (name === 'rewrite_draft') {
    const draft = await scopedAgentDraft(db, session, String(a.draftId))
    if (draft.status !== 'draft' || !['continue', 'write_chapter'].includes(draft.kind)) throw new AiError('conflict', '只能改写未发布的章节草稿', 409)
    if (generationContentRevision(draft.result) !== a.baseRevision) throw new AiError('conflict', '草稿已变化，请重新读取后改写', 409)
    const selectedText = String(a.selectedText) || draft.result
    const start = draft.result.indexOf(selectedText)
    if (start < 0 || draft.result.indexOf(selectedText, start + 1) >= 0) throw new AiError('invalid', '选段必须在当前草稿中唯一匹配，请提供更完整的原文', 422)
    receipt = await api(`/api/ai/writing/drafts/${encodeURIComponent(draft.id)}/rewrite`, 'POST', {
      baseRevision: a.baseRevision,
      startUTF16: start,
      endUTF16: start + selectedText.length,
      selectedText,
      mode: 'custom',
      instruction: a.instruction,
      clientRequestId: operationId,
    })
  } else if (name === 'refine_rewrite') {
    const previous = await requireAgentArtifact(db, session.id, String(a.taskId))
    const params = parseRewriteTaskParams(JSON.parse(previous.params || '{}'))
    const suggestion = params ? parseRewriteSuggestion(previous.result, params) : undefined
    if (previous.kind !== 'rewrite_selection' || previous.status !== 'completed' || !params || !suggestion)
      throw new AiError('invalid', '上次改写尚未完成或结果无效', 409)
    const draft = await scopedAgentDraft(db, session, params.draftId)
    if (draft.status !== 'draft' || generationContentRevision(draft.result) !== params.baseRevision)
      throw new AiError('conflict', '草稿已经变化，请读取当前正文后重新改写', 409)
    receipt = await api(`/api/ai/writing/drafts/${encodeURIComponent(draft.id)}/rewrite`, 'POST', {
      baseRevision: params.baseRevision,
      startUTF16: params.startUTF16,
      endUTF16: params.endUTF16,
      selectedText: params.selectedText,
      mode: 'custom',
      instruction: a.instruction,
      previousTaskId: previous.id,
      clientRequestId: operationId,
    })
  } else if (name === 'generate_cover') {
    if (!String(a.instruction).trim()) throw new AiError('invalid', '请先确定封面画面要求', 422)
    receipt = await api('/api/ai/cover/generate', 'POST', { novelId: session.novelId, prompt: a.instruction, promptMode: 'exact', operationId })
  } else if (name === 'refresh_memory') {
    if (!session.afterChapterId) throw new AiError('invalid', '当前对话起点没有正式章节，请发布后新建对话再更新分析', 422)
    await anchorOrder(db, session)
    receipt = await api(`/api/ai/writing/memory/${a.kind}/${encodeURIComponent(session.novelId)}/start`, 'POST', {
      afterChapterId: session.afterChapterId,
    })
    const task = receipt.task as { id?: string; taskId?: string } | undefined
    receipt = { ...receipt, taskId: task?.id || task?.taskId || receipt.taskId }
  } else throw new AiError('invalid', '未开放的工具', 422)
  const taskId = String(receipt.taskId || '')
  if (!taskId) throw new AiError('upstream', '生成接口未返回任务标识，请在任务中心检查后再继续', 502)
  await trackAgentArtifact(db, session.id, taskId)
  return { taskId, status: 'submitted', message: '任务已提交，尚未生成完成。可以在产出区查看进度；结果不会自动采纳。' }
}
