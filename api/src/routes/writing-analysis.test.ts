import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisKind } from '@shared/novel-analysis'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { captureAnalysisSources } from '../services/ai/novel-analysis-source'
import { generateWriting, generateContinuationChapters } from '../services/ai/writing'
import { updateAiTask } from '../services/ai/tasks'

vi.mock('../services/ai/client', async original => ({ ...(await original<typeof import('../services/ai/client')>()), isTextAiConfigured: () => true }))
vi.mock('../services/ai/writing', async original => ({ ...(await original<typeof import('../services/ai/writing')>()),
  generateWriting: vi.fn(async () => ({})),
  generateContinuationChapters: vi.fn(async (db, opts) => { await updateAiTask(db, opts.taskId, { status: 'completed' }); return {} }),
}))
let t: TestDb, token: string
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  const response = await app.request('/api/auth/bootstrap-admin', json({ username: 'analysisadmin', password: 'analysispass123' }))
  token = (await response.json() as { token: string }).token
}, 120_000)
beforeEach(async () => {
  await t.db.query('DELETE FROM novels'); await t.db.query('DELETE FROM ai_tasks')
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试作品',1,1),('other','其他作品',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','第一章','旧信仍在抽屉。',1,1),('c2','book','第二章','信已交出。',2,1)")
  vi.mocked(generateWriting).mockClear(); vi.mocked(generateContinuationChapters).mockClear()
})
afterAll(async () => { setDbForTests(null); vi.unstubAllEnvs(); await t.close() })
async function report(end = 'c1', id = 'report', kind: AnalysisKind = 'plot', edited = '人工修订：信尚未交出。') {
  const input = { kind, startChapterId: 'c1', endChapterId: end, question: '' }
  const sources = await captureAnalysisSources(t.db, 'book', input)
  await t.db.query(`INSERT INTO novel_analysis_reports(id,novel_id,user_id,request_id,request_json,source_json,content,edited_content,task_id,created_at,updated_at)
    VALUES($1,'book','author',$1,$2::jsonb,$3::jsonb,'原分析',$4,'deleted-task',1,1)`, [id, JSON.stringify(input), JSON.stringify(sources), edited])
}
it('预览使用同书报告的人工修订；陈旧、未来和外书报告在提交前被拒绝', async () => {
  await report()
  const input = { novelId: 'book', afterChapterId: 'c1', analysisReferences: [{ reportId: 'report', revision: 1 }] }
  const response = await app.request('/api/ai/writing/materials', json(input))
  expect(response.status).toBe(200)
  const preview = await response.json() as any
  expect(JSON.stringify(preview.plan)).toContain('人工修订：信尚未交出')
  expect(preview.analysisReferences[0]).toMatchObject({ id: 'report', revision: 1, startChapter: { id: 'c1' } })
  expect(JSON.stringify(preview.plan)).not.toContain('原分析')
  await t.db.query("UPDATE novel_analysis_reports SET revision=2 WHERE id='report'")
  expect((await app.request('/api/ai/writing/continue', json(input))).status).toBe(409)
  await report('c2', 'future')
  expect((await app.request('/api/ai/writing/continue', json({ ...input, analysisReferences: [{ reportId: 'future', revision: 1 }] }))).status).toBe(409)
  expect((await app.request('/api/ai/writing/continue', json({ ...input, novelId: 'other', afterChapterId: undefined }))).status).toBe(422)
  await t.db.query("UPDATE chapters SET content='正文变更' WHERE id='c1'")
  expect((await app.request('/api/ai/writing/materials', json({ ...input, analysisReferences: [{ reportId: 'report', revision: 2 }] }))).status).toBe(409)
  expect(generateContinuationChapters).not.toHaveBeenCalled()
})
it('续写预览把所选文风报告用作独立参考，生成冻结同一修订版本', async () => {
  await report()
  const styleNotes = '用短句写动作，按说话人另起一段。'
  await report('c1', 'style-report', 'style', styleNotes)
  const input = { novelId: 'book', afterChapterId: 'c1', analysisReferences: [{ reportId: 'report', revision: 1 }, { reportId: 'style-report', revision: 1 }] }
  const response = await app.request('/api/ai/writing/materials', json(input))
  expect(response.status).toBe(200)
  const preview = await response.json() as any
  expect(preview.plan.style).toEqual([{ id: 'novel-style-analysis', kind: 'analysis_report', text: expect.stringContaining(styleNotes),
    source: { field: 'novel_analysis_reports' }, priority: 50 }])
  expect(JSON.stringify(preview.plan.currentState)).toContain('人工修订：信尚未交出。')
  expect(JSON.stringify(preview.plan.currentState)).not.toContain(styleNotes)
  const started = await app.request('/api/ai/writing/continue', json({ ...input, materialRevision: preview.revision }))
  expect(started.status).toBe(202)
  expect(vi.mocked(generateContinuationChapters).mock.calls.at(-1)?.[1].continuationSnapshot?.analysisReferences).toContainEqual(
    expect.objectContaining({ id: 'style-report', kind: 'style', content: styleNotes, revision: 1 }),
  )
})
it('没有档案或报告仍可续写，新任务冻结正文与报告，并以当前原文校验重试', async () => {
  const input = { novelId: 'book', afterChapterId: 'c1', analysisReferences: [] }
  const first = await app.request('/api/ai/writing/continue', json(input))
  expect(first.status).toBe(202)
  expect(vi.mocked(generateContinuationChapters).mock.calls[0]?.[1].continuationSnapshot).toMatchObject({ version: 2, analysisReferences: [] })
  await report()
  const response = await app.request('/api/ai/writing/continue', json({ ...input, analysisReferences: [{ reportId: 'report', revision: 1 }] }))
  expect(response.status).toBe(202)
  const { taskId } = await response.json() as { taskId: string }
  await t.db.query("UPDATE ai_tasks SET status='failed' WHERE id=$1", [taskId])
  await t.db.query("UPDATE novel_analysis_reports SET revision=2 WHERE id='report'")
  const retry = await app.request(`/api/ai/tasks/${taskId}/retry`, json({ operationId: 'retry-analysis' }))
  expect(retry.status).toBe(409)
})
it('空起点的新写与重试不会自动加载后来发布的正文；大纲正常使用所选起点', async () => {
  const response = await app.request('/api/ai/writing/chapter', json({ novelId: 'book', title: '开篇', afterChapterId: null, analysisReferences: [] }))
  expect(response.status).toBe(202)
  expect(vi.mocked(generateWriting).mock.calls.at(-1)?.[1]).toMatchObject({ context: '' })
  expect(vi.mocked(generateWriting).mock.calls.at(-1)?.[1].continuationSnapshot).toBeUndefined()
  const { taskId } = await response.json() as { taskId: string }
  const stored = (await t.db.query<{ params: string }>('SELECT params FROM ai_tasks WHERE id=$1', [taskId])).rows[0]!
  expect(JSON.parse(stored.params)).toMatchObject({ afterChapterId: null, analysisReferences: [], analysisContextVersion: 2 })
  await t.db.query("UPDATE ai_tasks SET status='failed' WHERE id=$1", [taskId])
  expect((await app.request(`/api/ai/tasks/${taskId}/retry`, json({ operationId: 'empty-anchor-retry' }))).status).toBe(202)
  expect(vi.mocked(generateWriting).mock.calls.at(-1)?.[1].continuationSnapshot).toBeUndefined()
  expect((await app.request('/api/ai/writing/outline', json({ novelId: 'book', title: '大纲', afterChapterId: 'c1', analysisReferences: [] }))).status).toBe(202)
  expect(vi.mocked(generateWriting).mock.calls.at(-1)?.[1].context).toContain('旧信仍在抽屉')
})
it.each(['/style-profile', '/style-profile/book', '/plot-state', '/relationship-profile', '/memory/plot/book/start', '/memory/book/rebuild', '/profiles/plot/book/override'])('旧档案入口 %s 明确停用且不启动模型', async path => {
  expect((await app.request(`/api/ai/writing${path}`, json({ novelId: 'book' }))).status).toBe(410)
  expect((await app.request(`/api/ai/writing${path}`, { method: 'POST' })).status).toBe(401)
  expect(generateWriting).not.toHaveBeenCalled()
})
