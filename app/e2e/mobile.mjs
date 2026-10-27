// Phones and tablets: no sideways overflow, no surprise zoom (boxes at 16px), readable bill, visible cart, editing an item,
// back buttons, language switch, two businesses on one phone, and starting from a backup file.
// Needs the web app on http://localhost:5173 (npm run dev).   node e2e/mobile.mjs
import { chromium } from 'playwright-core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP = process.env.APP || 'http://localhost:5173'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const errors = []

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
const ANDROID = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' }
const IPAD = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// Open Food Facts is mocked, so the test does not depend on the internet or on volunteers' data
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxoAAAAAElFTkSuQmCC', 'base64')
const OFF = {
  8908002377217: { product_name: 'RARA Instant Noodles', brands: 'Him-Shree Foods (P.) Ltd.', countries_tags: ['en:nepal'], image_front_url: 'https://images.openfoodfacts.org/images/test/rara.png' },
  8906013030015: { product_name: 'WAI WAI', brands: 'CG Foods', image_front_url: 'https://images.openfoodfacts.org/images/test/wai.png' },
  8901719134845: { product_name: 'Parle-G Biscuit', brands: 'Parle', quantity: '45 g', image_front_url: 'https://images.openfoodfacts.org/images/test/parle.png' },
}
const offCalls = []
async function mockOff(ctx) {
  const cors = { 'access-control-allow-origin': '*' }
  await ctx.route('https://world.openfoodfacts.org/api/v2/product/**', (r) => {
    const code = /product\/(\d+)\.json/.exec(r.request().url())?.[1]
    offCalls.push(code)
    r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(OFF[code] ? { status: 1, product: OFF[code] } : { status: 0, status_verbose: 'product not found' }) })
  })
  await ctx.route('https://images.openfoodfacts.org/**', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PNG }))
}
async function open(profile) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...profile })
  await mockOff(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP)
  return { ctx, page }
}
const btn = (p, name, o = {}) => p.getByRole('button', { name, exact: o.exact ?? false })
const nav = (p, name) => p.locator('.nav button', { hasText: name }).click()
const dump = (page, table, db = 'pasal') => page.evaluate(([t, d]) => new Promise((res, rej) => {
  const q = indexedDB.open(d); q.onerror = () => rej(q.error)
  q.onsuccess = () => { const r = q.result.transaction(t).objectStore(t).getAll(); r.onsuccess = () => { q.result.close(); res(r.result) } }
}), [table, db])
async function more(p, label) { await nav(p, 'More'); await p.locator('.body .item.tap', { hasText: label }).first().click() }

