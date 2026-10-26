import { Hono } from 'hono'
import type { App } from './index'
import { safeEqual } from './crypto'
import { decryptJson, encryptJson } from './secrets'
import type { Env } from './mail'

/**
 * QR payments. Money goes straight to the shop's own merchant account; this server only starts the payment and checks the result.
 *
 *  khalti  Khalti ePayment: initiate -> payment_url, then lookup. Official docs: docs.khalti.com/khalti-epayment
 *  esewa   eSewa ePay v2: signed form (HMAC-SHA256) and the transaction status API.
 *  fonepay Not built: Fonepay's dynamic QR API is only given to merchants by their bank, so it cannot be written from public docs.
 *  mock    A fake provider so the whole flow can be tried without merchant accounts. Off unless ENABLE_MOCK_PAY=1.
 *
 * Khalti and eSewa show a payment page rather than a QR picture. The QR on the shopkeeper's screen encodes the link to that page;
 * the customer scans it with the phone camera, pays, and the result is checked here with the provider, never taken from the phone.
 */
export const pay = new Hono<App>()

type Provider = 'khalti' | 'esewa' | 'mock'
type Mode = 'sandbox' | 'live'
const KHALTI = { sandbox: 'https://dev.khalti.com/api/v2', live: 'https://khalti.com/api/v2' }
const ESEWA_FORM = { sandbox: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form', live: 'https://epay.esewa.com.np/api/epay/main/v2/form' }
const ESEWA_STATUS = { sandbox: 'https://rc.esewa.com.np/api/epay/transaction/status/', live: 'https://epay.esewa.com.np/api/epay/transaction/status/' }
const EXPIRY_MS = 30 * 60_000

interface Row { id: string; shop_id: string; provider: Provider; mode: Mode; amount_paisa: number; ref: string; status: string; provider_ref: string | null; pay_url: string | null; expires_at: number; paid_at: number | null }

const rupees = (paisa: number) => String(paisa / 100)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function hmacB64(secret: string, message: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)))))
}
/** eSewa signs "field=value" pairs joined by commas, in the order named in signed_field_names. */
export const esewaMessage = (names: string, values: Record<string, string>) => names.split(',').map((n) => `${n}=${values[n]}`).join(',')

async function loadConfig<T>(env: Env, shop: string, provider: string) {
  const r = await env.DB.prepare('SELECT mode,enc FROM pay_config WHERE shop_id=? AND provider=?').bind(shop, provider).first<{ mode: Mode; enc: string }>()
  return r ? { mode: r.mode, keys: await decryptJson<T>(env.SECRETS_KEY, r.enc) } : null
}
const getPayment = (env: Env, id: string) => env.DB.prepare('SELECT * FROM payments WHERE id=?').bind(id).first<Row>()
async function setStatus(env: Env, id: string, status: string, providerRef?: string | null) {
  await env.DB.prepare('UPDATE payments SET status=?, provider_ref=COALESCE(?,provider_ref), paid_at=CASE WHEN ?=\'paid\' THEN ? ELSE paid_at END WHERE id=? AND status<>\'paid\'')
    .bind(status, providerRef ?? null, status, Date.now(), id).run()
}

/* ---------- ask the provider whether the money arrived ---------- */
async function verify(env: Env, p: Row): Promise<'paid' | 'pending' | 'failed'> {
  if (p.status === 'paid') return 'paid'
  if (p.provider === 'khalti') {
    const cfg = await loadConfig<{ secret: string }>(env, p.shop_id, 'khalti')
    if (!cfg || !p.provider_ref) return 'pending'
    const r = await fetch(KHALTI[cfg.mode] + '/epayment/lookup/', { method: 'POST', headers: { Authorization: 'Key ' + cfg.keys.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ pidx: p.provider_ref }) })
    const j: any = await r.json().catch(() => ({}))
    if (j.status === 'Completed') {
      if (Number(j.total_amount) !== p.amount_paisa) { await setStatus(env, p.id, 'failed'); return 'failed' }
      await setStatus(env, p.id, 'paid', j.transaction_id ?? null)
      return 'paid'
    }
    if (j.status === 'Expired' || j.status === 'User canceled') { await setStatus(env, p.id, 'failed'); return 'failed' }
    return 'pending'
  }
  if (p.provider === 'esewa') {
    const cfg = await loadConfig<{ code: string; secret: string }>(env, p.shop_id, 'esewa')
    if (!cfg) return 'pending'
    const q = new URLSearchParams({ product_code: cfg.keys.code, total_amount: rupees(p.amount_paisa), transaction_uuid: p.id })
    const r = await fetch(ESEWA_STATUS[cfg.mode] + '?' + q)
    const j: any = await r.json().catch(() => ({}))
    if (j.status === 'COMPLETE') {
      if (Math.round(Number(j.total_amount) * 100) !== p.amount_paisa) { await setStatus(env, p.id, 'failed'); return 'failed' }
      await setStatus(env, p.id, 'paid', j.ref_id ?? null)
      return 'paid'
    }
    if (j.status === 'CANCELED' || j.status === 'FULL_REFUND') { await setStatus(env, p.id, 'failed'); return 'failed' }
    return 'pending' // PENDING, AMBIGUOUS, NOT_FOUND (customer has not reached eSewa yet)
  }
  return 'pending' // mock is marked paid only by its own page
}

