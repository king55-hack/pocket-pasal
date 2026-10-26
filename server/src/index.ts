import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context } from 'hono'
import { hashPassword, randomHex, safeEqual, sha256, signJwt, verifyJwt } from './crypto'
import { otpMail, sendMail, type Env } from './mail'
import { sync } from './sync'
import { pay } from './pay'

export type App = { Bindings: Env; Variables: { owner: string; shop: string; dev: string } }
const app = new Hono<App>()

const DAY = 86400000
const emailOk = (e: unknown): e is string => typeof e === 'string' && e.length < 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const norm = (e: string) => e.trim().toLowerCase()
const uid = () => crypto.randomUUID()

app.use('*', async (c, next) => {
  const origins = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return cors({ origin: (o) => (origins.includes(o) ? o : ''), allowHeaders: ['Authorization', 'Content-Type', 'x-admin-key'], allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 600 })(c, next)
})

/* Safety checks and headers on every response. */
app.use('*', async (c, next) => {
  // A weak or missing secret would make every login token forgeable, so refuse to serve rather than run unsafely.
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) return c.json({ error: 'misconfigured' }, 500)
  const len = Number(c.req.header('content-length') ?? 0)
  if (len > 8 * 1024 * 1024) return c.json({ error: 'too_big' }, 413)
  await next()
  const h = c.res.headers
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('Referrer-Policy', 'no-referrer')
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  h.set('Cross-Origin-Resource-Policy', 'same-site')
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store')
  if ((h.get('content-type') ?? '').includes('text/html')) {
    // The customer payment pages: nothing may frame them, load other scripts, or send the form anywhere except eSewa.
    h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' https://rc-epay.esewa.com.np https://epay.esewa.com.np; base-uri 'none'; frame-ancestors 'none'")
  }
})

export async function body<T = any>(c: Context<App>): Promise<T | null> {
  try { return (await c.req.json()) as T } catch { return null }
}
export const bad = (c: Context<App>, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, error: string) => c.json({ error }, status)

/* ---------- plan ---------- */
function effectivePlan(s: { plan: string; plan_until: number; trial_ends: number }) {
  const now = Date.now()
  if (s.trial_ends > now) return 'max'
  if (s.plan !== 'free' && s.plan_until > now) return s.plan
  return 'free'
}
async function shopInfo(env: Env, shopId: string) {
  const s = await env.DB.prepare('SELECT id,name,plan,plan_until,trial_ends FROM shops WHERE id=?').bind(shopId).first<any>()
  return s && { id: s.id, name: s.name, plan: effectivePlan(s), paidPlan: s.plan, planUntil: s.plan_until, trialEnds: s.trial_ends }
}

/* ---------- OTP by email (no SMS cost) ---------- */
async function issueOtp(env: Env, email: string, purpose: 'signup' | 'login') {
  const now = Date.now()
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM otps WHERE email=? AND created_at>?').bind(email, now - 3600_000).first<{ n: number }>()
  if ((r?.n ?? 0) >= 5) return { error: 'rate' as const }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  await env.DB.prepare('INSERT INTO otps (email,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?)')
    .bind(email, purpose, await sha256(`${code}:${email}:${env.JWT_SECRET}`), now + 10 * 60_000, now).run()
  const m = otpMail(code)
  const sent = await sendMail(env, email, m.subject, m.text)
  if (!sent && env.DEV_RETURN_OTP !== '1') {
    // No way to deliver the code: say so now instead of leaving the person waiting for an email that will never come.
    await env.DB.prepare('DELETE FROM otps WHERE email=? AND created_at=?').bind(email, now).run()
    return { error: 'mail' as const }
  }
  return { ok: true as const, devCode: env.DEV_RETURN_OTP === '1' ? code : undefined }
}
async function checkOtp(env: Env, email: string, purpose: string, code: unknown) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false
  const row = await env.DB.prepare('SELECT id,code_hash,attempts FROM otps WHERE email=? AND purpose=? AND used=0 AND expires>? ORDER BY id DESC LIMIT 1')
    .bind(email, purpose, Date.now()).first<{ id: number; code_hash: string; attempts: number }>()
  if (!row || row.attempts >= 5) return false
  await env.DB.prepare('UPDATE otps SET attempts=attempts+1 WHERE id=?').bind(row.id).run()
  if (!safeEqual(row.code_hash, await sha256(`${code}:${email}:${env.JWT_SECRET}`))) return false
  await env.DB.prepare('UPDATE otps SET used=1 WHERE id=?').bind(row.id).run()
  return true
}

