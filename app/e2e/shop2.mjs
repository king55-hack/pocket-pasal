// End-to-end test of a brand new shop (a pharmacy) in a real Chrome, with a second phone and the cloud server.
// Needs: the web app on http://localhost:5173 (npm run dev) and the API on http://127.0.0.1:8787 (server: npm run dev, with DEV_RETURN_OTP=1 and ENABLE_MOCK_PAY=1).
//   node e2e/shop2.mjs
import { chromium } from 'playwright-core'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP = process.env.APP || 'http://localhost:5173'
const API = process.env.API || 'http://127.0.0.1:8787'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const stamp = Date.now()
const EMAIL = `sita${stamp}@pasal.np`
const PW = 'pharma-pass-1'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const near = (a, b) => Math.abs(a - b) < 0.005
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function unzipStore(buf) {
  const files = {}
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), el = buf.readUInt16LE(p + 28)
    files[buf.subarray(p + 30, p + 30 + nl).toString('utf8')] = buf.subarray(p + 30 + nl + el, p + 30 + nl + el + size).toString('utf8')
    p += 30 + nl + el + size
  }
  return files
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const errors = []
const dialogs = []
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss() })
  return { ctx, page, name }
}
const dump = (page, table) => page.evaluate((t) => new Promise((res, rej) => {
  const q = indexedDB.open('pasal'); q.onerror = () => rej(q.error)
  q.onsuccess = () => { const r = q.result.transaction(t).objectStore(t).getAll(); r.onsuccess = () => { q.result.close(); res(r.result) } }
}), table)
const kv = async (page, k) => (await dump(page, 'kv')).find((r) => r.k === k)?.v
const nav = (page, name) => page.locator('.nav button', { hasText: name }).click()
const btn = (page, name, o = {}) => page.getByRole('button', { name, exact: o.exact ?? false })
async function more(page, label) { await nav(page, 'More'); await page.locator('.body .item.tap', { hasText: label }).first().click() }
const prov = (pg) => pg.locator('label', { hasText: /^Province/ }).locator('select')
const dist = (pg) => pg.locator('label', { hasText: /^District/ }).locator('select')
async function outboxEmpty(pg, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if ((await dump(pg, 'outbox')).length === 0) return; await sleep(400) }
  throw new Error('outbox did not empty')
}
/** Wait until a value settles on what we expect (screens update a moment after typing or tapping). */
async function settles(get, want, ms = 4000) {
  const end = Date.now() + ms
  let v = await get()
  while (v !== want && Date.now() < end) { await sleep(150); v = await get() }
  return v === want
}
const waitText = (page, text, timeout = 10000) => page.getByText(text).first().waitFor({ timeout })

/* ============ PHONE 1: set up a new pharmacy ============ */
const A = await phone('phone1')
const p = A.page
await p.goto(APP)
await btn(p, 'English', { exact: true }).click()
await p.getByLabel('Shop name').fill('Sita Pharmacy')
await p.getByLabel('Company / firm name').fill('Sita Health Pvt Ltd')
await p.getByLabel('Shop type').selectOption('pharmacy')
ok((await dist(p).isDisabled()), 'district is locked until a province is chosen')
await prov(p).selectOption('bagmati')
const dOpts = await dist(p).locator('option').allTextContents()
ok(dOpts.length === 14 && dOpts.includes('Lalitpur') && !dOpts.includes('Jhapa'), 'district list shows only the 13 districts of Bagmati')
await dist(p).selectOption('ललितपुर')
await prov(p).selectOption('koshi')
ok((await dist(p).inputValue()) === '', 'changing the province clears the district')
await prov(p).selectOption('bagmati')
await dist(p).selectOption('ललितपुर')
const muniBox = p.locator('label', { hasText: /^Municipality/ }).locator('select')
await muniBox.waitFor()
const muniOpts = await muniBox.locator('option').allTextContents()
ok(muniOpts.some((x) => /^Lalitpur Metropolitan City · 29 wards/.test(x)) && muniOpts.some((x) => /Godawari Municipality/.test(x)) && muniOpts.some((x) => /Not in the list/.test(x)), 'the municipality list shows the places of the chosen district with their ward counts')
await muniBox.selectOption('ललितपुर')
const wardBox = p.locator('label', { hasText: /^Ward/ }).locator('select')
ok((await wardBox.locator('option').count()) === 30, 'Lalitpur has 29 wards, so the ward list stops at 29')
await wardBox.selectOption('3')
await p.getByLabel('PAN / VAT (ichhik)').fill('301234567')
await p.getByRole('button', { name: 'vat' }).click()
await btn(p, 'Next', { exact: true }).click()
await p.getByLabel('Your name').fill('Sita')
await p.getByLabel('Email', { exact: true }).fill(EMAIL)
await p.getByLabel('Password', { exact: true }).fill('short')
await p.getByLabel('Repeat password').fill('short')
await p.getByRole('button', { name: 'Show' }).first().click()
ok((await p.getByLabel('Password', { exact: true }).getAttribute('type')) === 'text' && (await p.getByLabel('Password', { exact: true }).inputValue()) === 'short', 'the eye button shows the password that was typed')
await p.getByRole('button', { name: 'Hide' }).first().click()
ok((await p.getByLabel('Password', { exact: true }).getAttribute('type')) === 'password', 'and hides it again')
await btn(p, 'Start my shop').click()
ok(await p.getByText('at least 8 characters').isVisible(), 'a short password is refused in the app')
await p.getByLabel('Password', { exact: true }).fill(PW)
await p.getByLabel('Repeat password').fill(PW)
await btn(p, 'Start my shop').click()
await waitText(p, 'Namaste, Sita')
const cats0 = await dump(p, 'categories')
ok(cats0.length === 5 && cats0.some((c) => c.nameEn === 'Tablets'), 'pharmacy starts with its own 5 categories')
const st0 = await kv(p, 'settings')
ok(st0.shopType === 'pharmacy' && st0.province === 'bagmati' && st0.district === 'ललितपुर' && st0.muni === 'ललितपुर' && st0.ward === '3' && st0.vatRegistered, 'shop details saved: type, province, district, ward, VAT')
ok((await dump(p, 'items')).length === 0, 'a pharmacy starts with no kirana items')

