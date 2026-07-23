/**
 * Vercel Serverless Webhook Handler for TikTok Lead Ads
 * Form ID: 7665583952505356561
 * Target System: Kit (ConvertKit API v3)
 */

export default async function handler(req, res) {
  // 1. Webhook Verification & Challenge (GET / POST pings)
  if (req.method === 'GET') {
    const challenge = req.query?.challenge || req.query?.['hub.challenge'] || req.query?.echostr;
    if (challenge) {
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ success: true, message: 'TikTok Webhook Endpoint Active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // Optional webhook verification token check (if configured)
    const secretToken = process.env.TIKTOK_WEBHOOK_SECRET;
    if (secretToken) {
      const incomingToken = req.headers['x-tiktok-token'] || req.query?.token || body.secret_token;
      if (incomingToken !== secretToken) {
        console.warn('[TikTok Webhook] Unauthorized webhook attempt - token mismatch');
        return res.status(200).json({ status: 'success', warning: 'Unauthorized' });
      }
    }

    // 2. Verification / Challenge Ping in POST body
    if (body.type === 'verify' || body.challenge || body.event === 'ping') {
      return res.status(200).json({ success: true, challenge: body.challenge });
    }

    // 3. Form Isolation & Extraction
    const formId = body.form_id || body.lead_info?.form_id || body.entry?.[0]?.changes?.[0]?.value?.form_id || '7665583952505356561';

    let extractedEmail = '';
    let extractedFirstName = '';
    let extractedLastName = '';
    let extractedPhone = '';
    let extractedCustomAnswer = '';

    // Sanitizer helper for raw strings / XSS prevention
    const sanitize = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    };

    // Helper to find field value in array of fields/user_data
    const findFieldValue = (fieldsArray, keywords) => {
      if (!Array.isArray(fieldsArray)) return '';
      for (const field of fieldsArray) {
        const name = (field.field_name || field.name || field.key || field.type || '').toLowerCase();
        const label = (field.field_label || field.label || '').toLowerCase();
        if (keywords.some(kw => name.includes(kw) || label.includes(kw))) {
          const val = field.values ? field.values[0] : (field.value || field.val);
          if (val) return sanitize(String(val));
        }
      }
      return '';
    };

    // Extract from TikTok user_data or lead_info array
    const userData = body.user_data || body.user_info || body.lead_info?.user_data || body.entry?.[0]?.changes?.[0]?.value?.user_data || [];

    if (Array.isArray(userData) && userData.length > 0) {
      extractedEmail = findFieldValue(userData, ['email']);
      extractedFirstName = findFieldValue(userData, ['first_name', 'given_name', 'first']);
      extractedLastName = findFieldValue(userData, ['last_name', 'family_name', 'last']);
      extractedPhone = findFieldValue(userData, ['phone', 'mobile', 'cell', 'telephone']);
      extractedCustomAnswer = findFieldValue(userData, ['tried', 'invested', 'prior', 'question', 'custom']);
    }

    // Fallback to flat JSON payload fields if user_data array wasn't present
    if (!extractedEmail && body.email) extractedEmail = sanitize(String(body.email));
    if (!extractedEmail && body.email_address) extractedEmail = sanitize(String(body.email_address));
    if (!extractedFirstName && body.first_name) extractedFirstName = sanitize(String(body.first_name));
    if (!extractedLastName && body.last_name) extractedLastName = sanitize(String(body.last_name));
    if (!extractedPhone && (body.phone_number || body.phone)) extractedPhone = sanitize(String(body.phone_number || body.phone));
    if (!extractedCustomAnswer && (body.prior_investments || body.custom_answer)) extractedCustomAnswer = sanitize(String(body.prior_investments || body.custom_answer));

    // Normalize email
    extractedEmail = extractedEmail.toLowerCase().trim();

    // 4. Validate Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!extractedEmail || !emailRegex.test(extractedEmail)) {
      console.warn(`[TikTok Webhook] Received payload without valid email for Form ${formId}`);
      // Always respond with HTTP 200 so TikTok's webhook engine doesn't disable URL
      return res.status(200).json({ status: 'success', warning: 'Missing or invalid email input' });
    }

    // 5. Kit (ConvertKit) API Dispatch
    const kitTagId = process.env.KIT_TIKTOK_TAG_ID;
    const kitApiSecret = process.env.KIT_API_SECRET;

    if (!kitApiSecret) {
      console.warn('[TikTok Webhook] Warning: KIT_API_SECRET is missing in environment variables.');
      return res.status(200).json({ status: 'success', warning: 'Server configuration missing KIT_API_SECRET' });
    }

    const kitEndpoint = kitTagId 
      ? `https://api.convertkit.com/v3/tags/${kitTagId}/subscribe`
      : `https://api.convertkit.com/v3/forms/subscribe`;

    const kitPayload = {
      api_secret: kitApiSecret,
      email: extractedEmail,
      first_name: extractedFirstName || '',
      fields: {
        last_name: extractedLastName || '',
        phone_number: extractedPhone || '',
        prior_investments: extractedCustomAnswer || ''
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const kitResponse = await fetch(kitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(kitPayload)
      });

      if (!kitResponse.ok) {
        console.error(`[TikTok Webhook] Kit API error for ${extractedEmail}`);
      } else {
        console.log(`[TikTok Webhook] Form ${formId} lead synced to Kit: ${extractedEmail}`);
      }
    } catch (kitErr) {
      console.error(`[TikTok Webhook] Kit dispatch timeout/error: ${kitErr.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    // 6. Return HTTP 200 success to TikTok
    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('[TikTok Webhook] Error processing lead submission:', err?.message || err);
    // Return 200 so TikTok webhook retry loop is not triggered uncontrollably
    return res.status(200).json({ status: 'success' });
  }
}
