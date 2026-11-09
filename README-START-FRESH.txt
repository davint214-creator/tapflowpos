TAPFLOW — FRESH START WITH YOUR ORIGINAL WORKING VERSION (Nov 8, 2026)
======================================================================
This zip = the copy you uploaded (your original working version), with
exactly ONE change: a one-line security-header fix in server.js so the
buttons actually work when hosted on Render (that header was silently
blocking every button click on every browser - the thing that made the
newer versions feel dead). Nothing else was touched: original design,
original QR page, original logins.

WHAT'S INSIDE
-------------
server.js            backend (one line changed - see above)
package.json         dependencies (Node 20)
public/index.html    the whole website - YOUR original version
.env                 template secrets (local runs)
.env.example         same, for reference
render.yaml          Render settings (matches the steps below)
fly.toml, wrangler.toml, CLOUDFLARE*.md, FREE_SETUP_GUIDE.md,
INSTALL.txt, README.md, .nvmrc, .node-version, .github/workflows
                     your original extras - keep whatever you use

STEP 1 - DELETE THE OLD SITES
-----------------------------
GitHub: github.com -> your repositories -> DELETE both "tapflow-pos"
and "tapflow-pos2" (Settings -> Danger Zone -> Delete this repo).
Render: dashboard.render.com -> both old services -> Settings ->
Delete service. Fresh start everywhere.

STEP 2 - NEW REPO (make it PRIVATE this time)
---------------------------------------------
GitHub -> New repository -> name: tapflow-pos -> Private -> Create.
Upload the files from this zip (Add file -> Upload files):
  server.js, package.json, render.yaml, README.md, INSTALL.txt,
  .nvmrc, .node-version, .env.example, fly.toml, wrangler.toml,
  the .github folder (with deploy.yml inside it),
  and index.html INSIDE the "public" folder.
Do NOT upload: tapflow.db (Render creates its own), .env (secrets).

STEP 3 - RENDER (this is the part that RUNS the site)
-----------------------------------------------------
dashboard.render.com -> New + -> Web Service -> connect tapflow-pos:
  Environment:   Node        Build: npm install        Start: node server.js
  Instance:      Free
Environment variables (Render -> Environment -> add):
  JWT_SECRET         = a long random line of text (40+ chars)
  NODE_VERSION       = 20
  ADYEN_ENVIRONMENT  = test
Click "Create Web Service" -> wait for "Deploy live" (~3 min).

STEP 4 - USE THE RENDER URL ONLY
--------------------------------
Open the URL from the Render dashboard (like https://tapflow-pos-xxxx.onrender.com)
in a private/incognito tab. Old bookmarks and pages.dev links are dead ends.

STEP 5 - LOGINS (original ones, created automatically on first boot)
--------------------------------------------------------------------
  admin@tapflow.local    / Admin123!
  manager@tapflow.local  / Manager123!
  employee@tapflow.local / Employee123!
  arcade@tapflow.local   / Arcade123!
Change the admin password after first login (Employees page).

STEP 6 - TEST (2 minutes)
-------------------------
1. Site opens on the home page, everything CLICKS
2. Sign in as admin -> POS opens, add items to cart, all buttons work
3. QR Pay -> Generate QR -> scan with your phone -> pay page opens
4. Everything $0.00 is normal (fresh database - make a test sale)

NOTES
-----
- This is your ORIGINAL version: it does NOT have the newer extras
  (webmaster protected account, QR-page lockdown, email receipts).
  Get stable first - if you want any of those back, ask later.
- First visit after idle takes 30-60s to wake up (Render free tier):
  if a click does nothing, wait and refresh ONCE.
- Keep the repo PRIVATE so your .env values stay secret; put secrets
  in Render's Environment tab, never in GitHub.
