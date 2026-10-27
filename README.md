# Pocket Pasal · पकेट पसल

POS, stock and khata (credit) app for small shops in Nepal. It works without internet and syncs when the phone is online.
Runs in any browser and installs on Android like an app (a PWA). Nepali first, English second, Bikram Sambat dates.

> All rights reserved. This repository is public so the work can be read and checked. It is not licensed for reuse or resale.

## Live
- App: https://pocket-pasal.dahal-khani.workers.dev (open it on Android Chrome, menu, Install app)
- API: https://pocket-pasal-api.dahal-khani.workers.dev
- The app works fully on the phone without the server. Cloud sync and login need the email sender (Resend) to be connected first, see below.

## What it does
- Sell: search or camera barcode scan (works on iPhone too), type the amount the customer gave and see the change, put the rest on baki, tax invoice (13% VAT) or cash receipt, cash / QR / card / credit, split into categories, best sellers first.
- Search that works from an English keyboard on Nepali names (`chini`, `tel`, `dudh`, `wai`).
- Stock, categories, purchases from suppliers, returns (credit notes), low-stock order list with WhatsApp / Messenger / email / call buttons.
- Khata: customer and supplier ledgers, day book, sales book, VAT summary, CSV export.
- Bills can be sent as PDF, shared, or emailed to the customer (the owner can switch these buttons off in Settings). Books and ledger go to Excel for the PC.
- Print on any ESC/POS thermal printer (58 mm / 80 mm over Bluetooth) or A4/A5 through PDF. Nepali text prints correctly because the bill is sent as a picture.
- Owner and staff on one phone or several. The owner chooses what each staff member may do.
- Cloud backup and sync between phones, email-code login (no SMS cost), lost phones can be cut off.
- QR payments: the shop's own QR picture, or an exact-amount QR through Khalti and eSewa (Fonepay needs a bank agreement, see below).
- Plans: Free, Pro, Max, with a 14-day Max trial.

## Folders
| | |
|---|---|
| `app/` | The web app (React, TypeScript, IndexedDB). Unit tests in `src/tests`, browser tests in `e2e/`. |
| `server/` | The API (Hono on Cloudflare Workers, D1 database): login, email codes, sync, payments, plans. Tests in `test/`. |
| `docs/` | Design document and the early wireframes and prototypes. |

## Run it on your computer
```bash
# 1. API
cd server && npm install
cp .dev.vars.example .dev.vars        # local test secrets only
npx wrangler d1 migrations apply pasal --local
npm run dev:test                      # http://127.0.0.1:8787

# 2. App (another terminal)
cd app && npm install && npm run dev  # http://localhost:5173
```

## Tests
| Command | What it checks |
|---|---|
| `cd app && npm test` | 50 unit tests: money and VAT, search, change and baki, stock, returns, ledgers, sync merging, permissions, Excel and PDF files, Open Food Facts lookups, Nepal places |
| `cd server && npm test` | API checks (login and codes, sync rules, payments, emailing bills, closing accounts and the admin, attack-style security) and 10 unit tests for the email builder |
| `cd app && node e2e/mobile.mjs` | iPhone, Android and iPad sizes: no sideways scroll, no zoom-on-tap, readable bill and cart, editing items, back buttons, two businesses on one phone |
| `cd app && node e2e/admin.mjs` | The admin page: key door, a closing request with its reason, approve, search, log out |
| `cd app && node e2e/shop2.mjs` | 71 browser checks: a new pharmacy end to end, photos, typed amount and baki, PDF, email, Excel, a second phone, offline sale, cloud, QR, staff, backup, plan locks |
| `cd app && npm run build:prod && node e2e/security.mjs` | 20 front-end security checks under the strict content policy, including reading a barcode with a (fake) camera using the same reader iPhones use |
| `API=… ORIGIN=… node server/test/prod-smoke.mjs` and `SITE=… node app/e2e/prod-check.mjs` | Safe checks of the live API and the live site (they create no account) |

The browser tests drive a real Chrome (`CHROME=/path/to/chrome`) and need the API and the app running as above.
GitHub Actions runs all of them on every push (`.github/workflows/ci.yml`).

## Put it online (Cloudflare)
See [server/README.md](server/README.md). In short: `wrangler d1 create`, set three secrets, `wrangler deploy`, then build the app with
`VITE_API_URL=<api address> npm run build:prod` and publish `app/dist` to Cloudflare Pages (it includes the `_headers` file with the security policy).
Emails need a sender: either Resend (`npx wrangler secret put RESEND_API_KEY` and a verified `MAIL_FROM`) or a Gmail account (four secrets, steps in [server/README.md](server/README.md)). Until then the API answers "email service is not ready" instead of pretending a code was sent.
The website is a Workers static-assets deployment (`app/wrangler.toml`): `cd app && VITE_API_URL=<api> npm run build:prod && npx wrangler deploy`.

## Security in short
- Passwords and PINs are stored as salted PBKDF2 hashes. Login codes expire in 10 minutes, allow 5 guesses and are sent by email.
- API tokens last 15 minutes, refresh tokens rotate, a revoked phone is refused at once, and each shop can only reach its own data.
- Merchant keys for Khalti / eSewa are encrypted on the server and never sent back to a phone. Payment results are always checked with the provider.
- The web app runs under a content policy that allows only its own scripts and its own API, cannot be framed, sets no cookies, and ships no source maps.
- Backups never contain login tokens.

## Credits
- Product names and pictures for sample items come from [Open Food Facts](https://world.openfoodfacts.org) (data ODbL, pictures CC BY-SA), looked up live by barcode.
- Province, district, municipality and ward counts come from [local-states-nepal](https://github.com/sagautam5/local-states-nepal) by Sagar Gautam (MIT licence).
- Barcode reading on iPhone uses ZXing.

## Known limits
- Barcodes of sample items are only filled in when the live lookup confirms them; the same product can carry a different code in another pack or market, so check against your own stock.
- Staff permissions are enforced by the app on the phone, not by the server. Anyone who can read a phone's stored data could get around them.
- A 4-digit staff PIN stored as a hash can be guessed offline by someone who copies the phone's data. Use longer PINs.
- The server can read shop data (it is encrypted in transit and at rest, but it is not end-to-end encrypted).
- Fonepay exact-amount QR is not built: the API is only given to merchants by their bank. Khalti and eSewa are built from their public documents and still need one test payment each in their sandbox.
- Bluetooth printing needs Android Chrome. iPhone browsers cannot do it; use PDF or share.
- Password reset by email is not built yet. Rules for VAT bills (numbering, IRD approval) must be checked with an accountant before real use.
- `npm audit` reports problems only in Wrangler's local development tools, not in the code that is deployed.
