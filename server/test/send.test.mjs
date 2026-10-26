// Sending a receipt or report by email. Needs the dev server (MAIL_DAILY_LIMIT=5 and DEV_RETURN_OTP=1 in .dev.vars).  node test/send.test.mjs
const B = process.env.API || 'http://127.0.0.1:8787'
const ADMIN = process.env.ADMIN_KEY || 'dev-admin-key'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
const stamp = Date.now()
async function newShop(tag) {
  const email = `m${tag}${stamp}@example.com`
  const code = (await call('/auth/otp', { method: 'POST', body: { email, purpose: 'signup' } })).j.devCode
  const r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'T', shopName: 'Mail Shop ' + tag, device: { id: `mail-dev-${tag}-${stamp}`, name: 'm' } } })
  return { email, ...r.j }
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')
const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('rest of a zip')]).toString('base64')
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]).toString('base64')
const good = { to: 'customer@example.com', kind: 'receipt', filename: 'A-T-2083-000001.pdf', data: pdf, billNo: 'A-T-2083-000001' }

const A = await newShop('A')
let r = await call('/send/email', { method: 'POST', body: good }); ok(r.s === 401, 'sending needs a login')
r = await call('/send/email', { method: 'POST', token: A.access, body: good }); ok(r.s === 200 && r.j.ok, 'a receipt PDF is accepted')
r = await call('/send/email', { method: 'POST', token: A.access, body: { ...good, kind: 'report', filename: 'books.xlsx', data: xlsx } }); ok(r.s === 200, 'a report spreadsheet is accepted')
r = await call('/send/email', { method: 'POST', token: A.access, body: { ...good, filename: 'bill.png', data: png } }); ok(r.s === 200, 'a bill picture is accepted')

for (const [label, patch] of [
  ['a missing address', { to: '' }],
  ['text that is not an address', { to: 'not-an-email' }],
  ['two addresses at once', { to: 'a@example.com,b@example.com' }],
  ['an address with a hidden second header', { to: 'a@example.com\r\nBcc: spy@example.com' }],
  ['an address with angle brackets', { to: 'Boss <a@example.com>' }],
  ['a file name that climbs folders', { filename: '../evil.pdf' }],
  ['a program file name', { filename: 'setup.exe', data: pdf }],
  ['a web page file name', { filename: 'page.html', data: pdf }],
  ['a PDF name on a zip file', { filename: 'x.pdf', data: xlsx }],
  ['a spreadsheet name on a PDF', { filename: 'x.xlsx', data: pdf }],
  ['data that is not base64', { data: 'not base64 !!' }],
  ['empty data', { data: '' }],
  ['a file over the size limit', { data: 'QUJD'.repeat(400_000) }],
]) {
  r = await call('/send/email', { method: 'POST', token: A.access, body: { ...good, ...patch } })
  ok(r.s === 400, `refused: ${label}`)
}
r = await call('/send/email', { method: 'POST', token: A.access, body: '{broken' }); ok(r.s === 400, 'broken request refused')

// the daily limit is 5 in test mode
const L = await newShop('L')
let last = 0, okCount = 0
for (let i = 0; i < 7; i++) { const x = await call('/send/email', { method: 'POST', token: L.access, body: good }); last = x.s; if (x.s === 200) okCount++ }
ok(okCount === 5 && last === 429, `a shop can send ${okCount} emails a day, then is stopped (limit 5)`)
r = await call('/send/email', { method: 'POST', token: A.access, body: good }); ok(r.s === 200, "one shop's limit does not block another shop")

// Free plan cannot email
const F = await newShop('F')
await call('/admin/plan', { method: 'POST', headers: { 'x-admin-key': ADMIN }, body: { email: F.email, plan: 'free', endTrial: true } })
r = await call('/send/email', { method: 'POST', token: F.access, body: good }); ok(r.s === 403 && r.j.error === 'plan', 'a Free shop cannot email bills (Pro feature)')
await call('/admin/plan', { method: 'POST', headers: { 'x-admin-key': ADMIN }, body: { email: F.email, plan: 'pro', days: 30, endTrial: true } })
r = await call('/send/email', { method: 'POST', token: F.access, body: good }); ok(r.s === 200, 'after upgrading to Pro the same shop can email')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
