import crypto from 'crypto';

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
      return res.status(400).json({ error: 'Payment authorization failed' });
    }

    // 3. THE KIT FULFILLMENT LOGIC
    // Replace these placeholder numbers with your real Kit Tag IDs from Phase 1
    const TAGS = {
      basePack: '20900737',        // $27 Base Prompts
      bumpChecklist: '20900740',  // $17 Career Checklist
      bumpCalculator: '20900743' // $12 Pricing Tool
    };

    const targetTags = [TAGS.basePack]; // Every buyer automatically gets the base prompt pack tag

    // Read the items matching the transaction history inside PayPal's secure response data
    const description = captureData.purchase_units[0].payments.captures[0].custom_id || "";
    
    // Check which order bumps were added based on the final total calculation
    const totalPaid = parseFloat(captureData.purchase_units[0].payments.captures[0].amount.value);
    
    if (totalPaid === 44) targetTags.push(TAGS.bumpChecklist);
    if (totalPaid === 39) targetTags.push(TAGS.bumpCalculator);
    if (totalPaid === 56) {
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

    // 5. Secure Server-to-Server TikTok Events API Tracking
    try {
      const tiktokAccessToken = process.env.TIKTOK_ACCESS_TOKEN;
      if (tiktokAccessToken) {
        const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || '';

        const payerNameObj = captureData.payer?.name || captureData.payment_source?.paypal?.name || {};
        const firstName = payerNameObj.given_name || '';
        const lastName = payerNameObj.surname || '';
        const fullName = `${firstName} ${lastName}`.trim();

        const hashedEmail = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
        const hashedName = fullName ? crypto.createHash('sha256').update(fullName.trim().toLowerCase()).digest('hex') : '';
        const event_id = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderID;

        const tiktokPayload = {
          event_source: 'web',
          event_source_id: 'D9BGIB3C77U133LMOJDG',
          data: [
            {
              event: 'Purchase',
              event_time: Math.floor(Date.now() / 1000),
              event_id: event_id,
              user: {
                email: hashedEmail,
                name: hashedName,
                ip: clientIp,
                user_agent: userAgent
              },
              properties: {
                value: totalPaid,
                currency: 'USD'
              }
            }
          ]
        };

        await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
          method: 'POST',
          headers: {
            'Access-Token': tiktokAccessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(tiktokPayload)
        });
      } else {
        console.warn('TikTok Access Token is missing in environment variables.');
      }
    } catch (tiktokError) {
      console.error('TikTok Events API tracking failed:', tiktokError);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PayPal Capture Order Error: ", err);
    return res.status(500).json({ error: "Failed to verify transaction." });
  }
}