# Pocket Pasal: Design Document v2.1

POS and inventory app for small shops in Nepal. First release is a **web app (PWA)** that runs on any phone, tablet or computer and installs on Android like a normal app. Works fully offline, syncs when online. See section 8 for what changed in v2.1.

| | |
|---|---|
| Status | Draft for client verification |
| Replaces | Wireframe v1, Design v2 |
| Date | 2083 Kartik 9 (2026-10-26) |

---

## 0. Decisions and items to confirm

These points change the cost or the legal standing of the app, so please confirm them first.

| # | Topic | What we will do | What the client must confirm |
|---|---|---|---|
| 1 | Printing | Universal **ESC/POS** commands over Bluetooth, USB and Wi-Fi/LAN. 58mm and 80mm. A4/A5 through the system PDF print. | Which printer model the shop has, for testing. |
| 2 | Network security | **HTTPS (TLS 1.2+ / 1.3)** to the server, certificate pinning, encrypted local database, field-level encryption for sensitive data. No VPN (VPN is costly and not needed for this app). | None. |
| 3 | "End-to-end" encryption | Data is encrypted on the phone, in transit and at rest on the server (see section 5.4). A zero-knowledge model, where even the server cannot read data, is possible but blocks cloud reports, password recovery and support. | Standard encryption (recommended), or zero-knowledge. |
| 4 | VAT and IRD | 13% VAT, PAN/VAT fields, sequential invoice numbers, tax invoice layout. | A VAT-registered shop must use IRD-approved billing software, and many must report to IRD's CBMS. **Check with an accountant or IRD before launch whether this app must be registered/approved.** We design for it but cannot promise approval. |
| 5 | Dynamic QR | Server creates a QR for the exact bill amount using each provider's merchant API. | The shop needs a **merchant account** with Fonepay, eSewa and Khalti, and API access. Providers decide approval and fees. Needs internet. |
| 6 | CCTV | Live view of cameras on the same Wi-Fi (RTSP/ONVIF). | Camera brands and whether they support RTSP. Remote viewing from outside the shop is a later phase. |
| 7 | Email OTP | Used for sign-up and high-risk actions. | Offline, OTP cannot be sent. See section 3.4 for how this is handled. |
| 8 | Delivery partners | Placeholders only (Pathao, Upaya and others). | Whether any partner has a public API. Contact them later. |

---

## 1. Roles and access (RBAC)

Two login flows, two dashboards.

| Action | Staff (कर्मचारी) | Owner (मालिक) |
|---|:--:|:--:|
| Make a sale, print a bill | ✔ | ✔ |
| Scan barcode | ✔ | ✔ |
| See items and stock | ✔ | ✔ |
| Cost price and profit | ✘ | ✔ |
| Edit price or give discount | Limit set by owner | ✔ |
| Cancel a bill | ✘ (request only) | ✔ |
| Return / refund | Needs owner approval (PIN or OTP) | ✔ |
| Credit (baki) | If owner enables | ✔ |
| Purchase entry | If owner enables | ✔ |
| Books and ledger | ✘ | ✔ |
| Reports and export | ✘ | ✔ |
| CCTV | If owner enables | ✔ |
| Settings, staff, printer, QR | ✘ | ✔ |

Rules:
- Each staff member has their own login and PIN. Every record stores who created it.
- The owner sets a per-staff maximum discount percent and can switch off any permission.
- Staff data on a lost phone can be wiped remotely by the owner (revoke the device).

---

## 2. Screen hierarchy

Nepali is the default. English is the second option. Calendar default is Bikram Sambat (BS), switchable to AD.

