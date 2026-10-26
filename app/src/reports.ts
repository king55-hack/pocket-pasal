import { db } from './db'
import type { Sheet } from './xlsx'
import { buildXlsx } from './xlsx'
import type { Settings } from './types'

export interface ReportOpts {
  from: number
  to: number
  s: Settings
  t: (ne: string, en: string) => string
  /** The date the way the shop reads it (BS or AD). */
  date: (ts: number) => string
  time: (ts: number) => string
  /** Cost price and profit only go into the file for people allowed to see them. */
  canCost: boolean
}
const r2 = (x: number) => Math.round(x * 100) / 100

/** Everything a shop owner would open on a PC: bills, items sold, purchases, ledger, customers, suppliers and stock. */
export async function buildReport(o: ReportOpts): Promise<{ bytes: Uint8Array; filename: string }> {
  const { t } = o
  const invoices = (await db.invoices.where('at').between(o.from, o.to, true, true).toArray()).sort((a, b) => a.at - b.at)
  const purchases = (await db.purchases.where('at').between(o.from, o.to, true, true).toArray()).sort((a, b) => a.at - b.at)
  const parties = await db.parties.toArray()
  const items = (await db.items.toArray()).filter((i) => i.active)
  const cats = new Map((await db.categories.toArray()).map((c) => [c.id, t(c.nameNe, c.nameEn)]))
  const ledger = await db.ledger.toArray()
  const pname = new Map(parties.map((p) => [p.id, p.name]))
  const sign = (k: string) => (k === 'credit_note' ? -1 : 1)
  const kindName = (k: string) => (k === 'tax' ? t('कर बीजक', 'Tax invoice') : k === 'cash' ? t('नगद भरपाई', 'Cash receipt') : t('क्रेडिट नोट (फिर्ता)', 'Credit note (return)'))
  const pay = (i: (typeof invoices)[number], m: string) => r2(i.payments.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0) * sign(i.kind))

  const sum = (m: string) => r2(invoices.reduce((a, i) => a + pay(i, m), 0))
  const sheets: Sheet[] = []

  sheets.push({
    name: t('सारांश', 'Summary'), widths: [34, 22],
    rows: [
      [t('विवरण', 'Item'), t('मान', 'Value')],
      [t('पसल', 'Shop'), o.s.shopName],
      [t('अवधि', 'Period'), `${o.date(o.from)} – ${o.date(o.to)}`],
      [t('बिल संख्या', 'Bills'), invoices.filter((i) => i.kind !== 'credit_note').length],
      [t('फिर्ता संख्या', 'Returns'), invoices.filter((i) => i.kind === 'credit_note').length],
      [t('खुद बिक्री (फिर्ता घटाएर)', 'Net sales (after returns)'), r2(invoices.reduce((a, i) => a + i.total * sign(i.kind), 0))],
      [t('नगद', 'Cash'), sum('cash')], ['QR', sum('qr')], [t('कार्ड', 'Card'), sum('card')], [t('उधारो दिइएको', 'Given on credit'), sum('credit')],
      [t('भ्याट (बिक्रीमा)', 'VAT on sales'), r2(invoices.reduce((a, i) => a + i.vat * sign(i.kind), 0))],
      [t('खरिद', 'Purchases'), r2(purchases.reduce((a, p) => a + p.total, 0))],
      [t('ग्राहकले तिर्न बाँकी (अहिले)', 'Customers owe now'), r2(parties.filter((p) => p.type === 'customer').reduce((a, p) => a + p.balance, 0))],
      [t('आपूर्तिकर्तालाई तिर्नुपर्ने (अहिले)', 'We owe suppliers now'), r2(parties.filter((p) => p.type === 'supplier').reduce((a, p) => a + p.balance, 0))],
    ],
  })

  sheets.push({
    name: t('बिक्री खाता', 'Sales'), widths: [22, 16, 8, 18, 18, 40, 12, 10, 12, 12, 10, 10, 12, 12, 10, 14],
    rows: [
      [t('बिल नं.', 'Bill no.'), t('मिति', 'Date'), t('समय', 'Time'), t('प्रकार', 'Type'), t('ग्राहक', 'Customer'), t('सामान', 'Items'), t('उप-जम्मा', 'Subtotal'), t('भ्याट', 'VAT'), t('जम्मा', 'Total'),
        t('नगद', 'Cash'), 'QR', t('कार्ड', 'Card'), t('उधारो (बाँकी)', 'Credit (due)'), t('ग्राहकले दिएको', 'Customer gave'), t('फिर्ता दिएको', 'Change'), t('बनाउने', 'By')],
      ...invoices.map((i) => [i.no, o.date(i.at), o.time(i.at), kindName(i.kind), i.partyName ?? (i.partyId ? pname.get(i.partyId) ?? '' : ''),
        i.lines.map((l) => `${t(l.name, l.nameEn)} x${l.qty}`).join(', '), r2(i.subtotal * sign(i.kind)), r2(i.vat * sign(i.kind)), r2(i.total * sign(i.kind)),
        pay(i, 'cash'), pay(i, 'qr'), pay(i, 'card'), pay(i, 'credit'), i.received ?? '', i.change ?? '', i.by]),
    ],
  })

  sheets.push({
    name: t('सामानअनुसार बिक्री', 'Items sold'), widths: [22, 16, 36, 8, 12, 14, 8],
    rows: [
      [t('बिल नं.', 'Bill no.'), t('मिति', 'Date'), t('सामान', 'Item'), t('संख्या', 'Qty'), t('दर', 'Rate'), t('रकम', 'Amount'), t('भ्याट %', 'VAT %')],
      ...invoices.flatMap((i) => i.lines.map((l) => [i.no, o.date(i.at), t(l.name, l.nameEn), l.qty * sign(i.kind), l.rate, r2(l.qty * l.rate * sign(i.kind)), l.vat])),
    ],
  })

  sheets.push({
    name: t('खरिद खाता', 'Purchases'), widths: [18, 16, 26, 44, 14, 12],
    rows: [
      [t('बिल नं.', 'Bill no.'), t('मिति', 'Date'), t('आपूर्तिकर्ता', 'Supplier'), t('सामान', 'Items'), t('जम्मा', 'Total'), t('स्थिति', 'Status')],
      ...purchases.map((p) => [p.billNo, o.date(p.at), p.supplierId ? pname.get(p.supplierId) ?? '' : '',
        p.lines.map((l) => `${items.find((x) => x.id === l.itemId)?.nameEn ?? l.itemId} x${l.qty}`).join(', '), p.total, p.paid ? t('तिरिसक्यो', 'Paid') : t('उधारो', 'On credit')]),
    ],
  })

  // Ledger: every party, every line, with a running balance, the way an accountant reads it.
  const byParty = new Map<string, typeof ledger>()
  for (const r of ledger) byParty.set(r.partyId, [...(byParty.get(r.partyId) ?? []), r])
  const ledgerRows: (string | number)[][] = []
  for (const p of [...parties].sort((a, b) => a.name.localeCompare(b.name))) {
    let bal = 0
    for (const r of (byParty.get(p.id) ?? []).sort((a, b) => a.at - b.at)) {
      bal = r2(bal + (r.delta ?? r.dr - r.cr))
      ledgerRows.push([p.name, p.type === 'customer' ? t('ग्राहक', 'Customer') : t('आपूर्तिकर्ता', 'Supplier'), o.date(r.at), r.desc, r.dr || '', r.cr || '', bal])
    }
  }
  sheets.push({
    name: t('लेजर', 'Ledger'), widths: [24, 14, 16, 30, 12, 12, 14],
    rows: [[t('पार्टी', 'Party'), t('प्रकार', 'Type'), t('मिति', 'Date'), t('विवरण', 'Detail'), t('डेबिट', 'Debit'), t('क्रेडिट', 'Credit'), t('बाँकी', 'Balance')], ...ledgerRows],
  })

  sheets.push({
    name: t('ग्राहक', 'Customers'), widths: [26, 16, 28, 14],
    rows: [[t('नाम', 'Name'), t('फोन', 'Phone'), t('इमेल', 'Email'), t('तिर्न बाँकी', 'Owes')], ...parties.filter((p) => p.type === 'customer').map((p) => [p.name, p.phone ?? '', p.email ?? '', p.balance])],
  })
  sheets.push({
    name: t('आपूर्तिकर्ता', 'Suppliers'), widths: [26, 16, 28, 14],
    rows: [[t('नाम', 'Name'), t('फोन', 'Phone'), t('इमेल', 'Email'), t('तिर्नुपर्ने', 'We owe')], ...parties.filter((p) => p.type === 'supplier').map((p) => [p.name, p.phone ?? '', p.email ?? '', p.balance])],
  })
  sheets.push({
    name: t('स्टक', 'Stock'), widths: [30, 30, 20, 8, 12, 12, 10, 10, 10],
    rows: [
      [t('सामान (नेपाली)', 'Item (Nepali)'), t('सामान (English)', 'Item (English)'), t('वर्ग', 'Category'), t('एकाइ', 'Unit'), ...(o.canCost ? [t('लागत', 'Cost')] : []), t('मूल्य', 'Price'), t('स्टक', 'Stock'), t('न्यूनतम', 'Min'), t('बिक्री', 'Sold')],
      ...items.sort((a, b) => b.sold - a.sold).map((i) => [i.nameNe, i.nameEn, i.categoryId ? cats.get(i.categoryId) ?? '' : '', i.unit, ...(o.canCost ? [i.cost] : []), i.price, i.stock, i.minStock, i.sold]),
    ],
  })

  const day = (x: number) => new Date(x).toISOString().slice(0, 10)
  return { bytes: buildXlsx(sheets), filename: `pocket-pasal-${day(o.from)}_to_${day(o.to)}.xlsx` }
}
