import { createHash } from 'node:crypto'
import { coverDataToBody } from './covers'
import type { BookImportPayload } from '@shared/types'

export function makeImportCover(bytes: Uint8Array, contentType: string): NonNullable<BookImportPayload['coverImage']> {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('封面文件必须小于 8 MB')
  const magic = Buffer.from(bytes.subarray(0, 32))
  const valid =
    contentType === 'image/png'
      ? magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === 'image/jpeg'
        ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
        : contentType === 'image/webp'
          ? magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP'
          : contentType === 'image/gif'
            ? /^GIF8[79]a/.test(magic.toString('ascii'))
            : contentType === 'image/avif'
              ? magic.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(magic.toString('ascii'))
              : false
  if (!valid) throw new Error('封面文件格式与图片类型不符')
  return { contentType, dataBase64: Buffer.from(bytes).toString('base64') }
}
export function normalizeImportCover(raw: unknown): NonNullable<BookImportPayload['coverImage']> | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') throw new Error('封面数据格式不正确')
  const value = raw as Record<string, unknown>
  if (typeof value.dataBase64 !== 'string' || value.dataBase64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataBase64))
    throw new Error('封面数据格式不正确')
  return makeImportCover(Buffer.from(value.dataBase64, 'base64'), String(value.contentType || ''))
}
export function coverSnapshot(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) return null
  const data = coverDataToBody(row.data)
  if (!data) throw new Error('已有封面数据读取失败')
  return {
    dataBase64: Buffer.from(data).toString('base64'),
    content_type: row.content_type,
    source: row.source,
    prompt: row.prompt,
    metadata: row.metadata,
    updated_at: Number(row.updated_at),
  }
}
export function coverFingerprint(snapshot: Record<string, unknown> | null): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}