```
App
├── A. Onboarding
│   ├── A1 Language choice (नेपाली / English)
│   ├── A2 Welcome / Login: Owner | Staff
│   ├── A3 Owner sign-up (email, password)
│   ├── A4 Email OTP verify
│   ├── A5 Shop setup 1: name, company, type, PAN/VAT, VAT registered Y/N
│   ├── A6 Shop setup 2: province, district, municipality, ward, map pin
│   ├── A7 Feature choice (modules ON/OFF, see D)
│   ├── A8 Sample items (kirana starter list with photos)
│   └── A9 Printer setup (optional)
│
├── B. Owner dashboard (मालिक)
│   ├── B1 Home: today's sales, profit, cash in hand, low stock, credit due
│   ├── B2 Sales (नयाँ बिक्री): see section 2.1
│   ├── B3 Items (सामान)
│   │   ├── Item list, search, filters
│   │   ├── Item add/edit (photo, barcode, prices, VAT, unit, min stock, supplier)
│   │   ├── Barcode scan to add
│   │   ├── Categories and units
│   │   └── Stock adjust (damage, count correction, with reason)
│   ├── B4 Purchases (खरिद): supplier bill entry, scan items in, payment status
│   ├── B5 Parties (पार्टी)
│   │   ├── Customers (ग्राहक)
│   │   ├── Suppliers (आपूर्तिकर्ता)
│   │   └── Party detail: ledger, contact buttons
│   ├── B6 Books (खाता)
│   │   ├── Day Book (दैनिक खाता)
│   │   ├── Sales Book (बिक्री खाता)
│   │   ├── Purchase Book (खरिद खाता)
│   │   ├── Ledger (लेजर)
│   │   ├── Cash / Bank / QR summary
│   │   └── VAT summary (monthly)
│   ├── B7 Orders (अर्डर): low stock list, make supplier order
│   ├── B8 Returns (फिर्ता)
│   ├── B9 CCTV (if ON)
│   ├── B10 Delivery (if ON, future)
│   ├── B11 Staff (कर्मचारी): add, permissions, activity log, revoke device
│   ├── B12 Settings (see D)
│   └── B13 Help: Report an issue / Contact developer
│
├── C. Staff dashboard (कर्मचारी)
│   ├── C1 Home: my sales today, my cash, quick buttons
│   ├── C2 New sale (same as B2)
│   ├── C3 Items (view only, stock)
│   ├── C4 My bills (today, reprint)
│   ├── C5 Return request (needs owner approval)
│   ├── C6 Credit / purchase / CCTV (only if owner allowed)
│   └── C7 Help: Report an issue
│
└── D. Settings (owner only)
    ├── D1 Shop profile and bill header/footer, logo
    ├── D2 Modules ON/OFF (section 2.2)
    ├── D3 Language and calendar (BS / AD)
    ├── D4 Tax: VAT on/off, rate, price includes VAT Y/N
    ├── D5 Invoice types and numbering
    ├── D6 Printer: Bluetooth/USB/LAN, 58/80mm, A4/A5, test print
    ├── D7 Payments: Cash, Fonepay, eSewa, Khalti, card; merchant keys
    ├── D8 Security: password, email OTP rules, biometric, devices, auto-lock
    ├── D9 Sync status, backup, restore
    ├── D10 Cameras (add IP camera)
    ├── D11 Delivery partners (placeholder)
    └── D12 Report an issue / About / Version
```

### 2.1 Sales screen set (B2 / C2)

```
Sales
├── Cart (scan or search, quantity, discount, notes)
├── Customer pick (walk-in, existing, new)
├── Invoice type: Tax Invoice (कर बीजक) | Cash Receipt (नगद भरपाई)
├── Payment: Cash | QR | Card | Credit | Split
│   └── Dynamic QR screen (amount, countdown, auto-confirm)
├── Success: Print | Share (WhatsApp/Messenger/Email) | PDF | New sale
└── Held bills (park a bill, resume later)
```

Sketch of the main sales screen:

```
┌──────────────────────────────┐
│ नयाँ बिक्री      ● अफलाइन   │
├──────────────────────────────┤
│ [ 🔍 खोज्नुस ]   [ ▮▮ स्क्यान ]│
├──────────────────────────────┤
│ [फोटो] वाईवाई नुडल्स          │
│        रु २५ × ४     रु १००  │
│ [फोटो] धारा तेल १ लिटर        │
│        रु २४५ × १    रु २४५  │
├──────────────────────────────┤
│ उप-जम्मा              रु ३४५ │
│ छुट                    रु ०  │
│ भ्याट (१३%)           रु ४४.८५│
│ कुल                 रु ३८९.८५│
├──────────────────────────────┤
│ [ होल्ड ]      [ भुक्तानी → ]│
└──────────────────────────────┘
```

### 2.2 Modular settings (owner toggles)

