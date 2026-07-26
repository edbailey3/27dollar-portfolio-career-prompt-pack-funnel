import crypto from 'crypto';

/**
 * Dual-Engine Server-Side Conversions API (CAPI) Endpoint
 * Synchronously dispatches events to Meta Conversions API (v19.0) and TikTok Web Events API (v1.3).
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

    const testCode = test_event_code || req.query?.test_event_code || req.query?.tt_test_code || req.body?.test_code || null;

    // Hash email using SHA256 if provided
    const hashedEmail = email && typeof email === 'string' && email.trim() !== ''
      ? crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
      : null;

    const resolvedExternalId = externalId || req.body?.external_id || hashedEmail || null;

    // Extract client IP and User-Agent directly
    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';
    const pageUrl = eventSourceUrl || req.headers?.referer || (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html';

    const dispatchPromises = [];

    // --- 1. META CONVERSIONS API (v19.0) DISPATCH ---
    const metaPixelId = process.env.META_PIXEL_ID;
    const metaAccessToken = process.env.META_ACCESS_TOKEN;

    if (metaPixelId && metaAccessToken) {
      const metaPayload = {
        data: [
          {
            event_name: eventName === 'CompletePayment' ? 'Purchase' : eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: pageUrl,
            user_data: {
              client_ip_address: clientIp,
              client_user_agent: userAgent,
              fbp: fbp || null,
              fbc: fbc || null,
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
      dispatchPromises.push(
        fetch(metaEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metaPayload)
        })
        .then(async (res) => {
          const data = await res.json();
          return { engine: 'meta', status: res.status, ok: res.ok, data };
        })
        .catch((err) => ({ engine: 'meta', ok: false, error: err.message }))
      );
    } else {
      console.warn('Meta CAPI skipped: META_PIXEL_ID or META_ACCESS_TOKEN not configured.');
    }

    // --- 2. TIKTOK WEB EVENTS API (v1.3) DISPATCH ---
    const ttPixelId = process.env.TIKTOK_PIXEL_ID;
    const ttAccessToken = process.env.TIKTOK_ACCESS_TOKEN;

    if (ttPixelId && ttAccessToken) {
      let ttEvent = eventName;
      if (eventName === 'Purchase') ttEvent = 'CompletePayment';

      const ttValue = customData?.value || 27.00;
      const ttCurrency = customData?.currency || 'USD';
      const ttContentId = customData?.content_id || (customData?.content_ids ? customData.content_ids[0] : 'pcs-prompt-pack');

      const ttPayload = {
        pixel_code: ttPixelId,
        event: ttEvent,
        event_id: eventId,
        timestamp: new Date().toISOString(),
        context: {
          user: {
            ...(hashedEmail ? { email: hashedEmail } : {}),
            ...(ttclid ? { ttclid: ttclid } : {}),
            ...(resolvedExternalId ? { external_id: resolvedExternalId } : {})
          },
          ip: clientIp,
          user_agent: userAgent,
          page: { url: pageUrl }
        },
        properties: {
          currency: ttCurrency,
          value: ttValue,
          contents: [
            {
              price: ttValue,
              quantity: 1,
              content_id: ttContentId,
              content_type: 'product'
            }
          ]
        },
        ...(testCode ? { test_event_code: testCode } : {})
      };

      const ttEndpoint = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
      dispatchPromises.push(
        fetch(ttEndpoint, {
          method: 'POST',
          headers: {
            'Access-Token': ttAccessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(ttPayload)
        })
        .then(async (res) => {
          const data = await res.json();
          return { engine: 'tiktok', status: res.status, ok: res.ok && data.code === 0, data };
        })
        .catch((err) => ({ engine: 'tiktok', ok: false, error: err.message }))
      );
    } else {
      console.warn('TikTok CAPI skipped: TIKTOK_PIXEL_ID or TIKTOK_ACCESS_TOKEN not configured.');
    }

    const results = await Promise.all(dispatchPromises);
    return res.status(200).json({ success: true, eventId, results });
  } catch (err) {
    console.error('Dual CAPI server handler error:', err);
    return res.status(500).json({ error: 'Failed to process dual CAPI events.' });
  }
}
