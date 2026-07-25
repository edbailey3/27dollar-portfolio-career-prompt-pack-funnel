import crypto from 'crypto';

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

function renderOperational() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>PCS Command Center</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;background:#0a0a0a;color:#f0f0f0;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .card{text-align:center;padding:2.5rem 2rem;border:1px solid #1f1f1f;border-radius:16px;max-width:380px;background:#111}
  .status-dot{width:12px;height:12px;border-radius:50%;background:#00c96b;box-shadow:0 0 10px #00c96b;margin:0 auto 1.25rem}
  h1{font-size:1.15rem;font-weight:700;letter-spacing:-.01em;color:#f0f0f0;margin-bottom:.5rem}
  p{color:#666;font-size:.85rem;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <div class="status-dot"></div>
  <h1>PCS Command Center — Operational</h1>
  <p>Authenticated Session Verified</p>
</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (!isAuthenticated(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(renderUnauthorized());
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(renderOperational());
}