| Module | Default | When OFF |
|---|:--:|---|
| Credit / Baki (उधारो) | ON | No credit option at payment. Customer ledger hidden. |
| Purchases and suppliers | ON | Stock changes only by manual adjust. |
| VAT / Tax invoice | Depends on shop | Only cash receipts. No VAT fields. |
| Barcode scanner | ON | Search and tap only. |
| Returns | ON | Return screen hidden. |
| Staff accounts | OFF | Owner-only app. |
| CCTV | OFF | Hidden. |
| QR payments | ON | Cash only. |
| Delivery | OFF | Hidden. |
| Discounts | ON | Fixed price only. |
| Expiry tracking | OFF | No expiry field. |

Turning a module OFF hides screens and fields. It never deletes old data.

---

## 3. User flows

### 3.1 Login to checkout, online

```
Open app
  → Role: Owner or Staff
  → Email/phone + password  (Owner: Email OTP on new device)
  → Dashboard
  → नयाँ बिक्री
  → Scan barcode (camera) or search → item added, stock held
  → Repeat scanning; edit quantity; discount (within limit)
  → Pick customer (optional; required for Credit)
  → Pick invoice type: Tax Invoice or Cash Receipt
  → Pay
       Cash:    enter amount received → change shown
       QR:      server creates dynamic QR for exact amount
                → customer scans in their own app
                → provider callback → "भुक्तानी प्राप्त" → bill closes
       Card:    mark paid (card terminal is separate)
       Credit:  customer's ledger debit
  → Bill saved locally, then pushed to the server
  → Print (ESC/POS) | Share | PDF
  → Stock reduced, books updated automatically
```

### 3.2 Login to checkout, offline

```
Open app (no internet)
  → Login with PIN or biometric (device was already verified earlier)
  → Same sales flow; camera barcode scan works offline
  → Items, prices, stock all read from the local database
  → Pay:
       Cash:   works
       Credit: works
       Card:   works (manual mark)
       QR:     dynamic QR NOT available offline.
               Option A: show the shop's static QR; staff taps "Payment received";
                         bill is tagged "unverified QR" until synced.
               Option B: collect cash instead.
  → Bill number comes from this device's own series (section 5.3)
  → Print over Bluetooth/USB works offline
  → Everything is saved in the local encrypted database + outbox queue
  → Status bar: "अफलाइन · ७ बिल पर्खिरहेका"
When internet returns:
  → Outbox uploads in order
  → Server answers per record: accepted / conflict / rejected
  → Status: "सिंक पूरा"
```

### 3.3 Return and refund

```
Staff: B8 → find the original bill (scan bill QR or search by number/date)
  → pick items and quantity to return, choose reason
  → Staff requests; owner approves (PIN on same phone, or Email OTP remotely)
  → System makes a Credit Note linked to the original bill
  → Stock goes back (or to "damaged" if the reason says so)
  → Refund: cash out | back to QR/card | reduce customer's credit due
  → Ledger, Day Book, Sales Book and VAT summary update automatically
  → Print credit note
```

### 3.4 Email OTP, and what happens offline

| Action | Needs OTP | Offline behavior |
|---|:--:|---|
| Owner sign-up | Yes | Needs internet. |
| New device login | Yes | Needs internet. |
| Change email/password | Yes | Blocked offline. |
| Large refund, cancel bill, export data | Owner PIN | Works offline with PIN, logged, and flagged for review on sync. |
| Daily Staff/Owner login on a known device | No | PIN or biometric. |

Email is free to send. Rate limits (for example 5 OTPs per hour) stop abuse.

### 3.5 Other flows (short)

- **Purchase:** B4 → pick supplier → scan or search items → quantity and cost → paid or on credit → stock up, supplier ledger updated.
- **Low stock to order:** B7 lists items under minimum, grouped by supplier → order message → buttons: WhatsApp, Messenger, Email, Call.
- **Close the day:** B6 Day Book → opening cash + cash sales − expenses = expected cash → enter counted cash → difference recorded.

---

## 4. Feature notes per pillar

