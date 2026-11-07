// Synthetic data only, in a newly created loopback PostgreSQL cluster.
// BOOK_BENCH_PG_BIN=/path/to/postgres/bin node --import tsx scripts/benchmark-book-search.mjs
// Set TSX_TSCONFIG_PATH=api/tsconfig.json when running outside that workspace.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { searchableChapterText, searchBook, parseSearchCursor } from '../api/src/services/book-search.ts'
import { bookMatchPattern } from '../shared/book-search.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(path.join(tmpdir(), 'zz-book-bench-'))
const bin = process.env.BOOK_BENCH_PG_BIN
const locale = process.env.BOOK_BENCH_LOCALE || 'C'
if (!bin) throw new Error('BOOK_BENCH_PG_BIN must point to PostgreSQL server binaries')
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key]
const exe = (name) => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
async function run(name, args) {
  const child = spawn(exe(name), args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  const [code] = await once(child, 'exit')
  if (code) throw new Error(`${name} failed: ${output}`)
  return output.trim()
}
async function timing(fn, runs = 7, prepare) {
  await prepare?.()
  await fn()
  const samples = []
  for (let i = 0; i < runs; i++) {
    await prepare?.()
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: +samples[Math.floor(runs / 2)].toFixed(2), maxMs: +samples.at(-1).toFixed(2), runs }
}
// Frozen reference: the pre-cache search at 6719986c, with the same 20-hit / 200-chapter limits.
async function legacySearchBook(db, novelId, query, after) {
  const items = []
  let cursor = after, scanned = 0
  while (scanned < 200 && items.length < 20) {
    const { rows } = await db.query('SELECT id,title,sort_order,content FROM chapters WHERE novel_id=$1 AND (sort_order,id)>($2,$3) ORDER BY sort_order,id LIMIT 20', [novelId, cursor.order, cursor.id])
    if (!rows.length) break
    for (const row of rows) {
      cursor = { order: Number(row.sort_order), id: row.id }; scanned++
      const text = searchableChapterText(row.content), pattern = bookMatchPattern(query), first = pattern.exec(text)
      if (first) {
        let matchCount = 1
        while (pattern.exec(text)) matchCount++
        const start = Math.max(0, first.index - 42), end = Math.min(text.length, first.index + first[0].length + 90)
        items.push({ chapterId: row.id, chapterTitle: row.title, chapterOrder: Number(row.sort_order), snippet: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`, matchCount })
      }
      if (items.length === 20 || scanned === 200) break
    }
  }
  const more = await db.query('SELECT 1 FROM chapters WHERE novel_id=$1 AND (sort_order,id)>($2,$3) LIMIT 1', [novelId, cursor.order, cursor.id])
  return { novelId, query, items, scanned, nextCursor: more.rows.length ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null }
}
let pool, started = false
try {
  await run('initdb', ['-D', path.join(root, 'data'), '-U', 'benchmark', '-A', 'trust', '--encoding=UTF8', `--locale=${locale}`])
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  await run('pg_ctl', ['-D', path.join(root, 'data'), '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  started = true
  pool = new pg.Pool({ host: '127.0.0.1', port, database: 'postgres', user: 'benchmark', max: 2 })
  const version = (await pool.query('SELECT version() AS version')).rows[0].version
  await pool.query(`CREATE EXTENSION pg_trgm;
    CREATE TABLE chapters(id text PRIMARY KEY, novel_id text NOT NULL, title text NOT NULL, content text NOT NULL,
      search_text text, search_text_version integer NOT NULL DEFAULT 0, sort_order integer NOT NULL,
      word_count integer NOT NULL DEFAULT 3000, source_url text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 1);
    CREATE INDEX chapters_order ON chapters(novel_id,sort_order,id)`)
  const classification = (await pool.query("SELECT datctype AS lc_ctype,show_trgm('青铜古城') AS chinese_trigrams FROM pg_database WHERE datname=current_database()")).rows[0]
  await pool.query(await readFile(path.join(repo, 'api/src/db/migrations/075_chapter_search_cache.sql'), 'utf8'))
  let state = 20261107
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state }
  const phrases = Array.from({ length: 512 }, () => Array.from({ length: 25 }, () => String.fromCharCode(0x4e00 + rand() % 4000)).join(''))
  const results = []
  for (const size of [1000, 5000, 10000]) {
    const seedStart = performance.now()
    for (let offset = results.at(-1)?.chapters || 0; offset < size; offset += 100) {
      const rows = Array.from({ length: Math.min(100, size - offset) }, (_, j) => {
        const n = offset + j + 1
        const text = Array.from({ length: 120 }, () => phrases[(rand() >>> 9) % phrases.length]).join('。')
          + (n % 997 === 0 ? '青铜古城。青铜古城。' : '') + (n % 31 === 0 ? '海风。' : '') + (n % 101 === 0 ? '猫。' : '')
        const content = `<p>${text}</p><script>广告不搜索</script><p>字面 %_ &amp; Cat</p>`
        return { id: `chapter-${String(n).padStart(6, '0')}`, title: `第 ${n} 章`, content, search_text: searchableChapterText(content), sort_order: n }
      })
      await pool.query(`INSERT INTO chapters(id,novel_id,title,content,search_text,search_text_version,sort_order)
        SELECT id,'book',title,content,search_text,1,sort_order FROM json_to_recordset($1::json)
        AS x(id text,title text,content text,search_text text,sort_order integer)`, [JSON.stringify(rows)])
    }
    await pool.query('VACUUM ANALYZE chapters')
    const rawPage = () => pool.query("SELECT content FROM chapters WHERE novel_id='book' ORDER BY sort_order,id LIMIT 200")
    const cachedPage = () => pool.query("SELECT search_text FROM chapters WHERE novel_id='book' ORDER BY sort_order,id LIMIT 200")
    const item = { chapters: size, seedMs: +(performance.now() - seedStart).toFixed(2) }
    item.rawPage = await timing(async () => { for (const r of (await rawPage()).rows) searchableChapterText(r.content).includes('无此词语') })
    item.precomputedPage = await timing(async () => { for (const r of (await cachedPage()).rows) r.search_text.includes('无此词语') })
    item.actualSearchPage = await timing(() => searchBook(pool, 'book', '无此词语', parseSearchCursor('')))
    item.legacySearchPage = await timing(() => legacySearchBook(pool, 'book', '无此词语', parseSearchCursor('')))
    item.coldSearchPage = await timing(() => searchBook(pool, 'book', '无此词语', parseSearchCursor('')), 3,
      () => pool.query("DELETE FROM chapter_search_text WHERE chapter_id IN (SELECT id FROM chapters ORDER BY sort_order,id LIMIT 200)"))
    const wholeBook = async (search) => {
      let cursor = parseSearchCursor(''), count = 0
      do {
        const result = await search(pool, 'book', '青铜古城', cursor)
        count += result.items.length
        cursor = result.nextCursor ? parseSearchCursor(result.nextCursor) : null
      } while (cursor)
      if (count !== Math.floor(size / 997)) throw new Error('Full-book cursor missed matches')
    }
    item.actualWholeBook = await timing(() => wholeBook(searchBook), 3)
    item.legacyWholeBook = await timing(() => wholeBook(legacySearchBook), 3)
    const metadata = (await pool.query("SELECT id,novel_id,title,sort_order,word_count,source_url,created_at FROM chapters WHERE novel_id='book' ORDER BY sort_order,id")).rows
    const response = JSON.stringify({ novelId: 'book', total: metadata.length, chapters: metadata.map((r) => ({ id: r.id, novelId: r.novel_id, title: r.title, order: r.sort_order, wordCount: r.word_count, sourceUrl: r.source_url, createdAt: Number(r.created_at) })) })
    item.directory = { bytes: Buffer.byteLength(response), gzipBytes: gzipSync(response).length, query: await timing(() => pool.query("SELECT id,novel_id,title,sort_order,word_count,source_url,created_at FROM chapters WHERE novel_id='book' ORDER BY sort_order,id")) }
    results.push(item)
    console.log(JSON.stringify(item))
  }
  const indexStart = performance.now()
  await pool.query('CREATE INDEX chapters_search_trgm ON chapters USING gin(search_text gin_trgm_ops)')
  await pool.query('ANALYZE chapters')
  const index = { buildMs: +(performance.now() - indexStart).toFixed(2), ...(await pool.query("SELECT pg_relation_size('chapters_search_trgm')::float8 AS bytes,pg_total_relation_size('chapters')::float8 AS total_bytes")).rows[0], queries: [] }
  for (const q of ['青铜古城', '海风', '猫', '%_', '无此词语']) {
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const sql = "SELECT id FROM chapters WHERE novel_id='book' AND search_text LIKE $1 ORDER BY sort_order,id"
    index.queries.push({ query: q, ...await timing(() => pool.query(sql, [pattern])), plan: (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, [pattern])).rows[0]['QUERY PLAN'] })
  }
  // C locale may not classify Chinese as word characters. Measure the same data
  // with an explicit ICU Chinese collation before recommending a trigram index.
  await pool.query("CREATE COLLATION benchmark_zh (provider=icu,locale='zh',deterministic=true)")
  const chineseIndexStart = performance.now()
  await pool.query('CREATE INDEX chapters_search_zh ON chapters USING gin((search_text COLLATE benchmark_zh) gin_trgm_ops)')
  const chineseIndex = { buildMs: +(performance.now() - chineseIndexStart).toFixed(2), ...(await pool.query("SELECT pg_relation_size('chapters_search_zh')::float8 AS bytes")).rows[0], queries: [] }
  for (const q of ['青铜古城', '海风', '猫', '%_', '无此词语']) {
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const sql = "SELECT id FROM chapters WHERE novel_id='book' AND search_text COLLATE benchmark_zh LIKE $1 ORDER BY sort_order,id"
    chineseIndex.queries.push({ query: q, ...await timing(() => pool.query(sql, [pattern])), plan: (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, [pattern])).rows[0]['QUERY PLAN'] })
  }
  const label = process.argv[2] || 'baseline'
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid output label')
  const output = path.join(repo, '.tmp/performance', label)
  await mkdir(output, { recursive: true })
  const cacheBytes = (await pool.query("SELECT pg_total_relation_size('chapter_search_text')::float8 AS bytes")).rows[0].bytes
  await writeFile(path.join(output, 'books.json'), JSON.stringify({ version, node: process.versions.node, locale, classification, synthetic: true, results, cacheBytes, index, chineseIndex }, null, 2) + '\n')
  console.log(JSON.stringify({ output, cacheBytes, chineseIndex: { buildMs: chineseIndex.buildMs, bytes: chineseIndex.bytes, queries: chineseIndex.queries.map(({ plan: _plan, ...q }) => q) } }))
} finally {
  await pool?.end()
  if (started) await run('pg_ctl', ['-D', path.join(root, 'data'), '-m', 'immediate', '-w', 'stop'])
  // Keep the small isolated cluster and evidence for inspection; never touch a configured database.
  console.log(`Stopped synthetic cluster: ${root}`)
}