/** Nothing may be wider than the screen, and every text box must be at least 16px so iPhone does not zoom in. */
async function layoutOk(p, label) {
  const r = await p.evaluate(() => ({
    over: document.documentElement.scrollWidth - innerWidth,
    bodyOver: Math.max(0, ...[...document.querySelectorAll('.app, .body')].map((e) => e.scrollWidth - e.clientWidth)),
    small: [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')].filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.placeholder || e.getAttribute('aria-label') || e.tagName) + ':' + getComputedStyle(e).fontSize),
  }))
  ok(r.over <= 1 && r.bodyOver <= 1, `${label}: nothing is wider than the screen` + (r.over > 1 || r.bodyOver > 1 ? ` (over by ${r.over}/${r.bodyOver})` : ''))
  ok(r.small.length === 0, `${label}: every text box is 16px or more` + (r.small.length ? ' ' + r.small.join(', ') : ''))
}

/* ===== iPhone 14: set up a kirana, then visit the screens ===== */
let { ctx, page: p } = await open(IPHONE)
await btn(p, 'नेपाली', { exact: true }).click()
await layoutOk(p, 'iPhone setup 1')
// language can be changed on every step, and there is a way back
await p.getByRole('button', { name: 'English', exact: true }).first().click()
ok(await p.getByText('Your shop').isVisible(), 'language can be changed in the middle of setup')
await btn(p, 'Back').click()
ok(await p.getByText('Choose your language').isVisible() || await p.getByText('भाषा छान्नुस्').isVisible(), 'the Back button goes to the language page')
await btn(p, 'English', { exact: true }).click()
await p.getByLabel('Shop name').fill('Ram Kirana')
await layoutOk(p, 'iPhone setup 2')
await btn(p, 'Next', { exact: true }).click()
await btn(p, 'Back').click()
ok((await p.getByLabel('Shop name').inputValue()) === 'Ram Kirana', 'going back keeps what was typed')
await btn(p, 'Next', { exact: true }).click()
await p.getByLabel('Email', { exact: true }).fill('ram@example.com')
await p.getByLabel('Password', { exact: true }).fill('mobile-pass-1')
await p.getByLabel('Repeat password').fill('mobile-pass-1')
await layoutOk(p, 'iPhone setup 3')
await btn(p, 'Start my shop').click()
await p.getByText('Namaste').waitFor()
await layoutOk(p, 'iPhone home')

for (const tab of ['Sale', 'Items', 'Books']) { await nav(p, tab); await sleep(300); await layoutOk(p, 'iPhone ' + tab) }
for (const [label, name] of [['Parties', 'Parties'], ['Item categories', 'Categories'], ['Staff', 'Staff'], ['Cloud account', 'Cloud'], ['QR payment setup', 'QR setup'], ['Plan and subscription', 'Plans'], ['Settings', 'Settings'], ['Switch or add business', 'Businesses']]) {
  await more(p, label); await sleep(250); await layoutOk(p, 'iPhone ' + name)
}

/* ===== sample items: real barcode and photo from the web, and a small picture for the rest ===== */
await nav(p, 'Items')
const gotRara = await (async () => { for (let i = 0; i < 40; i++) { const x = (await dump(p, 'items')).find((q) => q.nameEn === 'Rara noodles'); if (x?.barcode && x?.photo) return x; await sleep(250) } return null })()
ok(!!gotRara && gotRara.barcode === '8908002377217' && gotRara.photo.startsWith('data:image/jpeg'), 'right after setup the Rara item got its real barcode and picture (when online)')
const itemsNow = await dump(p, 'items')
ok(itemsNow.find((q) => q.nameEn === 'Wai Wai noodles')?.barcode === '8906013030015' && itemsNow.find((q) => q.nameEn === 'Parle-G biscuit')?.barcode === '8901719134845', 'so did Wai Wai and Parle-G')
ok(!itemsNow.find((q) => q.nameEn === 'Sugar 1kg').barcode && !itemsNow.find((q) => q.nameEn === 'Dhaara oil 1L').barcode, 'items the web list does not know are left alone')
const icons = await p.locator('.item.tap .photo span').allInnerTexts()
ok(icons.length > 5 && icons.some((x) => ['🌾', '🫙', '🍵', '🥤', '🧼', '🥛', '🛒'].includes(x)), 'items with no photo show their category picture, not a plain box: ' + [...new Set(icons)].join(' '))
ok((await p.locator('.item.tap .photo img').count()) >= 3, 'items with photos show them')

/* ===== a new item can be filled from its barcode ===== */
await btn(p, '+ New').click()
await p.getByLabel('Barcode').fill('8901719134845')
await p.getByRole('button', { name: /Find name and photo/ }).click()
await p.getByText('Found:').waitFor({ timeout: 8000 })
ok((await p.getByPlaceholder('Name (English)').inputValue()) === 'Parle-G Biscuit' && (await p.locator('button.photo img').count()) === 1, 'typing a barcode finds the name and the photo on the web')
ok(await p.getByText('Open Food Facts').first().isVisible(), 'the source is named on screen')
await p.getByLabel('Barcode').fill('1234567890128')
await p.getByRole('button', { name: /Find name and photo/ }).click()
await p.getByText('not found online').waitFor({ timeout: 8000 })
ok(true, 'an unknown barcode says so and leaves the form alone')
await p.locator('.back').click()

/* ===== cart is easy to see ===== */
await nav(p, 'Sale')
for (let i = 0; i < 3; i++) await p.locator('.card').nth(i).click()
const cart = await p.locator('.cart').evaluate((e) => ({ w: e.getBoundingClientRect().width, name: parseFloat(getComputedStyle(e.querySelector('.nm')).fontSize), btn: e.querySelector('.qty button').getBoundingClientRect().height, border: getComputedStyle(e).borderTopWidth, total: parseFloat(getComputedStyle(e.querySelector('.cart-total')).fontSize) }))
ok(cart.name >= 17 && cart.btn >= 40 && cart.total >= 22 && cart.border === '2px', `the cart has big text (${cart.name}px), big +/- buttons (${Math.round(cart.btn)}px) and a clear border`)
await p.locator('.card').nth(5).scrollIntoViewIfNeeded()
await p.locator('.body').evaluate((e) => { e.scrollTop = 400 })
ok(await p.locator('.cart').isVisible() && (await p.locator('.cart').boundingBox()).y < 120, 'the cart stays at the top while the item list scrolls')
await layoutOk(p, 'iPhone sale with cart')

/* ===== the bill is readable ===== */
await p.getByRole('button', { name: /^Pay/ }).click()
await p.getByLabel('Amount the customer gave (Rs)').fill('1000')
await layoutOk(p, 'iPhone payment')
await btn(p, 'Create bill').click()
await p.getByText('Saved').first().waitFor()
for (const paper of ['58mm', '80mm', 'A4/A5']) {
  await btn(p, paper, { exact: true }).click(); await sleep(300)
  const img = await p.locator('.receipt img').evaluate((i) => ({ shown: i.getBoundingClientRect().width, natural: i.naturalWidth }))
  ok(img.shown >= 300 && img.natural >= 700, `${paper} bill on screen is ${Math.round(img.shown)} px wide and sharp (${img.natural} px picture), easy to read`)
}
await layoutOk(p, 'iPhone bill')

/* ===== an existing item opens and saves (it used to show a blank screen) ===== */
await nav(p, 'Items')
await p.locator('.item.tap').first().click()
await p.getByLabel('Price').waitFor({ timeout: 5000 })
ok(true, 'tapping an item opens its edit screen')
await layoutOk(p, 'iPhone item edit')
await p.getByLabel('Price').fill('31')
await btn(p, 'Save', { exact: true }).click()
await p.getByText('Saved').first().waitFor()
const items = await dump(p, 'items')
ok(items.some((i) => i.price === 31), 'the new price was saved')
ok(errors.length === 0, 'no script errors on the phone' + (errors.length ? ': ' + errors[0] : ''))

/* ===== a second business on the same phone ===== */
await more(p, 'Switch or add business')
await btn(p, 'Add another business').first().click()
await p.getByText('भाषा छान्नुस्').waitFor({ timeout: 10000 }) // a new business starts in Nepali
ok(await p.getByText('Ram Kirana').isVisible(), 'the new business page also lists the first business')
await btn(p, 'English', { exact: true }).click()
await p.getByLabel('Shop name').fill('Hari Shoes')
await p.getByLabel('Shop type').selectOption('jutta')
await btn(p, 'Next', { exact: true }).click()
await p.getByLabel('Email', { exact: true }).fill('hari@example.com')
await p.getByLabel('Password', { exact: true }).fill('second-pass-1')
await p.getByLabel('Repeat password').fill('second-pass-1')
await btn(p, 'Start my shop').click()
await p.getByText('Namaste').waitFor()
const dbs = (await p.evaluate(() => indexedDB.databases())).map((d) => d.name).filter((n) => n.startsWith('pasal'))
ok(dbs.length === 2, 'two separate databases exist: ' + dbs.join(', '))
const second = dbs.find((n) => n !== 'pasal')
ok((await dump(p, 'items', second)).length === 0 && (await dump(p, 'items', 'pasal')).length === 20, 'the shoe shop has no items and the kirana still has its 20 (nothing mixed)')
// switch back to the kirana
await more(p, 'Switch or add business')
await p.locator('.item.tap', { hasText: 'Ram Kirana' }).click()
await p.locator('input[type=password]').waitFor({ timeout: 10000 })
ok(await p.getByText('Ram Kirana').first().isVisible(), 'switching opens the other business at its own login')
await p.locator('input[type=password]').fill('wrong-password')
await btn(p, 'Login', { exact: true }).click()
await p.getByText('Wrong password').waitFor()
await p.locator('input[type=password]').fill('mobile-pass-1')
await btn(p, 'Login', { exact: true }).click()
await p.getByText('Namaste').waitFor()
ok((await dump(p, 'items', 'pasal')).find((i) => i.price === 31) !== undefined, 'back in the kirana, the edited price is still there')
// the business list is also on the login screen
await nav(p, 'More')
await btn(p, 'Switch user').click()
ok(await p.getByText('Businesses on this phone').isVisible(), 'the login screen lists both businesses')

/* ===== start from a backup file on a new phone ===== */
await p.locator('input[type=password]').fill('mobile-pass-1')
await btn(p, 'Login', { exact: true }).click()
await p.getByText('Namaste').waitFor()
await more(p, 'Settings')
const [dl] = await Promise.all([p.waitForEvent('download'), btn(p, 'Download backup').click()])
const file = join(mkdtempSync(join(tmpdir(), 'pasal-')), 'backup.json')
await dl.saveAs(file)
await ctx.close()
{
  const n = await open(ANDROID)
  await n.page.locator('input[type=file][accept="application/json"]').setInputFiles(file)
  await n.page.locator('input[type=password]').waitFor({ timeout: 10000 })
  ok(await n.page.getByText('Ram Kirana').first().isVisible(), 'a new phone can start from the backup file')
  await n.page.locator('input[type=password]').fill('mobile-pass-1')
  await btn(n.page, 'लगइन', { exact: true }).or(btn(n.page, 'Login', { exact: true })).first().click()
  await n.page.getByText(/Namaste|नमस्ते/).waitFor()
  ok((await dump(n.page, 'items')).length === 20, 'and all 20 items are there')
  await layoutOk(n.page, 'Android home')
  await nav(n.page, 'Sale'); await sleep(300); await layoutOk(n.page, 'Android sale')
  await n.ctx.close()
}

/* ===== iPad ===== */
{
  const n = await open(IPAD)
  await n.page.locator('input[type=file][accept="application/json"]').setInputFiles(file)
  await n.page.locator('input[type=password]').waitFor({ timeout: 10000 })
  await n.page.locator('input[type=password]').fill('mobile-pass-1')
  await btn(n.page, 'Login', { exact: true }).or(btn(n.page, 'लगइन', { exact: true })).first().click()
  await n.page.getByText(/Namaste|नमस्ते/).waitFor()
  await nav(n.page, 'Sale'); await sleep(400)
  const cols = await n.page.locator('.grid2').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)
  const width = await n.page.locator('.app').evaluate((e) => e.getBoundingClientRect().width)
  ok(cols >= 3 && width >= 700, `on an iPad the items use ${cols} columns and the app is ${Math.round(width)} px wide`)
  await layoutOk(n.page, 'iPad sale')
  await n.ctx.close()
}

ok(offCalls.every((c) => /^\d{8,14}$/.test(c)), 'only barcodes were sent to Open Food Facts: ' + [...new Set(offCalls)].join(','))
ok(errors.length === 0, 'no script errors anywhere' + (errors.length ? ': ' + errors[0] : ''))
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
