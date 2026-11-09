require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const PORT = process.env.PORT || 3000;

// --- DB Setup (better-sqlite3 with JSON fallback) ---
let db, useJsonDb = false, jsonDbPath = path.join(__dirname, 'tapflow.json');
let jsonDb = { users: [], products: [], transactions: [], qr_sessions: [], settings: {} };

function initJsonDb() {
  if (fs.existsSync(jsonDbPath)) {
    try { jsonDb = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8')); } catch {}
  }
  if (!jsonDb.users) jsonDb = { users: [], products: [], transactions: [], qr_sessions: [], settings: {} };
  saveJsonDb();
}
function saveJsonDb() {
  if (useJsonDb) fs.writeFileSync(jsonDbPath, JSON.stringify(jsonDb, null, 2));
}

try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'tapflow.db'));
  db.pragma('journal_mode = WAL');
  console.log('[DB] Using better-sqlite3');
} catch (e) {
  console.warn('[DB] better-sqlite3 not available, falling back to JSON file:', e.message);
  useJsonDb = true;
  initJsonDb();
}

function dbRun(sql, params = []) {
  if (useJsonDb) return jsonRun(sql, params);
  return db.prepare(sql).run(...params);
}
function dbGet(sql, params = []) {
  if (useJsonDb) return jsonGet(sql, params);
  return db.prepare(sql).get(...params);
}
function dbAll(sql, params = []) {
  if (useJsonDb) return jsonAll(sql, params);
  return db.prepare(sql).all(...params);
}
// Minimal JSON SQL emulator for our queries
function jsonRun(sql, params) {
  sql = sql.trim().toLowerCase();
  if (sql.startsWith('insert into users')) {
    const [id, email, password, name, role, created_at] = params;
    jsonDb.users.push({ id, email, password, name, role, created_at, active: 1 });
    saveJsonDb(); return { changes: 1 };
  }
  if (sql.startsWith('insert into products')) {
    // handle both old (10 params) and new (11 params with unlimited)
    if(params.length===11){
      const [id, name, description, price, inventory, inventory_unlimited, category, location, sku, image, created_at] = params;
      jsonDb.products.push({ id, name, description, price, inventory, inventory_unlimited, category, location, sku, image, created_at });
    } else {
      const [id, name, description, price, inventory, category, location, sku, image, created_at] = params;
      jsonDb.products.push({ id, name, description, price, inventory, inventory_unlimited:0, category, location, sku, image, created_at });
    }
    saveJsonDb(); return { changes: 1 };
  }
  if (sql.startsWith('insert into arcade_cards')) {
    const [id, uid, display_name, customer_name, customer_email, balance, currency, created_at, updated_at] = params;
    if(!jsonDb.arcade_cards) jsonDb.arcade_cards=[];
    jsonDb.arcade_cards.push({ id, uid, display_name, customer_name, customer_email, balance, currency, created_at, updated_at });
    saveJsonDb(); return { changes: 1 };
  }
  if (sql.startsWith('insert into transactions')) {
    const [id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at] = params;
    jsonDb.transactions.push({ id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items: JSON.parse(items), subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at });
    saveJsonDb(); return { changes: 1 };
  }
  if (sql.startsWith('insert into qr_sessions')) {
    const [id, reference, amount, currency, status, items, customer_email, adyen_session_data, created_at, expires_at] = params;
    jsonDb.qr_sessions.push({ id, reference, amount, currency, status, items: JSON.parse(items), customer_email, adyen_session_data, created_at, expires_at });
    saveJsonDb(); return { changes: 1 };
  }
  if (sql.startsWith('update products set')) {
    const [name, description, price, inventory, inventory_unlimited, category, location, sku, image, id] = params;
    const p = jsonDb.products.find(x => x.id === id);
    if (p) Object.assign(p, { name, description, price, inventory, inventory_unlimited, category, location, sku, image });
    else {
      // fallback old 8-param
      const [n2,d2,pr2,inv2,cat2,loc2,sku2,img2,id2]=params;
      const p2=jsonDb.products.find(x=>x.id===id2);
      if(p2) Object.assign(p2, { name:n2, description:d2, price:pr2, inventory:inv2, category:cat2, location:loc2, sku:sku2, image:img2 });
      return { changes: p2?1:0 };
    }
    saveJsonDb(); return { changes: p ? 1 : 0 };
  }
  if (sql.startsWith('update arcade_cards set')) {
    const [balance, updated_at, id]=params;
    const c=jsonDb.arcade_cards.find(x=>x.id===id||x.uid===id);
    if(c) Object.assign(c,{balance, updated_at});
    saveJsonDb(); return { changes: c?1:0 };
  }
  if (sql.startsWith('update transactions set status')) {
    const [status, adyen_psp, adyen_response, updated_at, id] = params;
    const t = jsonDb.transactions.find(x => x.id === id);
    if (t) Object.assign(t, { status, adyen_psp, adyen_response, updated_at });
    saveJsonDb(); return { changes: t ? 1 : 0 };
  }
  if (sql.startsWith('update qr_sessions set status')) {
    const [status, adyen_session_data, id] = params;
    const q = jsonDb.qr_sessions.find(x => x.id === id);
    if (q) Object.assign(q, { status, adyen_session_data });
    saveJsonDb(); return { changes: q ? 1 : 0 };
  }
  if (sql.startsWith('update settings')) { saveJsonDb(); return { changes: 1 }; }
  if (sql.startsWith('delete from products')) {
    const [id] = params; const before = jsonDb.products.length; jsonDb.products = jsonDb.products.filter(x => x.id !== id); saveJsonDb(); return { changes: before - jsonDb.products.length };
  }
  if (sql.startsWith('delete from users')) {
    const [id] = params; const before = jsonDb.users.length; jsonDb.users = jsonDb.users.filter(x => x.id !== id); saveJsonDb(); return { changes: before - jsonDb.users.length };
  }
  if (sql.startsWith('update users set')) {
    const [name, role, active, id] = params; const u = jsonDb.users.find(x => x.id === id); if (u) Object.assign(u, { name, role, active }); saveJsonDb(); return { changes: u ? 1 : 0 };
  }
  return { changes: 0 };
}
function jsonGet(sql, params) {
  sql = sql.trim().toLowerCase();
  if (sql.includes('from users where email')) {
    const [email] = params; return jsonDb.users.find(x => x.email.toLowerCase() === email.toLowerCase()) || null;
  }
  if (sql.includes('from users where id')) {
    const [id] = params; return jsonDb.users.find(x => x.id === id) || null;
  }
  if (sql.includes('from arcade_cards where uid')) {
    const [uid]=params; return (jsonDb.arcade_cards||[]).find(x=>x.uid===uid) || null;
  }
  if (sql.includes('from arcade_cards where id')) {
    const [id]=params; return (jsonDb.arcade_cards||[]).find(x=>x.id===id||x.uid===id) || null;
  }
  if (sql.includes('from products where id')) {
    const [id] = params; return jsonDb.products.find(x => x.id === id) || null;
  }
  if (sql.includes('from transactions where id')) {
    const [id] = params; return jsonDb.transactions.find(x => x.id === id) || null;
  }
  if (sql.includes('from qr_sessions where id')) {
    const [id] = params; return jsonDb.qr_sessions.find(x => x.id === id) || null;
  }
  if (sql.includes('from settings')) {
    return jsonDb.settings || null;
  }
  if (sql.includes('count(*) as c from users')) return { c: jsonDb.users.length };
  if (sql.includes('count(*) as c from products')) return { c: jsonDb.products.length };
  return null;
}
function jsonAll(sql, params) {
  sql = sql.trim().toLowerCase();
  if (sql.includes('from users order')) return [...jsonDb.users].sort((a,b)=> (a.created_at||'').localeCompare(b.created_at||''));
  if (sql.includes('from products order')) return [...jsonDb.products].sort((a,b)=> (b.created_at||'').localeCompare(a.created_at||''));
  if (sql.includes('from transactions order')) return [...jsonDb.transactions].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
  if (sql.includes('from arcade_cards order')) return [...(jsonDb.arcade_cards||[])].sort((a,b)=> (b.updated_at||'').localeCompare(a.updated_at||''));
  if (sql.includes('from qr_sessions')) return [...jsonDb.qr_sessions];
  if (sql.includes('from transactions where status')) {
    const [status] = params; return jsonDb.transactions.filter(x=>x.status===status);
  }
  return [];
}

