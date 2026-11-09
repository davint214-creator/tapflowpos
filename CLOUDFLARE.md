# Hosting TapFlow for Free on GitHub + Cloudflare (All Features, No Demo Lock)

## Important: GitHub Pages Alone = Static Only (No Backend)
GitHub Pages can ONLY host `public/index.html` (no Node, no SQLite, no Adyen calls). 
To keep ALL features (POS, products, dashboard, employees, Adyen), you need:

**Frontend on Cloudflare Pages (or GitHub Pages) + Backend on Render/Fly (free) -- OR -- All-in-one on Cloudflare**

---

## Option 1: Easiest - Keep Your Current Node Backend + Frontend on Cloudflare Pages (Recommended)

You already have a full Node server (`server.js`). Cloudflare Pages can host it with Functions + D1 (free SQLite).

### Steps (5 min, free):
1. Push your `tapflow-pos` folder to GitHub:
   ```bash
   git init
   git add .
   git commit -m "tapflow"
   git branch -M main
   git remote add origin https://github.com/YOU/tapflow-pos.git
   git push -u origin main
   ```
2. Go to https://dash.cloudflare.com → Pages → Create application → Connect to GitHub → pick `tapflow-pos`
3. Build settings:
   - Framework preset: None
   - Build command: `npm install`
   - Build output directory: `public`
   - Functions directory: `functions` (auto)
4. Cloudflare auto-creates D1: Pages → your project → Settings → Functions → D1 Binding → Create database `tapflow`
   - Replace `database_id` in `wrangler.toml` with the ID Cloudflare shows
5. Add Variables (Pages → Settings → Environment Variables):
   ```
   JWT_SECRET = any-32-char-random-string
   ADYEN_API_KEY = (blank for now, add later via Settings → Import)
   ADYEN_MERCHANT_ACCOUNT =
   ADYEN_ENVIRONMENT = test
   ```
6. Deploy → you get `https://tapflow-pos.pages.dev` (free HTTPS, custom domain free)

**Result:** All features work — POS, products, dashboard graphs, Arcade Crew login, QR, transactions, receipts. Adyen import works later via Settings → no code change. SQLite is D1 (Cloudflare's free SQLite).

---

## Option 2: Frontend on GitHub Pages + Backend on Render (Free, No Cloudflare Functions Needed)

If you only want GitHub Pages for the site preview:

1. Keep backend on https://dashboard.render.com (free) as in README.md → you get `https://tapflow-pos.onrender.com`
2. Edit `public/index.html` line near `function api` to set backend URL:
   ```js
   const BACKEND = "https://tapflow-pos.onrender.com";
   function api(path, opts={}){ return fetch(BACKEND+path, opts) ... }
   ```
3. Push `public/` to GitHub → Settings → Pages → Source: `main` / `public` → Save
4. Your site: `https://YOU.github.io/tapflow-pos/` → talks to Render backend → all features kept.

**Note:** GitHub Pages alone without a backend = buttons won't save to DB. You MUST have Render/Fly/Cloudflare backend running.

---

## Option 3: Instant Free Public Link (No GitHub) — Cloudflare Tunnel

Want to show your company TODAY without pushing to GitHub?

On the computer running `node server.js`:
```bash
npm install -g cloudflared
cloudflared tunnel --url http://localhost:3000
# Cloudflare gives you https://random-words-1234.trycloudflare.com (free, live)
```
Share that link — it tunnels to your laptop. All features work, no demo mode. Turn off when done.

---

## "Without Demo Mode" — Already Done

There is NO demo flag in this build. Current behavior:
- Cash + manual QR → works NOW, no keys, real DB writes, receipts print
- Adyen Terminal/QR → returns 503 `ADYEN_NOT_CONFIGURED` until you paste keys in Settings → Import

Hosting on GitHub or Cloudflare does NOT re-enable a demo lock — once you paste keys in Settings (or via Import JSON), the same deployed site charges real cards. No redeploy needed.

To verify: Sign in as `manager@tapflow.local / Manager123!` → Dashboard → daily revenue graphs only show `captured` sales. Arcade Crew (`arcade@tapflow.local / Arcade123!`) gets 403 on Dashboard — POS only.

---

## Custom Domain (Free)
Cloudflare Pages → Custom domains → Add `pos.yourpark.com` → Cloudflare gives free TLS. Render custom domain also free.