| # | Pillar | Design |
|---|---|---|
| 1 | Roles | Section 1. Role stored in the signed login token and checked again on the server. |
| 2 | Modules | Section 2.2. Settings stored per shop and synced. |
| 3 | Barcode | Camera scan (EAN-13, Code-128, QR). Unknown code → "add new item" with the code filled in. Beep and vibrate. Works offline. Can also accept a Bluetooth scanner that types as a keyboard. |
| 4 | Books | Day Book, Sales Book, Purchase Book, Ledger built from one **double-entry journal**, so totals always agree. Filter by BS date, export PDF/Excel. |
| 5 | VAT | 13% default. Price either includes or excludes VAT (setting). Per-item VAT or exempt flag. Round per invoice. Monthly VAT summary: output VAT (sales) − input VAT (purchases). Invoice shows: seller name, PAN, bill number, BS date, buyer name/PAN (if given), item lines, taxable amount, VAT, total, total in words. Layout and numbering rules must be checked against current IRD rules before launch. |
| 6 | Date and language | All dates stored in AD (UTC) and **shown** in BS by default using a verified BS conversion table. Numbers can display in Devanagari digits. Nepali text is written by a Nepali-language reviewer. No machine transliteration. |
| 7 | Printing | Section 4.1. |
| 8 | Supplier | Contact buttons use phone intents and deep links: `tel:`, `https://wa.me/<number>?text=...`, `mailto:`, Messenger link. They open the other app with the order text ready. |
| 9 | CCTV | Section 4.2. |
| 10 | QR | Section 4.3. |
| 11 | Security | Section 5.4. |
| 12 | Email OTP | Section 3.4. |
| 13 | Support | Form: category, message, optional screenshot, auto-attached app version, device model, last sync status, and a log (no customer data). Saved offline and sent when online. Ticket number is shown. |
| 14 | Delivery | Interface `DeliveryProvider` with `createOrder`, `track`, `cancel`, and a webhook for incoming orders. No partner is built in v1. |
| 15 | Returns | Section 3.3. |
| 16 | Invoice types | Tax Invoice (VAT, full details, own number series) and Cash Receipt (short, no tax claim, own series). Choice per sale, with a default in settings. |
| 17 | Offline-first | Section 5. |

### 4.1 Printing (ESC/POS, universal)

- App builds the receipt as ESC/POS bytes itself, so it works with any compatible thermal printer (Epson-style command set, which most 58mm/80mm Bluetooth printers follow).
- Connections: Bluetooth (classic SPP and BLE), USB (Android OTG), Wi-Fi/LAN (port 9100).
- Paper width setting: 58mm = 32 characters per line, 80mm = 48 characters.
- **Nepali text on thermal printers:** many printers have no Devanagari font and cannot shape conjunct letters. Solution: render the bill as an **image (raster)** and send it with the ESC/POS raster command. This prints correct Nepali on any printer. English-only bills can use fast text mode.
- A4/A5: bill is made as a PDF and sent through the phone's normal print service or shared.
- Settings: printer name, width, logo on/off, footer text, number of copies, cash drawer kick (optional), test print.
- If the printer is not connected, the bill is saved and "Print later" appears. Nothing blocks the sale.

### 4.2 CCTV (technically viable, with limits)

- Add camera: name, IP, port, username, password (stored encrypted on the phone).
- Live view over **RTSP** from the shop's local Wi-Fi. Grid of 1, 2 or 4 cameras. Sub-stream (low resolution) used to save data and battery.
- Phone and camera must be on the same network. Phones do not play RTSP natively, so a player library is used.
- Viewing from outside the shop needs port forwarding or a relay service, which has security risk and cost. Not in v1.
- No recording in the app. The camera's own recorder does that.

### 4.3 QR payments

```
Cashier taps "QR भुक्तानी"
  → App sends (bill id, amount) to our server (needs internet)
  → Server calls Fonepay / eSewa / Khalti merchant API
  → Provider returns a dynamic QR string for that exact amount
  → App draws the QR in-app (no external app opens)
  → Customer pays with any supported wallet or bank app
  → Provider sends a callback (webhook) to our server
  → Server verifies the signature and amount → marks bill paid
  → Phone gets a push or poll → "भुक्तानी प्राप्त ✔"
  → If the QR expires or the amount differs → not marked paid
```

Notes:
- Never trust the cashier's tap alone when online. The provider callback decides.
- Merchant keys live on the server only, never inside the app.
- Each provider has its own onboarding, fees and settlement time. This is a business step for the client, not just code.

---

## 5. Data architecture and sync

### 5.1 Overview

