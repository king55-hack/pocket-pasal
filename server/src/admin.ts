import { Hono } from 'hono'
import type { App } from './index'
import { safeEqual, sha256 } from './crypto'
import type { Env } from './mail'
import { sendMail } from './mail'

/** The seller's own tools (the admin page uses these). Every route needs the ADMIN_KEY, and wrong keys are counted per address. */
export const admin = new Hono<App>()

const DAY = 86_400_000
const emailOk = (e: unknown): e is string => typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'

admin.use('*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  const key = 'admin:' + ip
  const since = Date.now() - 15 * 60_000
  const fails = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_attempts WHERE key=? AND at>?').bind(key, since).first<{ n: number }>()
  if ((fails?.n ?? 0) >= 10) return c.json({ error: 'locked' }, 429)
  const given = c.req.header('x-admin-key') ?? ''
  if (!c.env.ADMIN_KEY || !given || !safeEqual(given, c.env.ADMIN_KEY)) {
    await c.env.DB.prepare('INSERT INTO admin_attempts (key,at) VALUES (?,?)').bind(key, Date.now()).run()
    return c.json({ error: 'forbidden' }, 403)
  }
  c.header('X-Robots-Tag', 'noindex')
  await next()
})

const effective = (s: { plan: string; plan_until: number; trial_ends: number }) => {
  const now = Date.now()
  return s.trial_ends > now ? 'max (trial)' : s.plan !== 'free' && s.plan_until > now ? s.plan : 'free'
}

admin.get('/stats', async (c) => {
  const one = async (sql: string, ...a: unknown[]) => (await c.env.DB.prepare(sql).bind(...a).first<{ n: number }>())?.n ?? 0
  const now = Date.now()
  return c.json({
    shops: await one('SELECT COUNT(*) AS n FROM shops'),
    newThisWeek: await one('SELECT COUNT(*) AS n FROM shops WHERE created_at>?', now - 7 * DAY),
    activePhones30d: await one('SELECT COUNT(*) AS n FROM devices WHERE revoked=0 AND last_seen>?', now - 30 * DAY),
    paid: await one("SELECT COUNT(*) AS n FROM shops WHERE plan<>'free' AND plan_until>?", now),
    onTrial: await one('SELECT COUNT(*) AS n FROM shops WHERE trial_ends>?', now),
    waitingRequests: await one("SELECT COUNT(*) AS n FROM closure_requests WHERE status='pending'"),
    scheduledDeletions: await one("SELECT COUNT(*) AS n FROM closure_requests WHERE status='approved' AND type='delete_account'"),
    tickets: await one('SELECT COUNT(*) AS n FROM tickets'),
    emailsLast24h: await one('SELECT COUNT(*) AS n FROM mail_log WHERE at>?', now - DAY),
  })
})

admin.get('/shops', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 60)
  const r = await c.env.DB.prepare(
    `SELECT s.id,s.name,s.plan,s.plan_until,s.trial_ends,s.created_at,o.email,
      (SELECT COUNT(*) FROM devices d WHERE d.shop_id=s.id AND d.revoked=0) AS devices,
      (SELECT MAX(last_seen) FROM devices d WHERE d.shop_id=s.id) AS last_seen,
      (SELECT COUNT(*) FROM records x WHERE x.shop_id=s.id) AS records
     FROM shops s JOIN owners o ON o.shop_id=s.id
     WHERE (?1='' OR s.name LIKE ?2 ESCAPE '\\' OR o.email LIKE ?2 ESCAPE '\\')
     ORDER BY s.created_at DESC LIMIT 100`).bind(q, like(q)).all<any>()
  return c.json({ shops: r.results.map((s) => ({ ...s, effectivePlan: effective(s) })) })
})