/* ---------- tokens ---------- */
async function tokens(env: Env, ownerId: string, shopId: string, deviceId: string) {
  const access = await signJwt({ sub: ownerId, shop: shopId, dev: deviceId }, env.JWT_SECRET, 15 * 60)
  const rid = randomHex(8), secret = randomHex(32)
  await env.DB.prepare('INSERT INTO refresh_tokens (id,owner_id,device_id,hash,expires) VALUES (?,?,?,?,?)')
    .bind(rid, ownerId, deviceId, await sha256(secret), Date.now() + 60 * DAY).run()
  return { access, refresh: `${rid}.${secret}`, expiresIn: 15 * 60 }
}
async function upsertDevice(env: Env, id: string, shopId: string, ownerId: string, name: string) {
  const now = Date.now()
  await env.DB.prepare('INSERT INTO devices (id,shop_id,owner_id,name,created_at,last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,name=excluded.name')
    .bind(id, shopId, ownerId, name.slice(0, 60), now, now).run()
}
const deviceOk = (d: any): d is { id: string; name: string } => d && typeof d.id === 'string' && d.id.length >= 8 && d.id.length <= 64 && typeof d.name === 'string'

/* ---------- routes ---------- */
app.get('/health', (c) => c.json({ ok: true, time: Date.now() }))

app.post('/auth/otp', async (c) => {
  const b = await body(c)
  if (!b || !emailOk(b.email) || !['signup', 'login'].includes(b.purpose)) return bad(c, 400, 'invalid')
  const email = norm(b.email)
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM owners WHERE email=?').bind(email).first()
  if (b.purpose === 'signup' && exists) return bad(c, 409, 'exists')
  // For login do not reveal whether the email has an account.
  if (b.purpose === 'login' && !exists) return c.json({ ok: true })
  const r = await issueOtp(c.env, email, b.purpose)
  if ('error' in r) return r.error === 'mail' ? bad(c, 503, 'mail') : bad(c, 429, 'rate')
  return c.json({ ok: true, devCode: r.devCode })
})

app.post('/auth/signup', async (c) => {
  const b = await body(c)
  if (!b || !emailOk(b.email) || typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200 || !deviceOk(b.device) || typeof b.shopName !== 'string' || !b.shopName.trim()) return bad(c, 400, 'invalid')
  const email = norm(b.email)
  if (await c.env.DB.prepare('SELECT 1 AS x FROM owners WHERE email=?').bind(email).first()) return bad(c, 409, 'exists')
  if (!(await checkOtp(c.env, email, 'signup', b.code))) return bad(c, 401, 'bad_code')
  const now = Date.now(), shopId = uid(), ownerId = uid(), salt = randomHex(12)
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO shops (id,name,plan,trial_ends,created_at) VALUES (?,?,?,?,?)').bind(shopId, String(b.shopName).slice(0, 100), 'free', now + 14 * DAY, now),
    c.env.DB.prepare('INSERT INTO owners (id,shop_id,email,name,salt,hash,created_at) VALUES (?,?,?,?,?,?,?)').bind(ownerId, shopId, email, String(b.name || '').slice(0, 80), salt, await hashPassword(b.password, salt), now),
  ])
  await upsertDevice(c.env, b.device.id, shopId, ownerId, b.device.name)
  return c.json({ ...(await tokens(c.env, ownerId, shopId, b.device.id)), shop: await shopInfo(c.env, shopId), email })
})

app.post('/auth/login', async (c) => {
  const b = await body(c)
  if (!b || !emailOk(b.email) || typeof b.password !== 'string' || b.password.length > 200 || !deviceOk(b.device)) return bad(c, 400, 'invalid')
  const email = norm(b.email)
  const since = Date.now() - 15 * 60_000
  const fails = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email=? AND at>?').bind(email, since).first<{ n: number }>()
  if ((fails?.n ?? 0) >= 8) return bad(c, 429, 'locked')
  const o = await c.env.DB.prepare('SELECT * FROM owners WHERE email=?').bind(email).first<any>()
  const good = o ? safeEqual(await hashPassword(b.password, o.salt), o.hash) : (await hashPassword(b.password, 'x'.repeat(24)), false)
  if (!o || !good) {
    await c.env.DB.prepare('INSERT INTO login_attempts (email,at) VALUES (?,?)').bind(email, Date.now()).run()
    return bad(c, 401, 'bad_login')
  }
  const dev = await c.env.DB.prepare('SELECT revoked FROM devices WHERE id=? AND owner_id=?').bind(b.device.id, o.id).first<{ revoked: number }>()
  if (dev?.revoked) return bad(c, 403, 'device_revoked')
  if (!dev) {
    // A phone we have not seen before must prove it has the email inbox.
    if (!b.code) {
      const r = await issueOtp(c.env, email, 'login')
      if ('error' in r && r.error === 'mail') return bad(c, 503, 'mail')
      return c.json({ error: 'otp_required', devCode: 'error' in r ? undefined : r.devCode }, 401)
    }
    if (!(await checkOtp(c.env, email, 'login', b.code))) return bad(c, 401, 'bad_code')
  }
  await upsertDevice(c.env, b.device.id, o.shop_id, o.id, b.device.name)
  return c.json({ ...(await tokens(c.env, o.id, o.shop_id, b.device.id)), shop: await shopInfo(c.env, o.shop_id), email })
})

