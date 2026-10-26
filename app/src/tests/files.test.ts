import { beforeEach, describe, expect, it } from 'vitest'
import { db, uid } from '../db'
import { billRows } from '../escpos'
import { addParty, createSale } from '../logic'
import { pdfFromJpeg } from '../pdf'
import { buildReport } from '../reports'
import { buildXlsx, crc32, safeSheetName } from '../xlsx'
import { DEFAULT_PERMS, type Item, type Settings } from '../types'
import { DEFAULTS } from '../ctx'

/** Reads a zip made with no compression, the way Excel does, and checks every checksum on the way. */
function unzip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files: Record<string, Uint8Array> = {}
  let p = 0
  while (v.getUint32(p, true) === 0x04034b50) {
    const crc = v.getUint32(p + 14, true), size = v.getUint32(p + 18, true), nl = v.getUint16(p + 26, true), el = v.getUint16(p + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl))
    const data = bytes.subarray(p + 30 + nl + el, p + 30 + nl + el + size)
    expect(crc32(data)).toBe(crc)
    files[name] = data
    p += 30 + nl + el + size
  }
  // the end-of-file record must say how many files there are and where the directory starts
  const end = bytes.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  expect(v.getUint16(end + 10, true)).toBe(Object.keys(files).length)
  expect(v.getUint32(v.getUint32(end + 16, true), true)).toBe(0x02014b50)
  return files
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)
/** Cheap well-formedness check: every opened tag is closed in order. */
function wellFormed(xml: string) {
  const stack: string[] = []
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([A-Za-z0-9:_]+)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue
    if (m[1]) { if (stack.pop() !== m[2]) return false } else stack.push(m[2])
  }
  return stack.length === 0
}
const cellsOf = (sheetXml: string) => [...sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)].map((m) => [m[1], m[2] ?? m[3]])

describe('Excel file', () => {
  it('is a valid package: checksums, content types, workbook and sheets', () => {
    const f = unzip(buildXlsx([{ name: 'Sales', rows: [['Bill', 'Total'], ['A-1', 12.5]] }, { name: 'Ledger', rows: [['Party'], ['Sita']] }]))
    expect(Object.keys(f)).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    for (const [name, data] of Object.entries(f)) expect(wellFormed(text(data)), name).toBe(true)
    expect(text(f['xl/workbook.xml'])).toContain('name="Sales"')
    expect(text(f['xl/workbook.xml'])).toContain('name="Ledger"')
    expect(text(f['[Content_Types].xml'])).toContain('/xl/worksheets/sheet2.xml')
  })
  it('keeps numbers as numbers and text as text, with Nepali letters intact', () => {
    const f = unzip(buildXlsx([{ name: 'S', rows: [['नाम', 'रकम'], ['सीता', 1250.5], ['x', 3]] }]))
    const cells = Object.fromEntries(cellsOf(text(f['xl/worksheets/sheet1.xml'])))
    expect(cells).toMatchObject({ A1: 'नाम', B1: 'रकम', A2: 'सीता', B2: '1250.5', B3: '3' })
    expect(text(f['xl/worksheets/sheet1.xml'])).toMatch(/<c r="B2" s="2"><v>1250.5<\/v>/)
  })
  it('never lets a name act as a formula or break the XML', () => {
    const f = unzip(buildXlsx([{ name: 'S', rows: [['h'], ['=HYPERLINK("http://evil","x")'], ['a<b&"c'], ['\u0001ctrl']] }]))
    const xml = text(f['xl/worksheets/sheet1.xml'])
    expect(xml).not.toContain('<f>')
    expect(xml).toContain('t="inlineStr"')
    expect(xml).toContain('a&lt;b&amp;&quot;c')
    expect(xml).not.toContain('\u0001')
    expect(wellFormed(xml)).toBe(true)
  })
  it('makes sheet names Excel accepts, and unique', () => {
    const used = new Set<string>()
    expect(safeSheetName('A/B:C?[x]', used)).toBe('A B C  x')
    expect(safeSheetName('A/B:C?[x]', used)).not.toBe('A B C  x')
    expect(safeSheetName('x'.repeat(50), new Set()).length).toBe(31)
  })
  it('handles 5000 rows', () => {
    const rows = [['n', 'v'], ...Array.from({ length: 5000 }, (_, i) => [`row ${i}`, i * 1.25])]
    const f = unzip(buildXlsx([{ name: 'Big', rows }]))
    expect(cellsOf(text(f['xl/worksheets/sheet1.xml'])).length).toBe(2 * 5001) // a header plus 5000 rows of two cells each; a number 0 is still written
  })
})

