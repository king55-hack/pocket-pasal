// Attack-style checks against a running dev server (npm run dev, DEV_RETURN_OTP=1, ENABLE_MOCK_PAY=1).  node test/security.test.mjs
import { createHmac } from 'node:crypto'
const B = process.env.API || 'http://127.0.0.1:8787'
const DEV_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me-0123456789abcdef'
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const raw = (path, { method = 'GET', body, token, headers = {} } = {}) =>
  fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined })
const call = async (path, o) => { const r = await raw(path, o); return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers } }
const b64u = (x) => Buffer.from(x).toString('base64url')
const jwt = (payload, secret = DEV_SECRET, alg = 'HS256') => {
  const h = b64u(JSON.stringify({ alg, typ: 'JWT' })), p = b64u(JSON.stringify(payload))
  return `${h}.${p}.${secret === null ? '' : createHmac('sha256', secret).update(h + '.' + p).digest('base64url')}`
}
const stamp = Date.now()
async function newShop(tag) {
  const email = `s${tag}${stamp}@example.com`
  const code = (await call('/auth/otp', { method: 'POST', body: { email, purpose: 'signup' } })).j.devCode
  const device = { id: `sec-dev-${tag}-${stamp}`, name: 'sec' }
  const r = await call('/auth/signup', { method: 'POST', body: { email, code, password: 'secret123', name: 'T', shopName: 'Sec ' + tag, device } })
  return { email, device, ...r.j, shopId: r.j.shop.id }
}
const A = await newShop('A')
const Z = await newShop('Z')

/* ---- 1. nothing works without a login ---- */
const guarded = [['GET', '/me'], ['GET', '/devices'], ['POST', '/support'], ['POST', '/sync/push'], ['GET', '/sync/pull'], ['GET', '/sync/conflicts'], ['GET', '/pay/config'], ['POST', '/pay/config'], ['POST', '/pay/create'], ['GET', '/pay/status/x'], ['POST', '/auth/logout'], ['POST', '/devices/x/revoke']]
let open = []
for (const [m, p] of guarded) { const r = await call(p, { method: m, body: m === 'POST' ? {} : undefined }); if (r.s !== 401) open.push(`${m} ${p}=${r.s}`) }
ok(open.length === 0, 'every protected endpoint refuses a request with no token ' + open.join(' '))

/* ---- 2. forged and broken tokens ---- */
const now = Math.floor(Date.now() / 1000)
const claims = { sub: 'x', shop: A.shopId, dev: A.device.id, exp: now + 600 }
let r = await call('/me', { token: jwt(claims, 'a-totally-wrong-secret-that-is-long-enough!') }); ok(r.s === 401, 'token signed with the wrong secret is refused')
r = await call('/me', { token: jwt(claims, null, 'none') }); ok(r.s === 401, 'alg=none token with an empty signature is refused')
r = await call('/me', { token: jwt({ ...claims, exp: now - 10 }) }); ok(r.s === 401, 'expired token is refused')
r = await call('/me', { token: jwt({ ...claims, dev: 'no-such-device-0000' }) }); ok(r.s === 403, 'a correctly signed token for an unregistered device is refused')
const parts = A.access.split('.')
const swapped = `${parts[0]}.${b64u(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), shop: Z.shopId }))}.${parts[2]}`
r = await call('/me', { token: swapped }); ok(r.s === 401, 'access token with the shop id swapped (signature kept) is refused')
r = await call('/me', { token: 'garbage' }); ok(r.s === 401, 'garbage token is refused')
r = await call('/me', { headers: { Authorization: 'Basic ' + A.access } }); ok(r.s === 401, 'wrong auth scheme is refused')

