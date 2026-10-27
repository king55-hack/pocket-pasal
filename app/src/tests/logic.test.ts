import { beforeEach, describe, expect, it } from 'vitest'
import { db, kvGet, uid } from '../db'
import { PROVINCES, SHOP_TYPES } from '../data'
import { bsYear, fmtDate } from '../format'
import {
  addCategory, addParty, checkSecret, createPurchase, createReturn, createSale, createUser, loose, PLANREQ, ranked,
  receivePayment, removeCategory, returnedQty, roman, saveItem, seedSample, setPerms, totals,
} from '../logic'
import { applyAll } from '../sync'
import { DEFAULT_PERMS, type Item } from '../types'

const item = (o: Partial<Item> & { nameEn: string }): Item => ({
  id: uid(), nameNe: o.nameNe ?? o.nameEn, price: 100, cost: 70, stock: 0, minStock: 2, unit: 'pcs', vat: false, sold: 0, active: true, ...o,
})
async function stocked(i: Partial<Item> & { nameEn: string }, qty: number) {
  const it = item({ ...i, stock: qty })
  await db.items.add(it)
  await db.stockMoves.add({ id: uid(), itemId: it.id, qty, reason: 'opening', at: Date.now() })
  return it
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('money', () => {
  it('adds 13% VAT on top of the price only on a tax invoice', () => {
    const lines = [{ qty: 3, rate: 25, vat: 13 }]
    expect(totals(lines, true)).toEqual({ subtotal: 75, vat: 9.75, total: 84.75 })
    expect(totals(lines, false)).toEqual({ subtotal: 75, vat: 0, total: 75 })
  })
  it('does not charge VAT on an item that is VAT-free', () => {
    expect(totals([{ qty: 2, rate: 110, vat: 0 }, { qty: 1, rate: 100, vat: 13 }], true)).toEqual({ subtotal: 320, vat: 13, total: 333 })
  })
  it('rounds to paisa without float drift', () => {
    expect(totals([{ qty: 3, rate: 0.1, vat: 0 }], false).total).toBe(0.3)
  })
})

describe('search', () => {
  const mk = (id: string, ne: string, en: string, sold: number) => ({ ...item({ id, nameNe: ne, nameEn: en, sold }) })
  const items = [
    mk('wai', 'वाईवाई नुडल्स', 'Wai Wai noodles', 312), mk('quick', 'वाईवाई क्विक', 'Wai Wai Quick', 188),
    mk('flour', 'गहुँको पीठो १ केजी', 'Wheat flour 1kg', 120), mk('chini', 'चिनी १ केजी', 'Sugar 1kg', 96),
    mk('oil', 'धारा तेल १ लिटर', 'Dhaara oil 1L', 64), mk('milk', 'दूध १ लिटर', 'Milk 1L', 20), mk('rice', 'चामल १ केजी', 'Rice 1kg', 50),
    mk('tea', 'टाटा चिया २५० ग्राम', 'Tata Tea 250g', 140), mk('shoe', 'जुत्ता कालो', '', 5),
  ]
  const ids = (q: string) => ranked(items, q).map((i) => i.id)
  it('writes Nepali letters in Latin letters', () => {
    expect(roman('चिनी')).toBe('chinii')
    expect(roman('तेल')).toBe('tel')
    expect(roman('चामल')).toBe('chaamal')
    expect(roman('गहुँको पीठो')).toBe('gahunko piitho')
  })
  it('finds Nepali names from an English keyboard, however they are spelled', () => {
    for (const q of ['chini', 'cini', 'chinee']) expect(ids(q)).toEqual(['chini'])
    expect(ids('tel')).toEqual(['oil'])
    for (const q of ['dudh', 'doodh']) expect(ids(q)).toEqual(['milk'])
    expect(ids('chamal')).toEqual(['rice'])
    for (const q of ['chiya', 'cheya']) expect(ids(q)).toEqual(['tea'])
    expect(ids('juta')).toEqual(['shoe'])
    expect(ids('pitho')).toEqual(['flour'])
  })
  it('puts names that start with the letters first, best sellers first', () => {
    expect(ids('w')).toEqual(['wai', 'quick', 'flour'])
    expect(ids('wai')).toEqual(['wai', 'quick'])
    expect(ids('wai wai')).toEqual(['wai', 'quick'])
    expect(ids('vaivai')).toEqual(['wai', 'quick'])
  })
  it('still finds Nepali typed in Nepali, and sorts by sales when nothing is typed', () => {
    expect(ids('चिनी')).toEqual(['chini'])
    expect(ids('')[0]).toBe('wai')
  })
  it('finds a barcode exactly and ignores removed items', () => {
    const coded = [{ ...mk('a', 'क', 'Alpha', 1), barcode: '8901234567890' }, { ...mk('b', 'ख', 'Beta', 9), active: false }]
    expect(ranked(coded, '8901234567890').map((i) => i.id)).toEqual(['a'])
    expect(ranked(coded, 'beta')).toEqual([])
  })
  it('does not match everything for nonsense or one squeezed letter', () => {
    expect(ids('zzz')).toEqual([])
    expect(ids('qqqq')).toEqual([])
  })
  it('squeezes spelling differences', () => {
    expect(loose('Doodh')).toBe(loose('dudh'))
    expect(loose('Wai')).toBe(loose('vai'))
  })
})

describe('Nepal data', () => {
  it('has the 7 provinces and 77 districts, each district once', () => {
    expect(PROVINCES).toHaveLength(7)
    const all = PROVINCES.flatMap((p) => p.districts.map((d) => d[0]))
    expect(all).toHaveLength(77)
    expect(new Set(all).size).toBe(77)
    expect(PROVINCES.find((p) => p.id === 'gandaki')!.districts).toHaveLength(11)
    expect(PROVINCES.find((p) => p.id === 'koshi')!.districts).toHaveLength(14)
    expect(PROVINCES.find((p) => p.id === 'bagmati')!.districts.map((d) => d[1])).toContain('Kathmandu')
  })
  it('has all 753 local levels with their ward counts, in the right districts', async () => {
    const places = (await import('../places.json')).default as unknown as Record<string, [string, string, string, number][]>
    const all = Object.values(places).flat()
    expect(all).toHaveLength(753)
    expect(Object.keys(places)).toHaveLength(77)
    expect(all.filter((p) => p[2] === 'MC')).toHaveLength(6)
    expect(all.filter((p) => p[2] === 'SMC')).toHaveLength(11)
    expect(all.filter((p) => p[2] === 'M')).toHaveLength(276)
    expect(all.filter((p) => p[2] === 'RM')).toHaveLength(460)
    expect(all.reduce((a, p) => a + p[3], 0)).toBe(6743)
    expect(all.every((p) => p[3] >= 1 && p[3] <= 40 && p[0] && p[1])).toBe(true)
    expect(places['काठमाडौँ'].find((p) => p[1] === 'Kathmandu')![3]).toBe(32)
    // every district of the form's own list has local levels
    for (const d of PROVINCES.flatMap((p) => p.districts)) expect(places[d[0]]?.length, d[1]).toBeGreaterThan(0)
  })
  it('lists shop types including the shoe shop with its own categories', () => {
    expect(new Set(SHOP_TYPES.map((t) => t.id)).size).toBe(SHOP_TYPES.length)
    expect(SHOP_TYPES.find((t) => t.id === 'jutta')!.cats.length).toBeGreaterThan(3)
  })
  it('turns an English date into the Bikram Sambat date', () => {
    const ts = new Date('2026-10-26T06:00:00Z').getTime()
    expect(bsYear(ts)).toBe(2083)
    expect(fmtDate(ts, 'BS', 'en')).toBe('2083 Kartik 09')
    expect(fmtDate(ts, 'AD', 'en')).toBe('2026-10-26')
  })
})

describe('selling', () => {
  it('reduces stock, counts the sale and numbers bills in order', async () => {
    const a = await stocked({ nameEn: 'Rice' }, 10)
    const one = await createSale({ cart: [{ itemId: a.id, qty: 3 }], kind: 'cash', payments: [{ method: 'cash', amount: 300, verified: true }], by: 'Ram' })
    const two = await createSale({ cart: [{ itemId: a.id, qty: 2 }], kind: 'cash', payments: [{ method: 'cash', amount: 200, verified: true }], by: 'Ram' })
    const now = (await db.items.get(a.id))!
    expect(now.stock).toBe(5)
    expect(now.sold).toBe(5)
    expect(one.no).toMatch(/^[A-Z2-9]{3}-C-\d{4}-000001$/)
    expect(two.no).toMatch(/-000002$/)
    expect(one.no.slice(0, 3)).toBe(two.no.slice(0, 3)) // one phone keeps its own code
    expect(await db.stockMoves.where('itemId').equals(a.id).count()).toBe(3)
  })
  it('keeps tax invoices and cash receipts in separate number series', async () => {
    const a = await stocked({ nameEn: 'Oil', vat: true }, 10)
    const pay = [{ method: 'cash' as const, amount: 113, verified: true }]
    const tax = await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'tax', payments: pay, by: 'Ram' })
    const cash = await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', payments: pay, by: 'Ram' })
    expect(tax.no).toMatch(/-T-\d{4}-000001$/)
    expect(cash.no).toMatch(/-C-\d{4}-000001$/)
    expect(tax.vat).toBe(13)
    expect(cash.vat).toBe(0)
  })
  it('adds a credit sale to what the customer owes, and a payment takes it off', async () => {
    const a = await stocked({ nameEn: 'Tea', price: 160 }, 10)
    const c = await addParty('customer', 'Sita')
    await createSale({ cart: [{ itemId: a.id, qty: 2 }], kind: 'cash', partyId: c.id, payments: [{ method: 'credit', amount: 320, verified: true }], by: 'Ram' })
    expect((await db.parties.get(c.id))!.balance).toBe(320)
    await receivePayment(c.id, 120, 'cash')
    expect((await db.parties.get(c.id))!.balance).toBe(200)
    const rows = await db.ledger.where('partyId').equals(c.id).toArray()
    expect(rows.map((r) => r.delta).sort((x, y) => x - y)).toEqual([-120, 320])
  })
  it('puts every change in the outbox for the cloud', async () => {
    const a = await stocked({ nameEn: 'Salt' }, 5)
    await db.outbox.clear()
    await createSale({ cart: [{ itemId: a.id, qty: 1 }], kind: 'cash', payments: [{ method: 'cash', amount: 100, verified: true }], by: 'Ram' })
    const tables = (await db.outbox.toArray()).map((o) => o.table)
    expect(tables).toEqual(expect.arrayContaining(['invoices', 'stockMoves']))
  })
})

