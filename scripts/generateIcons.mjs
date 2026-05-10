// Generiert PWA-Icons aus public/icons/icon.svg.
//
// Sizes / Targets:
//   - icon-192.png             (192x192, "any")
//   - icon-512.png             (512x512, "any")
//   - icon-512-maskable.png    (512x512, "maskable" - Inhalt um ~14% verkleinert,
//                              dunkler Hintergrund, sodass Android-Launcher
//                              den Inhalt beim Maskieren nicht abschneiden)
//   - apple-touch-icon-180.png (180x180, opaque background fuer iOS)
//
// Aufruf:  node scripts/generateIcons.mjs
//
// Benoetigt das devDependency "sharp".

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const iconsDir = path.join(root, 'public', 'icons')

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

async function main() {
  await ensureDir(iconsDir)
  const svgPath = path.join(iconsDir, 'icon.svg')
  const svg = await fs.readFile(svgPath)

  // Standard 192/512 - voller Inhalt, Hintergrund laut SVG
  await sharp(svg, { density: 384 })
    .resize(192, 192, { fit: 'contain', background: { r: 11, g: 11, b: 15, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconsDir, 'icon-192.png'))
  console.log('wrote icon-192.png')

  await sharp(svg, { density: 1024 })
    .resize(512, 512, { fit: 'contain', background: { r: 11, g: 11, b: 15, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconsDir, 'icon-512.png'))
  console.log('wrote icon-512.png')

  // Maskable: Inhalt auf ~78% Inner Safe Area schrumpfen und auf opaken Hintergrund legen.
  const inner = 410
  const renderedInner = await sharp(svg, { density: 1024 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 11, g: 11, b: 15, alpha: 1 },
    },
  })
    .composite([{ input: renderedInner, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconsDir, 'icon-512-maskable.png'))
  console.log('wrote icon-512-maskable.png')

  // Apple Touch Icon: opak (iOS schneidet Alpha) + zentriert mit etwas Rand.
  const appleInner = await sharp(svg, { density: 720 })
    .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: { r: 11, g: 11, b: 15, alpha: 1 },
    },
  })
    .composite([{ input: appleInner, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconsDir, 'apple-touch-icon-180.png'))
  console.log('wrote apple-touch-icon-180.png')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
