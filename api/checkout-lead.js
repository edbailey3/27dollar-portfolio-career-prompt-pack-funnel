/**
 * Serverless Kit Pre-Checkout Lead & Abandoned Cart Endpoint
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    // Resolve Kit Auth & Tag IDs across environment variable variations
    const apiKey = process.env.KIT_API_SECRET || process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY;
    const checkoutTagId = process.env.KIT_CHECKOUT_TAG_ID || process.env.KIT_INITIATED_CHECKOUT_TAG_ID || process.env.KIT_TAG_ID;

    if (!apiKey) {
      console.warn('[Kit Error]: Missing KIT_API_SECRET in env vars.');
    }
    if (!checkoutTagId) {
      console.warn('[Kit Error]: Missing KIT_CHECKOUT_TAG_ID in env vars.');
    }

    if (!apiKey || !checkoutTagId) {
      return res.status(200).json({
        success: true,
        message: 'Kit pre-checkout lead sync skipped due to missing environment configuration.',
        hasApiKey: Boolean(apiKey),
        hasCheckoutTagId: Boolean(checkoutTagId)
      });
    }

    const endpoint = `https://api.convertkit.com/v3/tags/${checkoutTagId}/subscribe`;
    const payload = {
      api_secret: apiKey,
      api_key: apiKey,
      email: trimmedEmail
    };

    console.log(`[Kit Pre-Checkout Lead] Subscribing ${trimmedEmail} to Tag ID ${checkoutTagId}...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log(`[Kit Pre-Checkout Lead Response] Status: ${response.status}`, data);

    if (!response.ok) {
      console.error(`[Kit Error]: Failed to subscribe ${trimmedEmail} to Tag ${checkoutTagId}:`, data);
      return res.status(400).json({ error: 'Kit API subscribe failed', status: response.status, details: data });
    }

    return res.status(200).json({ success: true, status: response.status, data });
  } catch (err) {
    console.error('[Kit Error]: Pre-checkout lead handler failure:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error processing pre-checkout lead.' });
  }
}
