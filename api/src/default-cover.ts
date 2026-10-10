import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PROJECT_ROOT } from './config'

let image: Promise<{ data: Uint8Array; contentType: string }> | undefined

/** Build copies the shared Web asset beside the API bundle; dev reads the original. */
export function getDefaultCoverImage() {
  const bundled = new URL('./assets/default-cover-flower.webp', import.meta.url)
  image ??= readFile(existsSync(bundled) ? bundled : resolve(PROJECT_ROOT, 'web/public/images/default-cover-flower.webp'))
    .then((data) => ({ data, contentType: 'image/webp' }))
    .catch((error) => {
      image = undefined
      throw error
    })
  return image
}
