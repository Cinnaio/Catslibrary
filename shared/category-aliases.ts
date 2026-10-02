/** Explicit display aliases only; do not merge tags with merely similar meanings. */
const CATEGORY_ALIASES = [
  ['校园', '校園'],
  ['现代', '現代'],
  ['青梅竹马', '青梅竹馬'],
  ['轻松', '輕鬆'],
]

export function canonicalCategory(name: string): string {
  return CATEGORY_ALIASES.find((aliases) => aliases.includes(name))?.[0] || name
}

export function categoryAliases(name: string): string[] {
  return CATEGORY_ALIASES.find((aliases) => aliases.includes(name)) || [name]
}
