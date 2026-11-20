import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { beginAgentTurn, createAgentSession, getAgentSession, readAgentEvents } from './agent-store'
import {
  createWritingReference,
  changeWritingReference,
  listWritingReferences,
  referenceSelection,
  snapshotWritingReferences,
} from './agent-writing-references'
import { agentWritingMaterials, resolveAgentWritingContext } from './agent-writing'

let t: TestDb
const input = { title: '雨夜重逢', tags: ['氛围', '慢节奏'], content: '先描写雨声，再让对话逐步推进。', usage: '只参考节奏，人物以原书为准。' }
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  for (const id of ['reference-author', 'reference-other'])
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','test','test',1,1)", [id])
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('reference-book','参考测试',1,1)")
})
afterAll(async () => {
  await t?.close()
})
const finish = (id: string, status = 'completed') => t.db.query('UPDATE ai_tasks SET status=$2 WHERE id=$1', [id, status])
const params = async (id: string) => JSON.parse((await first<{ params: string }>(t.db, 'SELECT params FROM ai_tasks WHERE id=$1', [id]))!.params)

it('keeps the personal library isolated, searches tags and protects edited versions', async () => {
  const card = await createWritingReference(t.db, 'reference-author', input)
  expect((await listWritingReferences(t.db, 'reference-author', '慢节奏')).references.map((item) => item.id)).toContain(card.id)
  expect((await listWritingReferences(t.db, 'reference-other')).references).toEqual([])
  await expect(changeWritingReference(t.db, 'reference-other', card.id, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ status: 404 })
  const edited = await changeWritingReference(t.db, 'reference-author', card.id, { ...input, title: '新版雨夜', expectedRevision: 1 })
  expect(edited.revision).toBe(2)
  await expect(changeWritingReference(t.db, 'reference-author', card.id, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
})
it('freezes a turn snapshot, keeps one-turn selection out of defaults and replays without rereading changed cards', async () => {
  const session = await createAgentSession(t.db, 'reference-author', { novelId: 'reference-book' })
  const card = await createWritingReference(t.db, 'reference-author', input)
  const selection = { ids: [card.id], scope: 'turn' as const }
  const turn = await beginAgentTurn(t.db, 'reference-author', session.id, '参考所选素材续写', 'reference-turn-one', undefined, '', selection)
  await finish(turn.taskId)
  await changeWritingReference(t.db, 'reference-author', card.id, { ...input, content: '后来的新素材', expectedRevision: 1 })
  expect((await params(turn.taskId)).writingReferences[0]).toMatchObject({ id: card.id, content: input.content, revision: 1 })
  expect((await getAgentSession(t.db, 'reference-author', session.id)).writingReferenceIds).toEqual([])
  expect(await beginAgentTurn(t.db, 'reference-author', session.id, '参考所选素材续写', 'reference-turn-one', undefined, '', selection)).toEqual({
    taskId: turn.taskId,
    created: false,
  })
  await expect(
    beginAgentTurn(t.db, 'reference-author', session.id, '参考所选素材续写', 'reference-turn-one', undefined, '', { ids: [], scope: 'turn' }),
  ).rejects.toMatchObject({ status: 409 })
  expect((await readAgentEvents(t.db, session.id)).events[0]?.metadata.writingReferences).toEqual([{ id: card.id, title: card.title, revision: 1 }])
})
it('persists conversation selections, allows a one-turn override, and explicitly clears defaults', async () => {
  const session = await createAgentSession(t.db, 'reference-author', { novelId: 'reference-book' })
  const card = await createWritingReference(t.db, 'reference-author', input)
  const firstTurn = await beginAgentTurn(t.db, 'reference-author', session.id, '继续参考', 'reference-persist-one', undefined, '', {
    ids: [card.id],
    scope: 'session',
  })
  await finish(firstTurn.taskId)
  const override = await beginAgentTurn(t.db, 'reference-author', session.id, '本轮不使用', 'reference-persist-two', undefined, '', { ids: [], scope: 'turn' })
  expect((await params(override.taskId)).writingReferences).toEqual([])
  await finish(override.taskId)
  const inherited = await beginAgentTurn(t.db, 'reference-author', session.id, '继续', 'reference-persist-three')
  expect((await params(inherited.taskId)).writingReferences[0].id).toBe(card.id)
  await finish(inherited.taskId)
  const cleared = await beginAgentTurn(t.db, 'reference-author', session.id, '停止使用参考', 'reference-persist-four', undefined, '', {
    ids: [],
    scope: 'session',
  })
  expect((await getAgentSession(t.db, 'reference-author', session.id)).writingReferenceIds).toEqual([])
  expect((await params(cleared.taskId)).writingReferences).toEqual([])
  await finish(cleared.taskId)
})
it('hands the saved material to writing tasks as reference data and rejects a foreign author turn', async () => {
  const session = await createAgentSession(t.db, 'reference-author', { novelId: 'reference-book' })
  const card = await createWritingReference(t.db, 'reference-author', input)
  const turn = await beginAgentTurn(t.db, 'reference-author', session.id, '扩写正文', 'reference-handoff-one', undefined, '', { ids: [card.id], scope: 'turn' })
  await finish(turn.taskId)
  await changeWritingReference(t.db, 'reference-author', card.id, { expectedRevision: 1 }, true)
  const context = await resolveAgentWritingContext(
    t.db,
    { userId: 'reference-author', novelId: session.novelId },
    { sessionId: session.id, authorTaskId: turn.taskId },
  )
  expect(context?.writingReferences?.[0]).toMatchObject({ id: card.id, content: input.content })
  const material = agentWritingMaterials(context!)
  expect(material.references[0]?.kind).toBe('user_context')
  expect(material.references[0]?.text).toContain(input.content)
  expect(material.authors.some((item) => item.text.includes('保留原书人物性格'))).toBe(true)
  const other = await createAgentSession(t.db, 'reference-other', { novelId: 'reference-book' })
  await expect(
    resolveAgentWritingContext(t.db, { userId: 'reference-other', novelId: other.novelId }, { sessionId: other.id, authorTaskId: turn.taskId }),
  ).rejects.toMatchObject({ status: 422 })
})
it('recovers using the original snapshot even after its card has been archived', async () => {
  const session = await createAgentSession(t.db, 'reference-author', { novelId: 'reference-book' })
  const card = await createWritingReference(t.db, 'reference-author', input)
  const original = await beginAgentTurn(t.db, 'reference-author', session.id, '继续写作', 'reference-recovery-one', undefined, '', {
    ids: [card.id],
    scope: 'session',
  })
  await finish(original.taskId, 'failed')
  await changeWritingReference(t.db, 'reference-author', card.id, { expectedRevision: 1 }, true)
  const recovered = await beginAgentTurn(t.db, 'reference-author', session.id, '继续整理', 'reference-recovery-two', undefined, original.taskId)
  expect((await params(recovered.taskId)).writingReferences).toEqual((await params(original.taskId)).writingReferences)
  await finish(recovered.taskId)
  expect(await snapshotWritingReferences(t.db, 'reference-author', [card.id], false)).toEqual([])
  await expect(snapshotWritingReferences(t.db, 'reference-author', [card.id])).rejects.toMatchObject({ status: 409 })
})
it('rejects foreign cards without creating a turn or changing persistent defaults', async () => {
  const session = await createAgentSession(t.db, 'reference-other', { novelId: 'reference-book' })
  const card = await createWritingReference(t.db, 'reference-author', input)
  await expect(
    beginAgentTurn(t.db, 'reference-other', session.id, '试用参考', 'reference-foreign-one', undefined, '', { ids: [card.id], scope: 'session' }),
  ).rejects.toMatchObject({ status: 409 })
  expect((await readAgentEvents(t.db, session.id)).events).toEqual([])
  expect((await getAgentSession(t.db, 'reference-other', session.id)).writingReferenceIds).toEqual([])
})
it('validates selection size, card fields and aggregate budget without truncating', async () => {
  expect(() => referenceSelection({ ids: ['duplicate', 'duplicate'], scope: 'turn' })).toThrow()
  expect(() => referenceSelection({ ids: Array.from({ length: 7 }, (_, i) => `card-${i}`), scope: 'turn' })).toThrow()
  expect(() => referenceSelection({ ids: [], scope: 'all' })).toThrow()
  await expect(createWritingReference(t.db, 'reference-author', { ...input, content: '字'.repeat(8001) })).rejects.toMatchObject({ status: 422 })
  const cards = []
  for (let i = 0; i < 3; i++) cards.push(await createWritingReference(t.db, 'reference-author', { ...input, content: '字'.repeat(8000) }))
  await expect(
    snapshotWritingReferences(
      t.db,
      'reference-author',
      cards.map((item) => item.id),
    ),
  ).rejects.toMatchObject({ status: 422 })
})
