# Pocket Pasal API

Login, email OTP, cloud sync and plans for Pocket Pasal. Hono on Cloudflare Workers, data in Cloudflare D1 (SQLite).
Cloudflare was picked because it needs no server to look after and the free tier covers a few hundred small shops.

## Run on your computer
    npm install
    npm run db:local        # creates the local database
    npm run dev             # http://127.0.0.1:8787
    npm test                # api, payments, security, email-sending and admin checks against the running server, plus unit tests for the mail builder

`.dev.vars` holds local-only secrets and `DEV_RETURN_OTP=1`, which makes the API return the email code in the response
so you can test without sending mail. Never set `DEV_RETURN_OTP` in production.

## Put it online (needs your Cloudflare account)
    npx wrangler login
    npx wrangler d1 create pasal                 # copy the database_id into wrangler.toml
    npm run db:remote
    npx wrangler secret put JWT_SECRET           # a long random string
    npx wrangler secret put ADMIN_KEY            # your private key for the admin page and /admin/*
    # Email: pick ONE of the two ways below
    npx wrangler secret put RESEND_API_KEY       # (a) Resend: needs a domain you own, MAIL_FROM on that domain
    # (b) Gmail: see "Sending email from Gmail" below
    # edit wrangler.toml: ALLOWED_ORIGINS = your web app address, ADMIN_EMAIL = where closing requests are announced (optional)
    npm run deploy
Then build the app with `VITE_API_URL=https://<your-worker>.workers.dev npm run build`.

## Sending email from Gmail
Resend is a mail-sending service. It needs a domain you own. If you have no domain yet, the server can send through a Gmail account instead.
Mail then comes from that Gmail address. Gmail allows roughly 500 messages a day, which is enough for starting out.
Do this once, yourself (never share these values in chat):

1. Open console.cloud.google.com, create a project, and under *APIs & Services* enable **Gmail API**.
2. *OAuth consent screen*: user type External, add your Gmail as the app's contact, and press **Publish app** so the status is **In production**.
   (While it says *Testing*, Google ends the login after 7 days and mail stops.)
3. *Credentials* > *Create credentials* > *OAuth client ID* > type **Web application**, with redirect URI `https://developers.google.com/oauthplayground`. Copy the client id and secret.
4. Open developers.google.com/oauthplayground, press the gear, tick *Use your own OAuth credentials*, paste the id and secret.
   In step 1 pick scope `https://www.googleapis.com/auth/gmail.send`, sign in with the Gmail that will send, then *Exchange authorization code for tokens*. Copy the **refresh token**.
5. Put the four values on the server:

       npx wrangler secret put GMAIL_CLIENT_ID
       npx wrangler secret put GMAIL_CLIENT_SECRET
       npx wrangler secret put GMAIL_REFRESH_TOKEN
       npx wrangler secret put GMAIL_SENDER          # the Gmail address, e.g. mypasal@gmail.com

When all four exist, Gmail is used; otherwise Resend if its key exists; otherwise nothing is sent and the API says the email service is not ready.
The scope can only send mail. It cannot read the mailbox.

## Admin page
The web app has a separate page at `/admin` (for example `https://pocket-pasal.dahal-khani.workers.dev/admin`). Open it and type the `ADMIN_KEY`.
It shows numbers, closing requests (approve or reject with a note), shops (search, set plan), support tickets, and a button to erase shops whose date has come.
The key is kept only in that browser tab. Ten wrong keys from one address lock that address for 15 minutes. The page is not indexed and is never saved for offline use.

## Closing an account
An owner sends a request from *More > Close account / leave* with a reason and their password.
You approve or reject it in the admin page (aim: within 7 days). An approved deletion is carried out 14 days later by the daily job
(or by *Run due deletions now*), and the owner can cancel before that. Stopping only the paid plan takes effect when you approve it.
After erasing, the request row stays with its reason and dates, but the email and shop name are removed. Data on the owner's phone is not touched.