/* ---- 3. one shop cannot reach another shop's data ---- */
const mk = await call('/pay/create', { method: 'POST', token: A.access, body: { provider: 'mock', amount: 99, ref: 'x' } })
r = await call('/pay/status/' + mk.j.id, { token: Z.access }); ok(r.s === 404, 'shop Z cannot read shop A payment')
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'items', id: 'shared-id-1', ts: Date.now(), data: { id: 'shared-id-1', nameNe: 'A item', price: 1 } }] } })
await call('/sync/push', { method: 'POST', token: Z.access, body: { changes: [{ t: 'items', id: 'shared-id-1', ts: Date.now() + 1000, data: { id: 'shared-id-1', nameNe: 'Z item', price: 2 } }] } })
r = await call('/sync/pull?since=0', { token: A.access }); ok(r.j.changes.find((c) => c.id === 'shared-id-1')?.data.nameNe === 'A item', 'same record id in two shops never overwrites the other shop')
r = await call('/sync/pull?since=0', { token: Z.access }); ok(!r.j.changes.some((c) => c.data.nameNe === 'A item'), 'shop Z never receives shop A records')
await call(`/devices/${A.device.id}/revoke`, { method: 'POST', token: Z.access })
r = await call('/me', { token: A.access }); ok(r.s === 200, 'shop Z cannot revoke shop A phone')
r = await call('/devices', { token: Z.access }); ok(r.j.devices.every((d) => d.id !== A.device.id), 'device list only shows own phones')
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'invoices', id: 'cf1', ts: 1, data: { id: 'cf1', no: 'DUP-1' } }] } })
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'invoices', id: 'cf2', ts: 1, data: { id: 'cf2', no: 'DUP-1' } }] } })
const cf = (await call('/sync/conflicts', { token: A.access })).j.conflicts[0]
await call('/sync/conflicts/' + encodeURIComponent(cf.id) + '/resolve', { method: 'POST', token: Z.access })
r = await call('/sync/conflicts', { token: A.access }); ok(r.j.conflicts.some((c) => c.id === cf.id), "shop Z cannot dismiss shop A's conflicts")
r = await call('/sync/push', { method: 'POST', token: Z.access, body: { changes: [{ t: 'items', id: 'evil', ts: 5, data: { id: 'evil', shop_id: A.shopId, nameNe: 'x' } }] } })
r = await call('/sync/pull?since=0', { token: A.access }); ok(!r.j.changes.some((c) => c.id === 'evil'), 'a shop_id field inside pushed data does not move it into another shop')

/* ---- 4. clocks cannot be forged to lock a record ---- */
await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'items', id: 'future-1', ts: 9e15, data: { id: 'future-1', nameNe: 'future', price: 1 } }] } })
r = await call('/sync/pull?since=0', { token: A.access })
const fut = r.j.changes.find((c) => c.id === 'future-1')
ok(fut && fut.ts <= Date.now() + 10 * 60_000, 'a far-future edit time is clamped, so one phone cannot freeze a record')

/* ---- 5. injection ---- */
const evilEmail = "x'; DROP TABLE owners;--@example.com"
r = await call('/auth/otp', { method: 'POST', body: { email: evilEmail, purpose: 'login' } }); ok(r.s === 400 || r.s === 200, 'SQL in the email field does not crash the server')
const evil = "'); DROP TABLE records;--"
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'items', id: 'sqli-1', ts: Date.now(), data: { id: 'sqli-1', nameNe: evil, barcode: evil } }] } }); ok(r.s === 200, 'SQL text inside a record is stored as plain text')
r = await call('/support', { method: 'POST', token: A.access, body: { category: evil, message: evil, meta: { a: evil } } }); ok(r.s === 200, 'SQL text in a support message is harmless')
r = await call('/sync/pull?since=' + encodeURIComponent("0 OR 1=1"), { token: Z.access }); ok(r.s === 200 && r.j.changes.every((c) => c.data.nameNe !== 'A item'), 'SQL in the cursor parameter returns nothing extra')
r = await call('/sync/conflicts/' + encodeURIComponent("x' OR '1'='1") + '/resolve', { method: 'POST', token: Z.access }); ok(r.s === 200, 'SQL in a path parameter is harmless')
r = await call('/sync/pull?since=0', { token: A.access }); ok(r.j.changes.some((c) => c.id === 'sqli-1' && c.data.nameNe === evil), 'the records table survived and returns the text unchanged')
r = await call('/auth/login', { method: 'POST', body: { email: A.email, password: 'secret123', device: A.device } }); ok(r.s === 200, 'owners table survived: login still works')

