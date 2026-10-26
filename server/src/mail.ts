export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ADMIN_KEY?: string
  RESEND_API_KEY?: string
  MAIL_FROM: string
  ALLOWED_ORIGINS: string
  DEV_RETURN_OTP?: string
  /** Encrypts each shop's merchant keys. Set with wrangler secret put. */
  SECRETS_KEY: string
  /** Public address of this API, used in payment return links. */
  PUBLIC_URL: string
  /** 1 = allow the fake test provider. Never in production. */
  ENABLE_MOCK_PAY?: string
  /** How many receipts / reports one shop may email per day. */
  MAIL_DAILY_LIMIT?: string
}

/** Sends through Resend when a key is set. Without a key the message is only logged, which is what local runs use. */
export async function sendMail(env: Env, to: string, subject: string, text: string, opts: { attachments?: { filename: string; content: string }[]; replyTo?: string } = {}): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail:not sent, no RESEND_API_KEY] to=${to} subject=${subject}\n${text}`)
    return false
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(opts.attachments ? { attachments: opts.attachments } : {}), ...(opts.replyTo ? { reply_to: opts.replyTo } : {}) }),
  })
  if (!r.ok) console.log('[mail] provider error', r.status, await r.text())
  return r.ok
}

export const otpMail = (code: string) => ({
  subject: 'Pocket Pasal: तपाईंको कोड / your code',
  text: `तपाईंको प्रमाणीकरण कोड: ${code}\nYour verification code: ${code}\n\nयो कोड १० मिनेटसम्म मान्य छ। कसैलाई नदिनुस्।\nThis code is valid for 10 minutes. Do not share it.`,
})