describe('PDF file', () => {
  it('has a correct cross-reference table, so every reader opens it', () => {
    const jpeg = new Uint8Array(300).map((_, i) => (i * 7) & 255)
    const pdf = pdfFromJpeg(jpeg, 384, 560, 288, 420)
    const s = new TextDecoder('latin1').decode(pdf)
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    const start = Number(/startxref\n(\d+)/.exec(s)![1])
    expect(s.slice(start, start + 4)).toBe('xref')
    const offsets = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((o, i) => expect(s.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`))
    expect(s).toContain('/Filter /DCTDecode')
    expect(s).toContain('/MediaBox [0 0 288.00 420.00]')
    expect(s).toContain(`/Length ${jpeg.length}`)
  })
})

const item = (o: Partial<Item> & { nameEn: string }): Item => ({ id: uid(), nameNe: o.nameNe ?? o.nameEn, price: 100, cost: 70, stock: 0, minStock: 2, unit: 'pcs', vat: false, sold: 0, active: true, ...o })
const fmt = { m: (x: number) => 'Rs ' + x, n: (x: number | string) => String(x), date: () => 'D' }
const settings: Settings = { ...DEFAULTS, shopName: 'Test Shop' }

beforeEach(async () => { await db.delete(); await db.open() })

describe('change and baki on a bill', () => {
  it('keeps what the customer gave and the change: bill 430, customer gives 450, change 20', async () => {
    const a = item({ nameEn: 'Rice sack', price: 430, stock: 5 })
    await db.items.add(a)
    const inv = await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', payments: [{ method: 'cash', amount: 430, verified: true }], by: 'Ram', received: 450, change: 20 })
    expect(inv.total).toBe(430)
    expect(inv.received).toBe(450)
    expect(inv.change).toBe(20)
    const rows = billRows(inv, settings, 'en', fmt).map((r) => r.l + '|' + (r.r ?? ''))
    expect(rows).toContain('Customer gave|Rs 450')
    expect(rows).toContain('Change returned|Rs 20')
  })
  it('a part payment leaves the rest as baki on the customer, and the bill says so', async () => {
    const a = item({ nameEn: 'Rice sack', price: 430, stock: 5 })
    await db.items.add(a)
    const c = await addParty('customer', 'Mina Didi', '9800000000', 'mina@example.com')
    const inv = await createSale({
      cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', partyId: c.id, by: 'Ram', received: 300, change: 0,
      payments: [{ method: 'cash', amount: 300, verified: true }, { method: 'credit', amount: 130, verified: true }],
    })
    expect((await db.parties.get(c.id))!.balance).toBe(130)
    expect(inv.partyName).toBe('Mina Didi')
    expect(inv.partyBalance).toBe(130)
    expect((await db.parties.get(c.id))!.email).toBe('mina@example.com')
    const rows = billRows(inv, settings, 'en', fmt).map((r) => r.l + '|' + (r.r ?? ''))
    expect(rows).toContain('Customer: Mina Didi|')
    expect(rows).toContain('Cash|Rs 300')
    expect(rows).toContain('On credit (due)|Rs 130')
    expect(rows).toContain('Total due|Rs 130')
    // a second part-credit bill adds to what she already owes
    const two = await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', partyId: c.id, by: 'Ram', payments: [{ method: 'credit', amount: 430, verified: true }] })
    expect(two.partyBalance).toBe(560)
  })
  it('shows the bill in Nepali too', async () => {
    const a = item({ nameEn: 'Rice sack', price: 100, stock: 5 })
    await db.items.add(a)
    const inv = await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', payments: [{ method: 'cash', amount: 100, verified: true }], by: 'Ram', received: 150, change: 50 })
    const rows = billRows(inv, settings, 'ne', fmt).map((r) => r.l)
    expect(rows).toContain('ग्राहकले दिएको')
    expect(rows).toContain('फिर्ता दिएको')
  })
})

describe('Excel report for the PC', () => {
  it('has every sheet, the right numbers, and hides cost from people who may not see it', async () => {
    const rice = item({ nameEn: 'Rice', nameNe: 'चामल', price: 430, cost: 380, stock: 10, sold: 3 })
    await db.items.add(rice)
    const mina = await addParty('customer', 'Mina Didi', undefined, 'mina@example.com')
    await createSale({ cart: [{ itemId: rice.id, qty: 1 }], kind: 'cash', partyId: mina.id, by: 'Ram', received: 300, change: 0, payments: [{ method: 'cash', amount: 300, verified: true }, { method: 'credit', amount: 130, verified: true }] })
    await createSale({ cart: [{ itemId: rice.id, qty: 1 }], kind: 'cash', by: 'Ram', received: 450, change: 20, payments: [{ method: 'cash', amount: 430, verified: true }] })
    const base = { from: 0, to: Date.now() + 1000, s: settings, t: (_ne: string, en: string) => en, date: () => '2083 Kartik 09', time: () => '10:00' }

    const withCost = unzip((await buildReport({ ...base, canCost: true })).bytes)
    const wb = text(withCost['xl/workbook.xml'])
    for (const n of ['Summary', 'Sales', 'Items sold', 'Purchases', 'Ledger', 'Customers', 'Suppliers', 'Stock']) expect(wb).toContain(`name="${n}"`)
    const sheet = (n: number) => Object.fromEntries(cellsOf(text(withCost[`xl/worksheets/sheet${n}.xml`])))
    const summary = sheet(1)
    expect(Object.values(summary)).toEqual(expect.arrayContaining(['860', '130', '730'])) // net sales, credit given, cash (300 + 430)
    const sales = sheet(2)
    expect(Object.values(sales)).toEqual(expect.arrayContaining(['Mina Didi', '450', '20', '130']))
    const ledger = sheet(5)
    expect(Object.values(ledger)).toEqual(expect.arrayContaining(['Mina Didi', '130']))
    const customers = sheet(6)
    expect(Object.values(customers)).toEqual(expect.arrayContaining(['Mina Didi', 'mina@example.com', '130']))
    expect(Object.values(sheet(8))).toContain('380') // cost is in the stock sheet for the owner

    const noCost = unzip((await buildReport({ ...base, canCost: false })).bytes)
    expect(Object.values(Object.fromEntries(cellsOf(text(noCost['xl/worksheets/sheet8.xml']))))).not.toContain('380')
    expect(text(noCost['xl/worksheets/sheet8.xml'])).not.toContain('Cost')
    void DEFAULT_PERMS
  })
  it('names the file with the dates', async () => {
    const r = await buildReport({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 26), s: settings, t: (_a, b) => b, date: () => 'd', time: () => 't', canCost: false })
    expect(r.filename).toBe('pocket-pasal-2026-10-01_to_2026-10-26.xlsx')
  })
})
