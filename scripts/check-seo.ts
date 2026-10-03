/** Local HTTP smoke check with fixture data; no real database or production requests. */
import { createWebRoutes } from '../api/src/routes/web'
import { serve } from '@hono/node-server'
import { once } from 'node:events'
import type { DbClient } from '../api/src/db/pool'

const row = { id: 'smoke', title: '公开作品', author: '测试作者', description: '初始 HTML 简介', updated_at: 1700000000000 }
const db = { query: async () => ({ rows: [row], rowCount: 1 }) } as unknown as DbClient
const routes = createWebRoutes({ origin: () => 'https://read.example.com', configured: () => true, db: () => db })
const server = serve({ fetch: routes.fetch, port: 0, hostname: '127.0.0.1' })
try {
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
  const base = `http://127.0.0.1:${address.port}`
  const response = await fetch(base + '/novel/smoke')
  const html = await response.text()
  if (response.status !== 200 || response.headers.get('X-Robots-Tag') !== 'index, follow' || !html.includes('<h1>公开作品</h1>'))
    throw new Error('HTML smoke failed')
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]!)
  if (assets.length < 2) throw new Error('Missing built assets')
  for (const asset of assets) {
    const result = await fetch(base + asset)
    if (result.status !== 200 || result.headers.get('Content-Type')?.includes('text/html')) throw new Error(`Asset failed: ${asset}: ${result.status}`)
    await result.arrayBuffer()
  }
  const robots = await (await fetch(base + '/robots.txt')).text()
  if (!robots.includes('Sitemap: https://read.example.com/sitemap.xml') || robots.includes('Disallow: /api/\n')) throw new Error('robots smoke failed')
  console.log(`HTTP SMOKE PASS: built HTML, ${assets.length} assets, robots/sitemap declaration; default web/dist resolved correctly`)
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
