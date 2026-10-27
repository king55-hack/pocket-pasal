import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetGmailToken, buildMime, gmailConfigured, sendMail, type Env } from '../src/mail'

const env = (o: Partial<Env> = {}) => ({ MAIL_FROM: 'Pocket Pasal <noreply@example.com>', ...o }) as Env
const GMAIL = { GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'sec', GMAIL_REFRESH_TOKEN: 'rt', GMAIL_SENDER: 'shop.sender@gmail.com' }
const unb64 = (s: string) => Buffer.from(s.replace(/\r\n/g, ''), 'base64')
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

beforeEach(() => { _resetGmailToken(); vi.restoreAllMocks() })

describe('email message', () => {
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64')
  const mime = buildMime({ from: 'shop@gmail.com', to: 'customer@example.com', subject: 'सीता पसल: Receipt A-1', text: 'तपाईंको बिल संलग्न छ। धन्यवाद!', replyTo: 'owner@example.com', attachments: [{ filename: 'A-T-2083-000001.pdf', content: pdf }] })
  const [head, ...rest] = mime.split('\r\n\r\n')

  it('has the right headers, with Nepali text safely encoded', () => {
    expect(head).toContain('To: customer@example.com')
    expect(head).toContain('Reply-To: owner@example.com')
    expect(head).toContain('MIME-Version: 1.0')
    expect(head).toMatch(/Content-Type: multipart\/mixed; boundary="pp_[0-9a-f]{32}"/)
    const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(head)![1]
    expect(Buffer.from(subject, 'base64').toString('utf8')).toBe('सीता पसल: Receipt A-1')
  })
  it('carries the body and the attachment so any mail program can read them', () => {
    const body = rest.join('\r\n\r\n')
    expect(body).toContain('Content-Type: text/plain; charset=UTF-8')
    const text = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--pp_/.exec(body)![1]
    expect(unb64(text).toString('utf8')).toBe('तपाईंको बिल संलग्न छ। धन्यवाद!')
    expect(body).toContain('Content-Type: application/pdf; name="A-T-2083-000001.pdf"')
    expect(body).toContain('Content-Disposition: attachment; filename="A-T-2083-000001.pdf"')
    const att = /filename="A-T-2083-000001.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--pp_/.exec(body)![1]
    expect(unb64(att).toString()).toBe('%PDF-1.4 test')
    expect(mime.trimEnd().endsWith('--')).toBe(true)
  })
  it('keeps every base64 line within 76 characters', () => {
    const big = buildMime({ from: 'a@b.co', to: 'c@d.co', subject: 's', text: 'x'.repeat(500), attachments: [{ filename: 'a.xlsx', content: Buffer.alloc(5000, 7).toString('base64') }] })
    expect(big.split('\r\n').every((l) => l.length <= 998)).toBe(true)
    expect(big.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).every((l) => l.length <= 76)).toBe(true)
  })
  it('cannot be tricked into adding another recipient or header', () => {
    const bad = buildMime({ from: 'a@b.co', to: 'x@y.co\r\nBcc: spy@evil.example', subject: 'Hi\r\nBcc: spy@evil.example', text: 't', replyTo: 'r@y.co\r\nBcc: spy@evil.example' })
    expect(bad.split('\r\n\r\n')[0].split('\r\n').some((l) => /^Bcc:/i.test(l))).toBe(false)
  })
  it('cleans an attachment name and never trusts its type', () => {
    const m = buildMime({ from: 'a@b.co', to: 'c@d.co', subject: 's', text: 't', attachments: [{ filename: '../../evil"\r\n.exe', content: 'QQ==' }] })
    expect(m).not.toContain('..')
    expect(m).toContain('application/octet-stream')
    expect(m.split('\r\n').filter((l) => l.startsWith('Content-Disposition')).every((l) => !/[\r\n]/.test(l))).toBe(true)
  })
})

describe('sending', () => {
  it('uses Gmail when its four settings exist: one token request, then one send of the whole message', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'AT1', expires_in: 3600 })) : new Response('{}')
    }))
    expect(gmailConfigured(env(GMAIL))).toBe(true)
    const ok = await sendMail(env(GMAIL), 'customer@example.com', 'Receipt', 'Hello', { attachments: [{ filename: 'a.pdf', content: Buffer.from('%PDF').toString('base64') }], replyTo: 'owner@example.com' })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    const form = String(calls[0].init.body)
    expect(form).toContain('grant_type=refresh_token')
    expect(form).toContain('refresh_token=rt')
    expect(calls[1].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer AT1')
    const sent = unb64url(JSON.parse(String(calls[1].init.body)).raw)
    expect(sent).toContain('To: customer@example.com')
    expect(sent).toContain('<shop.sender@gmail.com>')
    expect(sent).toContain('filename="a.pdf"')
  })
  it('reuses the access token for later emails', async () => {
    const f = vi.fn(async (url: string) => (url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 })) : new Response('{}')))
    vi.stubGlobal('fetch', f)
    await sendMail(env(GMAIL), 'a@b.co', 's', 't')
    await sendMail(env(GMAIL), 'c@d.co', 's', 't')
    expect(f.mock.calls.filter((c) => String(c[0]).includes('oauth2'))).toHaveLength(1)
  })
  it('says it failed when Google refuses the login or the send', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })))
    expect(await sendMail(env(GMAIL), 'a@b.co', 's', 't')).toBe(false)
    _resetGmailToken()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 })) : new Response('quota', { status: 429 }))))
    expect(await sendMail(env(GMAIL), 'a@b.co', 's', 't')).toBe(false)
  })
  it('never lets a network error escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await sendMail(env(GMAIL), 'a@b.co', 's', 't')).toBe(false)
  })
  it('needs all four Gmail settings, otherwise falls back to Resend, and otherwise just logs', async () => {
    const partial = { ...GMAIL, GMAIL_REFRESH_TOKEN: undefined }
    expect(gmailConfigured(env(partial))).toBe(false)
    const f = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', f)
    expect(await sendMail(env({ ...partial, RESEND_API_KEY: 're_x' }), 'a@b.co', 's', 't')).toBe(true)
    expect(String(f.mock.calls[0][0])).toBe('https://api.resend.com/emails')
    f.mockClear()
    expect(await sendMail(env(partial), 'a@b.co', 's', 't')).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})
