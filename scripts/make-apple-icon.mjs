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
const OUT_BLACK = join(root, 'public', 'apple-touch-icon-black.png')
const OUT_ORANGE = join(root, 'public', 'apple-touch-icon-orange.png')

const CANVAS = 180          // standard apple-touch-icon size
const MARK_BOX = 132        // longest side of the mark on the 180 canvas — big &
                            // bold but still inside iOS's rounded-corner mask
const ORANGE = '#E14909'
const ALPHA_CUTOFF = 24     // drop only the faintest dither noise (high cutoffs
                            // chop the soft anti-aliased edges); turdSize kills specks
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

// 3–4) Trace the mask to an SVG in a given colour, then rasterise, TRIM the
//    transparent margins, and fit to MARK_BOX. Trimming to the true ink bounds
//    also fixes the source PNG's uneven transparent padding so the mark centres.
//    We build the mark in two colours: orange (for light/dark backgrounds) and
//    white (for the orange-background variant).
const SS = 4
const box = Math.round(MARK_BOX * SS)
async function buildMark(color) {
  const svg = await trace(mask, {
    threshold: 128,
    color,
    background: 'transparent',
    turdSize: 60,
    alphaMax: 1,
    optCurve: true,
    optTolerance: 0.4,
  })
  const trimmed = await sharp(Buffer.from(svg), { density: 512 })
    .resize({ height: box * 2, fit: 'inside' })
    .trim({ threshold: 10 })
    .png()
    .toBuffer()
  return sharp(trimmed)
    .resize({ width: box, height: box, fit: 'inside' })
    .png()
    .toBuffer()
}
const markOrange = await buildMark(ORANGE)
const markWhite = await buildMark('#FFFFFF')

// Emit three background variants so the resident "App icon" setting can
// advertise a white-, black-, or brand-orange-background home-screen icon
// (iOS paints transparency black in dark mode, so each variant is fully opaque).
const big = CANVAS * SS
const VARIANTS = [
  { bg: '#FFFFFF', mark: markOrange, out: OUT },        // orange mark on white
  { bg: '#111111', mark: markOrange, out: OUT_BLACK },  // orange mark on black
  { bg: ORANGE,    mark: markWhite,  out: OUT_ORANGE }, // white mark on brand orange
]
for (const { bg, mark, out } of VARIANTS) {
  const composed = await sharp({
    create: { width: big, height: big, channels: 4, background: bg },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer()

  await sharp(composed)
    .resize(CANVAS, CANVAS, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: bg })
    .png()
    .toFile(out)

  console.log(`Wrote ${out} — ${CANVAS}x${CANVAS}, vector-traced mark, opaque ${bg}.`)
}
