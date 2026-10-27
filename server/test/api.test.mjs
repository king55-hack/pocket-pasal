// Run with the dev server up:  npm run dev   then   node test/api.test.mjs
const B = process.env.API || 'http://127.0.0.1:8787'
const ADMIN = process.env.ADMIN_KEY || 'dev-admin-key'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
const stamp = Date.now()
const email = `t${stamp}@example.com`
const devA = { id: 'device-A-' + stamp, name: 'Phone A' }
const devB = { id: 'device-B-' + stamp, name: 'Phone B' }

// signup needs an OTP
let r = await call('/auth/otp', { method: 'POST', body: { email, purpose: 'signup' } })
ok(r.s === 200 && /^\d{6}$/.test(r.j.devCode), 'signup OTP issued')
const code = r.j.devCode
r = await call('/auth/signup', { method: 'POST', body: { email, code: '000000', password: 'secret123', name: 'Ram', shopName: 'Ram Pasal', device: devA } })
ok(r.s === 401, 'wrong OTP rejected')
r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'abc', name: 'Ram', shopName: 'Ram Pasal', device: devA } })
ok(r.s === 400, 'short password rejected')
r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'Ram', shopName: 'Ram Pasal', device: devA } })
ok(r.s === 200 && r.j.access && r.j.refresh && r.j.shop.plan === 'max', 'signup works, 14-day Max trial active')
const A = r.j
r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'Ram', shopName: 'X', device: devA } })
ok(r.s === 409, 'same email cannot sign up twice')

// auth guard
r = await call('/me'); ok(r.s === 401, '/me needs a token')
r = await call('/me', { token: A.access }); ok(r.s === 200 && r.j.owner.email === email, '/me returns the owner')

// login: wrong password, new device needs OTP
r = await call('/auth/login', { method: 'POST', body: { email, password: 'wrong', device: devB } }); ok(r.s === 401 && r.j.error === 'bad_login', 'wrong password rejected')
r = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123', device: devB } }); ok(r.s === 401 && r.j.error === 'otp_required' && r.j.devCode, 'new phone must give an email code')
const lc = r.j.devCode
r = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123', code: '111111', device: devB } }); ok(r.s === 401, 'wrong login code rejected')
r = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123', code: lc, device: devB } }); ok(r.s === 200 && r.j.access, 'new phone logs in with the code')
const Bt = r.j
r = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123', device: devA } }); ok(r.s === 200, 'known phone logs in without a code')

// refresh rotates
r = await call('/auth/refresh', { method: 'POST', body: { refresh: Bt.refresh } }); ok(r.s === 200 && r.j.access && r.j.refresh !== Bt.refresh, 'refresh works')
const Bt2 = r.j
r = await call('/auth/refresh', { method: 'POST', body: { refresh: Bt.refresh } }); ok(r.s === 401, 'used refresh token is dead')

// sync
const now = Date.now()
const item = (id, p) => ({ t: 'items', id, ts: p.ts ?? now, data: { id, nameNe: 'चिनी', nameEn: 'Sugar', price: p.price, barcode: p.barcode, updatedAt: p.ts ?? now } })
const move = (id, q) => ({ t: 'stockMoves', id, ts: now, data: { id, itemId: 'i1', qty: q, reason: 'sale', at: now } })
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [item('i1', { price: 100, barcode: '111' }), move('m1', -2), { t: 'invoices', id: 'inv1', ts: now, data: { id: 'inv1', no: 'A-T-2083-000001', total: 100, at: now } }] } })
ok(r.s === 200 && r.j.accepted === 3, 'push accepted')
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [move('m1', -2)] } }); ok(r.s === 200, 'same move sent again is fine')
r = await call('/sync/pull?since=0', { token: Bt2.access })
ok(r.s === 200 && r.j.changes.filter((x) => x.t === 'stockMoves').length === 1, 'phone B sees the move once only')
ok(r.j.changes.length === 3, 'phone B pulls all 3 records')
const cursor = r.j.next
r = await call('/sync/pull?since=' + cursor, { token: Bt2.access }); ok(r.j.changes.length === 0, 'nothing new after the cursor')