```
┌────────── Phone ──────────┐        HTTPS (TLS 1.3)        ┌────────── Cloud ──────────┐
│ UI (Flutter)              │ ───────────────────────────▶  │ API (login, sync, QR,     │
│ Business logic            │ ◀───────────────────────────  │  email OTP, support)      │
│ Local DB: SQLite          │     push changes / pull       │ PostgreSQL (main data)    │
│  (encrypted, SQLCipher)   │                               │ Object storage (photos)   │
│ Outbox queue              │                               │ Job queue (email, webhooks)│
└───────────────────────────┘                               └───────────────────────────┘
```

Suggested stack (one team, one codebase for Android and iOS): Flutter app, SQLite via Drift with SQLCipher, backend in Node.js or similar, PostgreSQL. This can change without changing the design.

### 5.2 Main tables (conceptual)

| Table | Key fields |
|---|---|
| shop | id, name, company, type, pan, vat_registered, address, province, district, municipality, ward, settings_json |
| user | id, shop_id, role (owner/staff), name, email, password_hash, pin_hash, permissions_json, active |
| device | id, shop_id, user_id, name, last_seen, revoked |
| item | id, shop_id, name_ne, name_en, barcode, category_id, unit, cost_price, sell_price, vat_rate, vat_exempt, min_stock, photo, supplier_id, active |
| stock_move | id, shop_id, item_id, qty_change (+/−), reason (sale, purchase, return, adjust, damage), ref_type, ref_id, device_id, created_at |
| party | id, shop_id, type (customer/supplier), name, phone, email, pan, address, credit_limit |
| invoice | id, shop_id, type (tax/cash/credit_note), number, series, device_id, party_id, date_ad, subtotal, discount, taxable, vat, total, status (open/paid/part/void), created_by, void_reason |
| invoice_line | id, invoice_id, item_id, qty, rate, discount, vat_rate, vat_amount, line_total |
| payment | id, shop_id, invoice_id, method (cash/fonepay/esewa/khalti/card/credit), amount, provider_txn_id, status (confirmed/unverified), created_at |
| purchase | id, shop_id, supplier_id, supplier_bill_no, date_ad, subtotal, vat, total, paid |
| purchase_line | id, purchase_id, item_id, qty, cost, vat |
| journal_entry | id, shop_id, date_ad, ref_type, ref_id, narration |
| journal_line | id, entry_id, account_id, debit, credit, party_id |
| account | id, shop_id, name, type (cash, bank, qr, sales, purchase, vat_in, vat_out, receivable, payable, expense) |
| expense | id, shop_id, date_ad, category, amount, note |
| camera | id, shop_id, name, ip, port, creds_encrypted |
| support_ticket | id, shop_id, user_id, category, message, app_version, device_info, status |
| audit_log | id, shop_id, user_id, device_id, action, entity, entity_id, at |
| sync_state | device_id, last_pull_cursor, last_push_at |

Every table also has: `created_at`, `updated_at`, `deleted_at` (soft delete), `version`, `device_id`.

**The books come from the journal.** Day Book, Sales Book, Purchase Book and Ledger are views of `invoice`, `purchase`, `payment`, `journal_line`. A sale posts: Dr Cash/Receivable, Cr Sales, Cr VAT Output. A return posts the reverse.

### 5.3 Keys and numbering for offline use

- **IDs:** UUID v7, created on the phone, so two phones never clash and no server round trip is needed.
- **Invoice numbers:** each device has its own series prefix, for example `A-2083-000123`, so offline phones never duplicate a number. VAT invoice numbers must be sequential and without gaps. Voided bills keep their number and are marked void. **The exact rule (one series per shop or per device/counter) must be confirmed with IRD.** If one shared series is required, the app will use one device per series or reserve number blocks from the server when online.
- **Time:** each record carries the device time plus a hybrid logical clock, so ordering stays correct even if a phone clock is wrong. The server also stamps arrival time.

### 5.4 Security design (replacing VPN)

| Layer | Measure |
|---|---|
| In transit | HTTPS only, TLS 1.2/1.3, HSTS, certificate pinning in the app. Signed requests with short-lived access tokens and refresh tokens. |
| On phone | Local database encrypted (SQLCipher). Key kept in Android Keystore / iOS Keychain, unlocked by PIN or biometric. App auto-lock. Screenshot block on sensitive screens (optional). |
| On server | Encryption at rest, field-level encryption for camera passwords, merchant keys and phone/email. Passwords hashed with Argon2. Daily encrypted backups. |
| Access | Role checks on server for every request. Device list with remote revoke. Rate limits and lockout. Audit log of important actions. |
| Payments | The app never stores card numbers. QR and card handled by the provider. Webhooks verified by signature. |
| Backups | Daily server backup. Owner can export an encrypted backup file. |