describe('returns', () => {
  it('puts stock back, makes a credit note and cannot return the same goods twice', async () => {
    const a = await stocked({ nameEn: 'Soap', price: 45 }, 10)
    const sale = await createSale({ cart: [{ itemId: a.id, qty: 4 }], kind: 'cash', payments: [{ method: 'cash', amount: 180, verified: true }], by: 'Ram' })
    const note = await createReturn(sale, [{ itemId: a.id, qty: 3 }], 'Ram')
    expect(note.kind).toBe('credit_note')
    expect(note.no).toMatch(/-CN-/)
    expect(note.total).toBe(135)
    expect(note.refId).toBe(sale.id)
    const it = (await db.items.get(a.id))!
    expect(it.stock).toBe(9)
    expect(it.sold).toBe(1)
    expect((await returnedQty(sale.id))[a.id]).toBe(3)
  })
  it('takes a credit-sale return off the customer balance first', async () => {
    const a = await stocked({ nameEn: 'Rice', price: 100 }, 10)
    const c = await addParty('customer', 'Hari')
    const sale = await createSale({ cart: [{ itemId: a.id, qty: 3 }], kind: 'cash', partyId: c.id, payments: [{ method: 'credit', amount: 300, verified: true }], by: 'Ram' })
    const note = await createReturn(sale, [{ itemId: a.id, qty: 1 }], 'Ram')
    expect((await db.parties.get(c.id))!.balance).toBe(200)
    expect(note.payments).toEqual([]) // no cash goes out because the customer had not paid yet
  })
})

