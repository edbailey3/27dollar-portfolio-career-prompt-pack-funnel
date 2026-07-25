/**
 * /api/scoreboard.js
 *
 * Secure, authenticated live sales scoreboard for internal operator use.
 * Sources real-time transaction telemetry from the PayPal Transactions API.
 *
 * Auth:  ?key=<SCOREBOARD_SECRET>  OR  Authorization: Bearer <SCOREBOARD_SECRET>
 * Route: /api/scoreboard  (registered in vercel.json rewrites)
 *
 * Security posture:
 *   - Token compared with timing-safe equality to prevent timing attacks.
 *   - X-Robots-Tag header blocks all crawler indexing.
 *   - Zero PII: no email addresses, no full street addresses, no card data.
 *   - Geo info is country + city only (aggregated, non-identifiable).
 *
 * DATE RANGE STRATEGY:
 *   PayPal's /v1/reporting/transactions API errors ("Data for the given start
 *   date is not available") when the window is too narrow (same-day UTC).
 *   Fix: always request a full 30-day window; all bucketing is done in-memory
 *   in Pacific Time (America/Los_Angeles) on both server and client.
 *   Dates are formatted WITHOUT milliseconds — PayPal rejects the .000Z suffix.
 *
 * CLIENT-SIDE INTERACTIVITY:
 *   The full 30-day transaction payload is serialised into window.allTransactions.
 *   Two pill-button toggle bars let the operator switch between:
 *     - Timeframe: Today (PT) | Yesterday (PT) | Last 7 Days (PT) | 30 Days
 *     - Category:  Funnel Sales (≤ $100) | Entire PayPal Account
 *   All metrics (revenue, orders, AOV, bump rate, feed) are re-calculated and
 *   re-rendered in the browser on each toggle tap — no page reload required.
 */

import crypto from 'crypto';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const _mode = (process.env.PAYPAL_MODE || process.env.PAYPAL_ENVIRONMENT || '').toLowerCase();
const PAYPAL_BASE = _mode === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// Product catalogue — used to derive item labels from captured amounts.
const PRODUCTS = {
  BASE:      { label: 'Prompt Pack ($27)',          price: 27 },
  BUMP_CL:   { label: '+ Career Checklist ($17)',   price: 17 },
  BUMP_CALC: { label: '+ Pricing Calculator ($12)', price: 12 },
};

// ─── SERVER-SIDE DATE HELPERS ─────────────────────────────────────────────────

/**
 * Format a Date as a clean ISO-8601 string WITHOUT milliseconds.
 * PayPal's Reporting API rejects dates with a .000Z millisecond suffix.
 */
const formatDate = (d) => d.toISOString().split('.')[0] + 'Z';

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthenticated(req) {
  const secret = process.env.SCOREBOARD_SECRET;
  if (!secret) return false;

  const queryKey = req.query?.key || '';
  if (queryKey && safeEqual(queryKey, secret)) return true;

  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && safeEqual(token, secret)) return true;
  }

  return false;
}

// ─── PAYPAL API ───────────────────────────────────────────────────────────────

async function getPayPalToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET_KEY) {
    throw new Error('PAYPAL_CLIENT_ID or PAYPAL_SECRET_KEY env var is not set.');
  }

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET_KEY}`
  ).toString('base64');

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    const rawBody = await res.text();
    console.error('PayPal Error [OAuth]:', res.status, rawBody);
    throw new Error(`PayPal OAuth handshake failed — HTTP ${res.status}: ${rawBody}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error('PayPal OAuth returned no access_token.');
  }
  return json.access_token;
}

/**
 * Fetch a 30-day transaction window from PayPal.
 * start_date = exactly 30 days ago (no milliseconds).
 * end_date   = right now (no milliseconds).
 * fields=all ensures transaction_info + payer_info are both present.
 */
async function fetchPayPalTransactions(token) {
  const now   = new Date(Date.now());
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    start_date: formatDate(start),
    end_date:   formatDate(now),
    fields:     'all',
    page_size:  '100',
    page:       '1',
  });

  const url = `${PAYPAL_BASE}/v1/reporting/transactions?${params}`;
  console.log('[scoreboard] Fetching:', params.toString());

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const rawBody = await res.text();
    console.error('PayPal Error [Reporting]:', res.status, rawBody);
    throw new Error(`PayPal Transactions API failed — HTTP ${res.status}: ${rawBody}`);
  }

  const data = await res.json();
  console.log('[scoreboard] Received', data.transaction_details?.length ?? 0, 'transactions');
  return data.transaction_details || [];
}

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────