/* ---- 6. pages shown to customers ---- */
const xssId = encodeURIComponent('"><script>alert(1)</script>')
const pg = await raw('/pay/go/mock/' + xssId); const html = await pg.text()
ok(!html.includes('<script>alert(1)</script>') && !html.includes('"><script>'), 'payment page never echoes a script from the address')
const pg2 = await raw(new URL(mk.j.qrText).pathname)
ok((pg2.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'") && pg2.headers.get('x-frame-options') === 'DENY', 'payment pages forbid framing')
ok((pg2.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), 'payment pages have a strict content policy')
r = await raw('/pay/mock/' + xssId + '/pay', { method: 'POST' }); ok(!(await r.text()).includes('<script>alert'), 'mock pay page does not echo scripts either')

/* ---- 7. browser rules ---- */
let o = await raw('/health', { headers: { Origin: 'https://evil.example' } }); ok(!o.headers.get('access-control-allow-origin'), 'a web page on another site gets no CORS permission')
o = await raw('/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }); ok(!o.headers.get('access-control-allow-origin'), 'preflight from another site is not approved')
o = await raw('/health', { headers: { Origin: ORIGIN } }); ok(o.headers.get('access-control-allow-origin') === ORIGIN, 'the real web app address is allowed')
o = await raw('/me', { token: A.access })
ok(o.headers.get('x-content-type-options') === 'nosniff' && o.headers.get('cache-control') === 'no-store' && (o.headers.get('strict-transport-security') ?? '').includes('max-age') && o.headers.get('referrer-policy') === 'no-referrer', 'API replies carry nosniff, no-store, HSTS and no-referrer')

/* ---- 8. guessing codes and passwords ---- */
const e1 = `g${stamp}@example.com`
const c1 = (await call('/auth/otp', { method: 'POST', body: { email: e1, purpose: 'signup' } })).j.devCode
const dev1 = { id: 'guess-dev-' + stamp, name: 'g' }
const wrong = c1 === '123456' ? '654321' : '123456'
for (let i = 0; i < 5; i++) await call('/auth/signup', { method: 'POST', body: { email: e1, code: wrong, password: 'secret123', name: 'g', shopName: 'g', device: dev1 } })
r = await call('/auth/signup', { method: 'POST', body: { email: e1, code: c1, password: 'secret123', name: 'g', shopName: 'g', device: dev1 } }); ok(r.s === 401, 'after 5 wrong code guesses even the right code is refused')
const e2 = `h${stamp}@example.com`
const c2 = (await call('/auth/otp', { method: 'POST', body: { email: e2, purpose: 'signup' } })).j.devCode
r = await call('/auth/signup', { method: 'POST', body: { email: e2, code: c2, password: 'short7!', name: 'h', shopName: 'h', device: { id: 'pw-dev-' + stamp, name: 'h' } } }); ok(r.s === 400, 'password under 8 characters is refused')
r = await call('/auth/signup', { method: 'POST', body: { email: e2, code: c2, password: 'x'.repeat(5000), name: 'h', shopName: 'h', device: { id: 'pw-dev2-' + stamp, name: 'h' } } }); ok(r.s === 400, 'a 5000-character password is refused before hashing')
r = await call('/auth/signup', { method: 'POST', body: { email: e2, code: c2, password: 'secret123', name: 'h', shopName: 'h', device: { id: 'pw-dev3-' + stamp, name: 'h' } } }); ok(r.s === 200, 'the code still works for a valid request')
r = await call('/auth/signup', { method: 'POST', body: { email: e2 + 'x', code: c2, password: 'secret123', name: 'h', shopName: 'h', device: { id: 'pw-dev4-' + stamp, name: 'h' } } }); ok(r.s === 401, 'a code is tied to its own email and cannot be reused')
// login code cannot be borrowed from a signup code
const e3 = `l${stamp}@example.com`
const owner3 = await newShop('L')
const newDev = { id: 'login-dev-' + stamp, name: 'second' }
const lc = (await call('/auth/login', { method: 'POST', body: { email: owner3.email, password: 'secret123', device: newDev } })).j.devCode
r = await call('/auth/login', { method: 'POST', body: { email: owner3.email, password: 'secret123', device: newDev, code: lc } }); ok(r.s === 200, 'new phone logs in with its code')
r = await call('/auth/login', { method: 'POST', body: { email: owner3.email, password: 'secret123', device: { id: 'login-dev-b-' + stamp, name: 'third' }, code: lc } }); ok(r.s === 401, 'a used login code cannot register a second phone')
void e3
let locked = 0
for (let i = 0; i < 9; i++) locked = (await call('/auth/login', { method: 'POST', body: { email: Z.email, password: 'wrong-' + i, device: Z.device } })).s
r = await call('/auth/login', { method: 'POST', body: { email: Z.email, password: 'secret123', device: Z.device } }); ok(locked === 429 && r.s === 429, 'after repeated wrong passwords the account is locked even for the right password')

/* ---- 9. sessions ---- */
const e4 = await newShop('S')
r = await call('/auth/refresh', { method: 'POST', body: { refresh: e4.refresh.split('.')[0] + '.' + '0'.repeat(64) } }); ok(r.s === 401, 'refresh token with a wrong secret half is refused')
await call('/auth/logout', { method: 'POST', token: e4.access })
r = await call('/auth/refresh', { method: 'POST', body: { refresh: e4.refresh } }); ok(r.s === 401, 'logout kills the refresh token')

/* ---- 10. size limits and bad input ---- */
r = await call('/sync/push', { method: 'POST', token: A.access, body: { changes: [{ t: 'items', id: 'big', ts: 1, data: { id: 'big', photo: 'x'.repeat(70_000) } }] } }); ok(r.s === 400, 'a single record over 64 KB is refused')
const huge = JSON.stringify({ changes: [{ t: 'items', id: 'h', ts: 1, data: { pad: 'x'.repeat(9 * 1024 * 1024) } }] })
r = await call('/sync/push', { method: 'POST', token: A.access, body: huge }); ok(r.s === 413 || r.s === 400, 'a 9 MB request is refused')
r = await call('/auth/login', { method: 'POST', body: '{not json' }); ok(r.s === 400 && !JSON.stringify(r.j).match(/at |stack|Error:/), 'broken JSON gives a plain 400 without internals')
r = await call('/no/such/route'); ok(r.s === 404 && r.j.error === 'not_found', 'unknown route gives a plain 404')
r = await call('/auth/login'); ok(r.s === 404, 'wrong HTTP method on a login route is not served')
r = await call('/auth/login', { method: 'POST', body: { email: { $ne: 1 }, password: ['x'], device: 5 } }); ok(r.s === 400, 'objects and arrays in place of text are refused')

/* ---- 11. seller key ---- */
r = await call('/admin/plan', { method: 'POST', body: { email: A.email, plan: 'max' } }); ok(r.s === 403, '/admin/plan without the key is refused')
r = await call('/admin/plan?x-admin-key=dev-admin-key', { method: 'POST', body: { email: A.email, plan: 'max' } }); ok(r.s === 403, 'the admin key is not accepted in the address')
r = await call('/admin/plan', { method: 'POST', token: A.access, body: { email: A.email, plan: 'max' } }); ok(r.s === 403, 'a shop owner token is not an admin key')

/* ---- 12. unknown email looks the same as a real one ---- */
const known = await call('/auth/otp', { method: 'POST', body: { email: A.email, purpose: 'login' } })
const unknown = await call('/auth/otp', { method: 'POST', body: { email: `nobody${stamp}@example.com`, purpose: 'login' } })
ok(known.s === unknown.s && known.j.ok === unknown.j.ok, 'login code request answers the same for known and unknown emails')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
