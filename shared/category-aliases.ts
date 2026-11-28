/** Explicit spelling aliases only; tags with merely similar meanings stay separate.
 * Keep the original labels in storage. Both display and API filtering use this list.
 */
const CATEGORY_ALIASES = [
  ['校园', '校園'],
  ['现代', '現代'],
  ['青梅竹马', '青梅竹馬'],
  ['轻松', '輕鬆'],
  ['系统', '系統'],
  ['人兽', '人獸'],
  ['都会', '都會'],
  ['宫斗', '宮鬥'],
  ['现代言情', '現代言情'],
  ['现言', '現言'],
  ['娱乐圈', '娛樂圈'],
  ['规则怪谈', '規則怪談'],
  ['豪门世家', '豪門世家'],
  ['豪门总裁', '豪門總裁'],
  ['灵魂互换', '靈魂互換'],
  ['欢喜冤家', '歡喜冤家'],
  ['先婚后爱', '先婚後愛'],
  ['破镜重圆', '破鏡重圓'],
  ['强取豪夺', '強取豪奪'],
  ['强制', '強制'],
  ['双向奔赴', '雙向奔赴'],
  ['团宠', '團寵'],
  ['伪骨', '偽骨'],
  ['强强', '強強'],
  ['双女主', '雙女主'],
  ['双处', '雙處'],
  ['男处', '男處'],
  ['调教', '調教'],
  ['纯肉', '純肉'],
  ['简体版', '簡體版'],
  ['繁体版', '繁體版'],
  ['1v1', '1V1', '１ｖ１', '１Ｖ１'],
  ['1vN', '1vn', '1VN', '1Vn'],
  ['BG', 'bg', 'Bg', 'bG', 'ＢＧ', 'ｂｇ'],
  ['NP', 'np', 'Np', 'nP', 'ＮＰ', 'ｎｐ'],
  ['H', 'h', 'Ｈ', 'ｈ'],
  ['高H', '高h', '高Ｈ', '高ｈ'],
  ['SM', 'sm', 'Sm', 'sM', 'ＳＭ', 'ｓｍ'],
  ['futa', 'FUTA', 'Futa'],
]

export function canonicalCategory(name: string): string {
  return CATEGORY_ALIASES.find((aliases) => aliases.includes(name))?.[0] || name
}

export function categoryAliases(name: string): string[] {
  return CATEGORY_ALIASES.find((aliases) => aliases.includes(name)) || [name]
}