function resolveItems(amountUSD) {
  const amt   = Math.round(amountUSD * 100);
  const items = [PRODUCTS.BASE.label];
  if (amt === 4400) items.push(PRODUCTS.BUMP_CL.label);
  if (amt === 3900) items.push(PRODUCTS.BUMP_CALC.label);
  if (amt === 5600) {
    items.push(PRODUCTS.BUMP_CL.label);
    items.push(PRODUCTS.BUMP_CALC.label);
  }
  return items;
}

function safeGeo(payerInfo) {
  try {
    const addr    = payerInfo?.address || {};
    const city    = addr.city         || '';
    const country = addr.country_code || payerInfo?.country_code || '';
    if (city && country) return `${city}, ${country}`;
    if (country)         return country;
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * Convert the raw PayPal transaction_details array into a lean, sanitised
 * payload safe for embedding in window.allTransactions.
 * Only status=S (Success) transactions with a positive amount are included.
 */
function buildTransactionPayload(transactions) {
  const payload = [];
  for (const tx of transactions) {
    const info  = tx.transaction_info || {};
    const payer = tx.payer_info       || {};

    const amount = parseFloat(info.transaction_amount?.value || '0');
    if (amount <= 0) continue;

    const status = (info.transaction_status || '').toUpperCase();
    if (status !== 'S') continue;

    payload.push({
      amount,
      initiationDate: info.transaction_initiation_date || null,
      geo:   safeGeo(payer),
      items: resolveItems(amount),
    });
  }
  return payload;
}

// ─── UI BUILDER ───────────────────────────────────────────────────────────────

function renderUnauthorized() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>401 — Access Denied</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;background:#0a0a0a;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .card{text-align:center;padding:2.5rem 2rem;border:1px solid #1f1f1f;border-radius:16px;max-width:340px}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{color:#e73d00;font-size:1.25rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.5rem}
  p{color:#555;font-size:.85rem;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔒</div>
  <h1>401 — Unauthorized</h1>
  <p>Valid credentials are required to access this resource.</p>
</div>
</body>
</html>`;
}

/**
 * Render the full dashboard shell.
 * @param {string} txPayloadJSON  — JSON.stringify of the sanitised transaction array
 * @param {string} asOf           — friendly "as of" timestamp string
 */
function renderDashboard(txPayloadJSON, asOf) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>⚡ Live Scoreboard — PCS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  /* ── RESET & TOKENS ────────────────────────────── */
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  :root{
    --bg:       #0a0a0a;
    --surface:  #111111;
    --border:   #1c1c1c;
    --accent:   #e73d00;
    --text:     #f0f0f0;
    --muted:    #555;
    --dim:      #333;
    --green:    #00c96b;
    --blue:     #3b82f6;
    --radius:   14px;
    --font:     'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  }
  html,body{
    height:100%;
    background:var(--bg);
    color:var(--text);
    font-family:var(--font);
    -webkit-font-smoothing:antialiased;
    overscroll-behavior:none;
  }

  /* ── LAYOUT ────────────────────────────────────── */
  .app{
    max-width:430px;
    margin:0 auto;
    min-height:100dvh;
    display:flex;
    flex-direction:column;
    padding-bottom:env(safe-area-inset-bottom);
  }

  /* ── HEADER ────────────────────────────────────── */
  .header{
    padding:max(16px,env(safe-area-inset-top)) 20px 0;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
  }
  .header-brand{ display:flex;align-items:center;gap:10px; }
  .logo-dot{
    width:10px;height:10px;border-radius:50%;
    background:var(--green);box-shadow:0 0 8px var(--green);
    animation:pulse 2s ease-in-out infinite;flex-shrink:0;
  }
  @keyframes pulse{
    0%,100%{box-shadow:0 0 6px var(--green);opacity:1}
    50%{box-shadow:0 0 16px var(--green);opacity:.7}
  }
  .header-title{
    font-size:.75rem;font-weight:700;
    letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
  }
  .as-of{
    font-size:.68rem;color:var(--dim);
    font-weight:500;text-align:right;line-height:1.3;
  }

  /* ── TOGGLE BARS ───────────────────────────────── */
  .toggle-section{
    padding:16px 20px 0;
    display:flex;
    flex-direction:column;
    gap:8px;
  }
  .toggle-label{
    font-size:.6rem;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:.08em;
    color:var(--dim);
    margin-bottom:2px;
  }
  .pill-bar{
    display:flex;
    gap:5px;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:100px;
    padding:4px;
  }
  .pill{
    flex:1;
    padding:7px 4px;
    border-radius:100px;
    border:none;
    background:transparent;
    color:var(--muted);
    font-family:var(--font);
    font-size:.65rem;
    font-weight:700;
    letter-spacing:.03em;
    cursor:pointer;
    text-align:center;
    transition:background .15s,color .15s;
    white-space:nowrap;
    -webkit-appearance:none;
  }
  /* Time pills — active = red */
  .pill-bar.time .pill.active{
    background:var(--accent);
    color:#fff;
  }
  /* Category pills — active = green */
  .pill-bar.cat .pill.active{
    background:var(--green);
    color:#000;
  }
  .pill:not(.active):hover{ color:var(--text); }

  /* ── HERO STAT ─────────────────────────────────── */
  .hero-block{ padding:22px 20px 0; }
  .hero-label{
    font-size:.7rem;font-weight:700;
    letter-spacing:.1em;text-transform:uppercase;
    color:var(--accent);margin-bottom:4px;
    transition:color .2s;
  }
  .hero-value{
    font-size:3.2rem;font-weight:900;
    letter-spacing:-.04em;line-height:1;
    background:linear-gradient(135deg,#ff6b35 0%,#e73d00 50%,#c22800 100%);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
    background-clip:text;
    filter:drop-shadow(0 0 24px rgba(231,61,0,.35));
  }
  .hero-sub{
    font-size:.8rem;color:var(--muted);
    margin-top:6px;font-weight:500;
  }

  /* ── KPI GRID ──────────────────────────────────── */
  .kpi-grid{
    display:grid;grid-template-columns:1fr 1fr 1fr;
    gap:10px;padding:16px 20px 0;
  }
  .kpi{
    background:var(--surface);border:1px solid var(--border);
    border-radius:var(--radius);padding:14px 12px;
    text-align:center;position:relative;overflow:hidden;
  }
  .kpi::before{
    content:'';position:absolute;inset:0;border-radius:var(--radius);
    background:radial-gradient(ellipse at 50% 0%,rgba(231,61,0,.08) 0%,transparent 70%);
    pointer-events:none;
  }
  .kpi-val{
    font-size:1.4rem;font-weight:800;
    letter-spacing:-.03em;color:var(--text);line-height:1.1;
  }
  .kpi-lbl{
    font-size:.6rem;font-weight:600;text-transform:uppercase;
    letter-spacing:.07em;color:var(--muted);margin-top:5px;line-height:1.3;
  }
  .kpi-accent .kpi-val{ color:var(--green); }

  /* ── 30-DAY BAND (reference baseline) ─────────── */
  .band-30{
    margin:12px 20px 0;
    background:var(--surface);border:1px solid var(--border);
    border-radius:var(--radius);padding:13px 16px;
    display:flex;align-items:center;justify-content:space-between;gap:12px;
  }
  .band-30-label{
    font-size:.6rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
    line-height:1.4;
  }
  .band-30-stats{ display:flex;gap:20px;align-items:center; }
  .band-stat{ text-align:right; }
  .band-stat-val{
    font-size:1rem;font-weight:800;color:var(--blue);letter-spacing:-.02em;
  }
  .band-stat-lbl{
    font-size:.59rem;color:var(--dim);font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;
  }

  /* ── SECTION HEADING ───────────────────────────── */
  .section-head{
    display:flex;align-items:center;justify-content:space-between;
    padding:20px 20px 10px;
  }
  .section-title{
    font-size:.72rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.1em;color:var(--muted);
  }
  .section-badge{
    font-size:.65rem;font-weight:700;
    background:rgba(231,61,0,.15);color:var(--accent);
    padding:3px 8px;border-radius:100px;
    border:1px solid rgba(231,61,0,.25);
  }

  /* ── SALES FEED ────────────────────────────────── */
  .sales-feed{
    padding:0 20px;display:flex;
    flex-direction:column;gap:8px;flex:1;
  }
  .sale-row{
    display:flex;align-items:center;gap:14px;
    background:var(--surface);border:1px solid var(--border);
    border-radius:var(--radius);padding:13px 14px;
    animation:slideIn .35s ease both;
  }
  @keyframes slideIn{
    from{opacity:0;transform:translateY(6px)}
    to{opacity:1;transform:translateY(0)}
  }
  .sale-row:hover{ border-color:var(--dim); }
  .sale-amount{
    font-size:1.05rem;font-weight:800;color:var(--green);
    letter-spacing:-.02em;white-space:nowrap;flex-shrink:0;
  }
  .sale-meta{ flex:1;min-width:0; }
  .sale-items{
    font-size:.78rem;font-weight:600;color:var(--text);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;
  }
  .sale-sub{
    font-size:.65rem;color:var(--muted);margin-top:3px;font-weight:500;
  }
  .no-sales{
    text-align:center;color:var(--dim);
    font-size:.82rem;padding:32px 0;font-weight:500;
  }

  /* ── FOOTER ────────────────────────────────────── */
  .divider{ height:1px;background:var(--border);margin:0 20px; }
  .footer{
    padding:16px 20px 22px;display:flex;
    align-items:center;justify-content:center;gap:8px;
  }
  .footer-text{
    font-size:.65rem;color:var(--dim);font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;
  }
  .footer-lock{ font-size:.75rem;opacity:.5; }

  /* ── REFRESH ───────────────────────────────────── */
  .refresh-btn{
    display:block;margin:4px 20px 16px;
    background:rgba(231,61,0,.1);border:1px solid rgba(231,61,0,.2);
    color:var(--accent);border-radius:12px;padding:12px;
    font-family:var(--font);font-size:.8rem;font-weight:700;
    letter-spacing:.04em;text-transform:uppercase;cursor:pointer;
    width:calc(100% - 40px);text-align:center;
    transition:background .15s,border-color .15s;-webkit-appearance:none;
  }
  .refresh-btn:active{
    background:rgba(231,61,0,.2);border-color:rgba(231,61,0,.4);
  }
</style>
</head>
<body>
<div class="app">

  <!-- HEADER -->
  <div class="header">
    <div class="header-brand">
      <div class="logo-dot"></div>
      <div class="header-title">PCS Live Scoreboard</div>
    </div>
    <div class="as-of">Updated<br>${asOf}</div>
  </div>

  <!-- TOGGLE: TIMEFRAME -->
  <div class="toggle-section">
    <div class="toggle-label">⏱ Timeframe</div>
    <div class="pill-bar time" id="bar-time">
      <button class="pill active" data-tf="today">Today</button>
      <button class="pill" data-tf="yesterday">Yesterday</button>
      <button class="pill" data-tf="7d">7 Days</button>
      <button class="pill" data-tf="30d">30 Days</button>
    </div>

    <!-- TOGGLE: CATEGORY -->
    <div class="toggle-label">📂 Revenue Category</div>
    <div class="pill-bar cat" id="bar-cat">
      <button class="pill active" data-cat="funnel">🎯 Funnel Sales</button>
      <button class="pill" data-cat="account">💼 Entire Account</button>
    </div>
  </div>

  <!-- HERO -->
  <div class="hero-block">
    <div id="hero-label" class="hero-label">Today's Yield (PT)</div>
    <div id="hero-value" class="hero-value">$0.00</div>
    <div id="hero-sub" class="hero-sub">0 completed orders captured</div>
  </div>

  <!-- KPI GRID -->
  <div class="kpi-grid">
    <div class="kpi">
      <div id="kpi-aov" class="kpi-val">$0.00</div>
      <div class="kpi-lbl">Avg Order Value</div>
    </div>
    <div class="kpi kpi-accent">
      <div id="kpi-bump" class="kpi-val">0.0%</div>
      <div class="kpi-lbl">Bump Attach Rate</div>
    </div>
    <div class="kpi">
      <div id="kpi-orders" class="kpi-val">0</div>
      <div class="kpi-lbl">Orders</div>
    </div>
  </div>

  <!-- 30-DAY BAND (always shows 30-day baseline for selected category) -->
  <div class="band-30">
    <div class="band-30-label">30-Day<br>Baseline</div>
    <div class="band-30-stats">
      <div class="band-stat">
        <div id="band-revenue" class="band-stat-val">$0.00</div>
        <div class="band-stat-lbl">Revenue</div>
      </div>
      <div class="band-stat">
        <div id="band-orders" class="band-stat-val">0</div>
        <div class="band-stat-lbl">Orders</div>
      </div>
    </div>
  </div>

  <!-- RECENT SALES FEED -->
  <div class="section-head">
    <div id="section-sales-title" class="section-title">Today's Sales (PT)</div>
    <div id="sales-badge" class="section-badge">0 shown</div>
  </div>
  <div id="sales-feed" class="sales-feed">
    <div class="no-sales">Loading transactions…</div>
  </div>

  <!-- REFRESH -->
  <div class="section-head"></div>
  <button class="refresh-btn" onclick="location.reload()">↻ &nbsp;Refresh Now</button>

  <!-- FOOTER -->
  <div class="divider"></div>
  <div class="footer">
    <span class="footer-lock">🔒</span>
    <span class="footer-text">Operator Eyes Only &nbsp;·&nbsp; No PII Displayed</span>
  </div>

</div><!-- /.app -->

<!-- ═══════════════════════════════════════════════════════════════════════════
     CLIENT-SIDE SCOREBOARD ENGINE
     All time-bucketing is done in Pacific Time (America/Los_Angeles).
     window.allTransactions is the authoritative 30-day dataset injected below.
     ═══════════════════════════════════════════════════════════════════════════ -->
<script>
// ─── DATA ─────────────────────────────────────────────────────────────────────
window.allTransactions = ${txPayloadJSON};

// ─── STATE ────────────────────────────────────────────────────────────────────
var _state = { timeframe: 'today', category: 'funnel' };

// ─── PT DATE HELPERS ──────────────────────────────────────────────────────────

/** Return YYYY-MM-DD in Pacific Time for a given ISO string. */
function ptDateStr(isoStr) {
  if (!isoStr) return null;
  try {
    return new Date(isoStr).toLocaleDateString('en-CA', {
      timeZone: 'America/Los_Angeles'
    });
  } catch (e) { return null; }
}

/** Today's date in Pacific Time, YYYY-MM-DD. */
function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Pacific Time date exactly N calendar days before today, YYYY-MM-DD. */
function nDaysAgoPT(n) {
  return new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles'
  });
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

function filterTimeframe(txs, tf) {
  var today = todayPT();
  if (tf === 'today') {
    return txs.filter(function(t) { return ptDateStr(t.initiationDate) === today; });
  }
  if (tf === 'yesterday') {
    var yest = nDaysAgoPT(1);
    return txs.filter(function(t) { return ptDateStr(t.initiationDate) === yest; });
  }
  if (tf === '7d') {
    // Rolling 7 calendar days inclusive of today (PT).
    // nDaysAgoPT(6) = 6 days back; together with today that is 7 days.
    var cutoff = nDaysAgoPT(6);
    return txs.filter(function(t) {
      var d = ptDateStr(t.initiationDate);
      return d && d >= cutoff && d <= today;
    });
  }
  return txs; // '30d' — full dataset
}

function filterCategory(txs, cat) {
  if (cat === 'funnel') {
    // Funnel transactions: $27 base + optional bumps, capped at $100.
    // Covers: $27, $39 ($27+$12), $44 ($27+$17), $56 ($27+$17+$12) and any
    // other funnel variant up to $100.
    return txs.filter(function(t) { return t.amount <= 100; });
  }
  return txs; // 'account' — all successful payments
}

// ─── METRICS ──────────────────────────────────────────────────────────────────

function computeMetrics(txs) {
  var revenue = 0, orders = 0, bumps = 0;
  for (var i = 0; i < txs.length; i++) {
    revenue += txs[i].amount;
    orders++;
    if (txs[i].amount > 27.00) bumps++;
  }
  var aov      = orders > 0 ? revenue / orders : 0;
  var bumpRate = orders > 0 ? bumps  / orders : 0;

  // Sort newest-first, cap feed at 30 rows.
  var feed = txs.slice().sort(function(a, b) {
    var da = a.initiationDate ? new Date(a.initiationDate).getTime() : 0;
    var db = b.initiationDate ? new Date(b.initiationDate).getTime() : 0;
    return db - da;
  }).slice(0, 30);

  return { revenue: revenue, orders: orders, aov: aov, bumpRate: bumpRate, feed: feed };
}

// ─── FORMAT ───────────────────────────────────────────────────────────────────

function fmtUSD(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) { return (n * 100).toFixed(1) + '%'; }
function fmtTimePT(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles'
    }) + ' PT';
  } catch(e) { return iso; }
}

// ─── LABELS ───────────────────────────────────────────────────────────────────

var TF_HERO = {
  today:     "Today's Yield (PT)",
  yesterday: "Yesterday's Yield (PT)",
  '7d':      '7-Day Yield (PT)',
  '30d':     '30-Day Yield'
};
var TF_SECTION = {
  today:     "Today's Sales (PT)",
  yesterday: "Yesterday's Sales (PT)",
  '7d':      'Last 7 Days (PT)',
  '30d':     'Last 30 Days'
};

// ─── DOM RENDER ───────────────────────────────────────────────────────────────

function buildSaleRow(tx, idx) {
  return '<div class="sale-row" style="animation-delay:' + (idx * 45) + 'ms">' +
    '<div class="sale-amount">$' + fmtUSD(tx.amount) + '</div>' +
    '<div class="sale-meta">' +
      '<div class="sale-items">' + (tx.items || []).join(' · ') + '</div>' +
      '<div class="sale-sub">' + (tx.geo || 'Unknown') + ' &nbsp;·&nbsp; ' + fmtTimePT(tx.initiationDate) + '</div>' +
    '</div>' +
  '</div>';
}

function updateDOM(m, tf, cat) {
  // Hero
  document.getElementById('hero-label').textContent = TF_HERO[tf] || 'Yield';
  document.getElementById('hero-value').textContent = '$' + fmtUSD(m.revenue);
  document.getElementById('hero-sub').textContent =
    m.orders + ' completed order' + (m.orders !== 1 ? 's' : '') + ' captured';

  // KPIs
  document.getElementById('kpi-aov').textContent    = '$' + fmtUSD(m.aov);
  document.getElementById('kpi-bump').textContent   = fmtPct(m.bumpRate);
  document.getElementById('kpi-orders').textContent = m.orders;

  // 30-day band — always shows 30-day totals for the selected category (baseline reference).
  var base30 = computeMetrics(filterCategory(window.allTransactions, cat));
  document.getElementById('band-revenue').textContent = '$' + fmtUSD(base30.revenue);
  document.getElementById('band-orders').textContent  = base30.orders;

  // Sales feed
  document.getElementById('section-sales-title').textContent = TF_SECTION[tf] || 'Sales';
  document.getElementById('sales-badge').textContent = m.feed.length + ' shown';
  var feedEl = document.getElementById('sales-feed');
  feedEl.innerHTML = m.feed.length
    ? m.feed.map(buildSaleRow).join('')
    : '<div class="no-sales">No completed transactions for this period.</div>';
}

// ─── RECALC ───────────────────────────────────────────────────────────────────

function recalculate() {
  var filtered = filterCategory(
    filterTimeframe(window.allTransactions, _state.timeframe),
    _state.category
  );
  updateDOM(computeMetrics(filtered), _state.timeframe, _state.category);
}

// ─── PILL HANDLERS ────────────────────────────────────────────────────────────

document.querySelectorAll('#bar-time .pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    _state.timeframe = this.getAttribute('data-tf');
    document.querySelectorAll('#bar-time .pill').forEach(function(b) {
      b.classList.remove('active');
    });
    this.classList.add('active');
    recalculate();
  });
});

document.querySelectorAll('#bar-cat .pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    _state.category = this.getAttribute('data-cat');
    document.querySelectorAll('#bar-cat .pill').forEach(function(b) {
      b.classList.remove('active');
    });
    this.classList.add('active');
    recalculate();
  });
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
recalculate();
</script>
</body>
</html>`;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // ── AUTH ────────────────────────────────────────────────────────────────────
  if (!isAuthenticated(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(renderUnauthorized());
  }

  // ── DATA ────────────────────────────────────────────────────────────────────
  try {
    const token        = await getPayPalToken();
    const rawTxs       = await fetchPayPalTransactions(token);
    const payload      = buildTransactionPayload(rawTxs);

    // Safely embed the payload — guard against </script> injection in PayPal data.
    const txPayloadJSON = JSON.stringify(payload)
      .replace(/<\/script>/gi, '<\\/script>');

    // Friendly "as of" timestamp in PT.
    const asOf = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'America/Los_Angeles',
    }) + ' PT';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderDashboard(txPayloadJSON, asOf));

  } catch (err) {
    console.error('[scoreboard] Fatal error:', err.message, err.stack);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(503).json({
      error:   true,
      message: 'Could not reach PayPal',
      details: err.message,
    });
  }
}
