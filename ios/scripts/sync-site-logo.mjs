import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

// Keep the downloaded site logo unchanged; prepare only the app-icon packaging.
const source = new URL('../ZhiZhou/Assets.xcassets/SiteLogo.imageset/site-logo.png', import.meta.url)
const target = new URL('../ZhiZhou/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png', import.meta.url)
const icon = await sharp(await readFile(source))
  .flatten({ background: '#ffffff' })
  .resize(1024, 1024, { fit: 'contain', background: '#ffffff' })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer()

await writeFile(target, icon)
console.log('App icon prepared from the bundled site logo (1024 x 1024, opaque PNG).')
