import type { DbClient } from '../../db/pool'
import { newId } from '../auth'

/** Called in the same transaction as the explicitly saved change. */
export async function recordWritingEdit(db: DbClient, userId: string, novelId: string, draftId: string, before: string, after: string) {
  if (!userId || !novelId || before === after) return
  await db.query(`INSERT INTO ai_writing_edit_samples(id,user_id,novel_id,draft_id,before_text,after_text,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [newId('writingedit'), userId, novelId, draftId, before, after, Date.now()])
}
