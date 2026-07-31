import { buffer } from 'micro';
import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false
  }
};

/**
 * Helper utility to send Server-to-Server (S2S) tracking event to TikTok Events API (v1.3).
 */
async function sendTikTokEvent(email, orderId, capturedValue, req) {
  try {
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    const pixelId = process.env.TIKTOK_PIXEL_ID || 'D9BGIB3C77U133LMOJDG';

    if (!accessToken) {
      console.warn('[Webhook TikTok CAPI Skipped]: Missing TIKTOK_ACCESS_TOKEN.');
      return;
    }

    const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    const unixSeconds = Math.floor(Date.now() / 1000);

    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';

    const payload = {
      event_source: "web",
      event_source_id: pixelId,
      pixel_code: pixelId,
      data: [
        {
          event: "CompletePayment",
          event_id: orderId,
          event_time: unixSeconds,
          user: {
            email: hashedEmail,
            user_agent: userAgent,
            ip: clientIp
          },
          page: {
            url: (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html'
          },
          properties: {
            currency: "USD",
            value: capturedValue !== undefined ? Number(capturedValue) : 27.00,
            contents: [
              {
                price: capturedValue !== undefined ? Number(capturedValue) : 27.00,
                quantity: 1,
                content_id: "pcs-prompt-pack",
                content_type: "product",
                content_name: "Portfolio Career School Offer"
              }
            ]
          }
        }
      ]
    };

    const ttRes = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const status = ttRes.status;
    const text = await ttRes.text();
    console.log('[TikTok Webhook CAPI Status]', status, text);
  } catch (tiktokError) {
    console.error('TikTok Webhook Events API tracking failed:', tiktokError);
  }
}

/**
 * Helper utility to send Server-to-Server (S2S) tracking event to Meta Conversions API (v19.0).
 */
async function sendMetaCAPIEvent(email, orderId, capturedValue, req, externalId) {
  try {
    const pixelId = process.env.META_PIXEL_ID || '2772807839768527';
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      console.warn('[Webhook Meta CAPI Skipped]: META_ACCESS_TOKEN not configured.');
      return;
    }

    const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    const resolvedExternalId = externalId || hashedEmail;

    const rawIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const clientIp = (typeof rawIp === 'string' ? rawIp : '').split(',')[0].trim();
    const userAgent = req?.headers?.['user-agent'] || '';

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: orderId,
          action_source: "website",
          event_source_url: (process.env.SITE_URL || 'https://portfoliocareerschool.com') + '/checkout.html',
          user_data: {
            em: [hashedEmail],
            external_id: resolvedExternalId,
            client_ip_address: clientIp,
            client_user_agent: userAgent
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
      console.error('Meta Webhook CAPI error response:', data);
    }
  } catch (metaError) {
    console.error('Meta Webhook CAPI tracking failed:', metaError);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('[Stripe Webhook Error]: Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET.');
    return res.status(500).json({ error: 'Stripe webhook environment variables missing.' });
  }

  let rawBuffer;
  try {
    rawBuffer = await buffer(req);
  } catch (err) {
    console.error('[Stripe Webhook Error] Failed to read raw body buffer:', err);
    return res.status(400).json({ error: 'Failed to read request body.' });
  }

  const sig = req.headers['stripe-signature'];
  const stripe = new Stripe(stripeSecretKey);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBuffer, sig, webhookSecret);
  } catch (err) {
    console.error(`[Stripe Webhook Verification Error]: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const metadata = paymentIntent.metadata || {};

    const grossAmount = (paymentIntent.amount / 100).toFixed(2);
    const grossVal = parseFloat(grossAmount);
    const email = (metadata.email || paymentIntent.receipt_email || '').trim().toLowerCase();
    const externalId = metadata.externalId || '';
    const bump1 = metadata.bump1 === 'true';
    const bump2 = metadata.bump2 === 'true';

    console.log(`[Stripe Webhook Succeeded]: Order ${paymentIntent.id} for ${email} ($${grossAmount})`);

    // 1. Upstash Redis Sales Ledger Recording (pcs_prompt_pack_orders)
    try {
      const redis = Redis.fromEnv();

      let resolvedItemName = "Prompt Pack ($27)";
      if (grossVal === 56) resolvedItemName = "Prompt Pack + Both Bumps ($56)";
      else if (grossVal === 44) resolvedItemName = "Prompt Pack + Checklist Bump ($44)";
      else if (grossVal === 39) resolvedItemName = "Prompt Pack + Calculator Bump ($39)";
      else if (grossVal !== 27) resolvedItemName = `Prompt Pack ($${grossVal})`;

      const orderRecord = {
        orderId: paymentIntent.id,
        grossAmount: grossVal,
        items: resolvedItemName,
        timestamp: new Date().toISOString(),
        datePT: new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }),
        timePT: new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
      };

      await redis.rpush('pcs_prompt_pack_orders', JSON.stringify(orderRecord));
      console.log(`[Upstash Redis]: Order ${paymentIntent.id} recorded successfully.`);
    } catch (redisErr) {
      console.error('[Upstash Redis Webhook Error]: Failed to log order:', redisErr);
    }

    // 2. Kit Subscriber Tagging (Purchaser - Prompt Pack)
    const TAGS = {
      basePack: '20900737',        // $27 Base Prompts
      bumpChecklist: '20900740',  // $17 Career Checklist
      bumpCalculator: '20900743' // $12 Pricing Tool
    };

    const targetTags = [TAGS.basePack];
    if (bump1 || grossVal === 44 || grossVal === 56) targetTags.push(TAGS.bumpChecklist);
    if (bump2 || grossVal === 39 || grossVal === 56) targetTags.push(TAGS.bumpCalculator);

    const kitApiKey = process.env.KIT_API_SECRET || process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY;
    if (kitApiKey && email) {
      for (const tagId of targetTags) {
        try {
          const kitRes = await fetch(`https://api.convertkit.com/v3/tags/${tagId}/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_secret: kitApiKey,
              email: email
            })
          });
          const kitData = await kitRes.json();
          console.log(`[Kit Tag ${tagId} Subscribe Response]: Status ${kitRes.status}`, kitData);
        } catch (kitErr) {
          console.error(`[Kit Webhook Error] Failed to tag ${email} with tag ${tagId}:`, kitErr);
        }
      }
    } else {
      console.warn('[Kit Webhook Warning]: Kit API Key or email missing, skipping subscriber tagging.');
    }

    // 3. Dispatch Meta and TikTok S2S CAPI Telemetry using paymentIntent.id
    sendTikTokEvent(email, paymentIntent.id, grossVal, req).catch(err => {
      console.error('[Webhook sendTikTokEvent Error]:', err);
    });

    sendMetaCAPIEvent(email, paymentIntent.id, grossVal, req, externalId).catch(err => {
      console.error('[Webhook sendMetaCAPIEvent Error]:', err);
    });
  }

  return res.status(200).json({ received: true });
}
