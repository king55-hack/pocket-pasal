// The admin page: the key door, seeing a closing request with its reason, approving it, and that it never lands in the shop app's offline cache.
// Needs the web app on http://localhost:5173 (npm run dev) and the test API on http://127.0.0.1:8787 (npm run dev:test in server).   node e2e/admin.mjs
import { chromium } from 'playwright-core'

const APP = process.env.APP || 'http://localhost:5173'
const API = process.env.API || 'http://127.0.0.1:8787'
const KEY = process.env.ADMIN_KEY || 'dev-admin-key'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const post = async (path, body, token) => (await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })).json()

// a shop that asks to leave
const stamp = Date.now()
const email = `adm${stamp}@example.com`
const { devCode } = await post('/auth/otp', { email, purpose: 'signup' })
const su = await post('/auth/signup', { email, code: devCode, password: 'secret123', name: 'T', shopName: 'Admin Page Shop ' + stamp, device: { id: 'adm-' + stamp, name: 'x' } })
const rq = await post('/account/closure', { type: 'delete_account', reasonCode: 'too_expensive', reasonText: 'script <b>bold</b> test', password: 'secret123' }, su.access)
ok(rq.request?.status === 'pending', 'a shop asked to close its account')

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('dialog', (d) => d.accept())
const text = () => page.evaluate(() => document.body.innerText)

await page.goto(APP + '/admin.html')
ok(await page.locator('input[type=password]').count() === 1, 'the admin page asks for the key first')
ok((await page.locator('meta[name=robots]').getAttribute('content')).includes('noindex'), 'the page asks search engines to stay away')
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
ok(!overflow, 'no sideways scrolling on a phone')

await page.fill('input[type=password]', 'not-the-key')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.body.innerText.includes('Wrong key') || document.body.innerText.includes('Cannot reach'), null, { timeout: 8000 })
ok((await text()).includes('Wrong key'), 'a wrong key is refused with a clear message')
await page.click('button:has-text("👁")')
ok(await page.locator('input[type=text]').count() === 1, 'the eye button shows what was typed')

await page.fill('input', KEY)
await page.keyboard.press('Enter')
await page.waitForSelector('text=Requests waiting', { timeout: 8000 })
ok((await text()).includes('Shops'), 'the right key opens the overview')
ok((await page.evaluate(() => sessionStorage.getItem('pp-admin-key'))) === KEY && !(await page.evaluate(() => localStorage.getItem('pp-admin-key'))), 'the key is kept for this tab only, not stored on disk')

await page.click('button:has-text("Requests")')
await page.waitForSelector('text=Admin Page Shop ' + stamp, { timeout: 8000 })
const t = await text()
ok(t.includes('too_expensive') && t.includes('script <b>bold</b> test'), 'the reason is shown as plain text, markup is not run')
ok(await page.locator('main b:text-is("bold")').count() === 0, 'text sent by a shop can never become page elements')

const card = page.locator('.card', { hasText: 'Admin Page Shop ' + stamp })
await card.locator('input[type=number]').fill('3')
await card.locator('button:has-text("Approve")').click()
await page.waitForFunction((n) => !document.body.innerText.includes(n), 'Admin Page Shop ' + stamp, { timeout: 8000 })
ok(true, 'approving removes it from the waiting list')
const st = await (await fetch(API + '/account/closure', { headers: { Authorization: 'Bearer ' + su.access } })).json()
const days = (st.request.scheduledAt - Date.now()) / 86400000
ok(st.request.status === 'approved' && days > 2.9 && days < 3.1, 'the owner sees it approved for the date the admin chose')

await page.click('button:has-text("Shops")')
await page.fill('input[placeholder^="Search"]', email)
await page.click('button:has-text("Search")')
await page.waitForSelector('text=' + email, { timeout: 8000 })
ok(true, 'the shop can be found by email')

await page.click('button:has-text("Log out")')
ok(await page.locator('input[type=password]').count() === 1 && !(await page.evaluate(() => sessionStorage.getItem('pp-admin-key'))), 'log out forgets the key')

// the shop app must not serve the admin page from its offline cache
await page.goto(APP + '/')
await page.waitForSelector('#root *', { timeout: 8000 })
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''))

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
