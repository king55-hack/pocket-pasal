import { Hono } from 'hono'
import type { App } from './index'

export const sync = new Hono<App>()

/** Records that are only ever added. Sending one twice is harmless. */
const APPEND = new Set(['invoices', 'ledger', 'stockMoves', 'purchases'])
/** Records that can be edited. The newest edit wins, record by record. */
const LWW = new Set(['items', 'parties', 'users', 'settings', 'categories'])
const MAX_BATCH = 100
const MAX_RECORD = 64 * 1024

interface Change { t: string; id: string; data: Record<string, unknown>; ts: number }

const uniqOf = (t: string, d: Record<string, unknown>) => {
  if (t === 'invoices' && typeof d.no === 'string') return d.no
  if (t === 'items' && typeof d.barcode === 'string' && d.barcode) return d.barcode
  return null
}

sync.post('/push', async (c) => {
  let b: { changes?: Change[] } | null = null
  try { b = await c.req.json() } catch { /* handled below */ }
  const list = b?.changes
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) return c.json({ error: 'invalid' }, 400)
  const shop = c.get('shop'), dev = c.get('dev')
  const rows: { ch: Change; json: string }[] = []
  for (const ch of list) {
    if (!ch || typeof ch.id !== 'string' || ch.id.length > 64 || !(APPEND.has(ch.t) || LWW.has(ch.t)) || typeof ch.data !== 'object' || !ch.data) return c.json({ error: 'invalid' }, 400)
    const json = JSON.stringify(ch.data)
    if (json.length > MAX_RECORD) return c.json({ error: 'too_big', id: ch.id }, 400)
    rows.push({ ch, json })
  }

  // Reserve a run of sequence numbers for this batch.
  const end = (await c.env.DB.prepare('UPDATE shops SET seq=seq+? WHERE id=? RETURNING seq').bind(rows.length, shop).first<{ seq: number }>())!.seq
  const start = end - rows.length + 1

  const stmts: D1PreparedStatement[] = []
  let flagged = 0
  for (let i = 0; i < rows.length; i++) {
    const { ch, json } = rows[i]
    const seq = start + i
    // A phone with a wrong clock (or a hostile one) must not be able to win every future edit, so edit times are capped at server time plus a few minutes.
    const ts = Number.isFinite(ch.ts) ? Math.min(Math.floor(ch.ts), Date.now() + 5 * 60_000) : Date.now()
    const uniq = uniqOf(ch.t, ch.data)
    if (uniq) {
      const other = await c.env.DB.prepare('SELECT id FROM records WHERE shop_id=? AND tbl=? AND uniq=? AND id<>? LIMIT 1').bind(shop, ch.t, uniq, ch.id).first<{ id: string }>()
      if (other) {
        // Same bill number or barcode on two different records: keep both, ask the owner to look.
        const pair = [ch.id, other.id].sort()
        const kind = ch.t === 'invoices' ? 'duplicate_bill_no' : 'duplicate_barcode'
        stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO conflicts (id,shop_id,kind,tbl,a,b,created_at) VALUES (?,?,?,?,?,?,?)').bind(`${shop}:${ch.t}:${pair[0]}:${pair[1]}`, shop, kind, ch.t, pair[0], pair[1], Date.now()))
        flagged++
      }
    }
    if (APPEND.has(ch.t)) {
      stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO records (shop_id,tbl,id,data,updated_at,seq,device_id,uniq) VALUES (?,?,?,?,?,?,?,?)').bind(shop, ch.t, ch.id, json, ts, seq, dev, uniq))
    } else {
      stmts.push(c.env.DB.prepare(
        `INSERT INTO records (shop_id,tbl,id,data,updated_at,seq,device_id,uniq) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(shop_id,tbl,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,seq=excluded.seq,device_id=excluded.device_id,uniq=excluded.uniq
         WHERE excluded.updated_at >= records.updated_at`).bind(shop, ch.t, ch.id, json, ts, seq, dev, uniq))
    }
  }
  await c.env.DB.batch(stmts)
  return c.json({ ok: true, accepted: rows.length, flagged, seq: end })
})

sync.get('/pull', async (c) => {
  const since = Math.max(0, Number(c.req.query('since')) || 0)
  const limit = 300
  const r = await c.env.DB.prepare('SELECT tbl,id,data,updated_at,seq FROM records WHERE shop_id=? AND seq>? ORDER BY seq LIMIT ?').bind(c.get('shop'), since, limit + 1).all<any>()
  const more = r.results.length > limit
  const rows = more ? r.results.slice(0, limit) : r.results
  return c.json({
    changes: rows.map((x) => ({ t: x.tbl, id: x.id, data: JSON.parse(x.data), ts: x.updated_at, seq: x.seq })),
    next: rows.length ? rows[rows.length - 1].seq : since,
    more,
  })
})

sync.get('/conflicts', async (c) => {
  const r = await c.env.DB.prepare('SELECT id,kind,tbl,a,b,created_at FROM conflicts WHERE shop_id=? AND resolved=0 ORDER BY created_at DESC LIMIT 50').bind(c.get('shop')).all()
  return c.json({ conflicts: r.results })
})
sync.post('/conflicts/:id/resolve', async (c) => {
  await c.env.DB.prepare('UPDATE conflicts SET resolved=1 WHERE id=? AND shop_id=?').bind(c.req.param('id'), c.get('shop')).run()
  return c.json({ ok: true })
})