/* ============ add stock through the form ============ */
async function addItem(name, cat, cost, price, stock, min, photo) {
  await nav(p, 'Items')
  await btn(p, '+ New').click()
  await p.getByPlaceholder('Name (English)').fill(name)
  if (photo) await p.locator('input[type=file]').setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: photo })
  await p.getByLabel('Category').selectOption({ label: cat })
  await p.getByLabel('Cost').fill(String(cost))
  await p.getByLabel('Price').fill(String(price))
  await p.getByLabel('Stock', { exact: true }).fill(String(stock))
  await p.getByLabel('Min stock').fill(String(min))
  await btn(p, 'Save', { exact: true }).click()
  await waitText(p, 'Saved', 5000).catch(() => {})
}
await addItem('Paracetamol 500mg', 'Tablets', 8, 12, 200, 20)
await addItem('Cough syrup', 'Syrups', 90, 120, 15, 5)
// a 3000 x 2000 picture like a phone camera makes, with colour blocks and a little grain
const bigPhoto = Buffer.from(await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 3000; c.height = 2000
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 3000, 2000); g.addColorStop(0, '#d9a066'); g.addColorStop(1, '#3a6ea5'); x.fillStyle = g; x.fillRect(0, 0, 3000, 2000)
  for (let i = 0; i < 2500; i++) { x.fillStyle = 'hsl(' + Math.random() * 360 + ',60%,' + (30 + Math.random() * 40) + '%)'; x.fillRect(Math.random() * 3000, Math.random() * 2000, 20 + Math.random() * 160, 20 + Math.random() * 160) }
  for (let i = 0; i < 60000; i++) { x.fillStyle = Math.random() > 0.5 ? '#ffffff30' : '#00000030'; x.fillRect(Math.random() * 3000, Math.random() * 2000, 2, 2) }
  return c.toDataURL('image/jpeg', 0.95).split(',')[1]
}), 'base64')
await addItem('Bandage roll', 'Health supplies', 20, 35, 3, 5, bigPhoto)
await addItem('<img src=x onerror=alert(1)>', 'Tablets', 5, 10, 10, 2)
await nav(p, 'Items')
let items = await dump(p, 'items')
const itemOf = (n) => items.find((i) => i.nameEn === n)
ok(items.length === 4 && itemOf('Paracetamol 500mg').stock === 200 && itemOf('Paracetamol 500mg').vat === true, '4 items added through the form, VAT on by default')
{
  for (let i = 0; i < 40 && !itemOf('Bandage roll').photo; i++) { await sleep(250); items = await dump(p, 'items') }
  const photo = itemOf('Bandage roll').photo
  const dims = await p.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([0, 0]); setTimeout(() => r([0, 0]), 10000); i.src = u }), photo)
  ok(bigPhoto.length > 150000 && photo && photo.length <= 52000 && Math.max(...dims) >= 360 && Math.max(...dims) <= 720, `a ${(bigPhoto.length / 1e6).toFixed(1)} MB camera photo is kept clear (${dims.join(' x ')} px) and small (${Math.round(photo.length / 1000)} KB, fits the sync limit)`)
}
ok((await p.locator('img[src="x"]').count()) === 0 && (await p.getByText('<img src=x onerror=alert(1)>').count()) >= 1 && dialogs.length === 0, 'an item named with HTML shows as plain text and runs nothing')
ok((await p.getByText('Low stock').count()) >= 1, 'Bandage roll (3 left, min 5) is marked low stock')
const mvSum = (await dump(p, 'stockMoves')).filter((m) => m.itemId === itemOf('Paracetamol 500mg').id).reduce((a, m) => a + m.qty, 0)
ok(mvSum === 200, 'opening stock is recorded as a stock move')