On "end-to-end": the above gives encryption from the phone to the server and on the server's disk. This is what banks and wallets use. A full zero-knowledge design (only the shop's devices hold the key) would mean: no web reports, no password recovery, no support access, and merging data across devices becomes harder. We recommend the standard design; zero-knowledge can be a premium option later.

If a VPN is ever needed (for example CCTV from outside), a low-cost option is a WireGuard-based service, added later.

### 5.5 How sync works

**Pattern: local-first with an outbox (change queue) and a pull cursor.**

1. Every change on the phone (new sale, stock move, item edit) is written to the local tables and to a local **outbox** in one transaction. The UI never waits for the network.
2. When online (or every 30–60 seconds, and on app open), the app **pushes** the outbox in order, in small batches. Each change has a unique ID, so retrying is safe (idempotent).
3. The server validates, applies, and replies per change: `accepted`, `merged`, `conflict`, or `rejected`.
4. The app then **pulls** everything newer than its cursor (changes made by other devices and by the server) and applies them.
5. A status icon shows pending count and last sync time.

### 5.6 Conflict rules

The most important choice: **do not sync stock as a single number.** Stock is the sum of `stock_move` rows.

| Data | Rule | Example |
|---|---|---|
| Stock quantity | **Add up all moves.** Two phones each sell 2 of the same item offline → stock is reduced by 4. No conflict possible. | Stock 10; A sells 2, B sells 2 → 6. |
| Negative stock | Allowed to happen. Shown as a warning "stock mismatch" for the owner to review. A sale is never refused offline. | Stock 1, both sell 1 → −1 flagged. |
| Invoices, payments, purchases, returns | **Append-only.** New record each time; a correction is a new record (void, credit note), never an edit of the old one. So these never conflict. | |
| Invoice number | Device series (5.3) prevents duplicates. If a duplicate still appears, the server keeps both and flags one. | |
| Item details (name, price, barcode) | **Last write wins per field**, using the logical clock. Owner edits beat staff edits if timestamps are close. Price change history is kept, and old invoices keep the price they were sold at. | Owner changes price on phone 1 and staff changes name on phone 2 → both fields kept. |
| Same barcode on two new items | Server keeps the first, links the second as a duplicate for the owner to merge. | |
| Party details | Last write wins per field. | |
| Credit balance | Computed from ledger lines, not stored as a number. | |
| Settings and permissions | **Server/owner wins.** Staff devices cannot override them. | |
| Deleted vs edited | Delete wins only if the deleted item has no invoices. Otherwise it is made inactive, not removed. | |
| Unverified QR payment | Stays "unverified" until the provider's record matches. If none is found, the owner sees an alert. | |
| Revoked device syncing | Rejected, local data on it is wiped at next contact. | |

Anything the app cannot merge by rule goes to a **Review list** (समीक्षा) for the owner with both versions side by side. This should be rare.

### 5.7 Offline limits (stated plainly)

- Dynamic QR, email OTP, new device sign-up and support submit need internet.
- Photos upload later in the background.
- If a phone is lost before syncing, unsynced data is lost. Mitigation: sync as soon as any connection exists, and prompt the owner when pending items are old.
- Cross-device stock is only approximate until both devices sync.

---

## 6. Suggested delivery plan

| Phase | Content |
|---|---|
| 1 | Login, roles, shop setup, items, barcode, sales, cash/credit, ESC/POS printing, offline DB, basic sync, Nepali/English, BS dates |
| 2 | Purchases, suppliers, returns, books, VAT summary, tax invoice, module toggles, support form |
| 3 | Dynamic QR (Fonepay, eSewa, Khalti), staff approvals, reports, backup |
| 4 | CCTV, delivery partners, extra reports |

---

## 7. Next steps

1. Client reviews this document and answers the questions in section 0.
2. Confirm the IRD/VAT requirements with an accountant.
3. Confirm printer model and QR providers.
4. After approval: app name, logo, colors, then the clickable screens and build.

