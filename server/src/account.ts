import { Hono } from 'hono'
import type { App } from './index'
import { hashPassword, safeEqual } from './crypto'
import { sendMail } from './mail'

/**
 * The owner asks to close the account (erase everything on the server) or only to stop the paid plan.
 * Nothing is erased on the spot: the admin approves (within about 7 days), and the data is erased 14 days after approval.
 * The owner can cancel the request at any time before that.
 */
export const account = new Hono<App>()

export const REASONS = ['too_expensive', 'not_using', 'missing_features', 'hard_to_use', 'other_app', 'closing_business', 'privacy', 'problems', 'other'] as const
const TYPES = ['delete_account', 'cancel_plan'] as const

const row = (r: any) => r && ({
  id: r.id, type: r.type, reason: r.reason_code, status: r.status, requestedAt: r.requested_at,
  decidedAt: r.decided_at, note: r.decision_note, scheduledAt: r.scheduled_at,
})

account.get('/closure', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM closure_requests WHERE shop_id=? ORDER BY requested_at DESC LIMIT 1').bind(c.get('shop')).first<any>()
  return c.json({ request: row(r) })
})

account.post('/closure', async (c) => {
  let b: any
  try { b = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
  if (!b || !TYPES.includes(b.type) || !REASONS.includes(b.reasonCode) || typeof b.password !== 'string' || b.password.length > 200) return c.json({ error: 'invalid' }, 400)
  const text = b.reasonText == null ? '' : String(b.reasonText)
  if (text.length > 1000) return c.json({ error: 'invalid' }, 400)
  if (b.reasonCode === 'other' && text.trim().length < 3) return c.json({ error: 'reason_needed' }, 400)

  const owner = await c.env.DB.prepare('SELECT id,email,salt,hash FROM owners WHERE id=?').bind(c.get('owner')).first<any>()
  const key = 'closure:' + owner.email
  const fails = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email=? AND at>?').bind(key, Date.now() - 15 * 60_000).first<{ n: number }>()
  if ((fails?.n ?? 0) >= 5) return c.json({ error: 'locked' }, 429)
  if (!safeEqual(await hashPassword(b.password, owner.salt), owner.hash)) {
    await c.env.DB.prepare('INSERT INTO login_attempts (email,at) VALUES (?,?)').bind(key, Date.now()).run()
    return c.json({ error: 'bad_password' }, 403)
  }
  const open = await c.env.DB.prepare("SELECT id FROM closure_requests WHERE shop_id=? AND status IN ('pending','approved')").bind(c.get('shop')).first()
  if (open) return c.json({ error: 'already_open' }, 409)

  const shop = await c.env.DB.prepare('SELECT name FROM shops WHERE id=?').bind(c.get('shop')).first<{ name: string }>()
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO closure_requests (id,shop_id,shop_name,owner_email,type,reason_code,reason_text,status,requested_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, c.get('shop'), shop?.name ?? '', owner.email, b.type, b.reasonCode, text.trim() || null, 'pending', Date.now()).run()

  // Tell the owner it was received, and the admin that something is waiting. Best effort: a mail problem never blocks the request.
  const what = b.type === 'delete_account' ? 'account deletion' : 'plan cancellation'
  const tasks = [sendMail(c.env, owner.email,
    'Pocket Pasal: we received your request',
    `तपाईंको खाता बन्द गर्ने अनुरोध प्राप्त भयो। हामी ७ दिनभित्र जाँच गर्छौं। स्वीकृत भएपछि १४ दिनमा सर्भरको डाटा मेटिन्छ। त्यसअघि जुनसुकै बेला रद्द गर्न मिल्छ।\nWe received your ${what} request. We review it within 7 days. After approval, server data is erased 14 days later. You can cancel any time before that.`)]
  if (c.env.ADMIN_EMAIL) tasks.push(sendMail(c.env, c.env.ADMIN_EMAIL, 'Pocket Pasal: new closure request', `${shop?.name} (${owner.email}) asked for ${what}. Reason: ${b.reasonCode}.\n${text.slice(0, 300)}`))
  try { c.executionCtx.waitUntil(Promise.allSettled(tasks)) } catch { /* no execution context (tests): skip */ }
  return c.json({ ok: true, request: row(await c.env.DB.prepare('SELECT * FROM closure_requests WHERE id=?').bind(id).first()) })
})

account.post('/closure/cancel', async (c) => {
  const r = await c.env.DB.prepare("UPDATE closure_requests SET status='cancelled', decided_at=? WHERE shop_id=? AND status IN ('pending','approved') RETURNING id").bind(Date.now(), c.get('shop')).first()
  if (!r) return c.json({ error: 'nothing_to_cancel' }, 404)
  return c.json({ ok: true })
})
