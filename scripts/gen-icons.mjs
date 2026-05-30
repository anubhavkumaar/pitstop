// Generates raster icons from public/icon-source.svg
// Usage: npm run icons
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const srcPath = 'public/icon-source.svg'
const src = await fs.readFile(srcPath)

const targets = [
  { size:  180, name: 'apple-touch-icon.png' },   // iOS home screen
  { size:  192, name: 'icon-192.png'        },    // PWA / Android
  { size:  512, name: 'icon-512.png'        },    // PWA / large preview
  { size: 1024, name: 'icon-1024.png'       },    // Discord avatars, social
]

for (const { size, name } of targets) {
  const out = path.join('public', name)
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`✓ ${out}  (${size}×${size})`)
}

console.log('\nDone. Re-run anytime icon-source.svg changes:  npm run icons')
