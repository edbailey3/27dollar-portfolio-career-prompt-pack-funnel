/**
 * Serverless Kit Lead Capture & Abandoned Cart Endpoint
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

    const apiKey = process.env.KIT_API_KEY || process.env.CONVERTKIT_API_KEY;
    const formId = process.env.KIT_FORM_ID;

    if (!apiKey || !formId) {
      console.warn('Kit API key or Form ID missing in environment variables. Pre-checkout lead sync skipped.');
      return res.status(200).json({ success: true, message: 'Kit credentials skipped (not configured).' });
    }

    const response = await fetch(`https://api.convertkit.com/v3/forms/${formId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        email: trimmedEmail
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Kit API subscribe error response:', data);
      return res.status(400).json({ error: 'Kit API subscribe failed', details: data });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Pre-checkout lead handler error:', err);
    return res.status(500).json({ error: 'Internal server error processing lead.' });
  }
}
