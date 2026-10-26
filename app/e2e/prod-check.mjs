// Opens the LIVE website in Chrome: sets up a throw-away shop on this browser only (nothing is sent to the server),
// sells once, goes offline, reloads, and checks the app still opens.   SITE=https://... node e2e/prod-check.mjs
import { chromium } from 'playwright-core'
const SITE = process.env.SITE
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!SITE) { console.error('Set SITE'); process.exit(2) }
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 820 } })
const page = await ctx.newPage()
const bad = []
page.on('pageerror', (e) => bad.push(e.message))
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) bad.push(m.text().slice(0, 120)) })
await page.goto(SITE)
ok((await page.title()).includes('Pocket Pasal'), 'the live site opens')
await page.getByRole('button', { name: 'English', exact: true }).click()
await page.getByLabel('Shop name').fill('Live Check Shop')
await page.getByRole('button', { name: 'Next', exact: true }).click()
await page.getByLabel('Email', { exact: true }).fill('live-check@example.com')
await page.getByLabel('Password', { exact: true }).fill('live-check-pass-1')
await page.getByLabel('Repeat password').fill('live-check-pass-1')
await page.getByRole('button', { name: 'Start my shop' }).click()
await page.getByText('Namaste').waitFor({ timeout: 15000 })
await page.getByRole('button', { name: /Sell/ }).first().click()
await page.locator('.card').first().click()
await page.getByRole('button', { name: /^Pay/ }).click()
await page.getByRole('button', { name: 'Exact' }).click()
await page.getByRole('button', { name: 'Create bill' }).click()
await page.getByText('Saved').first().waitFor()
ok(true, 'a sale works on the live site')
// the app must still open with no internet
await page.evaluate(() => navigator.serviceWorker.ready)
await page.waitForTimeout(2500)
await ctx.setOffline(true)
await page.reload()
await page.locator('input[type=password]').waitFor({ timeout: 15000 })
ok(true, 'with no internet the installed app still opens (offline files are cached)')
await page.locator('input[type=password]').fill('live-check-pass-1')
await page.getByRole('button', { name: 'Login', exact: true }).click()
await page.getByText('Namaste').waitFor({ timeout: 10000 })
ok(true, 'and you can log in and use it offline')
await ctx.setOffline(false)
// cloud connect should say plainly that email is not set up yet (if it is not)
await page.locator('.nav button', { hasText: 'More' }).click()
await page.locator('.body .item.tap', { hasText: 'Cloud account' }).click()
await page.getByLabel('Owner password of this app').fill('live-check-pass-1')
await page.getByRole('button', { name: 'Email me a code' }).click()
const msg = await Promise.race([
  page.getByText('email service is not ready').waitFor({ timeout: 15000 }).then(() => 'not-ready'),
  page.getByPlaceholder('______').waitFor({ timeout: 15000 }).then(() => 'code-box'),
]).catch(() => 'nothing')
ok(msg === 'not-ready' || msg === 'code-box', 'asking for a code gives a clear answer (' + msg + ')')
ok(bad.length === 0, 'no script errors or policy violations on the live site' + (bad.length ? ': ' + bad[0] : ''))
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
