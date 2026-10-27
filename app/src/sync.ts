import { authed, getCloud, setCloud } from './api'
import { db, kvGet, kvSet, queue } from './db'
import { uid } from './db'
import type { Settings } from './types'

/** Things in Settings that are shared between a shop's phones. Language, paper size and similar stay per phone. */
export const SHARED_SETTINGS: (keyof Settings)[] = ['shopName', 'company', 'shopType', 'shopTypeOther', 'pan', 'vatRegistered', 'province', 'district', 'muni', 'ward', 'mod', 'openingCash', 'billFooter', 'staticQr']

type Table = 'categories' | 'items' | 'parties' | 'users' | 'invoices' | 'ledger' | 'stockMoves' | 'purchases'
const ALL: Table[] = ['categories', 'items', 'parties', 'users', 'invoices', 'ledger', 'stockMoves', 'purchases']
/** Fields each phone works out for itself from the stock moves and the ledger. They are never sent as edits. */
const DERIVED: Record<string, string[]> = { items: ['stock', 'sold'], parties: ['balance'] }

interface Change { t: string; id: string; data: any; ts: number }

async function build(table: string, id: string): Promise<Change | null> {
  if (table === 'settings') {
    const s = await kvGet<Settings | null>('settings', null)
    if (!s) return null
    const data: any = {}
    for (const k of SHARED_SETTINGS) data[k] = s[k]
    data.updatedAt = s.updatedAt ?? Date.now()
    return { t: 'settings', id: 'shop', data, ts: data.updatedAt }
  }
  const row: any = await (db as any)[table].get(id)
  if (!row) return null
  const data = { ...row }
  for (const k of DERIVED[table] ?? []) delete data[k]
  return { t: table, id, data, ts: row.updatedAt ?? row.at ?? Date.now() }
}

/** First connection: put everything this phone already has into the outbox. */
export async function enqueueAll() {
  // Old data may have stock that no move explains. Add the difference as an opening move so totals add up after sync.
  for (const it of await db.items.toArray()) {
    const sum = (await db.stockMoves.where('itemId').equals(it.id).toArray()).reduce((a, m) => a + m.qty, 0)
    if (it.soldBase === undefined) {
      const fromMoves = (await db.stockMoves.where('itemId').equals(it.id).toArray()).reduce((a, m) => a + (m.reason === 'sale' ? -m.qty : m.reason === 'return' ? -m.qty : 0), 0)
      await db.items.update(it.id, { soldBase: Math.max(0, it.sold - fromMoves) })
    }
    if (Math.abs(sum - it.stock) > 1e-9) {
      const mv = { id: uid(), itemId: it.id, qty: it.stock - sum, reason: 'opening', at: Date.now() }
      await db.stockMoves.add(mv)
    }
  }
  const rows: { table: string; rowId: string; at: number }[] = []
  const at = Date.now()
  for (const t of ALL) for (const k of (await (db as any)[t].toCollection().primaryKeys()) as string[]) rows.push({ table: t, rowId: k, at })
  rows.push({ table: 'settings', rowId: 'shop', at })
  await db.outbox.clear()
  await db.outbox.bulkAdd(rows)
}
export const touchSettings = () => queue('settings', 'shop')

let running: Promise<SyncResult> | null = null
export interface SyncResult { pushed: number; pulled: number; error?: string; offline?: boolean }

export function syncNow(): Promise<SyncResult> {
  running ||= run().finally(() => { running = null })
  return running
}

