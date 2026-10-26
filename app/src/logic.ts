import { db, kvGet, kvSet, queue, uid } from './db'
import { bsYear, round2 } from './format'
import type { Category, Invoice, Item, Line, Method, Payment, Perms, Plan, Purchase, Role, User } from './types'

/* ---------- plans ---------- */
export const RANK: Record<Plan, number> = { free: 0, pro: 1, max: 2 }
/** Smallest plan that unlocks a feature. A feature that is not listed is free. */
export const PLANREQ: Record<string, Plan> = {
  vat: 'pro', purch: 'pro', returns: 'pro', orders: 'pro', staff: 'pro',
  dynqr: 'pro', books: 'pro', export: 'pro', cctv: 'max', delivery: 'max',
}
export const FREE_ITEM_LIMIT = 100
export const FREE_CREDIT_LIMIT = 10
export const STAFF_LIMIT: Record<Plan, number> = { free: 0, pro: 3, max: 99 }

/* ---------- search that also works from an English keyboard ---------- */
const CONS: Record<string, string> = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h' }
const VOW: Record<string, string> = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ii', उ: 'u', ऊ: 'uu', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au' }
const MATRA: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au' }

/** Nepali letters to Latin letters, for example चिनी to "chinii". Used only to match what people type. */
export function roman(s: string): string {
  const ch = [...s]
  let out = ''
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], n = ch[i + 1]
    if (CONS[c] !== undefined) {
      out += CONS[c]
      if (n && MATRA[n] !== undefined) { out += MATRA[n]; i++ }
      else if (n === '्') i++
      else if (n && (CONS[n] !== undefined || VOW[n] !== undefined || n === 'ं' || n === 'ँ')) out += 'a' // a letter follows: keep the inherent "a"; at the end of a word it is silent
    } else if (VOW[c] !== undefined) out += VOW[c]
    else if (c === 'ं' || c === 'ँ') out += 'n'
    else if (c === 'ः') out += 'h'
    else if (c >= '०' && c <= '९') out += String(c.charCodeAt(0) - 0x966)
    else if (c !== '़' && c !== '्' && MATRA[c] === undefined) out += c
  }
  return out
}
/** Squeeze spelling differences (chini / cini, doodh / dudh, wai / vai, chiya / cheya) so rough typing still matches. */
export function loose(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '')
    .replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/chh|ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'f').replace(/([bdgjkt])h/g, '$1')
    .replace(/(.)\1+/g, '$1').replace(/e/g, 'i').replace(/o/g, 'u')
}
interface Keys { raw: string[]; lo: string[]; words: string[]; loWords: string[]; flat: string[]; loFlat: string[] }
const keyCache = new Map<string, Keys>()
function keysOf(i: Item): Keys {
  const id = i.nameNe + '|' + i.nameEn
  let k = keyCache.get(id)
  if (!k) {
    const raw = [i.nameNe.toLowerCase(), i.nameEn.toLowerCase(), roman(i.nameNe)]
    const lo = raw.map(loose)
    const split = (a: string[]) => a.flatMap((x) => x.split(/\s+/)).filter(Boolean)
    k = { raw, lo, words: split(raw), loWords: split(lo), flat: raw.map((x) => x.replace(/\s+/g, '')), loFlat: lo.map((x) => x.replace(/\s+/g, '')) }
    if (keyCache.size > 5000) keyCache.clear()
    keyCache.set(id, k)
  }
  return k
}

/** Names that start with what was typed come first, then names that contain it. Within each group the best sellers come first. */
export function ranked(items: Item[], q: string): Item[] {
  const list = items.filter((i) => i.active)
  const s = q.trim().toLowerCase()
  if (!s) return list.sort((a, b) => b.sold - a.sold)
  const l = loose(s)
  const sFlat = s.replace(/\s+/g, '')
  // A query like 'zzz' squeezes down to one letter and would match almost anything, so rough matching needs something left to match on.
  const lRaw = l.replace(/\s+/g, '')
  const lFlat = lRaw.length < 2 && sFlat.length > 1 ? '' : lRaw
  const rows: { i: Item; r: number }[] = []
  for (const i of list) {
    if (i.barcode && i.barcode === s) { rows.push({ i, r: -1 }); continue }
    const k = keysOf(i)
    let r = 2
    if (k.words.some((w) => w.startsWith(s)) || k.flat.some((f) => f.startsWith(sFlat)) || (lFlat && (k.loWords.some((w) => w.startsWith(l)) || k.loFlat.some((f) => f.startsWith(lFlat))))) r = 0
    else if (k.raw.some((x) => x.includes(s)) || (lFlat && k.loFlat.some((f) => f.includes(lFlat)))) r = 1
    if (r < 2) rows.push({ i, r })
  }
  return rows.sort((a, b) => a.r - b.r || b.i.sold - a.i.sold).map((x) => x.i)
}