---

## 8. What changed in v2.1

### 8.1 Web app first (PWA), installable on Android

| | |
|---|---|
| What | One web app that works in the browser on any device (Android, iPhone, tablet, laptop). |
| Install | Android Chrome: "Install app" / "Add to Home screen". It gets its own icon and opens full screen. iPhone: Safari, Share, "Add to Home Screen". |
| Offline | A service worker keeps the app files on the phone. Data is kept in a local browser database and syncs when online (same design as section 5). |
| Play Store | Later, the same web app can be wrapped and listed in Google Play, and in the App Store if needed. |
| Why first | One codebase, no store approval wait, updates reach every shop at once, lower cost. |

Limits of a web app that the client should know:

| Feature | Android Chrome | iPhone Safari |
|---|---|---|
| Install to home screen | Yes | Yes (manual, via Share) |
| Offline use | Yes | Yes (data may be cleared if the app is unused for weeks, so sync often) |
| Camera barcode scan | Yes | Yes (needs a scan library, slightly slower) |
| Bluetooth thermal printing | Yes (Web Bluetooth) | **No.** Use Share/PDF, or a LAN printer, or a native wrapper later. |
| Push notifications | Yes | Yes, only after install |

If Bluetooth printing on iPhone is a must, we add a thin native wrapper in a later phase.

### 8.2 Subscription plans (suggested, prices to be decided)

| | **Free** | **Pro** | **Max** (all features) |
|---|---|---|---|
| Price per month | Rs 0 | Rs 499 | Rs 999 |
| Price per year | Rs 0 | Rs 4,999 | Rs 9,999 |
| Items | Up to 100 | Unlimited | Unlimited |
| Bills | Cash receipts | Cash receipts and VAT tax invoices | Same |
| Payments | Cash, static QR, credit (10 customers) | + dynamic QR (Fonepay, eSewa, Khalti) | Same |
| Books | Day Book | Full books, VAT summary, PDF/Excel export | Same |
| Purchases, suppliers, orders | Locked | Yes | Yes |
| Returns | Locked | Yes | Yes |
| Staff accounts | 1 (owner) | Up to 3 | Unlimited |
| CCTV | Locked | Locked | Yes |
| Delivery partners | Locked | Locked | Yes |
| Shops | 1 | 1 | Up to 3 |
| Backup | Manual | Daily automatic | Daily automatic |
| Support | Report form | Report form | Priority (phone / WhatsApp) |
| Offline, Nepali/English, BS dates, ESC/POS print | Yes | Yes | Yes |

- New shops get a **14-day free Max trial**, then drop to Free if they do not subscribe.
- Subscription is paid by eSewa, Khalti, Fonepay or bank. Yearly saves 2 months.
- If the shop is offline or payment is late, the app keeps working for a **7-day grace period**. Data is never deleted when a plan ends. Locked features hide, old records stay.
- Free is useful on its own, so shops can start and grow into Pro.
- Prices and limits above are suggestions for discussion, not final.

### 8.3 Owner can switch features off

Every optional feature has an ON/OFF switch in Settings: credit (baki), VAT, barcode, QR payments, returns, purchases, staff, **CCTV**, delivery, order list and low-stock alerts. A feature that is OFF disappears from the menus. Features locked by the plan show a lock and the plan needed.

### 8.4 Item search and order

- The item list and the sale screen show **best sellers first** (highest sales count, descending).
- Typing one or two letters shows names that **start with those letters first**, still ordered by sales. Example: typing `w` shows Wai Wai, Wai Wai Quick, Wheat flour, Whisper pad, in that sales order.
- Search works on both Nepali and English names, so a shopkeeper can type in either.

### 8.5 Easy for people who do not use phones much

- **Simple mode** (on by default): home shows big buttons only: Sell, Items, Credit, Today's total.
- **Large text** switch.
- A **"? Help"** button on main screens shows one or two plain lines on what to do next.
- Photos on items, money shown clearly, one main action per screen, and a bill can be made in about 4 taps.
- Pure Nepali labels by default, with no mixed Hindi.
- Warnings use plain words, for example "5 items running low".

### 8.6 Screens added in v2.1

Plans and subscription, Upgrade prompt (when a locked feature is tapped), Simple-mode home, Help hints, and Settings entries for Simple mode, Large text and the new switches.
