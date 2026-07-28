import crypto from 'crypto';

function hashSha256(str) {
  if (!str || typeof str !== 'string') return undefined;
  const clean = str.trim().toLowerCase();
  if (!clean) return undefined;
  if (/^[a-f0-9]{64}$/.test(clean)) return clean;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Dual-Engine Server-Side Conversions API (CAPI) Endpoint
 * Synchronously dispatches events in parallel to Meta Conversions API (v19.0) and TikTok Web Events API (v1.3).
 * Enforces 1:1 deterministic event_id deduplication matching client-side Browser Pixel events.
 * Supports test_event_code / tt_test_code sandbox testing for both engines.
 */
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

    // Hash email using SHA256 if provided
    const hashedEmail = hashSha256(email);
    const resolvedExternalId = externalId || req.body?.external_id || hashedEmail || null;

    // Extract client IP and User-Agent directly
    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';
    const pageUrl = eventSourceUrl || req.headers?.referer || (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html';

    // --- 1. META CONVERSIONS API (v19.0) PREPARATION ---
    const metaPixelId = process.env.META_PIXEL_ID || '2772807839768527';
    const metaAccessToken = process.env.META_ACCESS_TOKEN;

    let metaPromise;
    if (metaAccessToken) {
      const metaEventName = eventName === 'CompletePayment' ? 'Purchase' : eventName;
      const metaPayload = {
        data: [
          {
            event_name: metaEventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: pageUrl,
            user_data: {
              client_ip_address: clientIp,
              client_user_agent: userAgent,
              ...(fbp ? { fbp } : {}),
              ...(fbc ? { fbc } : {}),
              ...(resolvedExternalId ? { external_id: resolvedExternalId } : {}),
              ...(hashedEmail ? { em: [hashedEmail] } : {})
            },
            custom_data: customData || {
              currency: 'USD',
              value: 27.00
            }
          }
        ],
        ...(testCode ? { test_event_code: testCode } : {})
      };

      const metaEndpoint = `https://graph.facebook.com/v19.0/${metaPixelId}/events?access_token=${metaAccessToken}`;
      metaPromise = fetch(metaEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaPayload)
      })
      .then(async (r) => {
        const data = await r.json();
        return { ok: r.ok, status: r.status, data };
      })
      .catch((err) => ({ ok: false, error: err.message }));
    } else {
      metaPromise = Promise.resolve({ skipped: true, reason: 'META_ACCESS_TOKEN not configured' });
    }

    // --- 2. TIKTOK WEB EVENTS API (v1.3) PREPARATION ---
    const ttPixelId = process.env.TIKTOK_PIXEL_ID || 'D9BGIB3C77U133LMOJDG';
    const ttAccessToken = process.env.TIKTOK_ACCESS_TOKEN;

    let tiktokPromise;
    if (ttAccessToken) {
      const tiktokEventMap = {
        'PageView': 'Pageview',
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
              external_id: externalId ? (externalId.length === 64 ? externalId : hashSha256(externalId)) : undefined,
              email: hashSha256(email),
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
        ]
      };

      if (testCode) {
        tiktokPayload.test_event_code = testCode;
      }

      const ttEndpoint = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
      tiktokPromise = fetch(ttEndpoint, {
        method: 'POST',
        headers: {
          'Access-Token': ttAccessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tiktokPayload)
      })
      .then(async (ttRes) => {
        const status = ttRes.status;
        const text = await ttRes.text();
        console.log('[TikTok CAPI Status]', status, text);
        let data;
        try { data = JSON.parse(text); } catch(e) { data = text; }
        return { ok: ttRes.ok && (data?.code === 0), status, data };
      })
      .catch((err) => ({ ok: false, error: err.message }));
    } else {
      tiktokPromise = Promise.resolve({ skipped: true, reason: 'TIKTOK_ACCESS_TOKEN not configured' });
    }

    // --- 3. PARALLEL DISPATCH VIA Promise.allSettled() ---
    const [metaSettled, tiktokSettled] = await Promise.allSettled([metaPromise, tiktokPromise]);

    const metaResult = metaSettled.status === 'fulfilled' ? metaSettled.value : { ok: false, error: metaSettled.reason?.message || String(metaSettled.reason) };
    const tiktokResult = tiktokSettled.status === 'fulfilled' ? tiktokSettled.value : { ok: false, error: tiktokSettled.reason?.message || String(tiktokSettled.reason) };

    return res.status(200).json({
      success: true,
      meta: metaResult,
      tiktok: tiktokResult
    });
  } catch (err) {
    console.error('Dual CAPI server handler error:', err);
    return res.status(500).json({ error: 'Failed to process dual CAPI events.' });
  }
}
