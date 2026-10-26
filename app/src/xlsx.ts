/** A small Excel (.xlsx) writer: several sheets, bold header row, frozen top row, numbers kept as numbers. No library. */
export type Cell = string | number | null | undefined
export interface Sheet { name: string; rows: Cell[][]; widths?: number[] }

const te = new TextEncoder()
const T = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
export function crc32(b: Uint8Array) { let c = ~0; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0 }

/** A zip file with no compression (Excel reads it fine, and files stay small anyway). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let off = 0
  const u16 = (v: DataView, o: number, x: number) => v.setUint16(o, x, true)
  const u32 = (v: DataView, o: number, x: number) => v.setUint32(o, x, true)
  for (const f of files) {
    const name = te.encode(f.name)
    const crc = crc32(f.data)
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer)
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u16(lv, 10, 0); u16(lv, 12, 0x21)
    u32(lv, 14, crc); u32(lv, 18, f.data.length); u32(lv, 22, f.data.length); u16(lv, 26, name.length); u16(lv, 28, 0)
    lh.set(name, 30)
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer)
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0); u16(cv, 12, 0); u16(cv, 14, 0x21)
    u32(cv, 16, crc); u32(cv, 20, f.data.length); u32(cv, 24, f.data.length); u16(cv, 28, name.length)
    u32(cv, 42, off)
    ch.set(name, 46)
    chunks.push(lh, f.data); central.push(ch)
    off += lh.length + f.data.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length); u16(ev, 10, files.length); u32(ev, 12, cdSize); u32(ev, 16, off)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const b of all) { out.set(b, p); p += b.length }
  return out
}

// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }
export const safeSheetName = (n: string, used: Set<string>) => {
  let base = n.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base, i = 2
  while (used.has(name.toLowerCase())) name = base.slice(0, 28) + ' ' + i++
  used.add(name.toLowerCase())
  return name
}

function sheetXml(s: Sheet) {
  const widths = s.widths ?? []
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
  if (widths.length) x += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
  x += '<sheetData>'
  s.rows.forEach((row, r) => {
    x += `<row r="${r + 1}">`
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return
      const ref = col(c) + (r + 1)
      if (typeof v === 'number' && Number.isFinite(v)) x += `<c r="${ref}" s="${r === 0 ? 1 : Number.isInteger(v) ? 0 : 2}"><v>${v}</v></c>`
      else x += `<c r="${ref}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
    })
    x += '</row>'
  })
  return x + '</sheetData></worksheet>'
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE6F5"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>()
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }))
  const f = (name: string, text: string) => ({ name, data: te.encode(text) })
  return zipStore([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'),
    f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    f('xl/styles.xml', STYLES),
    ...named.map((s, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ])
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
