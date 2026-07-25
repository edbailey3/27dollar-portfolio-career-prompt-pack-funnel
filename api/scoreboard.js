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
 *   Fix: always request a full 30-day window; filter today's data in memory.
 *   Dates are formatted WITHOUT milliseconds — PayPal rejects the .000Z suffix.
 */

import crypto from 'crypto';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// Align base URL with capture-order.js (production) with opt-in sandbox override.
// Set PAYPAL_MODE=sandbox OR PAYPAL_ENVIRONMENT=sandbox in Vercel env vars to switch.
const _mode = (process.env.PAYPAL_MODE || process.env.PAYPAL_ENVIRONMENT || '').toLowerCase();
const PAYPAL_BASE = _mode === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

const SITE_URL = process.env.SITE_URL || 'https://portfoliocareerschool.com';

// Product catalogue — used to derive item labels from captured amounts.
const PRODUCTS = {
  BASE:      { id: 'pcs-prompt-pack',   label: 'Prompt Pack ($27)',          price: 27 },
  BUMP_CL:   { id: 'pcs-checklist',     label: '+ Career Checklist ($17)',   price: 17 },
  BUMP_CALC: { id: 'pcs-calculator',    label: '+ Pricing Calculator ($12)', price: 12 },
};

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────

/**
 * Format a Date as a clean ISO-8601 string WITHOUT milliseconds.
 * e.g. "2026-07-25T19:30:00Z"
 * PayPal's Reporting API rejects dates with a .000Z millisecond suffix.
 */
const formatDate = (d) => d.toISOString().split('.')[0] + 'Z';

/**
 * Return the UTC date string (YYYY-MM-DD) for a given Date.
 */
const utcDateStr = (d) => d.toISOString().split('T')[0];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Timing-safe string comparison to avoid secret-leaking timing attacks.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a dummy comparison to prevent length-based timing leaks.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate the incoming request against SCOREBOARD_SECRET.
 * Accepts: ?key=<secret>  OR  Authorization: Bearer <secret>
 */
function isAuthenticated(req) {
  const secret = process.env.SCOREBOARD_SECRET;
  if (!secret) return false; // Hard-fail if env var is not set.

  const queryKey = req.query?.key || '';
  if (queryKey && safeEqual(queryKey, secret)) return true;

  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && safeEqual(token, secret)) return true;
  }

  return false;
}

/**
 * Retrieve a PayPal OAuth2 access token using client credentials.
 * Env vars: PAYPAL_CLIENT_ID / PAYPAL_SECRET_KEY  (same as capture-order.js)
 */