async function run(): Promise<SyncResult> {
  const out: SyncResult = { pushed: 0, pulled: 0 }
  const c0 = await getCloud()
  if (!c0) return { ...out, error: 'not_connected' }
  if (!navigator.onLine) return { ...out, offline: true }
  try {
    /* 1. push, oldest first, 100 at a time */
    for (;;) {
      const pending = await db.outbox.orderBy('n').limit(300).toArray()
      if (!pending.length) break
      const seen = new Set<string>()
      const changes: Change[] = []
      const ns: number[] = []
      for (const o of pending) {
        if (changes.length >= 100) break
        ns.push(o.n!)
        const key = o.table + ':' + o.rowId
        if (seen.has(key)) continue
        seen.add(key)
        const ch = await build(o.table, o.rowId)
        if (ch) changes.push(ch)
      }
      if (changes.length) {
        await authed('/sync/push', 'POST', { changes })
        out.pushed += changes.length
      }
      // Only rows we looked at are cleared. Anything saved while this ran has a newer number and stays queued.
      await db.outbox.bulkDelete(ns)
    }
    /* 2. pull everything newer than our cursor */
    let cloud = (await getCloud())!
    for (;;) {
      const r = await authed('/sync/pull?since=' + cloud.cursor)
      if (r.changes.length) { await applyAll(r.changes); out.pulled += r.changes.length }
      cloud = { ...(await getCloud())!, cursor: r.next, lastSync: Date.now(), lastError: undefined }
      await setCloud(cloud)
      if (!r.more) break
    }
    /* 3. plan and conflicts */
    const me = await authed('/me')
    const s = await kvGet<Settings | null>('settings', null)
    if (s) {
      const paid = me.shop.paidPlan as Settings['plan']
      await kvSet('settings', { ...s, plan: paid, planUntil: me.shop.planUntil, trialEnds: me.shop.trialEnds })
    }
    try { await kvSet('closure', (await authed('/account/closure')).request) } catch { /* keep the last known state */ }
    const cf = await authed('/sync/conflicts')
    await kvSet('conflicts', cf.conflicts)
    return out
  } catch (e: any) {
    const c = await getCloud()
    if (c) await setCloud({ ...c, lastError: e.code || 'error' })
    return { ...out, error: e.code || 'error', offline: e.code === 'network' }
  }
}

export async function applyAll(changes: Change[]) {
  const touchedItems = new Set<string>()
  const touchedParties = new Set<string>()
  await db.transaction('rw', [db.categories, db.items, db.parties, db.users, db.invoices, db.ledger, db.stockMoves, db.purchases, db.kv], async () => {
    for (const c of changes) {
      const d = c.data
      switch (c.t) {
        case 'invoices':
        case 'purchases':
          if (!(await (db as any)[c.t].get(c.id))) await (db as any)[c.t].add(d)
          break
        case 'stockMoves':
          if (!(await db.stockMoves.get(c.id))) { await db.stockMoves.add(d); touchedItems.add(d.itemId) }
          break
        case 'ledger':
          if (!(await db.ledger.get(c.id))) { await db.ledger.add(d); touchedParties.add(d.partyId) }
          break
        case 'categories': {
          const l = await db.categories.get(c.id)
          if (!l || (d.updatedAt ?? 0) > (l.updatedAt ?? 0)) await db.categories.put(d)
          break
        }
        case 'items': {
          const l = await db.items.get(c.id)
          if (!l) await db.items.add({ ...d, stock: 0, sold: 0 })
          else if ((d.updatedAt ?? 0) > (l.updatedAt ?? 0)) await db.items.put({ ...d, stock: l.stock, sold: l.sold })
          touchedItems.add(c.id)
          break
        }
        case 'parties': {
          const l = await db.parties.get(c.id)
          if (!l) await db.parties.add({ ...d, balance: 0 })
          else if ((d.updatedAt ?? 0) > (l.updatedAt ?? 0)) await db.parties.put({ ...d, balance: l.balance })
          touchedParties.add(c.id)
          break
        }
        case 'users': {
          const l = await db.users.get(c.id)
          if (!l || (d.updatedAt ?? 0) > (l.updatedAt ?? 0)) await db.users.put(d)
          break
        }
        case 'settings': {
          const l = await kvGet<Settings | null>('settings', null)
          if (!l || (d.updatedAt ?? 0) > (l.updatedAt ?? 0)) {
            const next: any = { ...(l ?? {}) }
            for (const k of SHARED_SETTINGS) if (k in d) next[k] = d[k]
            next.updatedAt = d.updatedAt
            await kvSet('settings', next)
          }
          break
        }
      }
    }
    // Stock and balances are rebuilt from the full list of moves and ledger rows, so the order records arrive in never matters.
    for (const id of touchedItems) {
      const it = await db.items.get(id)
      if (!it) continue
      const mv = await db.stockMoves.where('itemId').equals(id).toArray()
      const stock = mv.reduce((a, m) => a + m.qty, 0)
      const fromMoves = mv.filter((m) => m.reason === 'sale').reduce((a, m) => a - m.qty, 0) - mv.filter((m) => m.reason === 'return').reduce((a, m) => a + m.qty, 0)
      await db.items.update(id, { stock, sold: Math.max(0, (it.soldBase ?? 0) + fromMoves) })
    }
    for (const id of touchedParties) {
      const p = await db.parties.get(id)
      if (!p) continue
      const rows = await db.ledger.where('partyId').equals(id).toArray()
      await db.parties.update(id, { balance: Math.round(rows.reduce((a, r) => a + (r.delta ?? r.dr - r.cr), 0) * 100) / 100 })
    }
  })
}
