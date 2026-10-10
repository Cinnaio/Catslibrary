import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = await readFile(path.join(root, 'web/dist/index.html'), 'utf8')
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
  .map((match) => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`)
const policy = `default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com ${hashes.join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https:; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
const dir = path.join(root, '.tmp/browser-security')
await mkdir(dir, { recursive: true })
const target = path.join(dir, 'nginx-security-headers.conf')
await writeFile(
  target,
  `# Generated from current web/dist. Regenerate on every release. Include in HTTPS server/location.\nadd_header X-Content-Type-Options "nosniff" always;\nadd_header X-Frame-Options "DENY" always;\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\nadd_header Strict-Transport-Security "max-age=15552000" always;\nadd_header Content-Security-Policy-Report-Only "${policy}" always;\n`,
)
console.log(target)
