import type { EntityKind, MemoryEntity } from './story-ledger'

export interface SourceName {
  text: string
  rule: 'place-possessive'
  chapterId: string
  ordinal: number
}
const ITEM_HEADS = new Set(['电闸', '铜门', '铁门', '木门', '水闸', '吊桥', '钟', '水泵', '柜子', '柜', '封箱', '账册', '钥匙', '地图', '站印'])

/** Remove one possessive particle only between a declared exact place and a
 * bounded object noun. Never apply this to people, aliases or arbitrary prose. */
export function placePossessiveName(name: string, kind: EntityKind, text: string, places: string[], sourceName?: string): { canonical: string; source: string } | undefined {
  if (kind !== 'item') return undefined
  const candidates = places.flatMap((place) => {
    if (place.length < 2 || !text.includes(place)) return []
    for (const head of ITEM_HEADS) {
      const canonical = `${place}${head}`
      const source = `${place}的${head}`
      if (name !== canonical && name !== source) continue
      if (sourceName !== undefined && sourceName !== source) continue
      // Literal co-occurrence may deliberately name two distinct objects.
      if (!text.includes(source) || text.includes(canonical)) continue
      return [{ canonical, source }]
    }
    return []
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

export const entityNames = (entity: MemoryEntity) => [entity.name, ...entity.aliases, ...(entity.sourceNames || []).map((source) => source.text)]
