/**
 * Serverless Kit TikTok Lead Sync Endpoint
 */
export default async function handler(req, res) {
  // Support GET verification / health pings
  if (req.method === 'GET') {
    const challenge = req.query?.challenge || req.query?.['hub.challenge'] || req.query?.echostr;
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ success: true, message: 'TikTok Lead Sync Endpoint Active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // Handle TikTok verification / ping events
    if (body.type === 'verify' || body.challenge || body.event === 'ping') {
      return res.status(200).json({ success: true, challenge: body.challenge });
    }

    // Extract email from flat fields or user_data array
    let extractedEmail = body.email || body.user_email || body.email_address || '';

    if (!extractedEmail && Array.isArray(body.user_data)) {
      for (const field of body.user_data) {
        const name = (field.field_name || field.name || field.key || field.type || '').toLowerCase();
        if (name.includes('email')) {
          const val = field.values ? field.values[0] : (field.value || field.val);
          if (val) {
            extractedEmail = String(val);
            break;
          }
        }
      }
    }

    if (!extractedEmail || typeof extractedEmail !== 'string') {
      console.warn('[TikTok Lead Sync] Received payload without email field:', body);
      return res.status(200).json({ status: 'success', warning: 'Missing or invalid email in request payload.' });
    }

    const trimmedEmail = extractedEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      console.warn(`[TikTok Lead Sync] Email failed regex validation: ${trimmedEmail}`);
      return res.status(200).json({ status: 'success', warning: 'Invalid email format' });
    }

    // Resolve Kit Auth & TikTok Tag IDs across variable variations
    const apiKey = process.env.KIT_API_SECRET || process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY;
    const tikTokTagId = process.env.KIT_TIKTOK_TAG_ID || process.env.Kit_tiktok_tag_id;

    if (!apiKey) {
      console.warn('[Kit Error]: Missing KIT_API_SECRET in env vars.');
    }
    if (!tikTokTagId) {
      console.warn('[Kit Error]: Missing KIT_TIKTOK_TAG_ID in env vars.');
    }

    if (!apiKey || !tikTokTagId) {
      return res.status(200).json({
        status: 'success',
        message: 'TikTok lead sync skipped due to missing environment configuration.',
        hasApiKey: Boolean(apiKey),
        hasTikTokTagId: Boolean(tikTokTagId)
      });
    }

    const endpoint = `https://api.convertkit.com/v3/tags/${tikTokTagId}/subscribe`;
    const payload = {
      api_secret: apiKey,
      api_key: apiKey,
      email: trimmedEmail
    };

    console.log(`[TikTok Lead Sync] Subscribing ${trimmedEmail} to Kit Tag ID ${tikTokTagId}...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log(`[TikTok Lead Sync Response] Status: ${response.status}`, data);

    if (!response.ok) {
      console.error(`[Kit Error]: TikTok lead sync failed for ${trimmedEmail}:`, data);
      return res.status(200).json({ status: 'success', warning: 'Kit API error', details: data });
    }

    return res.status(200).json({ status: 'success', kitStatus: response.status, data });
  } catch (err) {
    console.error('[Kit Error]: TikTok lead handler failure:', err?.message || err);
    return res.status(200).json({ status: 'success', error: err?.message || 'Server error' });
  }
}