async function getPayPalToken() {
  // Guard: surface missing credentials immediately rather than sending a blank Basic header.
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
    // Forensic: capture the raw response body before throwing so the root cause
    // is visible in Vercel Function Logs, not just a generic status code.
    const rawBody = await res.text();
    console.error('PayPal Error [OAuth /v1/oauth2/token]:', res.status, rawBody);
    throw new Error(`PayPal OAuth handshake failed — HTTP ${res.status}: ${rawBody}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    console.error('PayPal Error [OAuth]: response OK but access_token missing:', JSON.stringify(json));
    throw new Error('PayPal OAuth returned no access_token.');
  }

  return json.access_token;
}

/**
 * Fetch PayPal transactions for a 30-day window ending now.
 *
 * KEY CHANGES vs. prior version:
 *   - start_date is always 30 days ago (avoids "data not available" error for
 *     same-day UTC windows that PayPal's Reporting API rejects).
 *   - Dates are formatted without milliseconds via formatDate() — PayPal rejects .000Z.
 *   - fields=all to capture transaction_info, cart_info, payer_info in one call.
 *   - transaction_status filter removed here; we filter in-memory so we can
 *     count all successful statuses (S = Success, V = Reversal excluded downstream).
 *
 * Returns the raw `transaction_details` array from PayPal's Reporting API.
 */
async function fetchPayPalTransactions(token) {
  const now   = new Date(Date.now());
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // exactly 30 days ago

  const params = new URLSearchParams({
    start_date:         formatDate(start),
    end_date:           formatDate(now),
    fields:             'all',
    page_size:          '100',
    page:               '1',
  });

  const url = `${PAYPAL_BASE}/v1/reporting/transactions?${params}`;
  console.log('[scoreboard] Fetching PayPal transactions:', url.replace(PAYPAL_BASE, ''));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    // Forensic: log HTTP status + full raw body so the exact PayPal error message
    // (e.g. PERMISSION_DENIED, INVALID_REQUEST) appears in Vercel Function Logs.
    const rawBody = await res.text();
    console.error('PayPal Error [Reporting /v1/reporting/transactions]:', res.status, rawBody);
    throw new Error(`PayPal Transactions API failed — HTTP ${res.status}: ${rawBody}`);
  }

  const data = await res.json();
  console.log('[scoreboard] PayPal returned', data.transaction_details?.length ?? 0, 'transactions');
  return data.transaction_details || [];
}

/**
 * Resolve which product(s) were purchased based on the captured dollar amount.
 * This mirrors the logic in capture-order.js.
 */
function resolveItems(amountUSD) {
  const amt = Math.round(amountUSD * 100); // work in cents to avoid float drift
  const items = [PRODUCTS.BASE.label];
  if (amt === 4400) items.push(PRODUCTS.BUMP_CL.label);
  if (amt === 3900) items.push(PRODUCTS.BUMP_CALC.label);
  if (amt === 5600) {
    items.push(PRODUCTS.BUMP_CL.label);
    items.push(PRODUCTS.BUMP_CALC.label);
  }
  return items;
}

/**
 * Derive safe, non-PII geo label from PayPal payer_info.
 * Returns "City, COUNTRY" or "Unknown".
 */
function safeGeo(payerInfo) {
  try {
    const addr = payerInfo?.address || {};
    const city    = addr.city          || '';
    const country = addr.country_code  || payerInfo?.country_code || '';
    if (city && country) return `${city}, ${country}`;
    if (country)         return country;
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * Aggregate metrics from the raw 30-day transaction list.
 * Filters in Node.js memory — no extra API calls needed.
 *
 * Returns:
 *   todayYield       — USD revenue for today (UTC)
 *   todayOrderCount  — completed orders today (UTC)
 *   thirtyDayYield   — USD revenue for the full 30-day window
 *   thirtyDayOrders  — completed orders in the 30-day window
 *   aov              — average order value (today)
 *   bumpRate         — order bump attach rate today (transactions > $27)
 *   recentSales      — enriched sale objects, newest-first, capped at 30
 */
function aggregateMetrics(transactions, todayUTC) {
  let todayYield      = 0;
  let todayOrderCount = 0;
  let thirtyDayYield  = 0;
  let thirtyDayOrders = 0;
  let bumpCount       = 0;
  const recentSales   = [];

  for (const tx of transactions) {
    const info  = tx.transaction_info || {};
    const payer = tx.payer_info       || {};

    // Only count positive-value debits (buyer payment to merchant).
    const amount = parseFloat(info.transaction_amount?.value || '0');
    if (amount <= 0) continue;

    // Exclude reversals / refunds — only count status S (Success).
    const status = (info.transaction_status || '').toUpperCase();
    if (status !== 'S') continue;

    // ── 30-day totals ──────────────────────────────────────────────────────
    thirtyDayYield  += amount;
    thirtyDayOrders += 1;

    // ── today filter ───────────────────────────────────────────────────────
    const initiationDate = info.transaction_initiation_date || '';
    const txDayUTC = initiationDate ? utcDateStr(new Date(initiationDate)) : null;
    const isToday  = txDayUTC === todayUTC;

    if (isToday) {
      todayYield      += amount;
      todayOrderCount += 1;

      const hasBump = amount > 27;
      if (hasBump) bumpCount++;

      recentSales.push({
        amount,
        items: resolveItems(amount),
        geo:   safeGeo(payer),
        time:  initiationDate || new Date().toISOString(),
      });
    }
  }

  const aov      = todayOrderCount > 0 ? todayYield / todayOrderCount : 0;
  const bumpRate = todayOrderCount > 0 ? bumpCount  / todayOrderCount : 0;

  // Sort descending (newest first), cap at 30 display rows.
  recentSales.sort((a, b) => new Date(b.time) - new Date(a.time));

  return {
    todayYield,
    todayOrderCount,
    thirtyDayYield,
    thirtyDayOrders,
    aov,
    bumpRate,
    recentSales: recentSales.slice(0, 30),
  };
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
  html,body{height:100%;background:#0a0a0a;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
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

function renderDashboard({
  todayYield, todayOrderCount,
  thirtyDayYield, thirtyDayOrders,
  aov, bumpRate, recentSales, asOf,
}) {
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => (n * 100).toFixed(1) + '%';
  const fmtTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
      }) + ' ET';
    } catch { return iso; }
  };

  const salesRows = recentSales.length
    ? recentSales.map((s, i) => `
      <div class="sale-row" style="animation-delay:${i * 60}ms">
        <div class="sale-amount">$${fmt(s.amount)}</div>
        <div class="sale-meta">
          <div class="sale-items">${s.items.join(' · ')}</div>
          <div class="sale-sub">${s.geo} &nbsp;·&nbsp; ${fmtTime(s.time)}</div>
        </div>
      </div>`).join('')
    : `<div class="no-sales">No completed transactions yet today.</div>`;

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
  /* ── RESET & TOKENS ──────────────────────────────────── */
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  :root{
    --bg:       #0a0a0a;
    --surface:  #111111;
    --border:   #1c1c1c;
    --accent:   #e73d00;
    --accent-2: #ff6b35;
    --text:     #f0f0f0;
    --muted:    #555;
    --dim:      #333;
    --green:    #00c96b;
    --blue:     #3b82f6;
    --radius:   14px;
    --font:     'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  html,body{
    height:100%;
    background:var(--bg);
    color:var(--text);
    font-family:var(--font);
    -webkit-font-smoothing:antialiased;
    overscroll-behavior:none;
  }

  /* ── LAYOUT ─────────────────────────────────────────── */
  .app{
    max-width:430px;
    margin:0 auto;
    min-height:100dvh;
    display:flex;
    flex-direction:column;
    padding-bottom:env(safe-area-inset-bottom);
  }

  /* ── HEADER ─────────────────────────────────────────── */
  .header{
    padding:max(16px, env(safe-area-inset-top)) 20px 0;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
  }
  .header-brand{
    display:flex;
    align-items:center;
    gap:10px;
  }
  .logo-dot{
    width:10px;
    height:10px;
    border-radius:50%;
    background:var(--green);
    box-shadow:0 0 8px var(--green);
    animation:pulse 2s ease-in-out infinite;
    flex-shrink:0;
  }
  @keyframes pulse{
    0%,100%{box-shadow:0 0 6px var(--green);opacity:1}
    50%{box-shadow:0 0 16px var(--green);opacity:.7}
  }
  .header-title{
    font-size:.75rem;
    font-weight:700;
    letter-spacing:.12em;
    text-transform:uppercase;
    color:var(--muted);
  }
  .as-of{
    font-size:.68rem;
    color:var(--dim);
    font-weight:500;
    text-align:right;
    line-height:1.3;
  }

  /* ── HERO STAT ───────────────────────────────────────── */
  .hero-block{
    padding:24px 20px 0;
  }
  .hero-label{
    font-size:.7rem;
    font-weight:700;
    letter-spacing:.1em;
    text-transform:uppercase;
    color:var(--accent);
    margin-bottom:4px;
  }
  .hero-value{
    font-size:3.4rem;
    font-weight:900;
    letter-spacing:-.04em;
    line-height:1;
    background:linear-gradient(135deg,#ff6b35 0%,#e73d00 50%,#c22800 100%);
    -webkit-background-clip:text;
    -webkit-text-fill-color:transparent;
    background-clip:text;
    filter:drop-shadow(0 0 24px rgba(231,61,0,.35));
  }
  .hero-sub{
    font-size:.8rem;
    color:var(--muted);
    margin-top:6px;
    font-weight:500;
  }

  /* ── KPI GRID ────────────────────────────────────────── */
  .kpi-grid{
    display:grid;
    grid-template-columns:1fr 1fr 1fr;
    gap:10px;
    padding:20px 20px 0;
  }
  .kpi{
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:14px 12px;
    text-align:center;
    position:relative;
    overflow:hidden;
    transition:border-color .2s;
  }
  .kpi::before{
    content:'';
    position:absolute;
    inset:0;
    border-radius:var(--radius);
    background:radial-gradient(ellipse at 50% 0%,rgba(231,61,0,.08) 0%,transparent 70%);
    pointer-events:none;
  }
  .kpi-val{
    font-size:1.45rem;
    font-weight:800;
    letter-spacing:-.03em;
    color:var(--text);
    line-height:1.1;
  }
  .kpi-lbl{
    font-size:.62rem;
    font-weight:600;
    text-transform:uppercase;
    letter-spacing:.07em;
    color:var(--muted);
    margin-top:5px;
    line-height:1.3;
  }
  .kpi-accent .kpi-val{ color:var(--green); }
  .kpi-blue .kpi-val{ color:var(--blue); }

  /* ── 30-DAY BAND ─────────────────────────────────────── */
  .band-30{
    margin:16px 20px 0;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:14px 16px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
  }
  .band-30-label{
    font-size:.65rem;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:.08em;
    color:var(--muted);
  }
  .band-30-stats{
    display:flex;
    gap:20px;
    align-items:center;
  }
  .band-stat{
    text-align:right;
  }
  .band-stat-val{
    font-size:1.05rem;
    font-weight:800;
    color:var(--blue);
    letter-spacing:-.02em;
  }
  .band-stat-lbl{
    font-size:.6rem;
    color:var(--dim);
    font-weight:600;
    text-transform:uppercase;
    letter-spacing:.06em;
  }

  /* ── SECTION HEADING ─────────────────────────────────── */
  .section-head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:24px 20px 12px;
  }
  .section-title{
    font-size:.72rem;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:.1em;
    color:var(--muted);
  }
  .section-badge{
    font-size:.65rem;
    font-weight:700;
    background:rgba(231,61,0,.15);
    color:var(--accent);
    padding:3px 8px;
    border-radius:100px;
    border:1px solid rgba(231,61,0,.25);
  }

  /* ── SALES FEED ──────────────────────────────────────── */
  .sales-feed{
    padding:0 20px;
    display:flex;
    flex-direction:column;
    gap:8px;
    flex:1;
  }
  .sale-row{
    display:flex;
    align-items:center;
    gap:14px;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:13px 14px;
    animation:slideIn .4s ease both;
    transition:border-color .2s;
  }
  .sale-row:hover{ border-color:var(--dim); }
  @keyframes slideIn{
    from{opacity:0;transform:translateY(8px)}
    to{opacity:1;transform:translateY(0)}
  }
  .sale-amount{
    font-size:1.1rem;
    font-weight:800;
    color:var(--green);
    letter-spacing:-.02em;
    white-space:nowrap;
    flex-shrink:0;
  }
  .sale-meta{
    flex:1;
    min-width:0;
  }
  .sale-items{
    font-size:.78rem;
    font-weight:600;
    color:var(--text);
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    line-height:1.3;
  }
  .sale-sub{
    font-size:.66rem;
    color:var(--muted);
    margin-top:3px;
    font-weight:500;
  }
  .no-sales{
    text-align:center;
    color:var(--dim);
    font-size:.82rem;
    padding:32px 0;
    font-weight:500;
  }

  /* ── FOOTER ──────────────────────────────────────────── */
  .footer{
    padding:20px 20px 24px;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
  }
  .footer-text{
    font-size:.65rem;
    color:var(--dim);
    font-weight:600;
    letter-spacing:.06em;
    text-transform:uppercase;
  }
  .footer-lock{
    font-size:.75rem;
    opacity:.5;
  }

  /* ── DIVIDER ─────────────────────────────────────────── */
  .divider{
    height:1px;
    background:var(--border);
    margin:0 20px;
  }

  /* ── REFRESH BUTTON ──────────────────────────────────── */
  .refresh-btn{
    display:block;
    margin:0 20px 20px;
    background:rgba(231,61,0,.1);
    border:1px solid rgba(231,61,0,.2);
    color:var(--accent);
    border-radius:12px;
    padding:12px;
    font-family:var(--font);
    font-size:.8rem;
    font-weight:700;
    letter-spacing:.04em;
    text-transform:uppercase;
    cursor:pointer;
    width:calc(100% - 40px);
    text-align:center;
    transition:background .15s,border-color .15s;
    -webkit-appearance:none;
  }
  .refresh-btn:active{
    background:rgba(231,61,0,.2);
    border-color:rgba(231,61,0,.4);
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
    <div class="as-of">
      Today (UTC)<br>${asOf}
    </div>
  </div>

  <!-- HERO -->
  <div class="hero-block">
    <div class="hero-label">Today's Yield</div>
    <div class="hero-value">$${fmt(todayYield)}</div>
    <div class="hero-sub">${todayOrderCount} completed order${todayOrderCount !== 1 ? 's' : ''} captured</div>
  </div>

  <!-- KPI GRID -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-val">$${fmt(aov)}</div>
      <div class="kpi-lbl">Avg Order Value</div>
    </div>
    <div class="kpi kpi-accent">
      <div class="kpi-val">${fmtPct(bumpRate)}</div>
      <div class="kpi-lbl">Bump Attach Rate</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${todayOrderCount}</div>
      <div class="kpi-lbl">Orders Today</div>
    </div>
  </div>

  <!-- 30-DAY BAND -->
  <div class="band-30">
    <div class="band-30-label">30-Day<br>Total</div>
    <div class="band-30-stats">
      <div class="band-stat">
        <div class="band-stat-val">$${fmt(thirtyDayYield)}</div>
        <div class="band-stat-lbl">Revenue</div>
      </div>
      <div class="band-stat">
        <div class="band-stat-val">${thirtyDayOrders}</div>
        <div class="band-stat-lbl">Orders</div>
      </div>
    </div>
  </div>

  <!-- RECENT SALES -->
  <div class="section-head">
    <div class="section-title">Recent Sales (Today)</div>
    <div class="section-badge">${recentSales.length} shown</div>
  </div>

  <div class="sales-feed">
    ${salesRows}
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

</div>
</body>
</html>`;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Block all crawlers unconditionally.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // ── AUTH GATE ──────────────────────────────────────────────────────────────
  if (!isAuthenticated(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(renderUnauthorized());
  }

  // ── DATA FETCH ─────────────────────────────────────────────────────────────
  try {
    const token = await getPayPalToken();

    // Fetch the full 30-day window from PayPal (avoids "start date not available" error).
    // Today's metrics are derived by filtering in Node.js memory below.
    const transactions = await fetchPayPalTransactions(token);

    // Determine today's UTC date string once so all filtering is consistent.
    const now      = new Date();
    const todayUTC = utcDateStr(now);

    // ── AGGREGATE METRICS ──────────────────────────────────────────────────
    const {
      todayYield,
      todayOrderCount,
      thirtyDayYield,
      thirtyDayOrders,
      aov,
      bumpRate,
      recentSales,
    } = aggregateMetrics(transactions, todayUTC);

    // Friendly timestamp for "as of" header.
    const asOf = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'UTC',
    }) + ' UTC';

    // ── RENDER ─────────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderDashboard({
      todayYield,
      todayOrderCount,
      thirtyDayYield,
      thirtyDayOrders,
      aov,
      bumpRate,
      recentSales,
      asOf,
    }));

  } catch (err) {
    // Forensic: always log the full error server-side for Vercel Function Logs.
    console.error('[scoreboard] Fatal error:', err.message, err.stack);

    // Return structured JSON so the root cause is immediately readable in the
    // browser during diagnostics — avoids needing to open Vercel logs for basic triage.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(503).json({
      error:   true,
      message: 'Could not reach PayPal',
      details: err.message,
    });
  }
}