app.post('/auth/refresh', async (c) => {
  const b = await body(c)
  const [rid, secret] = String(b?.refresh ?? '').split('.')
  if (!rid || !secret) return bad(c, 400, 'invalid')
  const r = await c.env.DB.prepare('SELECT * FROM refresh_tokens WHERE id=?').bind(rid).first<any>()
  if (!r || r.revoked || r.expires < Date.now() || !safeEqual(r.hash, await sha256(secret))) return bad(c, 401, 'bad_refresh')
  const dev = await c.env.DB.prepare('SELECT d.revoked,d.shop_id FROM devices d WHERE d.id=?').bind(r.device_id).first<any>()
  if (!dev || dev.revoked) return bad(c, 403, 'device_revoked')
  await c.env.DB.prepare('UPDATE refresh_tokens SET revoked=1 WHERE id=?').bind(rid).run()
  return c.json(await tokens(c.env, r.owner_id, dev.shop_id, r.device_id))
})

/* ---------- everything below needs a valid access token from a device that is not revoked ---------- */
app.use('/me', auth)
app.use('/devices/*', auth)
app.use('/devices', auth)
app.use('/support', auth)
app.use('/sync/*', auth)
app.use('/auth/logout', auth)
// Only the owner-facing payment calls need a token. The customer pages (/pay/go, /pay/return, /pay/mock) are public.
app.use('/pay/config', auth)
app.use('/pay/create', auth)
app.use('/pay/status/*', auth)

async function auth(c: Context<App>, next: () => Promise<void>) {
  const h = c.req.header('Authorization') ?? ''
  const p = h.startsWith('Bearer ') ? await verifyJwt(h.slice(7), c.env.JWT_SECRET) : null
  if (!p) return bad(c, 401, 'unauthorized')
  const d = await c.env.DB.prepare('SELECT revoked FROM devices WHERE id=? AND shop_id=?').bind(p.dev, p.shop).first<{ revoked: number }>()
  if (!d || d.revoked) return bad(c, 403, 'device_revoked')
  c.set('owner', p.sub); c.set('shop', p.shop); c.set('dev', p.dev)
  await next()
}

app.post('/auth/logout', async (c) => {
  await c.env.DB.prepare('UPDATE refresh_tokens SET revoked=1 WHERE device_id=?').bind(c.get('dev')).run()
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  const o = await c.env.DB.prepare('SELECT email,name FROM owners WHERE id=?').bind(c.get('owner')).first<any>()
  return c.json({ owner: o, shop: await shopInfo(c.env, c.get('shop')), serverTime: Date.now() })
})

app.get('/devices', async (c) => {
  const r = await c.env.DB.prepare('SELECT id,name,revoked,created_at,last_seen FROM devices WHERE shop_id=? ORDER BY last_seen DESC').bind(c.get('shop')).all()
  return c.json({ devices: r.results, current: c.get('dev') })
})
app.post('/devices/:id/revoke', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE devices SET revoked=1 WHERE id=? AND shop_id=?').bind(id, c.get('shop')),
    c.env.DB.prepare('UPDATE refresh_tokens SET revoked=1 WHERE device_id=?').bind(id),
  ])
  return c.json({ ok: true })
})

app.post('/support', async (c) => {
  const b = await body(c)
  if (!b || typeof b.message !== 'string' || !b.message.trim()) return bad(c, 400, 'invalid')
  const r = await c.env.DB.prepare('INSERT INTO tickets (shop_id,category,message,meta,created_at) VALUES (?,?,?,?,?)')
    .bind(c.get('shop'), String(b.category ?? 'other').slice(0, 20), b.message.slice(0, 4000), JSON.stringify(b.meta ?? {}).slice(0, 2000), Date.now()).run()
  return c.json({ ok: true, ticket: r.meta.last_row_id })
})

app.route('/sync', sync)
app.route('/pay', pay)

/* ---------- seller tools: set a shop's plan after you receive their payment ---------- */
app.post('/admin/plan', async (c) => {
  const key = c.req.header('x-admin-key') ?? ''
  if (!c.env.ADMIN_KEY || !safeEqual(key, c.env.ADMIN_KEY)) return bad(c, 403, 'forbidden')
  const b = await body(c)
  if (!b || !emailOk(b.email) || !['free', 'pro', 'max'].includes(b.plan)) return bad(c, 400, 'invalid')
  const o = await c.env.DB.prepare('SELECT shop_id FROM owners WHERE email=?').bind(norm(b.email)).first<{ shop_id: string }>()
  if (!o) return bad(c, 404, 'no_shop')
  const days = Math.max(0, Math.min(3650, Number(b.days) || 30))
  await c.env.DB.prepare('UPDATE shops SET plan=?,plan_until=? WHERE id=?').bind(b.plan, b.plan === 'free' ? 0 : Date.now() + days * DAY, o.shop_id).run()
  return c.json({ ok: true, shop: await shopInfo(c.env, o.shop_id) })
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((e, c) => { console.log('error', e); return c.json({ error: 'server' }, 500) })

export default app
