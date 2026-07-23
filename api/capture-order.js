import crypto from 'crypto';

/**
 * Helper utility to send Server-to-Server (S2S) tracking event to TikTok Events API (v1.3).
 *
 * @param {string} email - Customer email address
 * @param {string} orderId - Order identifier (e.g. PayPal Order ID for deduplication)
 * @param {number} capturedValue - Exact numerical value of settled transaction
 * @param {import('http').IncomingMessage} req - The incoming HTTP request object
 */
export async function sendTikTokEvent(email, orderId, capturedValue, req) {
  try {
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    const pixelId = process.env.TIKTOK_PIXEL_ID;

    if (!accessToken) {
      console.warn('TikTok Access Token is missing in environment variables.');
      return;
    }

    const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';

    const payload = {
      pixel_code: pixelId,
      event: "CompletePayment",
      event_id: orderId,
      timestamp: new Date().toISOString(),
      context: {
        user: {
          email: hashedEmail
        },
        ip: clientIp,
        user_agent: userAgent,
        page: {
          url: "https://yourdomain.com/checkout.html"
        }
      },
      properties: {
        currency: "USD",
        value: capturedValue || 27.00,
        contents: [
          {
            price: capturedValue || 27.00,
            quantity: 1,
            content_id: "pcs-prompt-pack",
            content_type: "product",
            content_name: "Portfolio Career School Offer"
          }
        ]
      }
    };

    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      console.error('TikTok Events API error response:', data);
    }
  } catch (tiktokError) {
    console.error('TikTok Events API tracking failed:', tiktokError);
  }
}

/**
 * Helper utility to send Server-to-Server (S2S) tracking event to Meta Conversions API (v19.0).
 *
 * @param {string} email - Customer email address
 * @param {string} orderId - Order identifier (e.g. PayPal Order ID for deduplication)
 * @param {number} capturedValue - Exact numerical value of settled transaction
 * @param {import('http').IncomingMessage} req - The incoming HTTP request object
 */
export async function sendMetaCAPIEvent(email, orderId, capturedValue, req) {
  try {
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.warn('Meta CAPI tracking skipped: META_PIXEL_ID or META_ACCESS_TOKEN is not configured.');
      return;
    }

    const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';

    // Extract _fbp and _fbc cookies if present
    const cookieHeader = req?.headers?.cookie || '';
    const getCookie = (name) => {
      const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    };
    const fbpCookie = getCookie('_fbp');
    const fbcCookie = getCookie('_fbc');

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: orderId,
          action_source: "website",
          event_source_url: "https://yourdomain.com/checkout.html",
          user_data: {
            em: [hashedEmail],
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            fbp: fbpCookie || null,
            fbc: fbcCookie || null
          },
          custom_data: {
            currency: "USD",
            value: capturedValue || 27.00,
            content_name: "Portfolio Career School Offer",
            content_ids: ["pcs-prompt-pack"],
            content_type: "product"
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
    }
  } catch (metaError) {
    console.error('Meta Conversions API tracking failed:', metaError);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderID, email } = req.body || {};

    if (!orderID || !email) {
      return res.status(400).json({ error: 'Order verification fields are missing.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    // 1. Authenticate and Generate PayPal OAuth Token
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET_KEY}`).toString('base64');
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    const { access_token } = await tokenResponse.json();

    // 2. Capture the funds securely from PayPal
    const captureResponse = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      }
    });
    const captureData = await captureResponse.json();

    // If payment fails or is rejected, stop the script immediately
    if (captureData.status !== 'COMPLETED') {
      return res.status(400).json(captureData);
    }

    // Extract exact payload-derived captured value from PayPal response
    const captureObj = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const capturedValue = captureObj?.amount?.value ? parseFloat(captureObj.amount.value) : 27.00;

    // 3. THE KIT FULFILLMENT LOGIC
    // Replace these placeholder numbers with your real Kit Tag IDs from Phase 1
    const TAGS = {
      basePack: '20900737',        // $27 Base Prompts
      bumpChecklist: '20900740',  // $17 Career Checklist
      bumpCalculator: '20900743' // $12 Pricing Tool
    };

    const targetTags = [TAGS.basePack]; // Every buyer automatically gets the base prompt pack tag

    if (capturedValue === 44) targetTags.push(TAGS.bumpChecklist);
    if (capturedValue === 39) targetTags.push(TAGS.bumpCalculator);
    if (capturedValue === 56) {
      targetTags.push(TAGS.bumpChecklist);
      targetTags.push(TAGS.bumpCalculator);
    }

    // 4. Fire the data payload straight to Kit's server nodes
    for (const tagId of targetTags) {
      await fetch(`https://api.convertkit.com/v3/tags/${tagId}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_secret: process.env.KIT_API_SECRET,
          email: email
        })
      });
    }

    // 5. Fire TikTok and Meta Server-to-Server (S2S) tracking asynchronously (non-blocking) with dynamic capturedValue
    sendTikTokEvent(email, orderID, capturedValue, req).catch(err => {
      console.error('Background sendTikTokEvent error:', err);
    });

    sendMetaCAPIEvent(email, orderID, capturedValue, req).catch(err => {
      console.error('Background sendMetaCAPIEvent error:', err);
    });

    return res.status(200).json({ success: true, status: 'COMPLETED', value: capturedValue, orderID });
  } catch (err) {
    console.error("PayPal Capture Order Error: ", err);
    return res.status(500).json({ error: "Failed to verify transaction." });
  }
}