/* ---------- totals ---------- */
export function totals(lines: { qty: number; rate: number; vat: number }[], withVat: boolean) {
  const subtotal = round2(lines.reduce((a, l) => a + l.qty * l.rate, 0))
  const vat = withVat ? round2(lines.reduce((a, l) => a + (l.qty * l.rate * l.vat) / 100, 0)) : 0
  return { subtotal, vat, total: round2(subtotal + vat) }
}

/* ---------- numbering: one series per bill type and device ---------- */
const PREFIX = { tax: 'T', cash: 'C', credit_note: 'CN' } as const
async function nextNo(kind: Invoice['kind'], at: number) {
  const key = 'seq-' + kind
  const n = (await kvGet<number>(key, 0)) + 1
  await kvSet(key, n)
  // Each phone gets its own short code the first time it issues a bill, so two phones never use the same bill number.
  let dev = await kvGet<string>('device', '')
  if (!dev) {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    dev = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => letters[b % letters.length]).join('')
    await kvSet('device', dev)
  }
  return `${dev}-${PREFIX[kind]}-${bsYear(at)}-${String(n).padStart(6, '0')}`
}

/* ---------- sale ---------- */
export interface SaleArgs {
  cart: { itemId: string; qty: number }[]
  kind: 'tax' | 'cash'
  partyId?: string
  payments: Payment[]
  by: string
}
export async function createSale(a: SaleArgs): Promise<Invoice> {
  return db.transaction('rw', [db.items, db.invoices, db.ledger, db.stockMoves, db.parties, db.kv, db.outbox], async () => {
    const at = Date.now()
    const lines: Line[] = []
    for (const c of a.cart) {
      const it = await db.items.get(c.itemId)
      if (!it) continue
      lines.push({ itemId: it.id, name: it.nameNe, nameEn: it.nameEn, qty: c.qty, rate: it.price, vat: it.vat ? 13 : 0 })
    }
    const t = totals(lines, a.kind === 'tax')
    const inv: Invoice = { id: uid(), no: await nextNo(a.kind, at), kind: a.kind, at, partyId: a.partyId, lines, ...t, payments: a.payments, by: a.by }
    await db.invoices.add(inv)
    await queue('invoices', inv.id)
    for (const l of lines) {
      const it = (await db.items.get(l.itemId))!
      await db.items.update(it.id, { stock: it.stock - l.qty, sold: it.sold + l.qty })
      const mv = { id: uid(), itemId: it.id, qty: -l.qty, reason: 'sale', refId: inv.id, at }
      await db.stockMoves.add(mv)
      await queue('stockMoves', mv.id)
    }
    const credit = a.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0)
    if (credit > 0 && a.partyId) {
      const p = (await db.parties.get(a.partyId))!
      await db.parties.update(p.id, { balance: round2(p.balance + credit) })
      const row = { id: uid(), partyId: p.id, at, desc: inv.no, dr: credit, cr: 0, delta: credit }
      await db.ledger.add(row)
      await queue('ledger', row.id)
    }
    return inv
  })
}

/* ---------- return: credit note, stock back, ledger and refund updated together ---------- */
export async function createReturn(orig: Invoice, sel: { itemId: string; qty: number }[], by: string): Promise<Invoice> {
  return db.transaction('rw', [db.items, db.invoices, db.ledger, db.stockMoves, db.parties, db.kv, db.outbox], async () => {
    const at = Date.now()
    const lines: Line[] = sel.map((s) => {
      const l = orig.lines.find((x) => x.itemId === s.itemId)!
      return { ...l, qty: s.qty }
    })
    const t = totals(lines, orig.kind === 'tax')
    let refundCash = t.total
    const wasCredit = orig.payments.some((p) => p.method === 'credit')
    if (wasCredit && orig.partyId) {
      const p = (await db.parties.get(orig.partyId))!
      const off = Math.min(p.balance, t.total)
      await db.parties.update(p.id, { balance: round2(p.balance - off) })
      const row = { id: uid(), partyId: p.id, at, desc: 'Return', dr: 0, cr: off, delta: -off }
      await db.ledger.add(row)
      await queue('ledger', row.id)
      refundCash = round2(t.total - off)
    }
    const inv: Invoice = {
      id: uid(), no: await nextNo('credit_note', at), kind: 'credit_note', at, partyId: orig.partyId, lines, ...t,
      payments: refundCash > 0 ? [{ method: 'cash', amount: refundCash, verified: true }] : [], by, refId: orig.id,
    }
    await db.invoices.add(inv)
    await queue('invoices', inv.id)
    for (const l of lines) {
      const it = (await db.items.get(l.itemId))!
      await db.items.update(it.id, { stock: it.stock + l.qty, sold: Math.max(0, it.sold - l.qty) })
      const mv = { id: uid(), itemId: it.id, qty: l.qty, reason: 'return', refId: inv.id, at }
      await db.stockMoves.add(mv)
      await queue('stockMoves', mv.id)
    }
    return inv
  })
}

