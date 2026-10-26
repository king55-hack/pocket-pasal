// Simulates a second phone for the same shop. Usage: node test/phoneB.mjs <email> <password> <itemId>
// 1) logs in with an email code, 2) pulls the shop, 3) sells 2 of the item on credit, 4) prints what it saw.
const B = process.env.API || 'http://127.0.0.1:8787'
const [email, password, itemId] = process.argv.slice(2)
const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
const device = { id: 'phoneB-' + Date.now(), name: 'Phone B (script)' }
let r = await call('/auth/login', { method: 'POST', body: { email, password, device } })
if (r.j.error !== 'otp_required') throw new Error('expected otp_required, got ' + JSON.stringify(r))
r = await call('/auth/login', { method: 'POST', body: { email, password, device, code: r.j.devCode } })
const tok = r.j.access
r = await call('/sync/pull?since=0', { token: tok })
const by = {}
for (const c of r.j.changes) by[c.t] = (by[c.t] || 0) + 1
console.log('B pulled', JSON.stringify(by), 'more=' + r.j.more)
const users = r.j.changes.filter((c) => c.t === 'users').length
const settings = r.j.changes.find((c) => c.t === 'settings')
console.log('B sees owner user:', users === 1, '| shop name from settings:', settings?.data.shopName)
const now = Date.now()
const partyId = 'partyB-' + now
const invId = 'invB-' + now
const push = await call('/sync/push', {
  method: 'POST', token: tok,
  body: {
    changes: [
      { t: 'parties', id: partyId, ts: now, data: { id: partyId, type: 'customer', name: 'Sita (from phone B)', updatedAt: now } },
      { t: 'invoices', id: invId, ts: now, data: { id: invId, no: 'B-C-2083-000001', kind: 'cash', at: now, partyId, lines: [{ itemId, name: 'x', nameEn: 'x', qty: 2, rate: 25, vat: 0 }], subtotal: 50, vat: 0, total: 50, payments: [{ method: 'credit', amount: 50, verified: true }], by: 'Ram' } },
      { t: 'stockMoves', id: 'mvB-' + now, ts: now, data: { id: 'mvB-' + now, itemId, qty: -2, reason: 'sale', refId: invId, at: now } },
      { t: 'ledger', id: 'ldB-' + now, ts: now, data: { id: 'ldB-' + now, partyId, at: now, desc: 'B-C-2083-000001', dr: 50, cr: 0, delta: 50 } },
    ],
  },
})
console.log('B pushed a credit sale of 2 units:', push.s === 200)