admin.post('/plan', async (c) => {
  let b: any
  try { b = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
  if (!b || !emailOk(b.email) || !['free', 'pro', 'max'].includes(b.plan)) return c.json({ error: 'invalid' }, 400)
  const o = await c.env.DB.prepare('SELECT shop_id FROM owners WHERE email=?').bind(b.email.trim().toLowerCase()).first<{ shop_id: string }>()
  if (!o) return c.json({ error: 'no_shop' }, 404)
  const days = Math.max(0, Math.min(3650, Number(b.days) || 30))
  await c.env.DB.prepare('UPDATE shops SET plan=?,plan_until=? WHERE id=?').bind(b.plan, b.plan === 'free' ? 0 : Date.now() + days * DAY, o.shop_id).run()
  // A shop that has paid should not also keep its free trial running.
  if (b.endTrial === true) await c.env.DB.prepare('UPDATE shops SET trial_ends=0 WHERE id=?').bind(o.shop_id).run()
  const s = await c.env.DB.prepare('SELECT id,name,plan,plan_until,trial_ends FROM shops WHERE id=?').bind(o.shop_id).first<any>()
  return c.json({ ok: true, shop: { id: s.id, name: s.name, plan: effective(s).replace(' (trial)', ''), paidPlan: s.plan, planUntil: s.plan_until, trialEnds: s.trial_ends } })
})

admin.get('/tickets', async (c) => {
  const r = await c.env.DB.prepare('SELECT t.id,t.category,t.message,t.meta,t.created_at,s.name AS shop FROM tickets t LEFT JOIN shops s ON s.id=t.shop_id ORDER BY t.id DESC LIMIT 100').all()
  return c.json({ tickets: r.results })
})

admin.get('/closures', async (c) => {
  const st = c.req.query('status') ?? ''
  const r = await c.env.DB.prepare(`SELECT * FROM closure_requests ${['pending', 'approved', 'rejected', 'cancelled', 'done'].includes(st) ? 'WHERE status=?' : "WHERE ?<>'x'"} ORDER BY requested_at DESC LIMIT 100`).bind(st || 'all').all()
  return c.json({ requests: r.results })
})

const notifyOwner = async (env: Env, to: string, subject: string, text: string) => { await sendMail(env, to, subject, text).catch(() => false) }

admin.post('/closures/:id/approve', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const r = await c.env.DB.prepare("SELECT * FROM closure_requests WHERE id=? AND status='pending'").bind(c.req.param('id')).first<any>()
  if (!r) return c.json({ error: 'not_pending' }, 404)
  const now = Date.now()
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null
  if (r.type === 'cancel_plan') {
    // Stopping a paid plan takes effect straight away.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE shops SET plan='free', plan_until=0, trial_ends=0 WHERE id=?").bind(r.shop_id),
      c.env.DB.prepare("UPDATE closure_requests SET status='done', decided_at=?, done_at=?, decision_note=? WHERE id=?").bind(now, now, note, r.id),
    ])
    await notifyOwner(c.env, r.owner_email, 'Pocket Pasal: your plan was cancelled', 'तपाईंको सशुल्क प्लान रद्द गरियो। तपाईं फ्री प्लानमा हुनुहुन्छ, डाटा सुरक्षित छ।\nYour paid plan was cancelled. You are on the Free plan and your data is safe.')
    return c.json({ ok: true, done: true })
  }
  // The default wait is 14 days. A smaller number is only for the admin's own tests.
  const grace = b.graceDays === undefined ? 14 : Math.max(0, Math.min(60, Number(b.graceDays)))
  if (!Number.isFinite(grace)) return c.json({ error: 'invalid' }, 400)
  const at = now + grace * DAY
  await c.env.DB.prepare("UPDATE closure_requests SET status='approved', decided_at=?, scheduled_at=?, decision_note=? WHERE id=?").bind(now, at, note, r.id).run()
  await notifyOwner(c.env, r.owner_email, 'Pocket Pasal: account deletion approved',
    `तपाईंको खाता मेटाउने अनुरोध स्वीकृत भयो। सर्भरको डाटा ${new Date(at).toISOString().slice(0, 10)} मा मेटिन्छ। त्यसअघि एपमा "खाता बन्द" बाट रद्द गर्न मिल्छ। फोनमा रहेको डाटा मेटिँदैन।\nYour deletion request was approved. Server data will be erased on ${new Date(at).toISOString().slice(0, 10)}. You can cancel before then in the app. Data on your phone is not touched.`)
  return c.json({ ok: true, scheduledAt: at })
})

admin.post('/closures/:id/reject', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const r = await c.env.DB.prepare("UPDATE closure_requests SET status='rejected', decided_at=?, decision_note=? WHERE id=? AND status='pending' RETURNING owner_email").bind(Date.now(), typeof b.note === 'string' ? b.note.slice(0, 500) : null, c.req.param('id')).first<{ owner_email: string }>()
  if (!r) return c.json({ error: 'not_pending' }, 404)
  await notifyOwner(c.env, r.owner_email, 'Pocket Pasal: request not approved', `तपाईंको अनुरोध स्वीकृत भएन।\nYour request was not approved.${b.note ? '\n' + String(b.note).slice(0, 500) : ''}`)
  return c.json({ ok: true })
})

admin.post('/run-deletions', async (c) => c.json({ ok: true, ...(await runDueDeletions(c.env)) }))

/* ---------- the erasing itself ---------- */
export async function purgeShop(env: Env, shopId: string) {
  const owners = (await env.DB.prepare('SELECT id,email FROM owners WHERE shop_id=?').bind(shopId).all<{ id: string; email: string }>()).results
  const tag = async (e: string) => 'deleted:' + (await sha256(e)).slice(0, 16)
  const stmts = [
    ...owners.flatMap((o) => [
      env.DB.prepare('DELETE FROM refresh_tokens WHERE owner_id=?').bind(o.id),
      env.DB.prepare('DELETE FROM otps WHERE email=?').bind(o.email),
      env.DB.prepare('DELETE FROM login_attempts WHERE email=? OR email=?').bind(o.email, 'closure:' + o.email),
    ]),
    ...['records', 'conflicts', 'tickets', 'pay_config', 'payments', 'mail_log', 'devices'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE shop_id=?`).bind(shopId)),
    env.DB.prepare('DELETE FROM owners WHERE shop_id=?').bind(shopId),
    env.DB.prepare('DELETE FROM shops WHERE id=?').bind(shopId),
  ]
  await env.DB.batch(stmts)
  // Keep the request itself (reason and dates, for learning why people leave) but not who they were.
  const anon = owners[0] ? await tag(owners[0].email) : 'deleted'
  await env.DB.batch([
    env.DB.prepare("UPDATE closure_requests SET status='done', done_at=?, owner_email=?, shop_name='(deleted)' WHERE shop_id=? AND type='delete_account' AND status='approved'").bind(Date.now(), anon, shopId),
    env.DB.prepare("UPDATE closure_requests SET status='cancelled', owner_email=?, shop_name='(deleted)' WHERE shop_id=? AND status IN ('pending','approved')").bind(anon, shopId),
    env.DB.prepare("UPDATE closure_requests SET owner_email=?, shop_name='(deleted)' WHERE shop_id=?").bind(anon, shopId),
  ])
}

/** Erases every shop whose approved request has reached its date. Runs daily and from the admin page. */
export async function runDueDeletions(env: Env): Promise<{ deleted: number }> {
  const due = (await env.DB.prepare("SELECT DISTINCT shop_id FROM closure_requests WHERE type='delete_account' AND status='approved' AND scheduled_at<=?").bind(Date.now()).all<{ shop_id: string }>()).results
  for (const d of due) await purgeShop(env, d.shop_id)
  return { deleted: due.length }
}
