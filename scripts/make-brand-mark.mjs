// Regenerate public/residente-mark.png — the brand mark as a clean app-icon
// TILE for use in the landing nav/footer.
//
// The only logo source is a 47x56 raster, so a plain upscale is blurry and its
// anti-aliased edges smear into whatever sits behind it (the navy mobile
// header) as a muddy box. Instead we VECTORISE the mark first (potrace) and
// rasterise the vector onto a SOLID NAVY rounded square — like an iOS app icon.
// Being self-contained and opaque, it reads clean on the navy header AND on the
// cream desktop nav, at any size.
//
// Run: node scripts/make-brand-mark.mjs   (sharp + potrace are devDependencies)
import sharp from 'sharp'
import potrace from 'potrace'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const trace = promisify(potrace.trace)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'public', 'residente-logo.png')
const OUT = join(root, 'public', 'residente-mark.png')

const TILE = 144            // export at 3x of the 48px display size — crisp on retina
const RADIUS = 33           // ~23% — iOS-style rounded square
const MARK_BOX = 92         // longest side of the mark inside the tile (~64%)
const NAVY = '#1F2233'      // matches the landing's --ln-ink / mobile header
const ORANGE = '#E14909'
const ALPHA_CUTOFF = 24     // drop only the faintest dither noise
const TRACE_SS = 12         // upscale the mask before tracing → smooth curves

// 1) Clean the source: force sub-threshold alpha fully transparent so scattered
//    low-alpha noise doesn't get traced as speckles.
const { data: raw, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i + 3] < ALPHA_CUTOFF) raw[i + 3] = 0
}
const cleaned = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toBuffer()

// 2) High-res black-on-white mask of the mark (alpha → luminance), which is
//    what potrace traces.
const mask = await sharp(cleaned)
  .ensureAlpha()
  .extractChannel(3)
  .resize(Math.round(info.width * TRACE_SS), Math.round(info.height * TRACE_SS), { kernel: sharp.kernel.lanczos3 })
  .negate()
  .png()
  .toBuffer()

// 3) Trace to an SVG. turdSize drops residual specks; curve options keep the
//    nested-house outlines smooth.
const svg = await trace(mask, {
  threshold: 128,
  color: ORANGE,
  background: 'transparent',
  turdSize: 60,
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.4,
})

// 4) Rasterise the vector, TRIM its transparent margins (also fixes the source
//    PNG's uneven padding), and fit to MARK_BOX.
const SS = 4
const box = Math.round(MARK_BOX * SS)
const trimmed = await sharp(Buffer.from(svg), { density: 512 })
  .resize({ height: box * 2, fit: 'inside' })
  .trim({ threshold: 10 })
  .png()
  .toBuffer()
const mark = await sharp(trimmed)
  .resize({ width: box, height: box, fit: 'inside' })
  .png()
  .toBuffer()

// 5) Solid navy rounded-square tile (rasterised from an SVG rect), mark centred.
const big = TILE * SS
const tileSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}">` +
  `<rect width="${big}" height="${big}" rx="${RADIUS * SS}" ry="${RADIUS * SS}" fill="${NAVY}"/></svg>`
)
const composed = await sharp(tileSvg)
  .composite([{ input: mark, gravity: 'centre' }])
  .png()
  .toBuffer()

await sharp(composed)
  .resize(TILE, TILE, { kernel: sharp.kernel.lanczos3 })
  .png()
  .toFile(OUT)

console.log(`Wrote ${OUT} — ${TILE}x${TILE} navy app-icon tile, vector-traced mark fit to ~${MARK_BOX}px box.`)
