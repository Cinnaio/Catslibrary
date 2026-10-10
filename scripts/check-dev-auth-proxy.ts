import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { createServer as reservePort } from 'node:net'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createServer, loadConfigFromFile } from 'vite'
import { csrfProtection } from '../api/src/middlewares/browser-security'

// Use the actual development proxy and CSRF middleware, without accounts or database writes.
// Run: npx tsx --tsconfig api/tsconfig.json scripts/check-dev-auth-proxy.ts
const reservation = reservePort()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const reservedAddress = reservation.address()
assert.ok(reservedAddress && typeof reservedAddress === 'object')
const frontendPort = reservedAddress.port
await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))
const app = new Hono()
app.use('/api/*', csrfProtection())
app.post('/api/auth/login', (c) => c.json({ reachedAuth: true }, 400))
const backend = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
await once(backend, 'listening')
const address = backend.address()
assert.ok(address && typeof address === 'object')
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'web/vite.config.ts')
assert.ok(loaded)
const proxy = loaded.config.server?.proxy?.['/api']
assert.ok(proxy && typeof proxy === 'object')
const vite = await createServer({
  ...loaded.config,
  configFile: false,
  root: 'web',
  server: { ...loaded.config.server, host: '127.0.0.1', port: frontendPort, open: false, proxy: { '/api': { ...proxy, target: `http://127.0.0.1:${address.port}` } } },
})
try {
  await vite.listen()
  const front = vite.httpServer?.address()
  assert.ok(front && typeof front === 'object')
  const base = `http://127.0.0.1:${front.port}`
  for (const host of ['localhost', '127.0.0.1']) {
    const origin = `http://${host}:${front.port}`
    const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { Host: `${host}:${front.port}`, Origin: origin, 'X-ZZ-CSRF': '1', 'Content-Type': 'application/json' },
      }, (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }))
      })
      req.on('error', reject)
      req.end('{}')
    })
    const body = response.body
    assert.equal(response.status, 400, `${origin}: ${JSON.stringify(body)}`)
    assert.deepEqual(body, { reachedAuth: true })
    console.log(`PASS ${host}: proxied login reaches authentication`)
  }
  for (const headers of [{ Origin: 'https://untrusted-proxy-fixture.invalid', 'X-ZZ-CSRF': '1' }, { Origin: base }]) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: '{}' })
    assert.equal(response.status, 403)
    assert.equal((await response.json() as { code: string }).code, 'csrf_failed')
  }
  console.log('PASS untrusted origin and missing CSRF header remain rejected')
} finally {
  await vite.close()
  await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()))
}