/** Total already returned per item for a bill, so the same goods cannot be returned twice. */
export async function returnedQty(origId: string): Promise<Record<string, number>> {
  const notes = (await db.invoices.toArray()).filter((i) => i.kind === 'credit_note')
  const out: Record<string, number> = {}
  for (const n of notes) if (n.refId === origId) for (const l of n.lines) out[l.itemId] = (out[l.itemId] || 0) + l.qty
  return out
}

/* ---------- khata ---------- */
export async function receivePayment(partyId: string, amount: number, desc: string) {
  await db.transaction('rw', [db.parties, db.ledger, db.outbox], async () => {
    const p = (await db.parties.get(partyId))!
    await db.parties.update(partyId, { balance: round2(p.balance - amount) })
    const row = { id: uid(), partyId, at: Date.now(), desc, dr: 0, cr: amount, delta: -amount }
    await db.ledger.add(row)
    await queue('ledger', row.id)
  })
}
export async function addParty(type: 'customer' | 'supplier', name: string, phone?: string) {
  const p = { id: uid(), type, name, phone, balance: 0, updatedAt: Date.now() }
  await db.parties.add(p)
  await queue('parties', p.id)
  return p
}

/* ---------- purchases ---------- */
export async function createPurchase(a: { supplierId?: string; billNo: string; lines: { itemId: string; qty: number; cost: number }[]; paid: boolean }) {
  await db.transaction('rw', [db.items, db.purchases, db.stockMoves, db.parties, db.ledger, db.outbox], async () => {
    const at = Date.now()
    const total = round2(a.lines.reduce((s, l) => s + l.qty * l.cost, 0))
    const pur: Purchase = { id: uid(), supplierId: a.supplierId, billNo: a.billNo, at, lines: a.lines, total, paid: a.paid }
    await db.purchases.add(pur)
    await queue('purchases', pur.id)
    for (const l of a.lines) {
      const it = (await db.items.get(l.itemId))!
      await db.items.update(it.id, { stock: it.stock + l.qty, cost: l.cost })
      const mv = { id: uid(), itemId: it.id, qty: l.qty, reason: 'purchase', refId: pur.id, at }
      await db.stockMoves.add(mv)
      await queue('stockMoves', mv.id)
    }
    if (!a.paid && a.supplierId) {
      const p = (await db.parties.get(a.supplierId))!
      await db.parties.update(p.id, { balance: round2(p.balance + total) })
      const row = { id: uid(), partyId: p.id, at, desc: a.billNo, dr: 0, cr: total, delta: total }
      await db.ledger.add(row)
      await queue('ledger', row.id)
    }
  })
}

/* ---------- items ---------- */
export async function saveItem(it: Item) {
  await db.items.put({ ...it, updatedAt: Date.now() })
  await queue('items', it.id)
}
export async function adjustStock(itemId: string, delta: number, reason: string) {
  await db.transaction('rw', [db.items, db.stockMoves, db.outbox], async () => {
    const it = (await db.items.get(itemId))!
    await db.items.update(itemId, { stock: it.stock + delta })
    const mv = { id: uid(), itemId, qty: delta, reason, at: Date.now() }
    await db.stockMoves.add(mv)
    await queue('stockMoves', mv.id)
  })
}

/* ---------- categories ---------- */
export async function saveCategory(c: Category) {
  await db.categories.put({ ...c, updatedAt: Date.now() })
  await queue('categories', c.id)
}
export async function addCategory(nameNe: string, nameEn?: string) {
  const c: Category = { id: uid(), nameNe: nameNe.trim(), nameEn: (nameEn ?? nameNe).trim(), active: true }
  await saveCategory(c)
  return c
}
/** Removing a category keeps its items; they just have no category. */
export async function removeCategory(id: string) {
  const c = await db.categories.get(id)
  if (c) await saveCategory({ ...c, active: false })
  for (const it of await db.items.filter((x) => x.categoryId === id).toArray()) await saveItem({ ...it, categoryId: undefined })
}

/* ---------- users ---------- */
export async function setPerms(userId: string, perms: Partial<Perms>) {
  await db.users.update(userId, { perms, updatedAt: Date.now() })
  await queue('users', userId)
}
export async function setSecret(userId: string, secret: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(12)).buffer)
  await db.users.update(userId, { salt, hash: await hash(secret, salt), updatedAt: Date.now() })
  await queue('users', userId)
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function hash(secret: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256)
  return hex(bits)
}
export async function createUser(name: string, role: Role, secret: string): Promise<User> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(12)).buffer)
  const u: User = { id: uid(), name, role, salt, hash: await hash(secret, salt), active: true, updatedAt: Date.now() }
  await db.users.add(u)
  await queue('users', u.id)
  return u
}
export async function checkSecret(u: User, secret: string) {
  return (await hash(secret, u.salt)) === u.hash
}

