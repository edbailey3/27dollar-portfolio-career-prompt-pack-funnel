export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email field is missing.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    if (!process.env.KIT_API_SECRET) {
      console.warn("KIT_API_SECRET environment variable is missing.");
      return res.status(200).json({ success: false, warning: "Kit API secret is not configured." });
    }

    // Setup 3-second timeout controller for Kit API calls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const tagResponse = await fetch('https://api.convertkit.com/v3/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_secret: process.env.KIT_API_SECRET,
          tag: { name: 'Intent: Initiated Checkout' }
        })
      });

      if (!tagResponse.ok) {
        console.error(`Kit tag creation failed for ${normalizedEmail}`);
        return res.status(200).json({ success: false, warning: "Kit tag resolution skipped." });
      }

      const tagData = await tagResponse.json();
      const tagId = tagData?.tag?.id || tagData?.id;

      if (tagId) {
        await fetch(`https://api.convertkit.com/v3/tags/${tagId}/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            api_secret: process.env.KIT_API_SECRET,
            email: normalizedEmail
          })
        });
      }
    } catch (apiErr) {
      console.error("Kit API sync timeout or network error:", apiErr.message);
    } finally {
      clearTimeout(timeoutId);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Draft checkout API error:", err);
    return res.status(200).json({ success: false, error: "Internal server error." });
  }
}
