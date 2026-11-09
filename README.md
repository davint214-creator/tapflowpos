# TapFlow POS — Free Hosting + No Demo Mode (Production Ready)

TapFlow is already **out of demo mode**. The only "block" you see (503 *Adyen not configured*) is a safety lock so no fake "Paid" receipt ever prints. Once you add real credentials, the same code **charges real cards** — no code change needed.

## What "Without Demo Mode" Means
- **There is no fake payment button.** Every terminal/QR charge either:
  - Calls Adyen Terminal API live → reader lights up → customer taps → Adyen returns `Success` → server marks `captured` and prints receipt
  - Or calls Adyen Checkout Sessions → customer pays on `/pay/:id` → Adyen webhook → `captured`
- **If keys are missing, POS returns 503 with instructions** (intentional, prevents fraud). This is not demo data — it's production safety.
- **Cash sales work today with NO keys**: POS → select `Cash` → Confirm → inventory decrements + receipt prints. Use this to prove the flow before Adyen is approved.

## Free Adyen Test Account (Required for Real Card Charges)
1. Sign up: https://www.adyen.com/signup → choose **Test account** (free, no business registration needed for test)
2. Wait ~5 min for approval → log in at https://ca-test.adyen.com
3. Get **API Key**: Developers → API credentials → Create new credential → Server authentication → Copy `AQEm...`
4. Note **Merchant Account**: e.g. `YourCompanyECOM` (top-left after login)
5. Get **Client Key**: Developers → API URLs and responses → Client Key (`test_...`)
6. Add **Terminal**: *You can test without physical reader* using Adyen's **Terminal Simulator** or: In-Person Payments → Terminals → Order test P400Plus (or use S1E emulator). Copy Terminal ID like `P400Plus-275123456`
7. Create **Webhook**: Developers → Webhooks → Add webhook → URL `https://YOUR-FREE-DOMAIN/api/webhooks/adyen` → Events: `AUTHORISATION` → Copy HMAC key
8. Paste all 5 values in TapFlow → **Settings → Payments** → Save. Done — real charges work.

> No Adyen approval yet? Use **Cash** mode + **QR** to demo to your company; it writes to the same `transactions` table and prints receipts.

## Free Hosting — 3 Options (Pick One)

### Option A: Render.com (Easiest, 100% Free, Custom HTTPS Domain)
1. Create free GitHub account → create new repo `tapflow-pos` → upload these files (or `git push`)
2. Go to https://dashboard.render.com → New → Web Service → Connect GitHub repo
3. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance: Free
   - Environment: Node 20
4. Add Environment Variables (Render → Environment):
   ```
   JWT_SECRET=change_this_to_any_long_random_string_12345
   ADYEN_ENVIRONMENT=test
   ADYEN_API_KEY= (leave blank until you have it — app still runs, just cash/QR)
   ADYEN_MERCHANT_ACCOUNT=
   ADYEN_CLIENT_KEY=
   ADYEN_HMAC_KEY=
   ADYEN_TERMINAL_ID=
   ```
5. Deploy → Render gives you `https://tapflow-pos-xxxx.onrender.com` (free HTTPS)
6. Open that URL → sign in → Settings → paste Adyen keys → now terminal/QR are live
7. (Optional) Render → Settings → Custom Domain → add your company domain (free TLS)

**Why Render:** Keeps SQLite file (`tapflow.db`) on disk, auto-restarts, free 750 hrs/month = always on.

### Option B: Fly.io (Free, SQLite Persists, Faster)
```bash
npm install -g flyctl
fly auth signup   # free account
fly launch --copy-config  # answer: no to Postgres, yes to deploy
fly volumes create tapflow_data --region dfw --size 1  # 1GB free
fly deploy
fly open
```
Add `fly.toml` already included below.

### Option C: Run Locally for Free (No Internet Needed)
```bash
# 1. Unzip tapflow-pos.zip
# 2. Open terminal in that folder
npm install
npm start
# Open http://localhost:3000
```

## Files Included (All You Need)
```
tapflow-pos.zip
├── server.js         # Full backend: auth, products, Adyen Terminal + QR, webhooks, receipts
├── package.json      # Dependencies
├── public/index.html # Frontend: Overview, POS, Products, Transactions, QR, Employees, Settings, Pay
├── .env.example      # Copy to .env and fill JWT + Adyen (or use Settings UI)
├── fly.toml          # Free Fly.io deploy
├── render.yaml       # Free Render deploy
├── tapflow.db        # Starter SQLite DB (15 products + 3 users) — delete to reset
└── README.md         # This file
```

## After Deployment — Make It Accessible
1. Open `https://your-free-domain`
2. TapFlow loads → **Overview** page explains what site does (no login needed)
3. Click **Sign in** → `admin@tapflow.local` / `Admin123!`
4. Go to **Settings → Payments** → paste Adyen test keys → **Save**
5. **POS** → add items → enter **Terminal ID** (top field) → **Charge on Adyen Reader** → physical reader lights up. No more 503.
6. **QR Pay** → Generate QR → customer scans `https://your-domain/pay/<id>` → pays → you see `Paid ✓` live.

## Switching From Test to Live Money
- In Settings change `Environment` from `test` to `live` → paste **Live** API Key/Merchant (from https://ca-live.adyen.com) → save. Same code.

## Other Readers (If You Don't Want Adyen)
Edit `server.js` → function `adyenTerminalPayment()` (~ line 90) — replace fetch URL/headers with your provider:
```js
// Example Stripe Terminal
const intent = await stripe.paymentIntents.create({amount: amountCents, currency: 'usd'});
return await stripe.terminal.readers.processPaymentIntent(terminalId, {payment_intent: intent.id});
```
Store that provider's keys in Settings same table. QR flow is identical.

## Support Without Demo Mode
- Cash sales: Always work, logged as `captured` with `payment_method: cash`, PSP = `CASH`
- Inventory: Only decrements on `captured` (cash counts, pending does not)
- Receipts: Auto-print only on `captured` (browser print → set Chrome flags `--kiosk-printing` for silent thermal print)
- Refunds: Transactions → Refund → calls `POST /v71/payments/{psp}/refunds` for real — no local-only fake refund

## Default Logins (Change Immediately in Employees)
- admin@tapflow.local / Admin123! (admin)
- manager@tapflow.local / Manager123! (manager)
- employee@tapflow.local / Employee123! (employee)

## Security Checklist Before Going Public
- Change `JWT_SECRET` in Render/Fly env + `.env` to 32+ random chars
- Change all 3 default passwords via Employees → Edit → set new password
- Enable HTTPS (Render/Fly do it free automatically)
- In `server.js`, replace CORS `origin: true` with your domain for lock-down

---
Built with Node 20 + Express + SQLite + Adyen Terminal API v71. No demo code exists — only production safety locks.