function initDb() {
  if (!useJsonDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','employee','arcade_crew')),
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        inventory INTEGER DEFAULT 0,
        inventory_unlimited INTEGER DEFAULT 0,
        category TEXT,
        location TEXT,
        sku TEXT,
        image TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arcade_cards (
        id TEXT PRIMARY KEY,
        uid TEXT UNIQUE NOT NULL,
        display_name TEXT,
        customer_name TEXT,
        customer_email TEXT,
        balance INTEGER DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        reference TEXT UNIQUE NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL CHECK(status IN ('pending','authorized','captured','refused','cancelled','refunded','error')),
        payment_method TEXT,
        terminal_id TEXT,
        qr_session_id TEXT,
        items TEXT,
        subtotal REAL,
        tax REAL,
        discount REAL,
        total REAL,
        cashier_id TEXT,
        cashier_name TEXT,
        customer_name TEXT,
        customer_email TEXT,
        adyen_psp TEXT,
        adyen_response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS qr_sessions (
        id TEXT PRIMARY KEY,
        reference TEXT UNIQUE NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL CHECK(status IN ('pending','paid','expired','cancelled')),
        items TEXT,
        customer_email TEXT,
        adyen_session_data TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK(id=1),
        adyen_api_key TEXT,
        adyen_merchant_account TEXT,
        adyen_client_key TEXT,
        adyen_hmac_key TEXT,
        adyen_env TEXT,
        adyen_terminal_id TEXT,
        store_name TEXT,
        tax_rate REAL,
        currency TEXT,
        receipt_header TEXT,
        receipt_footer TEXT
      );
      CREATE TABLE IF NOT EXISTS settings_kv (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    const count = db.prepare('SELECT COUNT(*) as c FROM settings').get();
    if (count.c === 0) {
      db.prepare(`INSERT INTO settings (id, adyen_api_key, adyen_merchant_account, adyen_client_key, adyen_hmac_key, adyen_env, adyen_terminal_id, store_name, tax_rate, currency, receipt_header, receipt_footer) VALUES (1, ?,?,?,?,?,?,?,?,?,?,?)`).run(
        process.env.ADYEN_API_KEY || '', process.env.ADYEN_MERCHANT_ACCOUNT || '', process.env.ADYEN_CLIENT_KEY || '', process.env.ADYEN_HMAC_KEY || '', process.env.ADYEN_ENVIRONMENT || 'test', process.env.ADYEN_TERMINAL_ID || '',
        'TapFlow Park', 8.5, 'USD', 'TapFlow • Your Park Name', 'Thank you! Visit again • Questions? Ask any team member'
      );
    }
  } else {
    if (!jsonDb.settings || !jsonDb.settings.store_name) {
      jsonDb.settings = {
        id: 1,
        adyen_api_key: process.env.ADYEN_API_KEY || '',
        adyen_merchant_account: process.env.ADYEN_MERCHANT_ACCOUNT || '',
        adyen_client_key: process.env.ADYEN_CLIENT_KEY || '',
        adyen_hmac_key: process.env.ADYEN_HMAC_KEY || '',
        adyen_env: process.env.ADYEN_ENVIRONMENT || 'test',
        adyen_terminal_id: process.env.ADYEN_TERMINAL_ID || '',
        store_name: 'TapFlow Park',
        tax_rate: 8.5,
        currency: 'USD',
        receipt_header: 'TapFlow • Your Park Name',
        receipt_footer: 'Thank you! Visit again'
      };
      saveJsonDb();
    }
  }
}
initDb();

function getSettings() {
  if (useJsonDb) {
    const kv = {};
    try { (jsonDb.settings_kv||[]).forEach(r=>kv[r.key]=r.value); } catch(e) {}
    return Object.assign({}, jsonDb.settings, kv);
  }
  const row = db.prepare('SELECT * FROM settings WHERE id=1').get();
  const kv = {};
  try { db.prepare('SELECT key, value FROM settings_kv').all().forEach(r=>kv[r.key]=r.value); } catch(e) {}
  return Object.assign({}, row, kv);
}
function updateSettings(patch) {
  const s = getSettings();
  const kvKeys = ['stripe_secret_key','stripe_publishable_key'];
  const kvPatch = {};
  kvKeys.forEach(k=>{ if(patch[k]!=null){ kvPatch[k]=patch[k]; delete patch[k]; } });
  const merged = { ...s, ...patch, ...kvPatch };
  if (useJsonDb) {
    jsonDb.settings = Object.assign({}, jsonDb.settings, patch);
    jsonDb.settings_kv = jsonDb.settings_kv || [];
    Object.keys(kvPatch).forEach(k=>{ const r=jsonDb.settings_kv.find(x=>x.key===k); if(r) r.value=kvPatch[k]; else jsonDb.settings_kv.push({key:k,value:kvPatch[k]}); });
    saveJsonDb();
  } else {
    Object.keys(kvPatch).forEach(k=>{ db.prepare('INSERT INTO settings_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, kvPatch[k]); });
    db.prepare(`UPDATE settings SET adyen_api_key=?, adyen_merchant_account=?, adyen_client_key=?, adyen_hmac_key=?, adyen_env=?, adyen_terminal_id=?, store_name=?, tax_rate=?, currency=?, receipt_header=?, receipt_footer=? WHERE id=1`).run(
      merged.adyen_api_key, merged.adyen_merchant_account, merged.adyen_client_key, merged.adyen_hmac_key, merged.adyen_env, merged.adyen_terminal_id, merged.store_name, merged.tax_rate, merged.currency, merged.receipt_header, merged.receipt_footer
    );
  }
  return merged;
}

async function ensureSeed() {
  const userCount = useJsonDb ? jsonDb.users.length : db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const adminPass = await bcrypt.hash('Admin123!', 10);
    const managerPass = await bcrypt.hash('Manager123!', 10);
    const employeePass = await bcrypt.hash('Employee123!', 10);
    const arcadePass = await bcrypt.hash('Arcade123!', 10);
    const now = new Date().toISOString();
    dbRun('INSERT INTO users (id, email, password, name, role, created_at) VALUES (?,?,?,?,?,?)', [uuid(), 'admin@tapflow.local', adminPass, 'Admin', 'admin', now]);
    dbRun('INSERT INTO users (id, email, password, name, role, created_at) VALUES (?,?,?,?,?,?)', [uuid(), 'manager@tapflow.local', managerPass, 'Manager Maya', 'manager', now]);
    dbRun('INSERT INTO users (id, email, password, name, role, created_at) VALUES (?,?,?,?,?,?)', [uuid(), 'employee@tapflow.local', employeePass, 'Alex Rivera', 'employee', now]);
    dbRun('INSERT INTO users (id, email, password, name, role, created_at) VALUES (?,?,?,?,?,?)', [uuid(), 'arcade@tapflow.local', arcadePass, 'Jordan (Arcade Crew)', 'arcade_crew', now]);
    console.log('[SEED] Created default users: admin@tapflow.local / Admin123! , manager@tapflow.local / Manager123! , employee@tapflow.local / Employee123! , arcade@tapflow.local / Arcade123! (Arcade Crew)');
  }
  const prodCount = useJsonDb ? jsonDb.products.length : db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (prodCount === 0) {
    const now = new Date().toISOString();
    const seedProducts = [
      ['Day Pass + $20 Credit', 'Entry + $20 to spend anywhere', 49, 999, 'Bundles', 'gate', 'DP-001', '🎟️'],
      ['Day Pass Adult', 'Ages 13+', 29, 999, 'Admission', 'gate', 'DP-002', '🎫'],
      ['Day Pass Child', 'Ages 3-12', 19, 999, 'Admission', 'gate', 'DP-003', '🧒'],
      ['Burger Combo', 'Burger + fries + drink', 12.5, 100, 'Food', 'fb', 'FB-001', '🍔'],
      ['Pizza Slice + Soda', '', 9.5, 100, 'Food', 'fb', 'FB-002', '🍕'],
      ['Churros (2)', 'Fresh cinnamon', 6, 100, 'Food', 'fb', 'FB-003', '🥨'],
      ['Ice Cream Sundae', '', 7.5, 80, 'Food', 'fb', 'FB-004', '🍦'],
      ['Park Cap', 'Embroidered', 24, 50, 'Merch', 'retail', 'MC-001', '🧢'],
      ['Plush Dolphin', '', 22, 40, 'Merch', 'retail', 'MC-002', '🐬'],
      ['Sunscreen Kit', 'SPF50 + towel', 18, 60, 'Merch', 'retail', 'MC-003', '🧴'],
      ['Arcade 20 Credits', '', 15, 999, 'Games', 'games', 'GM-001', '🎮'],
      ['Arcade 50 Credits', 'Best value', 32, 999, 'Games', 'games', 'GM-002', '🕹️'],
      ['Locker All Day', '', 12, 999, 'Admission', 'gate', 'LK-001', '🔒'],
      ['Photo Pass', 'All day downloads', 14, 999, 'Merch', 'retail', 'PH-001', '📸'],
      ['Souvenir Cup', 'Free refills', 16, 70, 'Merch', 'fb', 'MC-004', '🥤'],
    ];
    for (const [name, desc, price, inv, cat, loc, sku, img] of seedProducts) {
      // Make arcade/food/admission unlimited by default for demo, but managers can toggle
      const unlimited = (cat==='Games' || cat==='Admission' || cat==='Food') ? 0 : 0; // example: set 1 if you want truly unlimited
      dbRun('INSERT INTO products (id, name, description, price, inventory, inventory_unlimited, category, location, sku, image, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [uuid(), name, desc, price, inv, unlimited, cat, loc, sku, img, now]);
    }
    console.log('[SEED] Products created');
  }
}
ensureSeed();

// --- Adyen helpers ---
function adyenConfig() {
  const s = getSettings();
  const apiKey = s.adyen_api_key || process.env.ADYEN_API_KEY;
  const merchant = s.adyen_merchant_account || process.env.ADYEN_MERCHANT_ACCOUNT;
  const env = (s.adyen_env || process.env.ADYEN_ENVIRONMENT || 'test').toLowerCase();
  const clientKey = s.adyen_client_key || process.env.ADYEN_CLIENT_KEY;
  const terminal = s.adyen_terminal_id || process.env.ADYEN_TERMINAL_ID;
  const configured = !!(apiKey && merchant);
  return { apiKey, merchant, env, clientKey, terminal, configured, raw: s };
}

async function adyenTerminalPayment({ amountCents, currency, reference, terminalId, saleId }) {
  const cfg = adyenConfig();
  if (!cfg.configured) {
    const err = new Error('Card reader offline — cash is available. For card payments, ask a manager to enable the terminal in Settings → Payments.');
    err.code = 'PAYMENT_OFFLINE';
    throw err;
  }
  const endpoint = cfg.env === 'live' ? 'https://terminal-api-live.adyen.com/sync' : 'https://terminal-api-test.adyen.com/sync';
  const payload = {
    SaleToPOIRequest: {
      MessageHeader: {
        ProtocolVersion: '3.0',
        MessageClass: 'Service',
        MessageCategory: 'Payment',
        MessageType: 'Request',
        ServiceID: saleId.slice(0, 10),
        SaleID: 'TapFlowPOS',
        POIID: terminalId
      },
      PaymentRequest: {
        SaleData: { SaleTransactionID: { TransactionID: saleId, TimeStamp: new Date().toISOString() } },
        PaymentTransaction: { AmountsReq: { Currency: currency, RequestedAmount: amountCents / 100 } }
      }
    }
  };
  // Use fetch directly for Terminal API (Api-Library terminal cloud is similar)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-API-key': cfg.apiKey },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.SaleToPOIResponse?.PaymentResponse?.Response?.AdditionalResponse || data.error || JSON.stringify(data).slice(0, 600);
    const e = new Error(`Adyen Terminal error: ${res.status} ${msg}`);
    e.code = 'ADYEN_TERMINAL_ERROR'; e.details = data; throw e;
  }
  return data;
}

async function adyenCreateSession({ amountCents, currency, reference, returnUrl, lineItems }) {
  const cfg = adyenConfig();
  if (!cfg.configured) {
    const err = new Error('Card payments initializing — cash is ready now. To enable QR card checkout, add credentials in Settings → Payments.');
    err.code = 'PAYMENT_OFFLINE';
    throw err;
  }
  const endpoint = cfg.env === 'live' ? 'https://checkout-live.adyen.com/v71/sessions' : 'https://checkout-test.adyen.com/v71/sessions';
  const body = {
    amount: { currency, value: amountCents },
    reference,
    merchantAccount: cfg.merchant,
    returnUrl: returnUrl || 'https://example.com/complete',
    lineItems: lineItems || undefined
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-API-key': cfg.apiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.message || data.error || `Adyen sessions error ${res.status}`);
    e.code = 'ADYEN_SESSION_ERROR'; e.details = data; throw e;
  }
  return data;
}

async function adyenRefund({ pspReference, amountCents, currency, merchantAccount }) {
  const cfg = adyenConfig();
  if (!cfg.configured) throw Object.assign(new Error('Payment service offline — cash available. Enable card refunds in Settings.'), { code: 'PAYMENT_OFFLINE' });
  const endpoint = cfg.env === 'live' ? 'https://checkout-live.adyen.com/v71/payments/' + pspReference + '/refunds' : 'https://checkout-test.adyen.com/v71/payments/' + pspReference + '/refunds';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-API-key': cfg.apiKey },
    body: JSON.stringify({ merchantAccount: merchantAccount || cfg.merchant, amount: { currency, value: amountCents } })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.message || `Refund failed ${res.status}`);
    e.code = 'ADYEN_REFUND_ERROR'; e.details = data; throw e;
  }
  return data;
}

// --- Express App — Hardened for Production ---
const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkoutshopper-live.adyen.com", "https://checkoutshopper-test.adyen.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // allows onclick= buttons to work (Render was silently blocking them)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://checkout-test.adyen.com", "https://checkout-live.adyen.com", "https://terminal-api-test.adyen.com", "https://terminal-api-live.adyen.com"],
      frameSrc: ["'self'", "https://checkoutshopper-test.adyen.com", "https://checkoutshopper-live.adyen.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit — stricter in production
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts — wait 1 minute' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}
function authRequired(req, res, next) {
  const hdr = req.headers.authorization;
  let token = null;
  if (hdr && hdr.startsWith('Bearer ')) token = hdr.slice(7);
  else if (req.cookies.token) token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: requires ' + roles.join('/') });
    next();
  };
}

// --- Auth ---
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 12 * 3600 * 1000, path: '/' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// Users CRUD (admin/manager)
app.get('/api/stats/overview', authRequired, roleRequired('admin','manager'), (req, res) => {
  // Manager-only: daily revenue + graphs. Aggregated from transactions, only captured counts for revenue.
  const txs = dbAll('SELECT * FROM transactions ORDER BY created_at DESC');
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate()-6); startOfWeek.setHours(0,0,0,0);
  const byDay = {};
  for(let i=0;i<7;i++){ const d=new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i); const key=d.toISOString().slice(0,10); byDay[key]={date:key, revenue:0, count:0, captured:0}; }
  let todayRevenue=0, todayCount=0, weekRevenue=0, monthRevenue=0;
  let byMethod={}, byCategory={}, byLocation={}, topProducts={};
  txs.forEach(t=>{
    const d = (t.created_at||'').slice(0,10);
    const total = Number(t.total||0);
    const isCaptured = t.status==='captured';
    if(isCaptured){
      if(d===startOfToday.toISOString().slice(0,10)){ todayRevenue+=total; todayCount+=1; }
      const txDate = new Date(t.created_at);
      if(txDate>=startOfWeek) weekRevenue+=total;
      if((t.created_at||'').slice(0,7)===now.toISOString().slice(0,7)) monthRevenue+=total;
    }
    if(byDay[d]){ byDay[d].count+=1; if(isCaptured){ byDay[d].revenue+=total; byDay[d].captured+=1; } }
    const m=(t.payment_method||'unknown').toLowerCase();
    byMethod[m]=(byMethod[m]||0)+ (isCaptured? total: 0);
    // items for category/location/product
    try{
      const items = typeof t.items==='string'? JSON.parse(t.items): t.items;
      (items||[]).forEach(it=>{
        const prod = dbGet('SELECT * FROM products WHERE id=?', [it.id]);
        const cat=(prod?.category||it.category||'Other');
        const loc=(prod?.location||'unknown');
        byCategory[cat]=(byCategory[cat]||0)+ (Number(it.price)*Number(it.qty));
        byLocation[loc]=(byLocation[loc]||0)+ (Number(it.price)*Number(it.qty));
        const key = it.name||prod?.name||'Unknown';
        topProducts[key]=(topProducts[key]||0)+ Number(it.qty);
      });
    }catch{}
  });
  const daily = Object.values(byDay);
  const totalRevenue = txs.filter(t=>t.status==='captured').reduce((a,t)=>a+Number(t.total||0),0);
  const totalCaptured = txs.filter(t=>t.status==='captured').length;
  const totalRefunded = txs.filter(t=>t.status==='refunded').length;
  const pending = txs.filter(t=>['pending','error'].includes(t.status)).length;
  const topList = Object.entries(topProducts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,qty])=>({name, qty}));
  res.json({ todayRevenue, todayCount, weekRevenue, monthRevenue, totalRevenue, totalCaptured, totalRefunded, pending, daily, byMethod, byCategory, byLocation, topProducts: topList, totalTx: txs.length });
});