/* ---------- owner settings (needs the owner's token; set up in index.ts) ---------- */
pay.get('/config', async (c) => {
  const rows = await c.env.DB.prepare('SELECT provider,mode,enc FROM pay_config WHERE shop_id=?').bind(c.get('shop')).all<{ provider: string; mode: Mode; enc: string }>()
  const out: Record<string, any> = {
    khalti: { set: false }, esewa: { set: false },
    fonepay: { set: false, supported: false, note: 'Needs a Fonepay merchant agreement with your bank.' },
    mock: { set: c.env.ENABLE_MOCK_PAY === '1' },
  }
  for (const r of rows.results) {
    if (r.provider === 'esewa') out.esewa = { set: true, mode: r.mode, code: (await decryptJson<{ code: string }>(c.env.SECRETS_KEY, r.enc)).code }
    else if (r.provider === 'khalti') out.khalti = { set: true, mode: r.mode }
  }
  return c.json({ providers: out })
})

pay.post('/config', async (c) => {
  let b: any
  try { b = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
  const provider = b?.provider as string
  if (!['khalti', 'esewa'].includes(provider)) return c.json({ error: 'invalid' }, 400)
  if (b.remove) {
    await c.env.DB.prepare('DELETE FROM pay_config WHERE shop_id=? AND provider=?').bind(c.get('shop'), provider).run()
    return c.json({ ok: true })
  }
  const mode: Mode = b.mode === 'live' ? 'live' : 'sandbox'
  const f = b.fields ?? {}
  let keys: Record<string, string>
  if (provider === 'khalti') {
    if (typeof f.secret !== 'string' || f.secret.trim().length < 10 || f.secret.length > 200) return c.json({ error: 'invalid' }, 400)
    keys = { secret: f.secret.trim() }
  } else {
    if (typeof f.code !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(f.code.trim()) || typeof f.secret !== 'string' || f.secret.length < 5 || f.secret.length > 200) return c.json({ error: 'invalid' }, 400)
    keys = { code: f.code.trim(), secret: f.secret }
  }
  await c.env.DB.prepare('INSERT INTO pay_config (shop_id,provider,mode,enc,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(shop_id,provider) DO UPDATE SET mode=excluded.mode,enc=excluded.enc,updated_at=excluded.updated_at')
    .bind(c.get('shop'), provider, mode, await encryptJson(c.env.SECRETS_KEY, keys), Date.now()).run()
  return c.json({ ok: true })
})

/* ---------- start a payment ---------- */
pay.post('/create', async (c) => {
  let b: any
  try { b = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
  const provider = b?.provider as Provider
  const amount = Number(b?.amount)
  if (c.env.SECRETS_KEY === undefined || c.env.SECRETS_KEY.length < 32) return c.json({ error: 'misconfigured' }, 500)
  if (!['khalti', 'esewa', 'mock'].includes(provider) || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return c.json({ error: 'invalid' }, 400)
  if (provider === 'mock' && c.env.ENABLE_MOCK_PAY !== '1') return c.json({ error: 'not_available' }, 404)
  const paisa = Math.round(amount * 100)
  const shop = c.get('shop')
  const shopName = (await c.env.DB.prepare('SELECT name FROM shops WHERE id=?').bind(shop).first<{ name: string }>())?.name ?? 'Shop'
  const cfg = provider === 'mock' ? { mode: 'sandbox' as Mode, keys: {} as any } : await loadConfig<any>(c.env, shop, provider)
  if (!cfg) return c.json({ error: 'not_configured' }, 409)

  const id = crypto.randomUUID()
  const now = Date.now()
  const ref = String(b.ref ?? '').slice(0, 60) || 'POS'
  let payUrl = `${c.env.PUBLIC_URL}/pay/go/${provider}/${id}`
  let providerRef: string | null = null
  let expires = now + EXPIRY_MS

  if (provider === 'khalti') {
    if (paisa < 1000) return c.json({ error: 'min_amount', min: 10 }, 400) // Khalti rejects anything under Rs 10
    const r = await fetch(KHALTI[cfg.mode as Mode] + '/epayment/initiate/', {
      method: 'POST', headers: { Authorization: 'Key ' + cfg.keys.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ return_url: `${c.env.PUBLIC_URL}/pay/return/khalti/${id}`, website_url: c.env.PUBLIC_URL, amount: paisa, purchase_order_id: id, purchase_order_name: `${shopName} ${ref}`.slice(0, 100) }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok || !j.pidx || !j.payment_url) return c.json({ error: 'provider', status: r.status, detail: j.detail ?? j.error_key ?? null }, 502)
    payUrl = j.payment_url
    providerRef = j.pidx
    if (j.expires_in) expires = now + Number(j.expires_in) * 1000
  }
  await c.env.DB.prepare('INSERT INTO payments (id,shop_id,provider,mode,amount_paisa,ref,pay_url,provider_ref,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, shop, provider, cfg.mode, paisa, ref, payUrl, providerRef, expires, now).run()
  return c.json({ id, qrText: payUrl, expiresAt: expires, provider, mode: cfg.mode })
})

/** The phone asks this every few seconds while the customer pays. */
pay.get('/status/:id', async (c) => {
  const p = await getPayment(c.env, c.req.param('id'))
  if (!p || p.shop_id !== c.get('shop')) return c.json({ error: 'not_found' }, 404)
  let status = p.status
  if (status === 'pending') {
    status = await verify(c.env, p).catch(() => 'pending')
    if (status === 'pending' && Date.now() > p.expires_at) { await setStatus(c.env, p.id, 'expired'); status = 'expired' }
  }
  const fresh = status === p.status ? p : await getPayment(c.env, p.id)
  return c.json({ id: p.id, status, providerRef: fresh?.provider_ref ?? null, paidAt: fresh?.paid_at ?? null, amount: p.amount_paisa / 100 })
})

/* ---------- public pages the customer's phone opens (the id in the link is a random UUID) ---------- */
const page = (title: string, body: string) => new Response(
  `<!doctype html><html lang="ne"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,"Noto Sans Devanagari",sans-serif;margin:0;padding:24px;background:#f4f6fb;color:#17202e;text-align:center}main{max-width:420px;margin:40px auto}
h1{font-size:22px}p{line-height:1.5}button{font:inherit;font-weight:700;border:0;border-radius:12px;background:#1e56b0;color:#fff;padding:14px 24px;width:100%}.big{font-size:34px;font-weight:700}</style></head><body><main>${body}</main></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } })

const usable = (p: Row | null) => !!p && p.status === 'pending' && Date.now() <= p.expires_at

pay.get('/go/esewa/:id', async (c) => {
  const p = await getPayment(c.env, c.req.param('id'))
  if (!usable(p) || p!.provider !== 'esewa') return page('Pocket Pasal', '<h1>यो भुक्तानी लिङ्क सकियो / This payment link has ended</h1><p>दोकानदारलाई नयाँ QR माग्नुस्। Ask the shop for a new QR.</p>')
  const cfg = await loadConfig<{ code: string; secret: string }>(c.env, p!.shop_id, 'esewa')
  if (!cfg) return page('Pocket Pasal', '<h1>Payment is not set up</h1>')
  const amt = rupees(p!.amount_paisa)
  const f: Record<string, string> = {
    amount: amt, tax_amount: '0', total_amount: amt, transaction_uuid: p!.id, product_code: cfg.keys.code,
    product_service_charge: '0', product_delivery_charge: '0',
    success_url: `${c.env.PUBLIC_URL}/pay/return/esewa/${p!.id}`, failure_url: `${c.env.PUBLIC_URL}/pay/return/esewa/${p!.id}?failed=1`,
    signed_field_names: 'total_amount,transaction_uuid,product_code',
  }
  f.signature = await hmacB64(cfg.keys.secret, esewaMessage(f.signed_field_names, f))
  const inputs = Object.entries(f).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
  return page('eSewa', `<h1>eSewa</h1><p class="big">Rs ${esc(amt)}</p><p>eSewa मा लगिन गर्दै… / Opening eSewa…</p>
<form id="f" method="POST" action="${ESEWA_FORM[cfg.mode]}">${inputs}<button>eSewa मा जानुस् / Continue to eSewa</button></form><script>setTimeout(function(){document.getElementById('f').submit()},400)</script>`)
})

pay.get('/return/esewa/:id', async (c) => {
  const p = await getPayment(c.env, c.req.param('id'))
  if (!p || p.provider !== 'esewa') return page('Pocket Pasal', '<h1>Not found</h1>')
  if (c.req.query('failed')) return page('Pocket Pasal', '<h1>भुक्तानी भएन / Payment was not completed</h1><p>फेरि QR स्क्यान गर्न सकिन्छ। You can scan the QR again.</p>')
  const cfg = await loadConfig<{ code: string; secret: string }>(c.env, p.shop_id, 'esewa')
  try {
    const d = JSON.parse(atob(c.req.query('data') ?? ''))
    // The data comes back through the customer's browser, so check eSewa's signature, then ask eSewa directly before trusting it.
    const sig = await hmacB64(cfg!.keys.secret, esewaMessage(String(d.signed_field_names), d))
    if (!safeEqual(sig, String(d.signature)) || d.transaction_uuid !== p.id || d.status !== 'COMPLETE') throw new Error('bad')
  } catch {
    return page('Pocket Pasal', '<h1>भुक्तानी जाँच भएन / Could not confirm</h1><p>दोकानदारलाई देखाउनुस्। Show this to the shop.</p>')
  }
  const s = await verify(c.env, p).catch(() => 'pending')
  return page('Pocket Pasal', s === 'paid'
    ? '<h1>✔ भुक्तानी सफल / Payment successful</h1><p>धन्यवाद! यो पेज बन्द गर्न सक्नुहुन्छ। Thank you, you can close this page.</p>'
    : '<h1>भुक्तानी जाँच हुँदैछ / Checking payment…</h1><p>केही बेरमा दोकानदारको फोनमा देखिन्छ। It will show on the shop phone shortly.</p>')
})

pay.get('/return/khalti/:id', async (c) => {
  const p = await getPayment(c.env, c.req.param('id'))
  if (!p || p.provider !== 'khalti') return page('Pocket Pasal', '<h1>Not found</h1>')
  const s = await verify(c.env, p).catch(() => 'pending') // lookup with Khalti, never the status in the link
  return page('Pocket Pasal', s === 'paid'
    ? '<h1>✔ भुक्तानी सफल / Payment successful</h1><p>धन्यवाद! यो पेज बन्द गर्न सक्नुहुन्छ। Thank you, you can close this page.</p>'
    : s === 'failed' ? '<h1>भुक्तानी भएन / Payment was not completed</h1>' : '<h1>भुक्तानी जाँच हुँदैछ / Checking payment…</h1>')
})

pay.get('/go/mock/:id', async (c) => {
  if (c.env.ENABLE_MOCK_PAY !== '1') return page('Pocket Pasal', '<h1>Not available</h1>')
  const p = await getPayment(c.env, c.req.param('id'))
  if (!usable(p) || p!.provider !== 'mock') return page('Pocket Pasal', '<h1>This payment link has ended</h1>')
  return page('Test payment', `<h1>TEST payment</h1><p class="big">Rs ${esc(rupees(p!.amount_paisa))}</p><p>This is a fake provider for trying the app. No money moves.</p>
<form method="POST" action="/pay/mock/${esc(p!.id)}/pay"><button>Pay (test)</button></form>`)
})
pay.post('/mock/:id/pay', async (c) => {
  if (c.env.ENABLE_MOCK_PAY !== '1') return page('Pocket Pasal', '<h1>Not available</h1>')
  const p = await getPayment(c.env, c.req.param('id'))
  if (!usable(p) || p!.provider !== 'mock') return page('Pocket Pasal', '<h1>This payment link has ended</h1>')
  await setStatus(c.env, p!.id, 'paid', 'MOCK-' + p!.id.slice(0, 8))
  return page('Test payment', '<h1>✔ Paid (test)</h1><p>You can close this page.</p>')
})
