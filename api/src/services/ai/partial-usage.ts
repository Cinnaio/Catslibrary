import type { Db } from '../../db/pool'
import type { AiChatResult } from './client'
import { recordUsage, type UsageRecord } from './usage'
import { usageAuditFields } from './upstream-usage'

/** Only received usage/exact billing is recorded. Missing cost remains explicitly unreported. */
export function partialUsageRecorder(
  db: Db,
  context: Pick<UsageRecord, 'userId' | 'provider' | 'novelId' | 'chapterId' | 'generationType' | 'ipAddress' | 'userAgent' | 'usageId' | 'createdAt'>,
) {
  return (result: AiChatResult) =>
    recordUsage(db, {
      ...context,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costMillicents: result.cost * 100000,
      ...usageAuditFields(result),
    })
}
