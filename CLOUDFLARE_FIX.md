# Cloudflare Pages Build Fix — better-sqlite3 error (1-click)

**You hit this because Cloudflare defaulted to Node 24.22.1, but better-sqlite3 9.6 needs Node 20 (C++20 build). Fix in 20 seconds:**

### FIX (in Cloudflare dashboard):
1. In your Pages project → **Settings** → **Environment variables** → **Add variable**
   - Name: `NODE_VERSION`  Value: `20.11.0`  → Save
   - (also add `NPM_VERSION` = `10.2.3` if you see bun warnings)
2. **Settings** → **Builds & deployments** → **Retry deployment**

Build will now use Node 20 and `bun install` will compile better-sqlite3 correctly.

**Alternative (no rebuild, even faster):** Switch backend to Render (Render supports better-sqlite3 natively on Node 24, no fix needed):
- Keep your GitHub repo as-is → go to https://dashboard.render.com → New Web Service → Connect `tapflow-pos` → Build `npm install` → Start `node server.js` → Free → Deploy → use that URL. Then in Cloudflare Pages, set output to `public` only (frontend static) — see `CLOUDFLARE.md` Option 2.

### Why this happened:
- `better-sqlite3` is a native addon (C++). Cloudflare Pages auto-detected `bun 1.4.4` + `Node 24` and tried to compile with C++14, but Node 24 needs C++20.
- Pinning to Node 20 fixes it. Your local `server.js` already has a JSON fallback if SQLite is missing, but Pages still tries to install it — so we pin Node.