## Endpoints
| | |
|---|---|
| `POST /auth/otp` | email a 6-digit code (5 per hour per email) |
| `POST /auth/signup` | code + password + shop, starts the 14-day Max trial |
| `POST /auth/login` | email + password. A phone the server has not seen needs an email code |
| `POST /auth/refresh`, `POST /auth/logout` | rotate or end a session |
| `GET /me` | shop name, plan, trial end |
| `GET /devices`, `POST /devices/:id/revoke` | list phones, cut a lost phone off at once |
| `POST /sync/push`, `GET /sync/pull?since=` | change feed, 100 per push, 300 per pull |
| `GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve` | duplicate bill numbers / barcodes for the owner to check |
| `POST /support` | trouble report from the app |
| `GET/POST /account/closure`, `POST /account/closure/cancel` | owner asks to delete the account or stop the plan; sees the status; cancels |
| `GET /admin/stats`, `/admin/shops`, `/admin/tickets`, `/admin/closures` | the admin page's lists (`x-admin-key` header) |
| `POST /admin/plan` | you set a shop to pro/max after you receive payment (`x-admin-key` header) |
| `POST /admin/closures/:id/approve` or `/reject`, `POST /admin/run-deletions` | decide a closing request; erase shops that are due |

Set a shop's plan by hand until the eSewa / Khalti / Fonepay payment hooks exist:

    curl -X POST https://<api>/admin/plan -H "x-admin-key: <ADMIN_KEY>" -H "content-type: application/json" \
         -d '{"email":"owner@shop.np","plan":"pro","days":30}'

## How sync decides things
- Bills, payments, stock moves, ledger rows and purchases are only ever added. Sending one twice does nothing.
- Stock and customer balances are not stored as numbers that phones overwrite. Each phone adds up the moves and ledger rows,
  so two phones selling the same item offline always add up correctly.
- Items, customers, staff and shop settings: the later edit wins, record by record (not field by field).
- Same bill number or same barcode on two records: both are kept and the owner sees it in the Review list.
- A revoked phone is refused on its next request.

## Known limits
- Staff PIN hashes are synced to every phone of the shop so staff can log in offline. A 4-digit PIN hash can be brute-forced by
  someone who gets the phone's storage. Use longer PINs, and remove lost phones from the Cloud account screen.
- Data is encrypted in transit (HTTPS) and at rest by Cloudflare, but the server can read it. It is not zero-knowledge end-to-end encryption.
- Password reset by email is not built yet.

## QR payments
Money goes straight to the shop's own merchant account. The server only starts the payment and asks the provider whether it was paid.

| Provider | Status |
|---|---|
| Khalti | Built on Khalti's official ePayment API (initiate, then lookup). Needs the shop's own secret key. **Not yet tried with a real Khalti sandbox account.** |
| eSewa | Built on eSewa ePay v2 (HMAC-SHA256 signed form, status API). The sandbox status host was reached and answered. **The signed form has not yet been paid in eSewa's sandbox**, so do that once before going live. |
| Fonepay | **Not built.** Fonepay's dynamic QR API is given to merchants by their bank and is not public. Shops use their own Fonepay QR picture (the "My QR" option) until you have the Fonepay documents. |
| Test | A fake provider for trying the whole flow. Needs `ENABLE_MOCK_PAY=1`. Never in production. |

Khalti and eSewa give a payment page, not a QR picture, so the QR encodes the link to that page. The customer scans it with the phone camera,
pays there, and the server checks the result with the provider. The result is never taken from the customer's phone.

Extra settings for production: `PUBLIC_URL` (your deployed API address, used in return links) and the secret `SECRETS_KEY`
(`npx wrangler secret put SECRETS_KEY`). Run `npm run db:remote` again to add the payments tables.
Test: `node test/pay.test.mjs` (28 checks).

Before real money: in Khalti's and eSewa's merchant dashboards, create a sandbox account, save its keys in the app in Test mode, pay one bill, and check that
the bill turns paid by itself. Only then switch to Live.