// edit rules: newest edit wins, older edit loses
await call('/sync/push', { method: 'POST', token: Bt2.access, body: { changes: [item('i1', { price: 120, barcode: '111', ts: now + 5000 })] } })
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [item('i1', { price: 90, barcode: '111', ts: now + 1000 })] } })
r = await call('/sync/pull?since=0', { token: A.access })
ok(r.j.changes.find((x) => x.id === 'i1').data.price === 120, 'newest edit wins, older edit is ignored')

// duplicates are flagged, both kept
await call('/sync/push', { method: 'POST', token: Bt2.access, body: { changes: [{ t: 'invoices', id: 'inv2', ts: now, data: { id: 'inv2', no: 'A-T-2083-000001', total: 50, at: now } }, item('i2', { price: 10, barcode: '111' })] } })
r = await call('/sync/conflicts', { token: A.access })
ok(r.j.conflicts.length === 2 && r.j.conflicts.some((c) => c.kind === 'duplicate_bill_no') && r.j.conflicts.some((c) => c.kind === 'duplicate_barcode'), 'duplicate bill number and barcode flagged')
const cid = r.j.conflicts[0].id
r = await call('/sync/pull?since=0', { token: A.access }); ok(r.j.changes.filter((x) => x.t === 'invoices').length === 2, 'both invoices kept')
r = await call('/sync/conflicts/' + encodeURIComponent(cid) + '/resolve', { method: 'POST', token: A.access }); ok(r.s === 200, 'owner can mark a conflict reviewed')

// bad input
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'hackers', id: 'x', data: {}, ts: 1 }] } }); ok(r.s === 400, 'unknown table rejected')
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: Array.from({ length: 101 }, (_, i) => move('z' + i, 1)) } }); ok(r.s === 400, 'batch over 100 rejected')

// another shop cannot see this shop's data
const e2 = `u${stamp}@example.com`
const c2 = (await call('/auth/otp', { method: 'POST', body: { email: e2, purpose: 'signup' } })).j.devCode
const S2 = (await call('/auth/signup', { method: 'POST', body: { email: e2, code: c2, password: 'secret123', name: 'Hari', shopName: 'Hari', device: { id: 'device-C-' + stamp, name: 'C' } } })).j
r = await call('/sync/pull?since=0', { token: S2.access }); ok(r.j.changes.length === 0, 'second shop sees nothing of the first')

// revoke
r = await call('/devices', { token: A.access }); ok(r.j.devices.length === 2, 'owner lists 2 phones')
r = await call(`/devices/${devB.id}/revoke`, { method: 'POST', token: A.access }); ok(r.s === 200, 'owner revokes phone B')
r = await call('/sync/pull?since=0', { token: Bt2.access }); ok(r.s === 403, 'revoked phone is cut off at once')
r = await call('/auth/refresh', { method: 'POST', body: { refresh: Bt2.refresh } }); ok(r.s === 401 || r.s === 403, 'revoked phone cannot refresh')

// support + admin plan
r = await call('/support', { method: 'POST', token: A.access, body: { category: 'bug', message: 'test', meta: { v: 1 } } }); ok(r.s === 200 && r.j.ticket, 'support ticket stored')
r = await call('/admin/plan', { method: 'POST', body: { email, plan: 'pro', days: 30 }, headers: { 'x-admin-key': 'nope', 'CF-Connecting-IP': '198.51.100.' + (Date.now() % 200 + 1) } }); ok(r.s === 403, 'admin route needs the key')
r = await call('/admin/plan', { method: 'POST', body: { email, plan: 'pro', days: 30 }, headers: { 'x-admin-key': ADMIN } }); ok(r.s === 200 && r.j.shop.paidPlan === 'pro', 'seller can set a paid plan')

// OTP rate limit (5 per hour)
const e3 = `r${stamp}@example.com`
let last = 0
for (let i = 0; i < 6; i++) last = (await call('/auth/otp', { method: 'POST', body: { email: e3, purpose: 'signup' } })).s
ok(last === 429, 'OTP requests are rate limited')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
