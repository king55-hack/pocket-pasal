// Needs the dev server running with ENABLE_MOCK_PAY=1 (see .dev.vars).  node test/pay.test.mjs
import { createHmac } from 'node:crypto'
const B = process.env.API || 'http://127.0.0.1:8787'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const raw = (path, { method = 'GET', body, token } = {}) =>
  fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
const call = async (path, o) => { const r = await raw(path, o); return { s: r.status, j: await r.json().catch(() => ({})) } }

async function newShop(tag) {
  const stamp = Date.now() + tag
  const email = `p${stamp}@example.com`
  const code = (await call('/auth/otp', { method: 'POST', body: { email, purpose: 'signup' } })).j.devCode
  const r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'T', shopName: 'Pay Shop ' + tag, device: { id: 'dev-' + stamp + '-xx', name: 'p' } } })
  return r.j.access
}
const A = await newShop('A')
const Z = await newShop('Z')

let r = await call('/pay/config'); ok(r.s === 401, 'payment settings need a login')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'khalti', amount: 100 } }); ok(r.s === 409 && r.j.error === 'not_configured', 'cannot start a Khalti payment before keys are saved')
r = await call('/pay/config', { method: 'POST', token: A, body: { provider: 'khalti', mode: 'sandbox', fields: { secret: 'x' } } }); ok(r.s === 400, 'too-short Khalti key rejected')
r = await call('/pay/config', { method: 'POST', token: A, body: { provider: 'fonepay', fields: {} } }); ok(r.s === 400, 'Fonepay is not accepted (not built)')

// eSewa: the public sandbox merchant code and key published by eSewa
const SECRET = '8gBm/:&EnhH.1/q'
r = await call('/pay/config', { method: 'POST', token: A, body: { provider: 'esewa', mode: 'sandbox', fields: { code: 'EPAYTEST', secret: SECRET } } }); ok(r.s === 200, 'eSewa keys saved')
r = await call('/pay/config', { token: A })
ok(r.j.providers.esewa.set && r.j.providers.esewa.code === 'EPAYTEST' && !JSON.stringify(r.j).includes(SECRET), 'settings show eSewa is set but never return the secret')
ok(r.j.providers.fonepay.supported === false, 'Fonepay is reported as not supported')

// mock provider end to end
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'mock', amount: 250.5, ref: 'T1' } })
ok(r.s === 200 && r.j.qrText.includes('/pay/go/mock/'), 'mock payment created with a link for the QR')
const mock = r.j
r = await call('/pay/status/' + mock.id, { token: A }); ok(r.j.status === 'pending' && r.j.amount === 250.5, 'starts pending with the right amount')
r = await call('/pay/status/' + mock.id, { token: Z }); ok(r.s === 404, 'another shop cannot see this payment')
let page = await raw(new URL(mock.qrText).pathname); let html = await page.text()
ok(page.status === 200 && html.includes('Pay (test)') && page.headers.get('x-frame-options') === 'DENY', 'customer page opens, cannot be framed')
await fetch(B + '/pay/mock/' + mock.id + '/pay', { method: 'POST' })
r = await call('/pay/status/' + mock.id, { token: A }); ok(r.j.status === 'paid' && r.j.paidAt, 'paid after the customer pays')
page = await raw(new URL(mock.qrText).pathname); html = await page.text(); ok(html.includes('has ended'), 'a paid link cannot be used twice')

// eSewa signed form
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'esewa', amount: 300, ref: 'T2' } })
ok(r.s === 200 && r.j.qrText.includes('/pay/go/esewa/'), 'eSewa payment created')
const es = r.j
html = await (await raw(new URL(es.qrText).pathname)).text()
const field = (n) => html.match(new RegExp(`name="${n}" value="([^"]*)"`))?.[1]
const expected = createHmac('sha256', SECRET).update(`total_amount=300,transaction_uuid=${es.id},product_code=EPAYTEST`).digest('base64')
ok(field('signature') === expected, 'eSewa form carries the correct HMAC-SHA256 signature')
ok(field('total_amount') === '300' && field('product_code') === 'EPAYTEST' && field('transaction_uuid') === es.id, 'eSewa form fields are right')
ok(html.includes('https://rc-epay.esewa.com.np/api/epay/main/v2/form'), 'sandbox form posts to the eSewa test address')
ok(!html.includes(SECRET), 'secret key never appears in the page')

// forged return from the customer's browser must not mark it paid
const forge = (sig) => Buffer.from(JSON.stringify({ transaction_code: 'X', status: 'COMPLETE', total_amount: '300.0', transaction_uuid: es.id, product_code: 'EPAYTEST', signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names', signature: sig })).toString('base64')
html = await (await raw(`/pay/return/esewa/${es.id}?data=${encodeURIComponent(forge('AAAA'))}`)).text()
ok(html.includes('Could not confirm'), 'forged return data is refused')
r = await call('/pay/status/' + es.id, { token: A }); ok(r.j.status === 'pending', 'forged return does not mark it paid')
const goodSig = createHmac('sha256', SECRET).update(`transaction_code=X,status=COMPLETE,total_amount=300.0,transaction_uuid=${es.id},product_code=EPAYTEST,signed_field_names=transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names`).digest('base64')
html = await (await raw(`/pay/return/esewa/${es.id}?data=${encodeURIComponent(forge(goodSig))}`)).text()
r = await call('/pay/status/' + es.id, { token: A }); ok(r.j.status === 'pending', 'even a correctly signed return stays pending until eSewa itself confirms')

// Khalti
r = await call('/pay/config', { method: 'POST', token: A, body: { provider: 'khalti', mode: 'sandbox', fields: { secret: 'fake-key-for-testing-only-0000' } } }); ok(r.s === 200, 'Khalti key saved')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'khalti', amount: 5 } }); ok(r.s === 400 && r.j.error === 'min_amount', 'Khalti minimum of Rs 10 is enforced')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'khalti', amount: 100 } }); ok(r.s === 502 && r.j.error === 'provider', 'a wrong Khalti key is reported as a provider error')

// removal and limits
r = await call('/pay/config', { method: 'POST', token: A, body: { provider: 'esewa', remove: true } }); ok(r.s === 200, 'keys can be removed')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'esewa', amount: 100 } }); ok(r.s === 409, 'no payments after keys are removed')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'mock', amount: -5 } }); ok(r.s === 400, 'negative amount rejected')
r = await call('/pay/create', { method: 'POST', token: A, body: { provider: 'mock', amount: 5_000_000 } }); ok(r.s === 400, 'huge amount rejected')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
