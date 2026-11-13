/**
 * 广告清洗 —— 由 Novel-KV _ad-cleaner.js 平移。
 * 单一事实来源：前端（清洗阅读文本）与服务端（清洗抓取内容）共用此实现，
 * 不再需要两端镜像同步。规则以正则内联（未来可改为"规则即数据"表）。
 */

const AD_TLDS = /^(?:com|net|org|xyz|cc|vip|biz|us|in|co|info|me|top|icu|site|work)$/i

function normalizeDomainToken(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .replace(/[οо]/gi, 'o')
    .replace(/[ρр]/gi, 'p')
    .replace(/[с]/gi, 'c')
    .replace(/[м]/gi, 'm')
    .replace(/[г]/gi, 'r')
    .replace(/\s/g, '')
    .toLowerCase()
}

/** 顺序扫描混淆域名；相邻字符共享空白的重复正则会在缺少域名后缀时指数回溯。 */
function stripObfuscatedDomains(text: string): string {
  const nameCharacter = /[a-zA-Z0-9À-ɏͰ-ϿЀ-ӿＡ-Ｚａ-ｚ]/iu
  const suffixCharacter = /[a-zA-ZÀ-ɏͰ-ϿЀ-ӿＡ-Ｚａ-ｚ]/iu
  const whitespace = /\s/u
  const parts: string[] = []
  let start = 0
  let letters = 0
  let copied = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (nameCharacter.test(char)) {
      letters++
      continue
    }
    if (whitespace.test(char)) continue
    if (letters >= 2 && (char === '.' || char === '。' || char === '．')) {
      let end = i + 1
      let suffixLetters = 0
      // 每个后缀最多扫描两次（前瞻和下一段名称），不会从每个起点重新回溯。
      while (end < text.length) {
        if (suffixCharacter.test(text[end]!)) suffixLetters++
        else if (!whitespace.test(text[end]!)) break
        end++
      }
      if (suffixLetters >= 2 && AD_TLDS.test(normalizeDomainToken(text.slice(i + 1, end)))) {
        parts.push(text.slice(copied, start))
        copied = end
        i = end - 1
      }
    }
    start = i + 1
    letters = 0
  }
  parts.push(text.slice(copied))
  return parts.join('')
}

export function removeAdPatterns(text: string | null | undefined): string {
  if (!text) return ''
  return stripObfuscatedDomains(text)
    // 旧正文里的站点水印
    .replace(/免费精彩在线[：:]?\s*[「『【\[〔【]?\s*po1[⒏8]homes?\s*[」』】\]〕】]?/gi, '')
    .replace(/po18\s*[.·]?\s*co\s*m?\b/gi, '')
    .replace(/首[-\s]?发\s*[：:]\s*po18(?:vip|p)?\s*[.·]?\s*(?:biz|org|com|vip|net|cc|xyz)\s*[\(（][^\)）]*[\)）]/gi, '')
    .replace(/首\s*[-－—]\s*发\s*[：:]?/gi, '')
    .replace(/(?:[\[「『【(])?\s*[РрPp][oо0σ][1⒈ⅠⅠlℓ][8⒏][Rr][eе][dԁ](?:\.(?:com|net|org))?\s*[\]」』】)]?/gi, '')
    .replace(/(?:po1[⒏8]\s*[υv]ip|po18\.us|ωoо1⒏\s*υip|「?Рo1⒏[аa]rt」?|「?Рo1⒏run」?|po1\s*8rn\.co\s*m|p\s*o1\s*8ar\s*t\.co\s*m|po1\s*8ai\.c\s*o\s*m|po1\s*8qb\.c\s*om)\s*/gi, '')
    .replace(/(?:hpo18|woo(?:1[4-8])?)\s*/gi, '')
    .replace(/like\s*[.·]\s*xi/gi, '')
    // Spaced domains
    .replace(/\s*yuwang\s*kongjian\.c\s*om\s*/gi, '')
    .replace(/\s*2\s*bx\s*x\.c\s*om\s*/gi, '')
    .replace(/\s*4\s*7\s*5x\.c\s*om\s*/gi, '')
    .replace(/\s*2w8\s*9\.c\s*o\s*m\s*/gi, '')
    .replace(/\s*zui\s*jile\.c\s*om\s*/gi, '')
    .replace(/\s*powenxu\s*e1\s*6\.c\s*om\s*/gi, '')
    .replace(/\s*jizai9\.com\s*/gi, '')
    .replace(/\s*myushuwu\.com\s*/gi, '')
    .replace(/\s*yut\s*i8\.c\s*om\s*/gi, '')
    .replace(/\s*hehuan8\s*/gi, '')
    .replace(/\s*2ha\s*it\s*an\s*g\s*\.c\s*om\s*/gi, '')
    .replace(/\s*yanyushu\s*8\.c\s*om\s*/gi, '')
    .replace(/\s*y\s*uw\s*angsh\s*e\.i\s*n\s*/gi, '')
    .replace(/\s*rir\s*iwen\.c\s*om\s*/gi, '')
    .replace(/\s*ye\s*hu\s*a\s*4\.c\s*om\s*/gi, '')
    // Text garbage
    .replace(/\s*p\s*o\s*wen\s*xu\s*/gi, '')
    .replace(/\s*ta\s*ose\s*sh\s*/gi, '')
    .replace(/\s*y[ūü]\s*wan\s*/gi, '')
    // Post-cleanup: orphaned TLDs and brackets
    .replace(/\s*\.\s*(?:com|net|org|xyz|cc|vip|biz|us|in|co|info|me|top|icu|site)(?![a-zA-Z0-9À-ɏͰ-ϿЀ-ӿＡ-Ｚａ-ｚ])\s*/giu, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[（(]\s*[,，、•·\s]+[）)]/g, '')
    .replace(/[（(][^）)]*?[,，、•·]+\s*[）)]/g, (m) => {
      const inner = m.slice(1, -1).replace(/[,，、•·\s]+$/, '').trim()
      return inner ? '（' + inner + '）' : ''
    })
    .replace(/[（(]\s*[^）)]*$/g, '')
}