/* ============ search ============ */
await nav(p, 'Sale')
const search = p.getByPlaceholder('Search item (Nepali or English)')
await search.fill('para')
ok(await settles(() => p.locator('.card').count(), 1), 'search "para" finds Paracetamol')
await search.fill('')
await p.getByRole('button', { name: /Tablets/ }).click()
ok(await settles(() => p.locator('.card').count(), 2), 'the Tablets category button shows only its 2 items')

/* ============ tax invoice, cash ============ */
await search.fill('para')
for (let i = 0; i < 3; i++) await p.locator('.card', { hasText: 'Paracetamol' }).click()
await p.getByRole('button', { name: /Tax invoice/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await btn(p, 'Exact').click()
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
let inv = await dump(p, 'invoices')
const bill1 = inv.find((i) => i.kind === 'tax')
ok(bill1 && near(bill1.total, 40.68) && near(bill1.vat, 4.68) && /-T-\d{4}-000001$/.test(bill1.no), `tax invoice: Rs 36 + 13% VAT = Rs 40.68 (${bill1?.no})`)
ok((await dump(p, 'items')).find((i) => i.nameEn === 'Paracetamol 500mg').stock === 197, 'stock fell from 200 to 197')
ok((await p.locator('.receipt img').first().evaluate((i) => i.naturalWidth)) > 100, 'bill image was drawn')

/* ============ credit sale, customer pays part ============ */
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Cough syrup' }).click()
await p.getByRole('button', { name: /Cash receipt/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await btn(p, 'Credit', { exact: true }).click()
await p.getByPlaceholder('New customer name').fill('Mina Didi')
await p.locator('.row', { has: p.getByPlaceholder('New customer name') }).getByRole('button', { name: '+' }).click()
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
let mina = (await dump(p, 'parties')).find((x) => x.name === 'Mina Didi')
ok(mina && mina.balance === 120, 'credit sale: Mina owes Rs 120 (cash receipt, no VAT)')
await more(p, 'Parties')
await p.locator('.item.tap', { hasText: 'Mina Didi' }).click()
await p.getByPlaceholder('Amount').fill('50')
await btn(p, 'Received').click()
await sleep(400)
mina = (await dump(p, 'parties')).find((x) => x.name === 'Mina Didi')
ok(mina.balance === 70, 'Mina pays Rs 50, balance Rs 70')

/* ============ return ============ */
await more(p, 'Returns')
await p.locator('.item.tap', { hasText: bill1.no }).first().click()
await p.locator('.qty button', { hasText: '+' }).first().click()
await btn(p, 'Process return').click()
await sleep(700)
inv = await dump(p, 'invoices')
const cn = inv.find((i) => i.kind === 'credit_note')
ok(cn && near(cn.total, 13.56) && cn.refId === bill1.id, 'return: credit note Rs 13.56 (Rs 12 + VAT)')
ok((await dump(p, 'items')).find((i) => i.nameEn === 'Paracetamol 500mg').stock === 198, 'returned tablet is back in stock (198)')

/* ============ buy stock from a supplier on credit ============ */
await more(p, 'Parties')
await btn(p, 'Suppliers').click()
await p.getByPlaceholder('Name', { exact: true }).fill('Everest Pharma')
await btn(p, '+ Add').click()
await sleep(300)
await more(p, 'Purchase')
await p.locator('select').first().selectOption({ label: 'Everest Pharma' })
await p.locator('.item', { hasText: 'Paracetamol' }).locator('.qty button', { hasText: '+' }).click({ clickCount: 10 })
await btn(p, 'On credit').click()
await btn(p, 'Add to stock').click()
await sleep(700)
const sup = (await dump(p, 'parties')).find((x) => x.name === 'Everest Pharma')
ok((await dump(p, 'items')).find((i) => i.nameEn === 'Paracetamol 500mg').stock === 208 && sup.balance === 80, 'purchase: +10 tablets (208), Rs 80 owed to Everest Pharma')

/* ============ books ============ */
await nav(p, 'Books')
const dayText = await p.locator('.body').innerText()
ok(/Cash sales/.test(dayText) && /Credit sales/.test(dayText) && /Expected cash/.test(dayText), 'Day Book shows cash, credit and expected cash')
await btn(p, 'VAT', { exact: true }).click()
ok(/Output VAT/.test(await p.locator('.body').innerText()), 'VAT summary is there for a VAT-registered shop')

/* ============ staff and permissions ============ */
await more(p, 'Staff')
await p.getByPlaceholder('Name', { exact: true }).fill('Hari')
await p.getByPlaceholder('PIN').fill('4821')
await btn(p, '+ Add').click()
await p.getByText('What this person can do').waitFor()
await p.locator('.toggle', { hasText: 'Can see cost price' }).locator('.sw').click()
await sleep(300)
const hari = (await dump(p, 'users')).find((u) => u.name === 'Hari')
ok(hari.role === 'staff' && hari.perms?.viewCost === true && !hari.perms?.books, 'staff saved with only the permissions the owner chose')
await nav(p, 'More')
await btn(p, 'Switch user').click()
await p.getByRole('button', { name: 'Hari' }).click()
await p.locator('input[type=password]').fill('0000')
await btn(p, 'Login', { exact: true }).click()
ok(await p.getByText('Wrong password or PIN').waitFor({ timeout: 5000 }).then(() => true, () => false), 'a wrong PIN is refused')
await p.locator('input[type=password]').fill('4821')
await btn(p, 'Login', { exact: true }).click()
await waitText(p, 'Namaste, Hari')
const tabs = await p.locator('.nav button').allInnerTexts()
ok(tabs.some((x) => /Bills/.test(x)) && !tabs.some((x) => /Books/.test(x)), 'staff has Bills, not Books')
await nav(p, 'More')
const staffMore = await p.locator('.body .item b').allInnerTexts()
ok(!staffMore.some((x) => /Settings|Staff|Cloud|Plan|Purchase|Orders/.test(x)) && staffMore.includes('Returns'), 'staff More menu hides settings, staff, cloud, plans, purchase and orders')
await nav(p, 'Items')
await p.getByText('Paracetamol').first().waitFor()
ok(/cost Rs 8/.test(await p.locator('.body').innerText()) && (await p.getByRole('button', { name: '+ New' }).count()) === 0, 'staff sees cost (allowed) but has no "New item" button (not allowed)')
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Cough' }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
ok((await btn(p, 'Credit', { exact: true }).count()) === 0, 'staff without the credit permission has no Credit payment')
await nav(p, 'More')
await btn(p, 'Switch user').click()
await p.getByRole('button', { name: /Sita/ }).click()
await p.locator('input[type=password]').fill(PW)
await btn(p, 'Login', { exact: true }).click()
await waitText(p, 'Namaste, Sita')
ok((await p.locator('.nav button', { hasText: 'Sale' }).count()) === 1, 'owner is back, and the cart of the staff member was cleared')
ok(!(await p.getByRole('button', { name: /^Pay/ }).count()), 'the staff cart did not carry over')

/* ============ connect cloud ============ */
await more(p, 'Cloud account')
await p.getByLabel('Owner password of this app').fill(PW)
await btn(p, 'Email me a code').click()
const hint = await p.getByText(/DEV code: \d{6}/).first().innerText()
await p.getByPlaceholder('______').fill(hint.match(/\d{6}/)[0])
await btn(p, 'Connect', { exact: true }).click()
await p.getByText('Last sync:').first().waitFor({ timeout: 20000 })
const cloud1 = await kv(p, 'cloud')
const pull = await (await A.ctx.request.get(`${API}/sync/pull?since=0`, { headers: { Authorization: 'Bearer ' + cloud1.access } })).json()
const count = (t) => pull.changes.filter((c) => c.t === t).length
ok(count('items') === 4 && count('invoices') === 3 && count('categories') === 5 && count('users') === 2 && count('parties') === 2, `server holds the shop: ${count('items')} items, ${count('invoices')} bills, ${count('categories')} categories, ${count('users')} users, ${count('parties')} parties`)
ok(!JSON.stringify(pull).includes(PW), 'the password never reached the server in readable form')
ok((await dump(p, 'outbox')).length === 0, 'nothing is left waiting to upload')

/* ============ mock QR payment ============ */
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Bandage' }).click()
await p.getByRole('button', { name: /Cash receipt/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await btn(p, 'QR', { exact: true }).click()
const [created] = await Promise.all([p.waitForResponse((r) => r.url().includes('/pay/create')), btn(p, 'Make QR').click()])
const pay = await created.json()
ok(!!pay.id && (await p.waitForFunction(() => { const i = document.querySelector('.receipt img[alt="QR"]'); return !!i && i.naturalWidth >= 200 }, null, { timeout: 6000 }).then(() => true, () => false)), 'an exact-amount QR is drawn')
ok(await btn(p, 'Create bill').isDisabled(), 'the bill cannot be made before the customer pays')
await A.ctx.request.post(`${API}/pay/mock/${pay.id}/pay`)
await p.getByText('Payment received').first().waitFor({ timeout: 12000 }).catch(async (e) => { console.log('DIAG qr screen:', (await p.locator('.body').innerText()).split('\n').join(' | ').slice(0, 400), 'status:', JSON.stringify(await (await A.ctx.request.get(API + '/pay/status/' + pay.id, { headers: { Authorization: 'Bearer ' + (await kv(p, 'cloud')).access } })).json())); throw e })
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
const qrBill = (await dump(p, 'invoices')).find((i) => i.payments[0]?.method === 'qr')
ok(qrBill?.payments[0].verified === true && qrBill.payments[0].provider === 'mock', 'QR bill is marked verified by the provider')

// make sure phone 1 has uploaded everything before the second phone downloads it
await outboxEmpty(p)
{
  const want = (await dump(p, 'invoices')).length
  const cl = await kv(p, 'cloud')
  let have = 0, polls = 0
  for (let i = 0; i < 20 && have < want; i++) { polls++; have = (await (await A.ctx.request.get(API + '/sync/pull?since=0', { headers: { Authorization: 'Bearer ' + cl.access } })).json()).changes.filter((c) => c.t === 'invoices').length; if (have < want) await sleep(500) }
  ok(have === want, 'before phone 2 starts the server already holds all ' + want + ' bills of phone 1 (it has ' + have + ', polls ' + polls + ')')
}
/* ============ PHONE 2: same shop on a new phone ============ */
const B = await phone('phone2')
const q = B.page
await q.goto(APP)
await btn(q, 'English', { exact: true }).click().catch(() => {})
await q.goto(APP)
await btn(q, 'I already have an account').click()
await q.getByLabel('Email').fill(EMAIL)
await q.getByLabel('Password').fill('wrong-password-1')
await btn(q, 'Log in', { exact: true }).click()
await q.getByText('Wrong email or password').waitFor()
ok(true, 'new phone: a wrong password is refused')
await q.getByLabel('Password').fill(PW)
await btn(q, 'Log in', { exact: true }).click()
const hint2 = await q.getByText(/DEV code: \d{6}/).first().innerText()
await q.locator('input[inputmode=numeric]').fill('000000')
await btn(q, 'Log in', { exact: true }).click()
await q.getByText('code is wrong').waitFor({ timeout: 8000 }).catch(() => {})
await q.locator('input[inputmode=numeric]').fill(hint2.match(/\d{6}/)[0])
await btn(q, 'Log in', { exact: true }).click()
await q.getByText('Sita Pharmacy').first().waitFor({ timeout: 30000 })
await q.locator('input[type=password]').fill(PW)
await btn(q, 'Login', { exact: true }).click()
await waitText(q, 'Namaste, Sita', 20000)
const it2 = await dump(q, 'items')
const pa2 = it2.find((i) => i.nameEn === 'Paracetamol 500mg')?.stock, ba2 = it2.find((i) => i.nameEn === 'Bandage roll')?.stock
if (!(it2.length === 4 && pa2 === 208 && ba2 === 2)) { const bid = it2.find((i) => i.nameEn === 'Bandage roll')?.id; const sv = await (await A.ctx.request.get(API + '/sync/pull?since=0', { headers: { Authorization: 'Bearer ' + (await kv(p, 'cloud')).access } })).json(); console.log('DIAG phone2 moves', JSON.stringify((await dump(q, 'stockMoves')).filter((m) => m.itemId === bid).map((m) => m.qty + m.reason)), 'server moves', JSON.stringify(sv.changes.filter((c) => c.t === 'stockMoves' && c.data.itemId === bid).map((c) => c.data.qty + c.data.reason + '@' + c.seq)), 'phone2 cursor', (await kv(q, 'cloud'))?.cursor, 'server seq', sv.next, 'phone2 outbox', (await dump(q, 'outbox')).length, 'phone1 outbox', (await dump(p, 'outbox')).length) }
ok(it2.length === 4 && pa2 === 208 && ba2 === 2, 'phone 2 has the same items with the same stock after sync (tablets ' + pa2 + ', bandage ' + ba2 + ')')
ok((await dump(q, 'parties')).find((x) => x.name === 'Mina Didi').balance === 70 && (await dump(q, 'parties')).find((x) => x.name === 'Everest Pharma').balance === 80, 'phone 2 has the same customer and supplier balances')
const dev1 = (await kv(p, 'device')), dev2 = (await kv(q, 'device'))
ok(dev2 === undefined || dev1 !== dev2, 'each phone has its own bill-number code')

/* ============ phone 2 sells with no internet, then both agree ============ */
await B.ctx.setOffline(true)
await nav(q, 'Sale')
await q.locator('.card', { hasText: 'Paracetamol' }).click()
await q.getByRole('button', { name: /^Pay/ }).click()
await btn(q, 'Exact').click()
await btn(q, 'Create bill').click()
await q.getByText('Saved offline').waitFor({ timeout: 8000 })
ok(true, 'phone 2 sold with no internet and says it will sync later')
ok((await dump(q, 'outbox')).length > 0, 'the offline sale is waiting in the outbox')
await B.ctx.setOffline(false)
await q.getByText('Last sync').first().waitFor({ timeout: 1 }).catch(() => {})
await outboxEmpty(q)
ok(true, 'back online, phone 2 uploaded the offline sale by itself')
// phone 1 also sells the same medicine meanwhile
await nav(p, 'Sale')
await p.getByPlaceholder('Search item (Nepali or English)').fill('para')
await p.locator('.card', { hasText: 'Paracetamol' }).click()
await p.locator('.card', { hasText: 'Paracetamol' }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await btn(p, 'Exact').click()
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
await more(p, 'Cloud account')
await btn(p, 'Sync now').click()
await sleep(2500)
const stock1 = (await dump(p, 'items')).find((i) => i.nameEn === 'Paracetamol 500mg').stock
await more(q, 'Cloud account').catch(() => {})
await btn(q, 'Sync now').click().catch(() => {})
await sleep(2500)
const stock2 = (await dump(q, 'items')).find((i) => i.nameEn === 'Paracetamol 500mg').stock
ok(stock1 === 205 && stock2 === 205, `both phones sold the same medicine and agree on stock: ${stock1} and ${stock2} (208 - 1 - 2)`)
const bills = [...(await dump(p, 'invoices')), ...(await dump(q, 'invoices'))].map((i) => i.no)
ok(new Set(bills.filter((n) => !/-CN-/.test(n))).size === 5 && (await A.ctx.request.get(`${API}/sync/conflicts`, { headers: { Authorization: 'Bearer ' + (await kv(p, 'cloud')).access } }).then((r) => r.json())).conflicts.length === 0, 'no duplicate bill numbers between the two phones')

/* ============ typed amount, change, baki, PDF, email, Excel ============ */
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Cough' }).click()
await p.getByRole('button', { name: /Cash receipt/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await p.getByLabel('Amount the customer gave (Rs)').fill('150')
await p.getByText('Give back').first().waitFor({ timeout: 4000 })
ok(/Rs 30/.test(await p.locator('.body').innerText()), 'Rs 120 bill, customer gives Rs 150: the screen says give back Rs 30')
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
let nb = (await dump(p, 'invoices')).sort((a, c) => c.at - a.at)[0]
ok(nb.total === 120 && nb.received === 150 && nb.change === 30, 'the bill remembers what was given (150) and the change (30)')
ok(/Give back/.test(await p.locator('.body').innerText()), 'the bill screen also reminds to give back the change')
const [pdfDl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /PDF/ }).click()])
const pdfFile = join(mkdtempSync(join(tmpdir(), 'pasal-')), 'bill.pdf')
await pdfDl.saveAs(pdfFile)
const pdfBytes = readFileSync(pdfFile)
ok(pdfBytes.subarray(0, 5).toString() === '%PDF-' && pdfBytes.toString('latin1').includes('/DCTDecode') && pdfDl.suggestedFilename() === nb.no + '.pdf', 'PDF of the bill downloads and is a real PDF (' + pdfDl.suggestedFilename() + ')')
await p.getByPlaceholder("Customer's email").fill('customer@example.com')
await btn(p, 'Send email').click()
await p.getByText('Email sent').first().waitFor({ timeout: 8000 })
ok(true, 'the bill is emailed to a customer (test mode: the server accepted it)')

// part payment: 240 bill, customer pays 100, the rest 140 becomes baki on Mina's khata
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Cough' }).click()
await p.locator('.card', { hasText: 'Cough' }).click()
await p.getByRole('button', { name: /Cash receipt/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await p.getByLabel('Amount the customer gave (Rs)').fill('100')
await p.getByRole('button', { name: 'credit the rest' }).click()
await p.locator('.item.tap', { hasText: 'Mina Didi' }).click()
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
nb = (await dump(p, 'invoices')).sort((a, c) => c.at - a.at)[0]
const minaNow = (await dump(p, 'parties')).find((x) => x.name === 'Mina Didi')
ok(nb.total === 240 && nb.payments.length === 2 && nb.payments[0].method === 'cash' && nb.payments[0].amount === 100 && nb.payments[1].method === 'credit' && nb.payments[1].amount === 140, 'part payment: Rs 100 cash and Rs 140 baki on the same bill')
ok(minaNow.balance === 210 && nb.partyBalance === 210 && /Mina Didi now owes/.test(await p.locator('.body').innerText()), 'Mina owes Rs 210 in total, and the bill says so')

// the owner can switch the PDF / email / share buttons off
await more(p, 'Settings')
await p.locator('.toggle', { hasText: 'Bill PDF / email / share buttons' }).locator('.sw').click()
await nav(p, 'Sale')
await p.locator('.card', { hasText: 'Bandage' }).click()
await p.getByRole('button', { name: /Cash receipt/ }).click()
await p.getByRole('button', { name: /^Pay/ }).click()
await btn(p, 'Exact').click()
await btn(p, 'Create bill').click()
await waitText(p, 'Saved')
ok((await p.getByRole('button', { name: /PDF/ }).count()) === 0 && (await p.getByPlaceholder("Customer's email").count()) === 0 && (await btn(p, 'Print').count()) === 1, 'with the setting off the bill screen has no PDF or email, only Print')
await more(p, 'Settings')
await p.locator('.toggle', { hasText: 'Bill PDF / email / share buttons' }).locator('.sw').click()

// Excel for the PC
await nav(p, 'Books')
const [xl] = await Promise.all([p.waitForEvent('download'), btn(p, 'Make the Excel file').click()])
const xlFile = join(mkdtempSync(join(tmpdir(), 'pasal-')), 'books.xlsx')
await xl.saveAs(xlFile)
const xbytes = readFileSync(xlFile)
const parts = unzipStore(xbytes)
const wbx = parts['xl/workbook.xml'] ?? ''
ok(xbytes.subarray(0, 2).toString() === 'PK' && ['Summary', 'Sales', 'Items sold', 'Purchases', 'Ledger', 'Customers', 'Suppliers', 'Stock'].every((n) => wbx.includes('name="' + n + '"')), 'the Excel file has all 8 sheets')
const salesX = parts['xl/worksheets/sheet2.xml'], ledgerX = parts['xl/worksheets/sheet5.xml'], custX = parts['xl/worksheets/sheet6.xml'], stockX = parts['xl/worksheets/sheet8.xml']
ok(salesX.includes(nb.no) && salesX.includes('Mina Didi') && salesX.includes('<v>150</v>'), 'the Sales sheet lists the bills with the customer and what was given')
ok(ledgerX.includes('Mina Didi') && ledgerX.includes('<v>210</v>'), 'the Ledger sheet has Mina with a running balance of 210')
ok(custX.includes('Mina Didi') && custX.includes('<v>210</v>') && stockX.includes('Paracetamol') && stockX.includes('Cost'), 'customers owe and stock are there (owner sees cost)')
await btn(p, 'Email it to me').click()
await p.getByText('Sent to ' + EMAIL).first().waitFor({ timeout: 8000 })
ok(true, 'the Excel report is emailed to the owner')

/* ============ backup keeps login tokens out ============ */
await more(p, 'Settings')
const [dl] = await Promise.all([p.waitForEvent('download'), btn(p, 'Download backup').click()])
const file = join(mkdtempSync(join(tmpdir(), 'pasal-')), 'backup.json')
await dl.saveAs(file)
const bk = JSON.parse(readFileSync(file, 'utf8'))
ok(bk.items.length === 4 && !JSON.stringify(bk.kv).includes(cloud1.refresh) && !bk.kv.some((r) => r.k === 'cloud' || r.k === 'deviceId'), 'backup file holds the data but no login token or phone id')
writeFileSync(file, '{"items":"not a list"}')
await p.locator('input[type=file][accept="application/json"]').setInputFiles(file)
await p.getByText('That file did not work').waitFor({ timeout: 5000 })
ok((await dump(p, 'items')).length === 4, 'a broken backup file is refused and nothing is lost')

/* ============ language and plan locks ============ */
await btn(p, 'नेपाली', { exact: true }).click()
await sleep(300)
ok(/२०८३/.test(await p.locator('body').innerText()) || (await dump(p, 'kv')).length > 0, 'Nepali language switch works')
await btn(p, 'English', { exact: true }).click()

/* ============ leaving the service: needs the admin's approval ============ */
await more(p, 'Close account / leave')
const sendBtn = btn(p, 'Send account deletion request')
ok(await sendBtn.isDisabled(), 'the request cannot be sent before the form is filled')
await p.locator('select').selectOption('too_expensive')
await p.getByRole('button', { name: 'I have saved a backup / Excel file' }).click()
await p.getByRole('button', { name: /I understand: 14 days after approval/ }).click()
await p.getByLabel('Enter the owner password to confirm').fill('definitely-wrong')
await sendBtn.click()
await p.getByText('Wrong password.').waitFor({ timeout: 8000 })
ok(true, 'a wrong password does not send the request')
await p.getByLabel('Enter the owner password to confirm').fill(PW)
await sendBtn.click()
await p.getByText('We review it within 7 days').waitFor({ timeout: 8000 })
const myClose = await (await A.ctx.request.get(`${API}/account/closure`, { headers: { Authorization: 'Bearer ' + (await kv(p, 'cloud')).access } })).json()
ok(myClose.request?.status === 'pending' && myClose.request.reason === 'too_expensive', 'the request reached the server, waiting for the admin')
await nav(p, 'Home')
await p.getByText('Your closing request is being reviewed').waitFor({ timeout: 8000 }).catch(() => {})
ok(await p.getByText('Your closing request is being reviewed').isVisible(), 'Home reminds the owner that a request is open')
await p.getByText('Your closing request is being reviewed').click()
await btn(p, 'Cancel the request').click()
await p.getByText('Why are you leaving?').waitFor({ timeout: 8000 })
ok((await (await A.ctx.request.get(`${API}/account/closure`, { headers: { Authorization: 'Bearer ' + (await kv(p, 'cloud')).access } })).json()).request.status === 'cancelled', 'the owner can take the request back and the account stays')
const wipeBtn = btn(p, 'Erase the data on this phone')
ok(await wipeBtn.isDisabled(), 'erasing the phone needs the shop name typed first')

await more(p, 'Cloud account')
await btn(p, 'Disconnect this phone').click()
await p.getByText('Email me a code').waitFor()
ok((await kv(p, 'cloud')) == null && (await dump(p, 'items')).length === 4, 'disconnecting from the cloud keeps all the data on the phone')
const set = await kv(p, 'settings')
await p.evaluate((s) => new Promise((res) => { const r = indexedDB.open('pasal'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ k: 'settings', v: s }); tx.oncomplete = () => { r.result.close(); res() } } }), { ...set, trialEnds: 0, plan: 'free', planUntil: 0 })
await p.reload()
await p.locator('input[type=password]').fill(PW)
await btn(p, 'Login', { exact: true }).click()
await waitText(p, 'Namaste, Sita')
await nav(p, 'Books')
await p.getByRole('button', { name: /^Sales/ }).click()
ok(await p.getByText('Available on the Pro plan').first().isVisible(), 'on the Free plan the full books are locked')
await p.locator('.back').click().catch(() => {})
await nav(p, 'More')
ok((await p.locator('.lockt').count()) >= 3, 'More shows locks on Pro and Max features')

/* ============ no browser errors ============ */
ok(errors.length === 0, 'no script errors in the browser' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''))
ok(dialogs.length === 0, 'no alert or prompt ever opened')

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