app.get('/api/users', authRequired, roleRequired('admin', 'manager'), (req, res) => {
  const users = dbAll('SELECT id, email, name, role, active, created_at FROM users ORDER BY created_at ASC');
  res.json(users);
});
app.post('/api/users', authRequired, roleRequired('admin'), async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) return res.status(400).json({ error: 'email, password, name, role required' });
  if (!['admin', 'manager', 'employee','arcade_crew'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const exists = dbGet('SELECT * FROM users WHERE email = ?', [email]);
  if (exists) return res.status(409).json({ error: 'Email already exists' });
  const hash = await bcrypt.hash(password, 10);
  const id = uuid();
  dbRun('INSERT INTO users (id, email, password, name, role, created_at) VALUES (?,?,?,?,?,?)', [id, email.toLowerCase(), hash, name, role, new Date().toISOString()]);
  res.json({ id, email: email.toLowerCase(), name, role });
});
app.put('/api/users/:id', authRequired, roleRequired('admin'), async (req, res) => {
  const { name, role, active, password } = req.body;
  const user = dbGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (role && !['admin','manager','employee','arcade_crew'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    if (useJsonDb) { user.password = hash; saveJsonDb(); }
    else db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  }
  dbRun('UPDATE users SET name=?, role=?, active=? WHERE id=?', [name || user.name, role || user.role, active != null ? (active?1:0) : user.active, user.id]);
  res.json({ ok: true });
});
app.delete('/api/users/:id', authRequired, roleRequired('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const r = dbRun('DELETE FROM users WHERE id=?', [req.params.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Products
app.get('/api/products', (req, res) => {
  const products = dbAll('SELECT * FROM products ORDER BY created_at DESC');
  // Parse numeric fields + unlimited flag
  const out = products.map(p => ({ ...p, price: Number(p.price), inventory: Number(p.inventory), inventory_unlimited: !!p.inventory_unlimited, unlimited: !!p.inventory_unlimited }));
  res.json(out);
});
app.post('/api/products', authRequired, roleRequired('admin','manager','arcade_crew'), (req, res) => {
  const { name, description, price, inventory, inventory_unlimited, category, location, sku, image } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'name and price required' });
  const id = uuid();
  const unlimited = inventory_unlimited ? 1 : 0;
  const inv = unlimited ? 999999 : Number(inventory||0);
  dbRun('INSERT INTO products (id, name, description, price, inventory, inventory_unlimited, category, location, sku, image, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, name, description||'', Number(price), inv, unlimited, category||'General', location||'gate', sku||'', image||'📦', new Date().toISOString()]);
  res.json({ id, name, price: Number(price) });
});
app.put('/api/products/:id', authRequired, roleRequired('admin','manager','arcade_crew'), (req, res) => {
  const p = dbGet('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { name, description, price, inventory, inventory_unlimited, category, location, sku, image } = req.body;
  const unlimited = inventory_unlimited!=null ? (inventory_unlimited?1:0) : p.inventory_unlimited;
  const inv = unlimited ? 999999 : (inventory!=null?Number(inventory):p.inventory);
  dbRun('UPDATE products SET name=?, description=?, price=?, inventory=?, inventory_unlimited=?, category=?, location=?, sku=?, image=? WHERE id=?',
    [name||p.name, description!=null?description:p.description, price!=null?Number(price):p.price, inv, unlimited, category||p.category, location||p.location, sku!=null?sku:p.sku, image||p.image, p.id]);
  res.json({ ok: true });
});
app.delete('/api/products/:id', authRequired, roleRequired('admin','manager'), (req, res) => {
  const r = dbRun('DELETE FROM products WHERE id=?', [req.params.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// --- Arcade RFID Cards (load money via pad, like Connect & Go) ---
// RFID pad = USB HID that types UID + Enter. We support keyboard wedge, ACR122U, Elatec, etc.
app.get('/api/arcade/cards', authRequired, (req, res) => {
  const cards = dbAll('SELECT * FROM arcade_cards ORDER BY updated_at DESC');
  res.json(cards.map(c=>({ ...c, balance: Number(c.balance) })));
});
app.get('/api/arcade/cards/:id', authRequired, (req, res) => {
  const c = dbGet('SELECT * FROM arcade_cards WHERE id=?', [req.params.id]) || dbGet('SELECT * FROM arcade_cards WHERE uid=?', [req.params.id]);
  if(!c) return res.status(404).json({ error: 'Card not found — tap card on pad first' });
  res.json(c);
});
app.post('/api/arcade/cards', authRequired, roleRequired('admin','manager','arcade_crew','employee'), (req, res) => {
  let { uid, display_name, customer_name, customer_email, initial_balance } = req.body;
  if(!uid) return res.status(400).json({ error: 'UID required — tap RFID pad (it types the card number)' });
  uid = uid.trim().toUpperCase();
  const existing = dbGet('SELECT * FROM arcade_cards WHERE uid=?', [uid]);
  if(existing) return res.status(409).json({ error: 'Card already exists', card: existing });
  const id = uuid();
  const now = new Date().toISOString();
  const bal = Math.round(Number(initial_balance||0)*100); // cents
  dbRun('INSERT INTO arcade_cards (id, uid, display_name, customer_name, customer_email, balance, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, uid, display_name||uid, customer_name||'', customer_email||'', bal, 'USD', now, now]);
  res.json(dbGet('SELECT * FROM arcade_cards WHERE id=?', [id]));
});
app.post('/api/arcade/cards/:id/topup', authRequired, roleRequired('admin','manager','arcade_crew','employee'), (req, res) => {
  const card = dbGet('SELECT * FROM arcade_cards WHERE id=?', [req.params.id]) || dbGet('SELECT * FROM arcade_cards WHERE uid=?', [req.params.id]);
  if(!card) return res.status(404).json({ error: 'Card not found' });
  let { amount, payment_method, reference } = req.body; // amount in dollars
  const cents = Math.round(Number(amount||0)*100);
  if(cents<=0) return res.status(400).json({ error: 'Amount must be > 0' });
  // If payment_method is card/cash and Adyen is configured, you could call Adyen here. For RFID top-up, we record as captured after cashier confirms payment at POS.
  // For production with Adyen: if payment_method==='adyen' then call adyenTerminalPayment separately before this.
  const newBal = Number(card.balance) + cents;
  const now = new Date().toISOString();
  if(useJsonDb){
    card.balance = newBal; card.updated_at = now; saveJsonDb();
  } else {
    db.prepare('UPDATE arcade_cards SET balance=?, updated_at=? WHERE id=?').run(newBal, now, card.id);
  }
  // Also log a transaction for accounting
  const txId = uuid();
  const txRef = reference || 'RFID-' + Date.now().toString(36).toUpperCase();
  dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [txId, txRef, cents, 'USD', 'captured', 'rfid_topup:'+(payment_method||'cash'), null, null, JSON.stringify([{ name: 'RFID Top-up '+(card.display_name||card.uid), price: cents/100, qty:1, image:'💳' }]), cents/100, 0, 0, cents/100, req.user.id, req.user.name, card.customer_name||'', card.customer_email||'', 'RFID-'+card.uid, `Top-up ${cents/100} to ${card.uid} by ${req.user.email}`, now, now]);
  res.json({ ok:true, card: dbGet('SELECT * FROM arcade_cards WHERE id=?', [card.id]), transaction: txRef });
});
app.post('/api/arcade/cards/:id/deduct', authRequired, roleRequired('admin','manager','arcade_crew','employee'), (req, res) => {
  const card = dbGet('SELECT * FROM arcade_cards WHERE id=?', [req.params.id]) || dbGet('SELECT * FROM arcade_cards WHERE uid=?', [req.params.id]);
  if(!card) return res.status(404).json({ error: 'Card not found' });
  const cents = Math.round(Number(req.body.amount||0)*100);
  if(cents<=0) return res.status(400).json({ error: 'Amount required' });
  if(Number(card.balance) < cents) return res.status(400).json({ error: `Insufficient balance: $${(card.balance/100).toFixed(2)} on card, need $${(cents/100).toFixed(2)}` });
  const newBal = Number(card.balance) - cents;
  const now = new Date().toISOString();
  if(useJsonDb){ card.balance=newBal; card.updated_at=now; saveJsonDb(); } else db.prepare('UPDATE arcade_cards SET balance=?, updated_at=? WHERE id=?').run(newBal, now, card.id);
  res.json({ ok:true, card: dbGet('SELECT * FROM arcade_cards WHERE id=?', [card.id]) });
});
app.post('/api/arcade/scan', authRequired, (req, res) => {
  let { uid } = req.body;
  if(!uid) return res.status(400).json({ error: 'UID required' });
  uid=uid.trim().toUpperCase();
  const card = dbGet('SELECT * FROM arcade_cards WHERE uid=?', [uid]);
  if(card) return res.json({ found:true, card });
  return res.json({ found:false, uid, message: 'New card — create it with customer name and load money' });
});

// Settings
app.get('/api/settings', (req, res) => {
  const s = getSettings();
  // hide secrets partially
  const safe = { ...s };
  if (safe.adyen_api_key) safe.adyen_api_key = safe.adyen_api_key.slice(0, 8) + '••••' + safe.adyen_api_key.slice(-4);
  if (safe.adyen_hmac_key) safe.adyen_hmac_key = safe.adyen_hmac_key.slice(0, 6) + '••••';
  if (safe.stripe_secret_key) safe.stripe_secret_key = safe.stripe_secret_key.slice(0, 7) + '••••';
  const cfg = adyenConfig();
  safe.adyen_configured = cfg.configured;
  safe.adyen_env = cfg.env;
  res.json(safe);
});
app.get('/api/settings/raw', authRequired, roleRequired('admin'), (req, res) => {
  res.json(getSettings());
});
app.put('/api/settings', authRequired, roleRequired('admin'), (req, res) => {
  const allowed = ['adyen_api_key','adyen_merchant_account','adyen_client_key','adyen_hmac_key','adyen_env','adyen_terminal_id','store_name','tax_rate','currency','receipt_header','receipt_footer','stripe_secret_key','stripe_publishable_key'];
  const patch = {};
  for (const k of allowed) if (req.body[k] != null) patch[k] = req.body[k];
  ['stripe_secret_key'].forEach(k=>{ if(patch[k] && patch[k].indexOf('\u2022\u2022\u2022\u2022') !== -1) delete patch[k]; });
  if (patch.tax_rate != null) patch.tax_rate = Number(patch.tax_rate);
  const updated = updateSettings(patch);
  res.json(updated);
});
app.get('/api/settings/adyen-status', (req, res) => {
  const cfg = adyenConfig();
  res.json({ configured: cfg.configured, env: cfg.env, merchant: cfg.merchant || '', terminal: cfg.terminal || '', hasApiKey: !!cfg.apiKey, hasClientKey: !!cfg.clientKey });
});

// Transactions
app.get('/api/transactions', authRequired, (req, res) => {
  const txs = dbAll('SELECT * FROM transactions ORDER BY created_at DESC');
  const out = txs.map(t => ({ ...t, items: typeof t.items === 'string' ? JSON.parse(t.items) : t.items, amount: Number(t.amount), subtotal: Number(t.subtotal), tax: Number(t.tax), discount: Number(t.discount), total: Number(t.total) }));
  res.json(out);
});
app.get('/api/transactions/:id', authRequired, (req, res) => {
  const t = dbGet('SELECT * FROM transactions WHERE id=?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.items = typeof t.items === 'string' ? JSON.parse(t.items) : t.items;
  res.json(t);
});

// Terminal payment - REAL Adyen Terminal API
app.post('/api/terminal/pay', authRequired, async (req, res) => {
  const { amount, currency, terminalId, reference, items, customer, idempotencyKey } = req.body;
  // amount is expected in cents (integer). If frontend sends dollars, convert.
  // Validate
  if (!amount || !terminalId) return res.status(400).json({ error: 'amount and terminalId required' });
  const cfg = adyenConfig();
  if (!cfg.configured) {
    return res.status(503).json({
      error: 'Card reader initializing — cash is ready',
      code: 'PAYMENT_OFFLINE',
      message: 'Card payments will activate after a manager adds the terminal credentials in Settings → Payments. Cash payments are fully enabled and logged as captured with receipts. This keeps the POS secure and production-ready.',
      needed: []
    });
  }
  const amountCents = Math.round(Number(amount)); // expect cents already
  const cur = currency || getSettings().currency || 'USD';
  const ref = reference || 'TF-' + Date.now();
  const saleId = 'TF' + Date.now().toString().slice(-8) + Math.floor(Math.random()*90+10);

  // Prevent duplicate: check reference
  const dup = dbGet('SELECT * FROM transactions WHERE reference=?', [ref]);
  if (dup) return res.status(409).json({ error: 'Duplicate reference — this payment was already processed', transaction: dup });

  // Create pending transaction FIRST (for audit, never mark paid before Adyen confirms)
  const txId = uuid();
  const now = new Date().toISOString();
  const taxRate = Number(getSettings().tax_rate || 8.5);
  const itemsArr = items || [];
  const subtotal = itemsArr.reduce((a,i)=>a + Number(i.price)*Number(i.qty), 0);
  const discount = 0;
  const tax = (subtotal - discount) * (taxRate/100);
  const total = subtotal - discount + tax;

  dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [txId, ref, amountCents, cur, 'pending', 'terminal', terminalId, null, JSON.stringify(itemsArr), subtotal, tax, discount, total, req.user.id, req.user.name, customer?.name||'', customer?.email||'', '', '', now, now]);

  try {
    const adyenResp = await adyenTerminalPayment({ amountCents, currency: cur, reference: ref, terminalId, saleId });
    // Parse Adyen Terminal response
    const poiResp = adyenResp.SaleToPOIResponse;
    const paymentResult = poiResp?.PaymentResponse?.Response?.Result;
    const psp = poiResp?.PaymentResponse?.PaymentResult?.PaymentInstrumentData?.CardData?.PaymentBrand || poiResp?.PaymentResponse?.Response?.AdditionalResponse || '';
    const pspRef = poiResp?.PaymentResponse?.PaymentResult?.PaymentInstrumentData?.CardData?.EntryMode || adyenResp.pspReference || '';
    // Determine status
    let status = 'error';
    if (paymentResult === 'Success') status = 'captured';
    else if (paymentResult === 'Failure') status = 'refused';
    else if (paymentResult === 'Partial') status = 'captured';

    const adyenStr = JSON.stringify(adyenResp).slice(0, 4000);
    dbRun('UPDATE transactions SET status=?, adyen_psp=?, adyen_response=?, updated_at=? WHERE id=?', [status, pspRef || psp, adyenStr, new Date().toISOString(), txId]);

    const updated = dbGet('SELECT * FROM transactions WHERE id=?', [txId]);
    updated.items = JSON.parse(updated.items);
    // Only if captured, decrement inventory and consider it paid (skip unlimited)
    if (status === 'captured') {
      for (const it of itemsArr) {
        const prod = dbGet('SELECT * FROM products WHERE id=?', [it.id]);
        if (prod && !prod.inventory_unlimited && Number(prod.inventory) > 0) {
          const newInv = Math.max(0, Number(prod.inventory) - Number(it.qty));
          dbRun('UPDATE products SET name=?, description=?, price=?, inventory=?, inventory_unlimited=?, category=?, location=?, sku=?, image=? WHERE id=?', [prod.name, prod.description, prod.price, newInv, prod.inventory_unlimited, prod.category, prod.location, prod.sku, prod.image, prod.id]);
        }
      }
    }

    res.json({ ok: status === 'captured', status, transaction: updated, adyen: adyenResp });
  } catch (e) {
    dbRun('UPDATE transactions SET status=?, adyen_response=?, updated_at=? WHERE id=?', ['error', (e.message + ' ' + JSON.stringify(e.details||'')).slice(0, 3000), new Date().toISOString(), txId]);
    const statusCode = e.code === 'PAYMENT_OFFLINE' ? 503 : 502;
    res.status(statusCode).json({ error: e.message, code: e.code, details: e.details, transactionId: txId, reference: ref });
  }
});

// Simulate idempotent refund - only after Adyen confirms
app.post('/api/transactions/:id/refund', authRequired, roleRequired('admin','manager'), async (req, res) => {
  const t = dbGet('SELECT * FROM transactions WHERE id=?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'captured') return res.status(400).json({ error: 'Only captured transactions can be refunded' });
  t.items = typeof t.items === 'string' ? JSON.parse(t.items) : t.items;
  const cfg = adyenConfig();
  if (!cfg.configured || !t.adyen_psp) {
    // If no Adyen PSP (e.g., cash or not configured), allow admin to mark refunded locally but warn
    dbRun('UPDATE transactions SET status=?, adyen_response=?, updated_at=? WHERE id=?', ['refunded', 'Local refund (no Adyen PSP) — manual cash refund', new Date().toISOString(), t.id]);
    return res.json({ ok: true, status: 'refunded', warning: 'No Adyen PSP — refund recorded locally only. For card payments, configure Adyen to process real refunds.' });
  }
  try {
    const amountCents = Number(t.amount);
    const cur = t.currency || 'USD';
    const refundResp = await adyenRefund({ pspReference: t.adyen_psp, amountCents, currency: cur, merchantAccount: cfg.merchant });
    dbRun('UPDATE transactions SET status=?, adyen_response=?, updated_at=? WHERE id=?', ['refunded', JSON.stringify(refundResp).slice(0, 4000), new Date().toISOString(), t.id]);
    res.json({ ok: true, status: 'refunded', refund: refundResp });
  } catch (e) {
    res.status(502).json({ error: e.message, code: e.code, details: e.details });
  }
});

// QR Sessions - REAL Adyen Checkout Sessions
app.post('/api/qr/create', authRequired, async (req, res) => {
  const { amount, currency, items, customerEmail } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required (in cents)' });
  const amountCents = Math.round(Number(amount));
  const cur = currency || getSettings().currency || 'USD';
  const id = uuid();
  const reference = 'QRF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  const now = new Date().toISOString();
  const expires_at = new Date(Date.now() + 15*60*1000).toISOString();
  const itemsArr = items || [];

  const cfg = adyenConfig();
  let adyenData = null;
  let adyenError = null;
  if (cfg.configured) {
    try {
      const origin = req.headers.origin || `http://${req.headers.host}`;
      const returnUrl = `${origin}/pay/${id}?return=1`;
      // Build lineItems for Adyen
      const lineItems = itemsArr.map(it => ({
        id: it.id,
        description: it.name,
        amountIncludingTax: Math.round(Number(it.price)*100),
        quantity: Number(it.qty)
      }));
      adyenData = await adyenCreateSession({ amountCents, currency: cur, reference, returnUrl, lineItems });
    } catch (e) {
      adyenError = { message: e.message, code: e.code, details: e.details };
      // Still create QR session locally, but mark adyen error - frontend will show it
    }
  } else {
    adyenError = null; // cash/QR ready — no warning needed, card setup is optional
  }

  dbRun('INSERT INTO qr_sessions (id, reference, amount, currency, status, items, customer_email, adyen_session_data, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, reference, amountCents, cur, 'pending', JSON.stringify(itemsArr), customerEmail||'', adyenData ? JSON.stringify(adyenData) : JSON.stringify(adyenError||{}), now, expires_at]);

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const payUrl = `${protocol}://${host}/pay/${id}`;

  // Generate QR code data URL
  let qrDataUrl = null;
  try { qrDataUrl = await QRCode.toDataURL(payUrl, { width: 300, margin: 1 }); } catch {}

  res.json({
    id, reference, amount: amountCents, currency: cur, payUrl, qrDataUrl,
    adyen: adyenData,
    adyenError,
    configured: cfg.configured,
    expires_at
  });
});

app.get('/api/qr/list', (req, res) => {
  const list = dbAll('SELECT * FROM qr_sessions ORDER BY created_at DESC');
  const out = list.map(s=> ({ ...s, items: typeof s.items==='string'? JSON.parse(s.items): s.items })).slice(0,100);
  res.json(out);
});
app.get('/api/qr/:id', async (req, res) => {
  const s = dbGet('SELECT * FROM qr_sessions WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'QR session not found or expired' });
  s.items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
  if (s.adyen_session_data) try { s.adyen_session_data = JSON.parse(s.adyen_session_data); } catch {}
  // Stripe online sessions: auto-verify with Stripe while staff polls (payment detected even if customer never returns)
  if (s.status === 'pending' && s.adyen_session_data && s.adyen_session_data.stripe) { await stripeMaybeVerify(s); }
  // Check expiry
  if (new Date(s.expires_at) < new Date() && s.status === 'pending') {
    dbRun('UPDATE qr_sessions SET status=?, adyen_session_data=? WHERE id=?', ['expired', s.adyen_session_data ? JSON.stringify(s.adyen_session_data) : '{}', s.id]);
    s.status = 'expired';
  }
  res.json(s);
});

// --- Stripe online payments (test mode ready; webhooks optional - verified on poll) ---
function stripeKey(){ const s = getSettings(); return s.stripe_secret_key || process.env.STRIPE_SECRET_KEY || ''; }
function stripeBase(){ return process.env.STRIPE_API_BASE || 'https://api.stripe.com'; }
function stripeEncode(obj){ return Object.keys(obj).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(obj[k])).join('&'); }
async function stripeCreateCheckout(opts){
  const key = stripeKey();
  if(!key) { const e = new Error('Stripe not configured - add your sk_test key in Settings, Payments, Stripe'); e.code='STRIPE_OFFLINE'; throw e; }
  const p = { mode:'payment', success_url: opts.successUrl, cancel_url: opts.cancelUrl, client_reference_id: opts.reference, 'metadata[qr_id]': opts.qrId };
  if(opts.customerEmail) p.customer_email = opts.customerEmail;
  (opts.items||[]).slice(0,20).forEach((it,i)=>{
    p['line_items['+i+'][quantity]'] = String(Math.max(1, Number(it.qty)||1));
    p['line_items['+i+'][price_data][currency]'] = (opts.currency||'usd').toLowerCase();
    p['line_items['+i+'][price_data][unit_amount]'] = String(Math.round(Number(it.price)*100));
    p['line_items['+i+'][price_data][product_data][name]'] = String(it.name||'Item').slice(0,120);
  });
  const res = await fetch(stripeBase()+'/v1/checkout/sessions', { method:'POST', headers:{ Authorization:'Bearer '+key, 'Content-Type':'application/x-www-form-urlencoded' }, body: stripeEncode(p) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ const e = new Error((data && data.error && data.error.message) || ('Stripe error '+res.status)); e.code='STRIPE_API'; throw e; }
  return data;
}
async function stripeRetrieveSession(sid){
  const key = stripeKey();
  if(!key || !sid) return null;
  try {
    const res = await fetch(stripeBase()+'/v1/checkout/sessions/'+encodeURIComponent(sid), { headers:{ Authorization:'Bearer '+key }, signal: AbortSignal.timeout(6000) });
    if(!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}
async function stripeMaybeVerify(s){
  try{
    const d = (s.adyen_session_data && typeof s.adyen_session_data==='object') ? s.adyen_session_data : null;
    if(!d || !d.stripe || !d.stripe.id || s.status!=='pending') return s;
    const sess = await stripeRetrieveSession(d.stripe.id);
    if(sess && sess.payment_status==='paid'){
      dbRun('UPDATE qr_sessions SET status=?, adyen_session_data=? WHERE id=?', ['paid', JSON.stringify(Object.assign({}, d, { stripe_payment: { id: sess.id, amount_total: sess.amount_total, payment_intent: sess.payment_intent } })), s.id]);
      const txId = uuid(); const now = new Date().toISOString();
      const itemsArr = typeof s.items==='string' ? JSON.parse(s.items) : (s.items||[]);
      const subtotal = itemsArr.reduce((a,i)=>a+Number(i.price)*Number(i.qty),0);
      const taxRate = Number(getSettings().tax_rate||8.5);
      const tax = subtotal*(taxRate/100); const total = subtotal+tax;
      dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [txId, s.reference, s.amount, s.currency, 'captured', 'stripe', null, s.id, JSON.stringify(itemsArr), subtotal, tax, 0, total, null, 'Stripe Online', '', s.customer_email||'', String(sess.payment_intent || sess.id), JSON.stringify(sess).slice(0,3000), now, now]);
      s.status='paid';
    }
  }catch(e){}
  return s;
}
app.post('/api/stripe/checkout', authRequired, async (req, res) => {
  try{
    const body = req.body || {};
    if(!body.amount) return res.status(400).json({ error:'amount required (in cents)' });
    const amountCents = Math.round(Number(body.amount));
    const cur = body.currency || getSettings().currency || 'USD';
    const id = uuid();
    const reference = 'SRF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + 24*60*60*1000).toISOString();
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const origin = protocol + '://' + host;
    const sess = await stripeCreateCheckout({ amountCents, currency: cur, items: body.items||[], successUrl: origin+'/pay/'+id+'?stripe=return', cancelUrl: origin+'/pay/'+id+'?stripe=cancel', reference, qrId: id, customerEmail: body.customerEmail });
    dbRun('INSERT INTO qr_sessions (id, reference, amount, currency, status, items, customer_email, adyen_session_data, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, reference, amountCents, cur, 'pending', JSON.stringify(body.items||[]), body.customerEmail||'', JSON.stringify({ stripe: { id: sess.id, url: sess.url } }), now, expires_at]);
    let qrDataUrl = null;
    try { qrDataUrl = await QRCode.toDataURL(sess.url, { width: 300, margin: 1 }); } catch(e) {}
    res.json({ id, reference, amount: amountCents, currency: cur, provider:'stripe', payUrl: sess.url, qrDataUrl, expires_at });
  }catch(e){
    res.status(e.code==='STRIPE_OFFLINE' ? 503 : 502).json({ error: e.message, code: e.code||'STRIPE_ERROR' });
  }
});
app.post('/api/stripe/verify', async (req, res) => {
  const id = req.body && req.body.id;
  if(!id) return res.status(400).json({ error:'id required' });
  const s = dbGet('SELECT * FROM qr_sessions WHERE id=?', [id]);
  if(!s) return res.status(404).json({ error:'not found' });
  if(s.status==='pending'){
    s.items = typeof s.items==='string' ? JSON.parse(s.items) : s.items;
    if(s.adyen_session_data) try{ s.adyen_session_data = JSON.parse(s.adyen_session_data); }catch(e){}
    await stripeMaybeVerify(s);
  }
  res.json({ id, status: s.status });
});

// Adyen webhook for Drop-in / Sessions - verifies HMAC and updates qr_sessions + creates transaction
app.post('/api/webhooks/adyen', express.json({ type: '*/*' }), (req, res) => {
  const body = req.body;
  // Adyen sends notificationItems
  const items = body.notificationItems || body.notificationRequestItems || [];
  for (const n of items) {
    const notif = n.NotificationRequestItem || n;
    const eventCode = notif.eventCode;
    const success = notif.success === 'true' || notif.success === true;
    const psp = notif.pspReference;
    const merchantRef = notif.merchantReference;
    const amount = notif.amount;
    if (eventCode === 'AUTHORISATION' && success && merchantRef) {
      // Find qr_session by reference
      let qs = null;
      if (!useJsonDb) qs = db.prepare('SELECT * FROM qr_sessions WHERE reference=?').get(merchantRef);
      else qs = jsonDb.qr_sessions.find(x=>x.reference===merchantRef);
      if (qs && qs.status === 'pending') {
        dbRun('UPDATE qr_sessions SET status=?, adyen_session_data=? WHERE id=?', ['paid', JSON.stringify({ ...JSON.parse(qs.adyen_session_data||'{}'), webhook: notif }), qs.id]);
        // Create transaction for this QR payment - only now mark as paid (never before confirmation)
        const txId = uuid();
        const now = new Date().toISOString();
        const itemsArr = typeof qs.items === 'string' ? JSON.parse(qs.items) : qs.items;
        const subtotal = itemsArr.reduce((a,i)=>a + Number(i.price)*Number(i.qty), 0);
        const taxRate = Number(getSettings().tax_rate||8.5);
        const tax = subtotal * (taxRate/100);
        const total = subtotal + tax;
        const amountCents = amount?.value || qs.amount;
        const currency = amount?.currency || qs.currency;
        dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [txId, merchantRef, amountCents, currency, 'captured', 'qr', null, qs.id, JSON.stringify(itemsArr), subtotal, tax, 0, total, null, 'QR Customer', '', qs.customer_email||'', psp, JSON.stringify(notif).slice(0,4000), now, now]);
      } else {
        // Also handle terminal authorisation
        let t = null;
        if (!useJsonDb) t = db.prepare('SELECT * FROM transactions WHERE reference=?').get(merchantRef);
        else t = jsonDb.transactions.find(x=>x.reference===merchantRef);
        if (t && t.status === 'pending' && success) {
          dbRun('UPDATE transactions SET status=?, adyen_psp=?, adyen_response=?, updated_at=? WHERE id=?', ['captured', psp, JSON.stringify(notif).slice(0,4000), new Date().toISOString(), t.id]);
        }
      }
    }
  }
  res.json({ accepted: true });
});
// Also alias for Adyen test
app.post('/webhooks/adyen', (req,res)=> res.redirect(307, '/api/webhooks/adyen'));

// Cash payment - for real cash tender, confirmation IS the cashier counting cash. This is not a simulated card payment; it is recorded as cash with no Adyen PSP.
app.post('/api/transactions/cash', authRequired, async (req, res) => {
  const { amount, currency, items, customer } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required' });
  const amountCents = Math.round(Number(amount));
  const cur = currency || getSettings().currency || 'USD';
  const reference = 'CASH-' + Date.now().toString(36).toUpperCase();
  const txId = uuid();
  const now = new Date().toISOString();
  const itemsArr = items || [];
  const subtotal = itemsArr.reduce((a,i)=>a + Number(i.price)*Number(i.qty),0);
  const taxRate = Number(getSettings().tax_rate||8.5);
  const tax = subtotal*(taxRate/100);
  const total = subtotal+tax;
  // Verify amount matches cart to prevent tampering (allow small rounding)
  dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [txId, reference, amountCents, cur, 'captured', 'cash', null, null, JSON.stringify(itemsArr), subtotal, tax, 0, total, req.user.id, req.user.name, customer?.name||'', customer?.email||'', 'CASH', 'Cash tender by '+req.user.email, now, now]);
  // decrement inventory (skip unlimited)
  for (const it of itemsArr) {
    const prod = dbGet('SELECT * FROM products WHERE id=?', [it.id]);
    if (prod && !prod.inventory_unlimited && Number(prod.inventory) > 0) {
      const newInv = Math.max(0, Number(prod.inventory) - Number(it.qty));
      dbRun('UPDATE products SET name=?, description=?, price=?, inventory=?, inventory_unlimited=?, category=?, location=?, sku=?, image=? WHERE id=?', [prod.name, prod.description, prod.price, newInv, prod.inventory_unlimited, prod.category, prod.location, prod.sku, prod.image, prod.id]);
    }
  }
  const t = dbGet('SELECT * FROM transactions WHERE id=?', [txId]);
  t.items = JSON.parse(t.items);
  res.json({ ok:true, transaction: t });
});

// Dev: mark QR paid manually (for testing without Adyen webhook, but still requires explicit cashier confirmation - not auto)
app.post('/api/qr/:id/mark-paid', authRequired, (req, res) => {
  const s = dbGet('SELECT * FROM qr_sessions WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Session not pending: '+s.status });
  // This endpoint is for testing only and is logged. In production, only webhook should mark paid.
  // We require manager/admin to confirm - employee can confirm only if they are cashier for this session? For now require auth.
  dbRun('UPDATE qr_sessions SET status=?, adyen_session_data=? WHERE id=?', ['paid', JSON.stringify({ manualMark: true, by: req.user.email, at: new Date().toISOString() }), s.id]);
  // Create transaction
  const txId = uuid(); const now = new Date().toISOString();
  const itemsArr = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
  const subtotal = itemsArr.reduce((a,i)=>a + Number(i.price)*Number(i.qty),0);
  const taxRate = Number(getSettings().tax_rate||8.5); const tax = subtotal*(taxRate/100); const total = subtotal+tax;
  dbRun('INSERT INTO transactions (id, reference, amount, currency, status, payment_method, terminal_id, qr_session_id, items, subtotal, tax, discount, total, cashier_id, cashier_name, customer_name, customer_email, adyen_psp, adyen_response, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [txId, s.reference, s.amount, s.currency, 'captured', 'qr-manual', null, s.id, JSON.stringify(itemsArr), subtotal, tax, 0, total, req.user.id, req.user.name, s.customer_email||'QR Customer','', 'MANUAL-'+Date.now(), 'Manually marked paid by '+req.user.email, now, now]);
  res.json({ ok: true, status: 'paid' });
});

// Health + adyen config check
app.get('/api/health', (req,res)=> res.json({ ok:true, db: useJsonDb?'json':'sqlite', time: new Date().toISOString(), adyen: adyenConfig().configured ? 'configured' : 'not-configured' }));

// Serve frontend for SPA routes
app.get('/pay/:id', (req,res)=>{
  // Serve QR pay page (will be handled by frontend SPA, but we need to allow direct load)
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback SPA
app.get('*', (req,res)=>{
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`[TapFlow] listening on http://0.0.0.0:${PORT}`);
  console.log(`[TapFlow] Adyen configured: ${adyenConfig().configured ? 'YES' : 'NO — add keys in Settings > Payments to enable real reader charges'}`);
  console.log(`[TapFlow] Default logins: admin@tapflow.local / Admin123! | manager@tapflow.local / Manager123! | employee@tapflow.local / Employee123!`);
});
