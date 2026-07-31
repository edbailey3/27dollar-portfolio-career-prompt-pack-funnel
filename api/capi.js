import crypto from 'crypto';

function hashSha256(str) {
  if (!str || typeof str !== 'string') return undefined;
  const clean = str.trim().toLowerCase();
  if (!clean) return undefined;
  if (/^[a-f0-9]{64}$/.test(clean)) return clean;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

function parseClientIp(req) {
  const rawHeader = req?.headers?.['x-forwarded-for'];
  let rawIp = '';
  if (Array.isArray(rawHeader)) {
    rawIp = rawHeader[0] || '';
  } else if (typeof rawHeader === 'string') {
    rawIp = rawHeader.split(',')[0].trim();
  } else {
    rawIp = req?.socket?.remoteAddress || '';
  }
  if (!rawIp) return '';
  if (rawIp.startsWith('::ffff:')) rawIp = rawIp.replace('::ffff:', '');
  if (rawIp.includes('[') && rawIp.includes(']')) {
    rawIp = rawIp.replace(/^\[|\]:\d+$|:\d+$/g, '');
  } else if (rawIp.includes('.') && rawIp.includes(':')) {
    rawIp = rawIp.split(':')[0];
  }
  return rawIp.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      eventName,
      eventId,
      email,
      externalId,
      fbp,
      fbc,
      ttclid,
      test_event_code,
      eventSourceUrl,
      customData
    } = req.body || {};

    if (!eventName || !eventId) {
      return res.status(400).json({ error: 'Missing required eventName or eventId.' });
    }

    const testCode = test_event_code || req.body?.test_code || req.query?.test_event_code || req.query?.tt_test_code || null;
    const hashedEmail = hashSha256(email);
    const rawExternalId = externalId || req.body?.external_id || hashedEmail || null;
    const clientIp = parseClientIp(req);
    const userAgent = req?.headers?.['user-agent'] || '';
    const pageUrl = eventSourceUrl || req.headers?.referer || (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html';

    // --- 1. ISOLATED META CONVERSIONS API DISPATCH ---
    const metaPixelId = process.env.META_PIXEL_ID || '2772807839768527';
    const metaAccessToken = process.env.META_ACCESS_TOKEN;

    let metaPromise;
    if (metaAccessToken) {
      metaPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        try {
          const metaEventName = eventName === 'CompletePayment' ? 'Purchase' : eventName;
          const metaUserData = {
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            ...(fbp ? { fbp } : {}),
            ...(fbc ? { fbc } : {}),
            ...(hashedEmail ? { em: [hashedEmail] } : {}),
            ...(rawExternalId ? { external_id: [rawExternalId] } : {}) // Meta requires list<string> array
          };

          const metaPayload = {
            data: [
              {
                event_name: metaEventName,
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                action_source: 'website',
                event_source_url: pageUrl,
                user_data: metaUserData,
                custom_data: customData || { currency: 'USD', value: 27.00 }
              }
            ],
            ...(testCode ? { test_event_code: testCode } : {})
          };

          const metaEndpoint = `https://graph.facebook.com/v19.0/${metaPixelId}/events?access_token=${metaAccessToken}`;
          const r = await fetch(metaEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metaPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const data = await r.json();
          return { ok: r.ok, status: r.status, data };
        } catch (err) {
          clearTimeout(timeoutId);
          return { ok: false, error: err.name === 'AbortError' ? 'Meta CAPI request timed out (3.5s)' : err.message };
        }
      })();
    } else {
      metaPromise = Promise.resolve({ skipped: true, reason: 'META_ACCESS_TOKEN not configured' });
    }

    // --- 2. ISOLATED TIKTOK WEB EVENTS API DISPATCH ---
    const ttPixelId = process.env.TIKTOK_PIXEL_ID || 'D9BGIB3C77U133LMOJDG';
    const ttAccessToken = process.env.TIKTOK_ACCESS_TOKEN;

    let tiktokPromise;
    if (ttAccessToken) {
      tiktokPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        try {
          const tiktokEventMap = {
            'PageView': 'Pageview', // Lowercase 'v' for TikTok API v1.3
            'ViewContent': 'ViewContent',
            'InitiateCheckout': 'InitiateCheckout',
            'AddPaymentInfo': 'AddPaymentInfo',
            'Purchase': 'CompletePayment'
          };
          const mappedTikTokEvent = tiktokEventMap[eventName] || eventName;
          const unixSeconds = Math.floor(Date.now() / 1000);

          let contentsArr = [];
          if (customData && Array.isArray(customData.contents)) {
            contentsArr = customData.contents;
          } else if (customData && (customData.content_id || customData.content_ids)) {
            const cid = customData.content_id || (Array.isArray(customData.content_ids) ? customData.content_ids[0] : 'pcs_prompt_pack');
            contentsArr = [{
              content_id: cid,
              content_type: customData.content_type || 'product',
              content_name: customData.content_name || 'Portfolio Career AI Prompt Pack',
              quantity: 1,
              price: customData.value !== undefined ? Number(customData.value) : 27.00
            }];
          }

          const tiktokPayload = {
            event_source: "web",
            event_source_id: ttPixelId,
            pixel_code: ttPixelId,
            data: [
              {
                event: mappedTikTokEvent,
                event_id: eventId,
                event_time: unixSeconds,
                user: {
                  external_id: rawExternalId || undefined, // TikTok requires scalar string
                  email: hashedEmail || undefined,
                  ttclid: ttclid || undefined,
                  user_agent: userAgent,
                  ip: clientIp
                },
                page: {
                  url: pageUrl || ""
                },
                properties: {
                  value: customData && customData.value !== undefined ? Number(customData.value) : undefined,
                  currency: (customData && customData.currency) || "USD",
                  contents: contentsArr.length > 0 ? contentsArr : undefined
                }
              }
            ],
            ...(testCode ? { test_event_code: testCode } : {})
          };

          const ttEndpoint = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
          const ttRes = await fetch(ttEndpoint, {
            method: 'POST',
            headers: {
              'Access-Token': ttAccessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(tiktokPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const text = await ttRes.text();
          let data;
          try { data = JSON.parse(text); } catch(e) { data = text; }
          return { ok: ttRes.ok && (data?.code === 0), status: ttRes.status, data };
        } catch (err) {
          clearTimeout(timeoutId);
          return { ok: false, error: err.name === 'AbortError' ? 'TikTok CAPI request timed out (3.5s)' : err.message };
        }
      })();
    } else {
      tiktokPromise = Promise.resolve({ skipped: true, reason: 'TIKTOK_ACCESS_TOKEN not configured' });
    }

    // --- 3. PARALLEL NON-BLOCKING DISPATCH ---
    const [metaSettled, tiktokSettled] = await Promise.allSettled([metaPromise, tiktokPromise]);

    const metaResult = metaSettled.status === 'fulfilled' ? metaSettled.value : { ok: false, error: String(metaSettled.reason) };
    const tiktokResult = tiktokSettled.status === 'fulfilled' ? tiktokSettled.value : { ok: false, error: String(tiktokSettled.reason) };

    return res.status(200).json({
      success: true,
      meta: metaResult,
      tiktok: tiktokResult
    });
  } catch (err) {
    console.error('Dual CAPI server handler top-level error:', err);
    return res.status(200).json({ success: false, error: 'Internal handler fallback.' });
  }
}
