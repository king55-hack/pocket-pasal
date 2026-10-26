import { Hono } from 'hono'
import type { App } from './index'
import { sendMail } from './mail'

/**
 * Sends a receipt or a report to a customer's or the owner's email, with the file attached.
 * The owner's phone makes the file; this server only delivers it, so it never sees more than the one document.
 * Safe by design: Pro plan only, one recipient, only pdf / xlsx / png whose first bytes match the name,
 * a fixed sender and subject, a reply-to that points at the shop, and a daily limit per shop.
 */
export const send = new Hono<App>()

const KINDS = { pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [0x50, 0x4b] }, png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] } } as const
const MAX_B64 = 1_200_000 // about 900 KB of file
const emailOk = (e: unknown): e is string => typeof e === 'string' && e.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e)
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\r\n\t\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const DAY = 86_400_000

send.post('/email', async (c) => {
  let b: any
  try { b = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
  if (!b || !emailOk(b.to)) return c.json({ error: 'invalid_email' }, 400)
  const filename = String(b.filename ?? '')
  const ext = (filename.split('.').pop() ?? '').toLowerCase() as keyof typeof KINDS
  if (!/^[\w .()\-]{1,80}$/.test(filename) || !KINDS[ext]) return c.json({ error: 'invalid_file' }, 400)
  const data = String(b.data ?? '')
  if (data.length === 0 || data.length > MAX_B64) return c.json({ error: 'too_big' }, 400)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return c.json({ error: 'invalid_file' }, 400)
  let head: Uint8Array
  try { head = Uint8Array.from(atob(data.slice(0, 16)), (ch) => ch.charCodeAt(0)) } catch { return c.json({ error: 'invalid_file' }, 400) }
  if (!KINDS[ext].magic.every((x, i) => head[i] === x)) return c.json({ error: 'invalid_file' }, 400)

  const shop = c.get('shop')
  const s = await c.env.DB.prepare('SELECT name,plan,plan_until,trial_ends FROM shops WHERE id=?').bind(shop).first<any>()
  const now = Date.now()
  const plan = s.trial_ends > now ? 'max' : s.plan !== 'free' && s.plan_until > now ? s.plan : 'free'
  if (plan === 'free') return c.json({ error: 'plan' }, 403)

  const limit = Math.max(1, Number(c.env.MAIL_DAILY_LIMIT) || 100)
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM mail_log WHERE shop_id=? AND at>?').bind(shop, now - DAY).first<{ n: number }>()
  if ((used?.n ?? 0) >= limit) return c.json({ error: 'limit' }, 429)

  const shopName = clean(s.name, 60) || 'Pocket Pasal shop'
  const kind = b.kind === 'report' ? 'report' : 'receipt'
  const bill = clean(b.billNo, 40)
  const owner = await c.env.DB.prepare('SELECT email FROM owners WHERE id=?').bind(c.get('owner')).first<{ email: string }>()
  const subject = `${shopName}: ${kind === 'report' ? 'Report' : 'Receipt'}${bill ? ' ' + bill : ''}`
  const text = kind === 'report'
    ? `${shopName} ले पठाएको रिपोर्ट यो इमेलमा संलग्न छ।\nThe report from ${shopName} is attached.\n\n— Pocket Pasal`
    : `${shopName} बाट तपाईंको बिल यो इमेलमा संलग्न छ। धन्यवाद!\nYour receipt from ${shopName} is attached. Thank you!\n\n— Pocket Pasal`
  // Count it first so a failure cannot be retried without limit.
  await c.env.DB.prepare('INSERT INTO mail_log (shop_id,at,kind) VALUES (?,?,?)').bind(shop, now, kind).run()
  const sent = await sendMail(c.env, b.to, subject, text, { attachments: [{ filename, content: data }], replyTo: owner?.email })
  if (!sent && c.env.DEV_RETURN_OTP !== '1') return c.json({ error: 'mail' }, 503)
  return c.json({ ok: true, dev: !sent || undefined })
})
