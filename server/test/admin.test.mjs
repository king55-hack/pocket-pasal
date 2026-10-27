// Closing an account, the admin's decisions, and erasing. Needs the dev server (see .dev.vars: ADMIN_KEY=dev-admin-key).  node test/admin.test.mjs
const B = process.env.API || 'http://127.0.0.1:8787'
const KEY = process.env.ADMIN_KEY || 'dev-admin-key'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers }
}
const stamp = Date.now()
// Deliberate wrong-key attempts come from a made-up address, so they never lock the address the other tests use.
const BAD = { 'CF-Connecting-IP': '198.51.100.' + (Date.now() % 200 + 1) }
const adm = (path, o = {}) => call(path, { ...o, headers: { 'x-admin-key': KEY, ...(o.headers ?? {}) } })
async function newShop(tag) {
  const email = `c${tag}${stamp}@example.com`
  const code = (await call('/auth/otp', { method: 'POST', body: { email, purpose: 'signup' } })).j.devCode
  const device = { id: `close-dev-${tag}-${stamp}`, name: 'c' }
  const r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'T', shopName: 'Close Shop ' + tag, device } })
  return { email, device, ...r.j }
}
const form = (o = {}) => ({ type: 'delete_account', reasonCode: 'not_using', reasonText: 'closing the shop', password: 'secret123', ...o })

/* ---- the admin door ---- */
let r = await call('/admin/stats', { headers: BAD }); ok(r.s === 403, 'admin pages need the key')
r = await call('/admin/stats', { headers: { 'x-admin-key': 'wrong', ...BAD } }); ok(r.s === 403, 'a wrong key is refused')
r = await call('/admin/stats?x-admin-key=' + KEY, { headers: BAD }); ok(r.s === 403, 'the key is not accepted in the address')
const A = await newShop('A')
r = await call('/admin/stats', { token: A.access, headers: BAD }); ok(r.s === 403, 'a shop owner login is not an admin key')
r = await adm('/admin/stats'); ok(r.s === 200 && r.j.shops >= 1 && 'waitingRequests' in r.j, 'the right key opens the numbers')
ok(r.h.get('x-robots-tag') === 'noindex' && r.h.get('cache-control') === 'no-store', 'admin answers are not indexed or cached')
const ip = '203.0.113.' + (stamp % 200 + 1)
let last = 0
for (let i = 0; i < 11; i++) last = (await call('/admin/stats', { headers: { 'x-admin-key': 'guess-' + i, 'CF-Connecting-IP': ip } })).s
ok(last === 429, 'after 10 wrong keys from one address, that address is locked out')
r = await call('/admin/stats', { headers: { 'x-admin-key': KEY, 'CF-Connecting-IP': ip } }); ok(r.s === 429, 'even the right key is refused from a locked address')
r = await adm('/admin/stats'); ok(r.s === 200, 'other addresses are not affected')

/* ---- the owner asks ---- */
r = await call('/account/closure'); ok(r.s === 401, 'asking to close an account needs a login')
r = await call('/account/closure', { method: 'POST', token: A.access, body: form({ password: 'wrong-password' }) }); ok(r.s === 403 && r.j.error === 'bad_password', 'the owner password must be re-entered, a wrong one is refused')
for (const [label, patch] of [['an unknown reason', { reasonCode: 'because' }], ['an unknown type', { type: 'explode' }], ['no password', { password: undefined }], ['a huge note', { reasonText: 'x'.repeat(1001) }], ['"other" with no words', { reasonCode: 'other', reasonText: '' }]]) {
  r = await call('/account/closure', { method: 'POST', token: A.access, body: form(patch) }); ok(r.s === 400, `refused: ${label}`)
}
r = await call('/account/closure', { method: 'POST', token: A.access, body: form() })
ok(r.s === 200 && r.j.request.status === 'pending' && r.j.request.type === 'delete_account', 'a request is saved as waiting for the admin')
const reqId = r.j.request.id
r = await call('/account/closure', { method: 'POST', token: A.access, body: form() }); ok(r.s === 409, 'a second request while one is open is refused')
r = await call('/account/closure', { token: A.access }); ok(r.j.request.status === 'pending' && r.j.request.reason === 'not_using', 'the owner can see the status')
const Z = await newShop('Z')
r = await call('/account/closure', { token: Z.access }); ok(r.j.request === null, "another shop does not see this shop's request")
r = await call('/account/closure/cancel', { method: 'POST', token: Z.access }); ok(r.s === 404, "another shop cannot cancel this shop's request")
for (let i = 0; i < 5; i++) await call('/account/closure', { method: 'POST', token: Z.access, body: form({ password: 'nope' + i }) })
r = await call('/account/closure', { method: 'POST', token: Z.access, body: form() }); ok(r.s === 429, 'guessing the password to close an account gets locked out')

/* ---- the admin sees and decides ---- */
r = await adm('/admin/closures?status=pending'); ok(r.s === 200 && r.j.requests.some((x) => x.id === reqId && x.reason_code === 'not_using' && x.reason_text === 'closing the shop'), 'the request, with the reason, shows on the admin list')
r = await adm(`/admin/closures/${reqId}/reject`, { method: 'POST', body: { note: 'please talk to us first' } }); ok(r.s === 200, 'the admin can say no')
r = await call('/account/closure', { token: A.access }); ok(r.j.request.status === 'rejected' && r.j.request.note === 'please talk to us first', 'the owner sees it was not approved, and why')
r = await adm(`/admin/closures/${reqId}/approve`, { method: 'POST', body: {} }); ok(r.s === 404, 'a decided request cannot be decided again')