describe('buying stock', () => {
  it('adds stock, updates cost and records what is owed to the supplier', async () => {
    const a = await stocked({ nameEn: 'Sugar', cost: 90 }, 2)
    const s = await addParty('supplier', 'Sharma Wholesale')
    await createPurchase({ supplierId: s.id, billNo: 'SW-1', lines: [{ itemId: a.id, qty: 20, cost: 98 }], paid: false })
    const it = (await db.items.get(a.id))!
    expect(it.stock).toBe(22)
    expect(it.cost).toBe(98)
    expect((await db.parties.get(s.id))!.balance).toBe(1960)
  })
})

describe('sample data and categories', () => {
  it('starts a kirana with categories and items that each belong to one', async () => {
    await seedSample()
    const items = await db.items.toArray()
    const cats = await db.categories.toArray()
    expect(items).toHaveLength(20)
    expect(cats).toHaveLength(8)
    expect(items.every((i) => cats.some((c) => c.id === i.categoryId))).toBe(true)
    for (const i of items) {
      const sum = (await db.stockMoves.where('itemId').equals(i.id).toArray()).reduce((a, m) => a + m.qty, 0)
      expect(sum).toBe(i.stock) // stock is always the sum of its moves
    }
  })
  it('removing a category keeps its items', async () => {
    const c = await addCategory('जुत्ता', 'Shoes')
    const a = item({ nameEn: 'Bata', categoryId: c.id })
    await saveItem(a)
    await removeCategory(c.id)
    expect((await db.items.get(a.id))!.categoryId).toBeUndefined()
    expect((await db.categories.get(c.id))!.active).toBe(false)
  })
})

