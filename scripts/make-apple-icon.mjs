// Regenerate public/apple-touch-icon.png from the brand mark.
//
// The only logo asset is a 47x56 raster, so a plain upscale is always blurry.
// Instead we VECTORISE the mark first (potrace) and rasterise the vector — the
// edges become clean curves at any size. iOS paints transparency black on the
// home screen, so the output is the orange mark BIGGER and centred on opaque
// white.
//
// Run: node scripts/make-apple-icon.mjs   (potrace is a devDependency)
import sharp from 'sharp'
import potrace from 'potrace'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const trace = promisify(potrace.trace)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'public', 'residente-logo.png')
const OUT = join(root, 'public', 'apple-touch-icon.png')

const CANVAS = 180          // standard apple-touch-icon size
const MARK_H = 122          // target mark height on the 180 canvas
const ORANGE = '#E14909'
const ALPHA_CUTOFF = 80     // drop the source's faint dither noise
const TRACE_SS = 12         // upscale the mask this much before tracing so
                            // potrace produces smooth curves, not stairsteps

// 1) Clean the source: force sub-threshold alpha fully transparent so the
//    scattered low-alpha noise doesn't get traced as speckles.
const { data: raw, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i + 3] < ALPHA_CUTOFF) raw[i + 3] = 0
}
const cleaned = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toBuffer()

// 2) Build a high-res black-on-white mask of the mark (alpha → luminance,
//    upscaled + smoothed), which is what potrace traces.
const maskW = Math.round(info.width * TRACE_SS)
const maskH = Math.round(info.height * TRACE_SS)
const mask = await sharp(cleaned)
  .ensureAlpha()
  .extractChannel(3)                                   // alpha as grayscale (mark = white)
  .resize(maskW, maskH, { kernel: sharp.kernel.lanczos3 })
  .negate()                                            // mark (opaque) → dark for potrace
  .png()                                               // (no flatten — it corrupts the 1-ch mask)
  .toBuffer()

// 3) Trace to an SVG. turdSize drops any residual specks; the curve options
//    keep the nested-house outlines smooth.
const svg = await trace(mask, {
  threshold: 128,
  color: ORANGE,
  background: 'transparent',
  turdSize: 60,
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.4,
})

// 4) Rasterise the vector at the target mark height, then composite centred on
//    an opaque white field at supersampled size and downsample once.
const aspect = info.width / info.height
const SS = 4
const markH = Math.round(MARK_H * SS)
const markW = Math.round(markH * aspect)
const mark = await sharp(Buffer.from(svg), { density: 384 })
  .resize(markW, markH, { fit: 'fill' })
  .png()
  .toBuffer()

const big = CANVAS * SS
const composed = await sharp({
  create: { width: big, height: big, channels: 4, background: '#FFFFFF' },
})
  .composite([{ input: mark, gravity: 'centre' }])
  .png()
  .toBuffer()

await sharp(composed)
  .resize(CANVAS, CANVAS, { kernel: sharp.kernel.lanczos3 })
  .flatten({ background: '#FFFFFF' })
  .png()
  .toFile(OUT)

console.log(`Wrote ${OUT} — ${CANVAS}x${CANVAS}, vector-traced mark ~${MARK_H}px tall, centred, opaque white.`)
