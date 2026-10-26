// Safe checks against a deployed API. They create no account and change no data.
//   API=https://your-api.workers.dev ORIGIN=https://your-app.pages.dev node test/prod-smoke.mjs
import { createHmac } from 'node:crypto'
const API = process.env.API
const ORIGIN = process.env.ORIGIN
if (!API || !ORIGIN) { console.error('Set API and ORIGIN'); process.exit(2) }
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers }
}
const b64u = (x) => Buffer.from(x).toString('base64url')
const jwt = (payload, secret) => { const h = b64u('{"alg":"HS256","typ":"JWT"}'), p = b64u(JSON.stringify(payload)); return `${h}.${p}.${createHmac('sha256', secret).update(h + '.' + p).digest('base64url')}` }

ok(API.startsWith('https://'), 'the API is served over HTTPS')
let r = await call('/health'); ok(r.s === 200 && r.j.ok === true, 'health check answers')
ok(r.h.get('x-content-type-options') === 'nosniff' && r.h.get('cache-control') === 'no-store' && /max-age/.test(r.h.get('strict-transport-security') ?? ''), 'security headers are on')
r = await call('/health', { headers: { Origin: ORIGIN } }); ok(r.h.get('access-control-allow-origin') === ORIGIN, 'the real web app address is allowed by CORS')
r = await call('/health', { headers: { Origin: 'https://evil.example' } }); ok(!r.h.get('access-control-allow-origin'), 'another website is not allowed by CORS')
for (const [m, p] of [['GET', '/me'], ['GET', '/devices'], ['POST', '/sync/push'], ['GET', '/sync/pull'], ['GET', '/pay/config'], ['POST', '/pay/create']]) {
  r = await call(p, { method: m, body: m === 'POST' ? {} : undefined }); ok(r.s === 401, `${m} ${p} needs a login`)
}
const claims = { sub: 'x', shop: 'x', dev: 'x', exp: Math.floor(Date.now() / 1000) + 600 }
r = await call('/me', { token: jwt(claims, 'dev-only-secret-change-me-0123456789abcdef') }); ok(r.s === 401, 'a token signed with the well-known test secret is refused (production has its own secret)')
r = await call('/admin/plan', { method: 'POST', body: { email: 'a@b.co', plan: 'max' }, headers: { 'x-admin-key': 'dev-admin-key' } }); ok(r.s === 403, 'the well-known test admin key does not work')
r = await call('/admin/plan', { method: 'POST', body: { email: 'a@b.co', plan: 'max' } }); ok(r.s === 403, 'admin route refuses a request with no key')
r = await call('/auth/otp', { method: 'POST', body: { email: `smoke${Date.now()}@example.com`, purpose: 'signup' } })
ok(r.j.devCode === undefined, 'a login code is never returned in the response (test mode is off)')
ok(r.s === 200 || (r.s === 503 && r.j.error === 'mail'), `code request ends cleanly (${r.s} ${r.j.error ?? 'sent'})`)
r = await call('/pay/go/mock/00000000-0000-0000-0000-000000000000'); ok(/Not available|has ended/.test(await (await fetch(API + '/pay/go/mock/00000000-0000-0000-0000-000000000000')).text()), 'the fake payment provider is switched off')
r = await call('/nothing-here'); ok(r.s === 404 && r.j.error === 'not_found', 'unknown address gives a plain 404')
r = await call('/auth/login', { method: 'POST', body: '{broken' }); ok(r.s === 400, 'broken request gives a plain 400')
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