describe('people', () => {
  it('checks passwords and PINs, with a different salt each time', async () => {
    const u = await createUser('Ram', 'owner', 'secret123')
    const v = await createUser('Hari', 'staff', 'secret123')
    expect(await checkSecret(u, 'secret123')).toBe(true)
    expect(await checkSecret(u, 'secret124')).toBe(false)
    expect(await checkSecret(u, '')).toBe(false)
    expect(u.hash).not.toBe(v.hash)
    expect(u.hash).not.toContain('secret')
  })
  it('gives a new staff member selling only, and saves what the owner allows', async () => {
    const s = await createUser('Hari', 'staff', '1234')
    expect({ ...DEFAULT_PERMS, ...(s.perms ?? {}) }).toEqual({ sell: true, credit: false, viewCost: false, editItems: false, purchase: false, returns: 'approval', books: false, orders: false, cctv: false })
    await setPerms(s.id, { ...DEFAULT_PERMS, credit: true, returns: 'off' })
    const saved = (await db.users.get(s.id))!
    expect(saved.perms).toMatchObject({ credit: true, returns: 'off', viewCost: false })
  })
  it('knows which features need which plan', () => {
    expect(PLANREQ.cctv).toBe('max')
    expect(PLANREQ.vat).toBe('pro')
    expect(PLANREQ.sell).toBeUndefined()
  })
})

describe('sync: what arrives from another phone', () => {
  it('rebuilds stock whatever order the records arrive in, and ignores repeats', async () => {
    const id = 'item-1'
    const mv = (n: string, qty: number, reason: string) => ({ t: 'stockMoves', id: n, ts: 1, data: { id: n, itemId: id, qty, reason, at: 1 } })
    // moves arrive before the item they belong to
    await applyAll([mv('m1', 10, 'opening'), mv('m2', -3, 'sale'), mv('m2', -3, 'sale')])
    await applyAll([{ t: 'items', id, ts: 5, data: { id, nameNe: 'चिनी', nameEn: 'Sugar', price: 110, cost: 90, minStock: 2, unit: 'kg', vat: false, active: true, soldBase: 10, updatedAt: 5 } }])
    const it = (await db.items.get(id))!
    expect(it.stock).toBe(7)
    expect(it.sold).toBe(13) // 10 sold before the app + 3 now
    await applyAll([mv('m3', -2, 'sale')])
    expect((await db.items.get(id))!.stock).toBe(5)
  })
  it('rebuilds a customer balance from the ledger rows', async () => {
    const row = (n: string, delta: number) => ({ t: 'ledger', id: n, ts: 1, data: { id: n, partyId: 'p1', at: 1, desc: n, dr: Math.max(delta, 0), cr: Math.max(-delta, 0), delta } })
    await applyAll([row('l1', 500), row('l2', -200), row('l1', 500)])
    await applyAll([{ t: 'parties', id: 'p1', ts: 3, data: { id: 'p1', type: 'customer', name: 'Sita', updatedAt: 3 } }])
    expect((await db.parties.get('p1'))!.balance).toBe(300)
  })
  it('keeps the newer edit of an item, and never lets an edit overwrite local stock', async () => {
    const it = await stocked({ nameEn: 'Tea', price: 100, updatedAt: 100 }, 8)
    const edit = (price: number, ts: number) => ({ t: 'items', id: it.id, ts, data: { ...it, price, updatedAt: ts, stock: 999, sold: 999 } })
    await applyAll([edit(120, 200)])
    expect((await db.items.get(it.id))!.price).toBe(120)
    await applyAll([edit(50, 150)])
    const now = (await db.items.get(it.id))!
    expect(now.price).toBe(120)
    expect(now.stock).toBe(8)
  })
  it('keeps this phone settings when shared shop settings arrive', async () => {
    await db.kv.put({ k: 'settings', v: { lang: 'en', paper: '80', shopName: 'Old', updatedAt: 1 } })
    await applyAll([{ t: 'settings', id: 'shop', ts: 9, data: { shopName: 'New', mod: { cctv: true }, updatedAt: 9 } }])
    const s = (await kvGet('settings', {} as Record<string, unknown>))
    expect(s).toMatchObject({ shopName: 'New', lang: 'en', paper: '80' })
  })
})
