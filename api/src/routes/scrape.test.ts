import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { sourceSyncTestHelpers } from '../services/source-sync'

// 本文件模拟所有 HTTP 响应，也固定 DNS，避免依赖真实源站及本机代理的 fake-ip 模式。
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) }))

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  await t.close()
})

async function req(path: string, init?: RequestInit) {
  return app.request(path, init)
}
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

describe('scrape 路由（免网络动作）', () => {
  let adminToken = ''

  it('bootstrap 管理员（爬虫动作均为 admin-only）', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token
  })

  it('公开实例不发布私有书源能力，并阻止旧抓取配置启动', async () => {
    const capabilities = '/api/scrape?action=source-capabilities'
    expect((await req(capabilities)).status).toBe(401)
    const res = await req(capabilities, json('GET', undefined, adminToken))
    expect(await res.json()).toEqual({ sources: [] })
    const sourceUrl = 'https://www.po18.tw/books/1'
    const denied = await req('/api/scrape', json('POST', {
      action: 'start', novelId: 'unavailable-source', sourceUrl,
      selectors: { chapterList: 'a', chapterContent: 'article' },
    }, adminToken))
    expect(denied.status).toBe(404)
    expect(await denied.json()).toEqual({ error: '书源未安装' })
  })

  it('追更设置要求管理员权限，并校验频率', async () => {
    expect((await req('/api/scrape?action=followup&novelId=follow-route')).status).toBe(401)
    const invalid = await req('/api/scrape', json('POST', { action: 'followup-save', novelId: 'follow-route', enabled: true, intervalHours: 2 }, adminToken))
    expect(invalid.status).toBe(400)
  })

  it('单书绑定来源要求管理员，保存后不创建任务或隐式开启追更', async () => {
    await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('bind-route','绑定测试',1,1)")
    const body = { action: 'followup-source-save', novelId: 'bind-route', sourceUrl: 'https://czbooks.net/n/123' }
    expect((await req('/api/scrape', json('POST', body))).status).toBe(401)
    const invalid = await req('/api/scrape', json('POST', { ...body, sourceUrl: 'https://unknown.example/book' }, adminToken))
    expect(invalid.status).toBe(400)
    const saved = await req('/api/scrape', json('POST', body, adminToken))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ hasConfig: true, enabled: false })
    expect((await t.db.query("SELECT id FROM scrape_jobs WHERE novel_id='bind-route'")).rows).toHaveLength(0)
  })
  it('复用目录重新匹配要求管理员及当前版本，应用后可生成新预览', async () => {
    const novelId = 'refresh-route', bindingId = 'refresh-binding', runId = 'refresh-run'
    const metadata = { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl: 'https://source.example/books/1' }
    await t.db.query('INSERT INTO novels (id,title,created_at,updated_at) VALUES ($1,$1,1,1)', [novelId])
    await t.db.query('INSERT INTO novel_source_bindings (id,novel_id,source_url,created_at,updated_at) VALUES ($1,$2,$3,1,1)', [bindingId, novelId, metadata.sourceUrl])
    await t.db.query("INSERT INTO source_sync_runs (id,binding_id,novel_id,status,metadata_json,created_at) VALUES ($1,$2,$3,'applied',$4,1)", [runId, bindingId, novelId, JSON.stringify(metadata)])
    const body = { action: 'source-sync-refresh', runId, revision: 0 }
    expect((await req('/api/scrape', json('POST', body))).status).toBe(401)
    expect((await req('/api/scrape', json('POST', { ...body, revision: 1 }, adminToken))).status).toBe(409)
    const response = await req('/api/scrape', json('POST', body, adminToken))
    expect(response.status).toBe(200)
    const next = await jsonOf<{ runId: string; localChapterCount: number; sourceChapterCount: number }>(response)
    expect(next.runId).not.toBe(runId)
    expect(next.localChapterCount).toBe(0)
    expect(next.sourceChapterCount).toBe(0)
  })

  it('源站融合接口传递序号修复选项，重复请求回放结果且不能复用键更改选项', async () => {
    const novelId = 'route-order-repair'
    const bindingId = 'route-order-binding'
    const runId = 'route-order-run'
    const sourceUrl = 'https://source.example/books/902326/articles'
    const source = [
      { key: 'notice', order: 45, title: '不行了，累累', url: `${sourceUrl}/45` },
      { key: 'chapter', order: 46, title: '没有喊哥哥', url: `${sourceUrl}/46` },
    ]
    const locals = [
      { id: 'route-notice', order: 46, title: '不行了，累累' },
      { id: 'route-chapter', order: 46, title: '没有喊哥哥' },
    ]
    const preview = sourceSyncTestHelpers().buildPreview(source, locals,
      { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl },
      true, { runId, bindingId, novelId, site: 'fixture', sourceUrl }, [])
    await t.db.query('INSERT INTO novels (id,title,created_at,updated_at) VALUES ($1,$1,1,1)', [novelId])
    for (const row of locals) await t.db.query('INSERT INTO chapters (id,novel_id,title,sort_order,created_at) VALUES ($1,$2,$3,$4,1)', [row.id, novelId, row.title, row.order])
    await t.db.query('INSERT INTO novel_source_bindings (id,novel_id,source_url,created_at,updated_at) VALUES ($1,$2,$3,1,1)', [bindingId, novelId, sourceUrl])
    await t.db.query('INSERT INTO source_sync_runs (id,binding_id,novel_id,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)',
      [runId, bindingId, novelId, JSON.stringify(preview.metadata), JSON.stringify(source), JSON.stringify(preview.changes), JSON.stringify(preview.mappings), JSON.stringify(locals)])
    const body = { action: 'source-sync-apply', runId, repairOrder: true, confirmedOrderIds: ['route-notice'], operationId: 'repair-order-once' }
    const invalidSelection = await req('/api/scrape', json('POST', { ...body, confirmedOrderIds: 'route-notice' }, adminToken))
    expect(invalidSelection.status).toBe(400)
    const result = await req('/api/scrape', json('POST', body, adminToken))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ updated: 0, orderUpdated: 1 })
    const retry = await req('/api/scrape', json('POST', body, adminToken))
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ orderUpdated: 1 })
    const conflict = await req('/api/scrape', json('POST', { ...body, repairOrder: false }, adminToken))
    expect(conflict.status).toBe(409)
    const selectionConflict = await req('/api/scrape', json('POST', { ...body, confirmedOrderIds: [] }, adminToken))
    expect(selectionConflict.status).toBe(409)
    const stored = await t.db.query<{ sort_order: number }>('SELECT sort_order FROM chapters WHERE id=\'route-notice\'')
    expect(stored.rows[0]?.sort_order).toBe(45)
    const history = await req(`/api/scrape?action=source-sync-history&novelId=${novelId}`, json('GET', undefined, adminToken))
    expect(history.status).toBe(200)
    expect(await history.json()).toMatchObject({ total: 1, items: [{ runId, canRollback: true }] })
    const detail = await req(`/api/scrape?action=source-sync-history-detail&runId=${runId}`, json('GET', undefined, adminToken))
    expect(await detail.json()).toMatchObject({ changes: [{ kind: 'chapter', id: 'route-notice', before: { order: 46 }, after: { order: 45 } }] })
    const rollbackBody = { action: 'source-sync-rollback', runId, operationId: 'rollback-route-once' }
    const rolledBack = await req('/api/scrape', json('POST', rollbackBody, adminToken))
    expect(rolledBack.status).toBe(200)
    expect(await rolledBack.json()).toMatchObject({ restored: 1, conflicts: [] })
    expect((await req('/api/scrape', json('POST', rollbackBody, adminToken))).status).toBe(200)
    expect((await req('/api/scrape?action=source-sync-history&novelId=' + novelId)).status).toBe(401)

    const manualRunId = runId + '-manual'
    await t.db.query('INSERT INTO source_sync_runs (id,binding_id,novel_id,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)',
      [manualRunId, bindingId, novelId, JSON.stringify(preview.metadata), JSON.stringify(source), JSON.stringify(preview.changes), JSON.stringify(preview.mappings), JSON.stringify(locals)])
    const remap = { action: 'source-sync-remap', runId: manualRunId, revision: 0, manualMappings: [{ localChapterId: 'route-notice', sourceChapterKey: null }] }
    const remapped = await req('/api/scrape', json('POST', remap, adminToken))
    expect(remapped.status).toBe(200)
    expect(await remapped.json()).toMatchObject({ revision: 1, unmatchedLocal: [{ id: 'route-notice' }] })
    const stale = await req('/api/scrape', json('POST', { action: 'source-sync-apply', runId: manualRunId, revision: 0 }, adminToken))
    expect(stale.status).toBe(409)
    expect((await req('/api/scrape', json('POST', { ...remap, revision: 1, manualMappings: [] }, adminToken))).status).toBe(200)
    expect((await req('/api/scrape', json('POST', { action: 'source-sync-apply', runId: manualRunId, revision: 2, repairOrder: true }, adminToken))).status).toBe(200)
  })

  it('真实路由串联删除杂章、复用目录、修复序号与撤回，重试不重复删除', async () => {
    const novelId='delete-refresh-route',bindingId='delete-refresh-binding',runId='delete-refresh-run'
    const sourceUrl='https://source.example/books/902326/articles'
    const source=[{key:'s1',order:1,title:'起程',url:''},{key:'s2',order:2,title:'归途',url:''}]
    const locals=[{id:'cleanup-a',order:1,title:'起程'},{id:'cleanup-junk',order:2,title:'无关公告'},{id:'cleanup-b',order:3,title:'归途'}]
    const metadata={title:'',author:'',description:'',coverUrl:'',category:'',categories:[],status:'',sourceUrl}
    const preview=sourceSyncTestHelpers().buildPreview(source,locals,metadata,true,{runId,bindingId,novelId,site:'fixture',sourceUrl},[])
    expect(preview.orderChanges).toEqual([])
    await t.db.query('INSERT INTO novels (id,title,chapter_count,created_at,updated_at) VALUES ($1,$1,3,1,1)',[novelId])
    for(const row of locals) await t.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ($1,$2,$3,$4,$5,1)',[row.id,novelId,row.title,'隔离正文',row.order])
    await t.db.query('INSERT INTO novel_source_bindings (id,novel_id,source_url,created_at,updated_at) VALUES ($1,$2,$3,1,1)',[bindingId,novelId,sourceUrl])
    await t.db.query('INSERT INTO source_sync_runs (id,binding_id,novel_id,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)',
      [runId,bindingId,novelId,JSON.stringify(metadata),JSON.stringify(source),JSON.stringify(preview.changes),JSON.stringify(preview.mappings),JSON.stringify(locals)])
    const deletion={action:'batch-delete',novelId,chapterIds:['cleanup-junk'],operationId:'delete-refresh-once'}
    expect((await req('/api/chapters',json('POST',deletion))).status).toBe(401)
    const deleted=await req('/api/chapters',json('POST',deletion,adminToken))
    expect(deleted.status).toBe(200)
    expect((await req('/api/chapters',json('POST',deletion,adminToken))).status).toBe(200)
    expect((await t.db.query<{chapter_count:number}>('SELECT chapter_count FROM novels WHERE id=$1',[novelId])).rows[0]?.chapter_count).toBe(2)
    // 没有配置源站账号，仍能成功重新匹配，证明使用已保存目录。
    const refreshed=await req('/api/scrape',json('POST',{action:'source-sync-refresh',runId,revision:0},adminToken))
    expect(refreshed.status).toBe(200)
    const next=await jsonOf<{runId:string;sourceChapterCount:number;localChapterCount:number;orderChanges:unknown[]}>(refreshed)
    expect(next).toMatchObject({sourceChapterCount:2,localChapterCount:2,orderChanges:[{localChapterId:'cleanup-b',oldOrder:3,newOrder:2}]})
    const applied=await req('/api/scrape',json('POST',{action:'source-sync-apply',runId:next.runId,revision:0,repairOrder:true,confirmedOrderIds:['cleanup-b'],operationId:'delete-refresh-apply'},adminToken))
    expect(applied.status).toBe(200)
    expect(await applied.json()).toMatchObject({updated:0,orderUpdated:1})
    const rollback=await req('/api/scrape',json('POST',{action:'source-sync-rollback',runId:next.runId,operationId:'delete-refresh-rollback'},adminToken))
    expect(rollback.status).toBe(200)
    const stored=(await t.db.query<{id:string;sort_order:number;content:string}>('SELECT id,sort_order,content FROM chapters WHERE novel_id=$1 ORDER BY sort_order',[novelId])).rows
    expect(stored).toEqual([{id:'cleanup-a',sort_order:1,content:'隔离正文'},{id:'cleanup-b',sort_order:3,content:'隔离正文'}])
  })

  it('追更设置保存并读回，默认关闭，缺少配置时拒绝开启', async () => {
    await t.db.query("INSERT INTO novels (id,title,status,created_at,updated_at) VALUES ('follow-route','追更路由','ongoing',1,1)")
    const initial = await req('/api/scrape?action=followup&novelId=follow-route', json('GET', undefined, adminToken))
    await expect(initial.json()).resolves.toMatchObject({ enabled: false, intervalHours: 6, hasConfig: false })
    const blocked = await req('/api/scrape', json('POST', { action: 'followup-save', novelId: 'follow-route', enabled: true, intervalHours: 3 }, adminToken))
    expect(blocked.status).toBe(400)
    await t.db.query("INSERT INTO scrape_configs (novel_id,source_url,selectors,updated_at) VALUES ('follow-route','https://example.com/book',$1,1)", [JSON.stringify({ chapterList: 'a', chapterContent: '.content' })])
    const saved = await req('/api/scrape', json('POST', { action: 'followup-save', novelId: 'follow-route', enabled: true, intervalHours: 3 }, adminToken))
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({ enabled: true, intervalHours: 3, hasConfig: true })
  })

  it('批量追更设置要求管理员权限并验证输入，不会直接启动抓取', async () => {
    const body = { action: 'followup-batch-save', novelIds: ['follow-route'], mode: 'enable', intervalHours: 6 }
    expect((await req('/api/scrape', json('POST', body))).status).toBe(401)
    const saved = await req('/api/scrape', json('POST', body, adminToken))
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({ saved: 1, skipped: 0 })
    expect((await t.db.query("SELECT COUNT(*)::integer AS count FROM scrape_jobs WHERE novel_id='follow-route'")).rows[0]).toMatchObject({ count: 0 })
    expect((await req('/api/scrape', json('POST', { ...body, novelIds: [] }, adminToken))).status).toBe(400)
    expect((await req('/api/scrape', json('POST', { ...body, mode: 'invalid' }, adminToken))).status).toBe(400)
  })

  it('detect：静态预设命中 czbooks，未命中返回 false', async () => {
    const hit = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://www.czbooks.net/n/123/' }, adminToken))
    expect(hit.status).toBe(200)
    const hitData = await jsonOf<{ detected: boolean; source: string; preset: { name: string } }>(hit)
    expect(hitData.detected).toBe(true)
    expect(hitData.source).toBe('preset')
    expect(hitData.preset.name).toBe('小說狂人')

    const miss = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://unknown-site.example.com/book/1' }, adminToken))
    const missData = await jsonOf<{ detected: boolean }>(miss)
    expect(missData.detected).toBe(false)
  })

  it('管理员可以保存开发代理，Docker 环境代理优先并可测试', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'zhi-zhou-proxy-'))
    const previousRuntimeDir = process.env.RUNTIME_CONFIG_DIR
    const previousProxyBase = process.env.PROXY_BASE
    const previousProxyBypass = process.env.PROXY_BYPASS
    const previousHttpProxy = process.env.HTTP_PROXY
    const previousHttpsProxy = process.env.HTTPS_PROXY
    const previousNoProxy = process.env.NO_PROXY
    process.env.RUNTIME_CONFIG_DIR = runtimeDir
    delete process.env.PROXY_BASE
    delete process.env.PROXY_BYPASS
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
    try {
      const invalid = await req(
        '/api/scrape',
        json('POST', { action: 'save-proxy-config', proxyBase: 'ftp://proxy.example.com', proxyBypass: 'example.com' }, adminToken),
      )
      expect(invalid.status).toBe(400)

      const saved = await req(
        '/api/scrape',
        json(
          'POST',
          {
            action: 'save-proxy-config',
            proxyBase: 'http://127.0.0.1:7890',
            proxyBypass: 'localhost, .internal.example.com',
          },
          adminToken,
        ),
      )
      expect(saved.status).toBe(200)
      const savedData = await jsonOf<{ configured: boolean; effectiveHost: string; config: { proxyBypass: string } }>(saved)
      expect(savedData.configured).toBe(true)
      expect(savedData.effectiveHost).toBe('127.0.0.1:7890')
      expect(savedData.config.proxyBypass).toBe('localhost,.internal.example.com')

      const runtimeRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://service.example.com/v1' }, adminToken))
      const runtimeRouteData = await jsonOf<{ usesProxy: boolean; source: string; proxyHost: string; bypassed: boolean }>(runtimeRoute)
      expect(runtimeRouteData).toMatchObject({ usesProxy: true, source: 'runtime', proxyHost: '127.0.0.1:7890', bypassed: false })

      const runtimeBypass = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://svc.internal.example.com/health' }, adminToken))
      const runtimeBypassData = await jsonOf<{ usesProxy: boolean; bypassed: boolean; bypassRule: string }>(runtimeBypass)
      expect(runtimeBypassData).toMatchObject({ usesProxy: false, bypassed: true, bypassRule: '.internal.example.com' })

      const loaded = await req('/api/scrape?action=proxy-config', json('GET', undefined, adminToken))
      expect(loaded.status).toBe(200)
      const loadedData = await jsonOf<{ source: string; config: { proxyBase: string } }>(loaded)
      expect(loadedData.source).toBe('runtime')
      expect(loadedData.config.proxyBase).toBe('http://127.0.0.1:7890')

      process.env.HTTPS_PROXY = 'http://172.18.0.1:7890'
      const environmentLoaded = await req('/api/scrape?action=proxy-config', json('GET', undefined, adminToken))
      const environmentData = await jsonOf<{ source: string; effectiveHost: string; effective: { proxyBase: string } }>(environmentLoaded)
      expect(environmentData).toMatchObject({ source: 'environment', effectiveHost: '172.18.0.1:7890' })
      expect(environmentData.effective.proxyBase).toBe('')

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html><body>proxy ok</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      )
      process.env.ALLOW_PRIVATE_FETCH = '1'
      try {
        const tested = await req('/api/scrape', json('POST', { action: 'proxy-test', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
        expect(tested.status).toBe(200)
        const testedData = await jsonOf<{ ok: boolean; proxyHost: string; targetHost: string }>(tested)
        expect(testedData).toMatchObject({ ok: true, proxyHost: '172.18.0.1:7890', targetHost: 'target.example.org' })
        const requestedUrl = String(fetchMock.mock.calls[0]?.[0])
        expect(requestedUrl).toBe('https://target.example.org/book/1')
        expect((fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown }).dispatcher).toBeTruthy()
      } finally {
        delete process.env.ALLOW_PRIVATE_FETCH
        fetchMock.mockRestore()
      }

      const envRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
      const envRouteData = await jsonOf<{ usesProxy: boolean; source: string; proxyHost: string; bypassed: boolean }>(envRoute)
      expect(envRouteData).toMatchObject({ usesProxy: true, source: 'environment', proxyHost: '172.18.0.1:7890', bypassed: false })

      process.env.NO_PROXY = 'target.example.org'
      try {
        const envBypass = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
        const envBypassData = await jsonOf<{ usesProxy: boolean; bypassed: boolean; bypassRule: string }>(envBypass)
        expect(envBypassData).toMatchObject({ usesProxy: false, bypassed: true, bypassRule: 'target.example.org' })
      } finally {
        delete process.env.NO_PROXY
      }

      const invalidRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: '不是网址' }, adminToken))
      expect(invalidRoute.status).toBe(400)
    } finally {
      if (previousRuntimeDir === undefined) delete process.env.RUNTIME_CONFIG_DIR
      else process.env.RUNTIME_CONFIG_DIR = previousRuntimeDir
      if (previousProxyBase === undefined) delete process.env.PROXY_BASE
      else process.env.PROXY_BASE = previousProxyBase
      if (previousProxyBypass === undefined) delete process.env.PROXY_BYPASS
      else process.env.PROXY_BYPASS = previousProxyBypass
      if (previousHttpProxy === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = previousHttpProxy
      if (previousHttpsProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = previousHttpsProxy
      if (previousNoProxy === undefined) delete process.env.NO_PROXY
      else process.env.NO_PROXY = previousNoProxy
      rmSync(runtimeDir, { recursive: true, force: true })
    }
  })

  it('未登录访问 scrape 返回 401', async () => {
    const res = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://www.czbooks.net/n/1/' }))
    expect(res.status).toBe(401)
  })
})
