import crypto from 'crypto';

/**
 * Server-Side Meta Conversions API (CAPI) Endpoint
 * Enforces 1:1 deterministic event_id deduplication matching client-side Browser Pixel events.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.warn('Meta CAPI endpoint: META_PIXEL_ID or META_ACCESS_TOKEN not configured in environment.');
      return res.status(200).json({ warning: 'Meta CAPI tokens not configured in environment.' });
    }

    const {
      eventName,
      eventId,
      email,
      fbp,
      fbc,
      eventSourceUrl,
      customData
    } = req.body || {};

    if (!eventName || !eventId) {
      return res.status(400).json({ error: 'Missing required eventName or eventId.' });
    }

    // Hash email using SHA256 if provided
    const hashedEmail = email && typeof email === 'string' && email.trim() !== ''
      ? crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
      : null;

    // Extract client IP and User-Agent directly
    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId, // Single source of truth event_id from client
          action_source: 'website',
          event_source_url: eventSourceUrl || req.headers?.referer || (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html',
          user_data: {
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            fbp: fbp || null,
            fbc: fbc || null,
            ...(hashedEmail ? { em: [hashedEmail] } : {})
          },
          custom_data: customData || {
            currency: 'USD',
            value: 27.00
          }
        }
      ]
    };

    const endpoint = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error('Meta Conversions API error response:', data);
      return res.status(400).json({ error: 'Meta CAPI rejected event', details: data });
    }

    return res.status(200).json({ success: true, eventId, result: data });
  } catch (err) {
    console.error('Meta CAPI server handler error:', err);
    return res.status(500).json({ error: 'Failed to process Meta CAPI event.' });
  }
}