/* ---------- sample kirana list, so a new shop does not start empty ---------- */
const S = (nameNe: string, nameEn: string, cost: number, price: number, stock: number, minStock: number, unit: string, vat = true): Omit<Item, 'id' | 'sold' | 'active'> =>
  ({ nameNe, nameEn, cost, price, stock, minStock, unit, vat })
export const SAMPLE_ITEMS = [
  S('वाईवाई नुडल्स', 'Wai Wai noodles', 21, 25, 80, 20, 'pkt'),
  S('रारा नुडल्स', 'Rara noodles', 21, 25, 60, 20, 'pkt'),
  S('धारा तेल १ लिटर', 'Dhaara oil 1L', 220, 245, 12, 10, 'pcs'),
  S('टाटा चिया २५० ग्राम', 'Tata Tea 250g', 140, 160, 10, 10, 'pkt'),
  S('चिनी १ केजी', 'Sugar 1kg', 98, 110, 30, 20, 'kg', false),
  S('नुन १ केजी', 'Salt 1kg', 22, 28, 40, 15, 'kg', false),
  S('चामल १ केजी', 'Rice 1kg', 70, 80, 50, 20, 'kg', false),
  S('दाल १ केजी', 'Lentil 1kg', 140, 160, 25, 10, 'kg', false),
  S('गहुँको पीठो १ केजी', 'Wheat flour 1kg', 65, 75, 30, 10, 'kg', false),
  S('कोका-कोला १.५ लिटर', 'Coca-Cola 1.5L', 165, 190, 24, 6, 'btl'),
  S('फ्यान्टा ५०० मिली', 'Fanta 500ml', 45, 55, 24, 6, 'btl'),
  S('लाइफबोय साबुन', 'Lifebuoy soap', 38, 45, 40, 10, 'pcs'),
  S('सर्फ एक्सेल १ केजी', 'Surf Excel 1kg', 190, 220, 15, 5, 'pkt'),
  S('कोलगेट टुथपेस्ट', 'Colgate toothpaste', 75, 95, 18, 6, 'pcs'),
  S('गुड डे बिस्कुट', 'Good Day biscuit', 18, 22, 50, 15, 'pkt'),
  S('पारलेजी बिस्कुट', 'Parle-G biscuit', 8, 10, 80, 20, 'pkt'),
  S('दूध १ लिटर', 'Milk 1L', 100, 115, 20, 10, 'pkt', false),
  S('अण्डा (१ डोज)', 'Eggs (1 dozen)', 190, 220, 10, 5, 'doz', false),
  S('माचिस', 'Matchbox', 4, 5, 100, 20, 'pcs'),
  S('सिगरेट खुकुरी', 'Khukuri cigarette', 17, 20, 60, 20, 'pkt'),
]
const SAMPLE_CATS: [string, string][] = [['नुडल्स र बिस्कुट', 'Noodles and biscuits'], ['अन्न र दाल', 'Grains and pulses'], ['तेल र मसला', 'Oil and spices'], ['चिया र चिनी', 'Tea and sugar'], ['पेय पदार्थ', 'Drinks'], ['सरसफाइ', 'Cleaning and hygiene'], ['दूध र अण्डा', 'Dairy and eggs'], ['अन्य', 'Other']]
const SAMPLE_CAT = [0, 0, 2, 3, 3, 2, 1, 1, 1, 4, 4, 5, 5, 5, 0, 0, 6, 6, 7, 7]
export async function seedSample() {
  const cats = SAMPLE_CATS.map(([nameNe, nameEn]) => ({ id: uid(), nameNe, nameEn, active: true, updatedAt: Date.now() }))
  await db.categories.bulkAdd(cats)
  for (const c of cats) await queue('categories', c.id)
  const at = Date.now()
  const rows: Item[] = SAMPLE_ITEMS.map((x, i) => ({ ...x, id: uid(), sold: Math.round(200 / (i + 1.5)), soldBase: Math.round(200 / (i + 1.5)), active: true, updatedAt: at, categoryId: cats[SAMPLE_CAT[i]].id }))
  await db.items.bulkAdd(rows)
  for (const r of rows) {
    await queue('items', r.id)
    // Stock is always the sum of its moves, so the starting stock is a move too.
    const mv = { id: uid(), itemId: r.id, qty: r.stock, reason: 'opening', at }
    await db.stockMoves.add(mv)
    await queue('stockMoves', mv.id)
  }
}

export const methodIsDigital = (m: Method) => m === 'qr' || m === 'card'
