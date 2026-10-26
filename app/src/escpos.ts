import type { Invoice, Settings } from './types'

/**
 * Prints with plain ESC/POS, so any 58mm or 80mm thermal printer that speaks the Epson command set works.
 * The bill is drawn on a canvas and sent as a raster image. That keeps Nepali (Devanagari) letters
 * correct on printers that have no Devanagari font.
 */
export interface Row { l: string; r?: string; bold?: boolean; center?: boolean; big?: boolean; rule?: boolean }

export function widthPx(paper: Settings['paper']) {
  return paper === '80' ? 576 : paper === 'a4' ? 700 : 384
}

export function drawRows(rows: Row[], w: number): HTMLCanvasElement {
  const size = w > 400 ? 26 : 22
  const lh = size + 8
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  c.width = w
  c.height = rows.reduce((a, r) => a + (r.rule ? 12 : r.big ? lh + 10 : lh), 12)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, c.height)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  let y = 4
  for (const r of rows) {
    if (r.rule) {
      ctx.fillRect(0, y + 5, w, 2)
      y += 12
      continue
    }
    const px = r.big ? size + 6 : size
    ctx.font = `${r.bold || r.big ? '700 ' : ''}${px}px "Noto Sans Devanagari", "Nirmala UI", system-ui, sans-serif`
    if (r.center) {
      ctx.textAlign = 'center'
      ctx.fillText(r.l, w / 2, y)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(r.l, 2, y, r.r ? w - 120 : w - 4)
      if (r.r) {
        ctx.textAlign = 'right'
        ctx.fillText(r.r, w - 2, y)
      }
    }
    y += r.big ? lh + 10 : lh
  }
  return c
}

export function toEscPos(c: HTMLCanvasElement): Uint8Array {
  const ctx = c.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  const wb = Math.ceil(c.width / 8)
  const out: number[] = [0x1b, 0x40] // ESC @ : reset
  const band = 128
  for (let y0 = 0; y0 < c.height; y0 += band) {
    const h = Math.min(band, c.height - y0)
    out.push(0x1d, 0x76, 0x30, 0x00, wb & 255, wb >> 8, h & 255, h >> 8) // GS v 0 : raster bit image
    for (let y = y0; y < y0 + h; y++) {
      for (let xb = 0; xb < wb; xb++) {
        let byte = 0
        for (let b = 0; b < 8; b++) {
          const x = xb * 8 + b
          const i = (y * c.width + x) * 4
          const dark = x < c.width && data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 140
          if (dark) byte |= 0x80 >> b
        }
        out.push(byte)
      }
    }
  }
  out.push(0x1b, 0x64, 0x04) // ESC d 4 : feed 4 lines
  out.push(0x1d, 0x56, 0x42, 0x00) // GS V B 0 : partial cut (ignored if no cutter)
  return Uint8Array.from(out)
}

let chr: any = null
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
]
export const btSupported = () => 'bluetooth' in navigator
export const printerConnected = () => !!chr

export async function connectPrinter(): Promise<string> {
  const dev = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES })
  const srv = await dev.gatt.connect()
  for (const sv of await srv.getPrimaryServices()) {
    for (const ch of await sv.getCharacteristics()) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        chr = ch
        dev.addEventListener('gattserverdisconnected', () => { chr = null })
        return dev.name || 'Printer'
      }
    }
  }
  throw new Error('no-write')
}

export async function sendBytes(bytes: Uint8Array) {
  if (!chr) throw new Error('not-connected')
  for (let i = 0; i < bytes.length; i += 100) {
    const part = bytes.slice(i, i + 100)
    if (chr.properties.writeWithoutResponse) await chr.writeValueWithoutResponse(part)
    else await chr.writeValue(part)
    await new Promise((r) => setTimeout(r, 15))
  }
}

export function billRows(inv: Invoice, s: Settings, lang: 'ne' | 'en', fmt: { m: (x: number) => string; n: (x: number | string) => string; date: (t: number) => string }): Row[] {
  const L = (ne: string, en: string) => (lang === 'ne' ? ne : en)
  const title = inv.kind === 'tax' ? L('कर बीजक', 'TAX INVOICE') : inv.kind === 'cash' ? L('नगद भरपाई', 'CASH RECEIPT') : L('क्रेडिट नोट', 'CREDIT NOTE')
  const rows: Row[] = [
    { l: s.shopName, center: true, big: true },
    ...(s.company ? [{ l: s.company, center: true } as Row] : []),
    { l: [s.muni, s.ward && L('वडा ' + s.ward, 'Ward ' + s.ward)].filter(Boolean).join(', '), center: true },
    ...(s.pan ? [{ l: 'PAN: ' + fmt.n(s.pan), center: true } as Row] : []),
    { l: title, center: true, bold: true },
    { l: '', rule: true },
    { l: L('बिल नं. ', 'Bill no. ') + fmt.n(inv.no), r: undefined },
    { l: fmt.date(inv.at) },
    { l: '', rule: true },
  ]
  for (const l of inv.lines) {
    rows.push({ l: `${lang === 'ne' ? l.name : l.nameEn}`, bold: true })
    rows.push({ l: `  ${fmt.n(l.qty)} × ${fmt.n(l.rate)}`, r: fmt.n((l.qty * l.rate).toFixed(2).replace(/\.00$/, '')) })
  }
  rows.push({ l: '', rule: true })
  if (inv.kind === 'tax') {
    rows.push({ l: L('करयोग्य', 'Taxable'), r: fmt.m(inv.subtotal) })
    rows.push({ l: L('भ्याट १३%', 'VAT 13%'), r: fmt.m(inv.vat) })
  }
  rows.push({ l: L('जम्मा', 'TOTAL'), r: fmt.m(inv.total), big: true })
  for (const p of inv.payments) {
    const nm = { cash: L('नगद', 'Cash'), qr: 'QR', card: L('कार्ड', 'Card'), credit: L('उधारो', 'Credit') }[p.method]
    rows.push({ l: nm + (p.verified ? '' : L(' (अप्रमाणित)', ' (unverified)')), r: fmt.m(p.amount) })
  }
  rows.push({ l: '', rule: true })
  rows.push({ l: s.billFooter || L('धन्यवाद! फेरि आउनुहोला।', 'Thank you! Visit again.'), center: true })
  return rows
}