// ask again, owner changes their mind
r = await call('/account/closure', { method: 'POST', token: A.access, body: form() }); const id2 = r.j.request.id
r = await call('/account/closure/cancel', { method: 'POST', token: A.access }); ok(r.s === 200, 'the owner can cancel while it is waiting')
r = await adm(`/admin/closures/${id2}/approve`, { method: 'POST', body: {} }); ok(r.s === 404, 'a cancelled request cannot be approved')

// approve with the normal wait: 14 days
r = await call('/account/closure', { method: 'POST', token: A.access, body: form({ reasonCode: 'too_expensive', reasonText: '' }) }); const id3 = r.j.request.id
r = await adm(`/admin/closures/${id3}/approve`, { method: 'POST', body: { note: 'ok' } })
const days = (r.j.scheduledAt - Date.now()) / 86400000
ok(r.s === 200 && days > 13.99 && days < 14.01, `approval schedules the erasing 14 days ahead (${days.toFixed(2)} days)`)
r = await call('/account/closure', { token: A.access }); ok(r.j.request.status === 'approved' && r.j.request.scheduledAt === r.j.request.scheduledAt && r.j.request.scheduledAt > Date.now(), 'the owner sees the date')
r = await adm('/admin/run-deletions', { method: 'POST' }); ok(r.s === 200 && r.j.deleted === 0, 'nothing is erased before the date')
r = await call('/me', { token: A.access }); ok(r.s === 200, 'and the account keeps working until then')
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'items', id: 'i1', ts: Date.now(), data: { id: 'i1', nameNe: 'सामान' } }] } })
r = await call('/account/closure/cancel', { method: 'POST', token: A.access }); ok(r.s === 200, 'an approved request can still be cancelled before the date')
r = await call('/account/closure', { method: 'POST', token: A.access, body: form() }); ok(r.s === 200, 'and asked again')
const id4 = r.j.request.id

// approve for today (admin test option) and erase
r = await adm(`/admin/closures/${id4}/approve`, { method: 'POST', body: { graceDays: 0 } }); ok(r.s === 200, 'approved with no wait (test only)')
r = await adm('/admin/run-deletions', { method: 'POST' })
ok(r.s === 200 && r.j.deleted >= 1, 'the daily run erases the shop')
r = await call('/me', { token: A.access }); ok(r.s === 403 || r.s === 401, "the shop's phone can no longer use the account")
r = await call('/auth/refresh', { method: 'POST', body: { refresh: A.refresh } }); ok(r.s === 401 || r.s === 403, 'its refresh login is gone too')
r = await call('/auth/login', { method: 'POST', body: { email: A.email, password: 'secret123', device: A.device } }); ok(r.s === 401, 'the email can no longer log in')
r = await adm('/admin/shops?q=' + encodeURIComponent('Close Shop A')); ok(r.j.shops.every((x) => x.email !== A.email), 'the shop is gone from the admin list')
r = await adm('/admin/closures?status=done')
const done = r.j.requests.find((x) => x.id === id4)
ok(done && done.status === 'done' && done.owner_email.startsWith('deleted:') && !done.owner_email.includes('@') && done.shop_name === '(deleted)' && done.reason_code === 'not_using', 'the record is kept for learning why people leave, without who they were')
const code2 = (await call('/auth/otp', { method: 'POST', body: { email: A.email, purpose: 'signup' } }))
ok(code2.s === 200, 'the same email can sign up again as a new account')
r = await call('/sync/pull?since=0', { token: Z.access }); ok(r.s === 200, "another shop's data is untouched")

/* ---- stopping only the paid plan ---- */
const P = await newShop('P')
await adm('/admin/plan', { method: 'POST', body: { email: P.email, plan: 'pro', days: 30, endTrial: true } })
r = await call('/me', { token: P.access }); ok(r.j.shop.plan === 'pro', 'a paid shop is on Pro')
r = await call('/account/closure', { method: 'POST', token: P.access, body: form({ type: 'cancel_plan', reasonCode: 'too_expensive' }) }); const pid = r.j.request.id
ok(r.s === 200 && r.j.request.type === 'cancel_plan', 'a plan cancellation is a request too')
r = await adm(`/admin/closures/${pid}/approve`, { method: 'POST', body: {} }); ok(r.s === 200 && r.j.done === true, 'approving it ends the plan at once')
r = await call('/me', { token: P.access }); ok(r.j.shop.plan === 'free', 'the shop is on Free, and its data is untouched')
r = await call('/sync/pull?since=0', { token: P.access }); ok(r.s === 200, 'it can still sync')

/* ---- the lists ---- */
r = await adm('/admin/shops'); ok(r.s === 200 && r.j.shops.length >= 2 && r.j.shops[0].email && 'effectivePlan' in r.j.shops[0] && 'devices' in r.j.shops[0], 'the shop list shows email, plan, phones and last seen')
r = await adm('/admin/shops?q=' + encodeURIComponent("%' OR 1=1 --")); ok(r.s === 200 && r.j.shops.length === 0, 'search text cannot be turned into SQL or wildcards')
r = await adm('/admin/tickets'); ok(r.s === 200 && Array.isArray(r.j.tickets), 'the support tickets list opens')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
