# Pocket Pasal (web app, installable)

Offline-first POS, inventory and khata app for small shops in Nepal. React + TypeScript + Dexie (IndexedDB), PWA.

## Run
    npm install
    npm run dev        # http://localhost:5173
    npm run build      # output in dist/, host it on any HTTPS static host

## Install on Android
Host `dist/` on HTTPS (Cloudflare Pages, Netlify, ...). Open it in Chrome, menu, "Install app".
iPhone: Safari, Share, "Add to Home Screen".

## What works now (phase 1, all on the phone, no server)
Setup and login (Owner / Staff), items with photo and barcode, best-seller-first search, sales (cash, QR confirm, card, credit),
VAT tax invoice / cash receipt, BS/AD dates, Nepali/English, returns (credit note), purchases, khata ledger, day book / sales book /
VAT summary, orders to suppliers (WhatsApp / Messenger / Email / call links), plans with locks, 14-day Max trial, module switches,
ESC/POS Bluetooth printing (Android Chrome), PDF/Share, backup and restore (JSON).

## Not built yet (needs a server or provider accounts)
Cloud sync and conflict review, email OTP, real subscription payment, Fonepay / eSewa / Khalti dynamic QR, CCTV live view
(needs an MJPEG/snapshot URL), delivery partners, multi-shop.
Every local write is already recorded in the `outbox` table for the future sync step.

## Plan switch for testing
In `npm run dev` the Plans screen has DEV buttons to switch plan. In a production build they are hidden.

## Cloud (phase 2)
The server is in `../server` (see its README). Run it, then in the app: More, Cloud account, enter the owner password,
get the email code, Connect. A new phone uses "I already have an account" on the first screen.
Set the server address for production builds with `VITE_API_URL`.

## Categories, search and staff permissions
- Items have categories (a row of buttons on the Sale and Items screens). Lists show 40 at a time with "Show more".
- Search works from an English keyboard on Nepali names: `chini`, `tel`, `chamal`, `dudh`, `wai` all find the Nepali items
  (`roman()` and `loose()` in `src/logic.ts`). Names that start with the typed letters come first, then best sellers.
- Owner and staff can share one phone: More, "Switch user". The owner sets each staff member's permissions in More, Staff.
  Permissions are enforced by the app on the phone, not by the server.
- Setup uses pick lists for shop type (14 kinds), province and district (all 7 provinces and 77 districts).
