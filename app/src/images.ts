/**
 * Turns a camera photo into a small, clear picture.
 * Phones take 12-megapixel photos; we keep the long side at `maxPx` and lower the quality step by step
 * until the picture fits in `maxBytes`, so it stays readable and still syncs (the server limit is 64 KB a record).
 * The photo's own rotation is respected, so pictures taken upright on an iPhone are not turned sideways.
 */
export async function compressImage(file: Blob, opts: { maxPx: number; maxBytes: number; quality?: number }): Promise<string> {
  let src: CanvasImageSource
  let w: number, h: number
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    src = bmp; w = bmp.width; h = bmp.height
  } catch {
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('bad image')); img.src = url })
    URL.revokeObjectURL(url)
    src = img; w = img.naturalWidth; h = img.naturalHeight
  }
  let px = opts.maxPx
  let q = opts.quality ?? 0.85
  let out = ''
  for (let i = 0; i < 10; i++) {
    const k = Math.min(1, px / Math.max(w, h))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height) // a PNG with see-through parts would turn black as a JPEG
    ctx.drawImage(src, 0, 0, c.width, c.height)
    out = c.toDataURL('image/jpeg', q)
    if (out.length <= opts.maxBytes) break
    if (q > 0.55) q -= 0.1
    else px = Math.round(px * 0.8)
  }
  if ('close' in src) (src as ImageBitmap).close()
  return out
}
/** Item pictures: clear enough to tell two similar boxes apart. About 40 KB. */
export const ITEM_PHOTO = { maxPx: 720, maxBytes: 52000, quality: 0.85 }
/** A shop's own QR picture must stay sharp enough for a phone to scan. */
export const QR_PHOTO = { maxPx: 800, maxBytes: 52000, quality: 0.92 }
