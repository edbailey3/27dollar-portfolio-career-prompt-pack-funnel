export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, product } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: 'Email field is missing.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    if (!process.env.KIT_API_SECRET) {
      console.error("KIT_API_SECRET environment variable is missing.");
      return res.status(500).json({ error: "Kit API secret is not configured on the server." });
    }

    // 1. Create (or retrieve if it already exists) the "Intent: Initiated Checkout" tag in Kit.
    // ConvertKit/Kit's POST /v3/tags API is idempotent: if the tag name exists, it returns the existing tag's details.
    const tagResponse = await fetch('https://api.convertkit.com/v3/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_secret: process.env.KIT_API_SECRET,
        tag: {
          name: 'Intent: Initiated Checkout'
        }
      })
    });

    if (!tagResponse.ok) {
      const errorText = await tagResponse.text();
      console.error(`Kit tag creation/retrieval failed: ${errorText}`);
      return res.status(502).json({ error: "Failed to resolve tag in Kit." });
    }

    const tagData = await tagResponse.json();
    const tagId = tagData?.tag?.id || tagData?.id;

    if (!tagId) {
      console.error("Failed to extract tag ID from Kit response:", tagData);
      return res.status(502).json({ error: "Tag ID not found in Kit response." });
    }

    // 2. Subscribe the email to this tag
    const subscribeResponse = await fetch(`https://api.convertkit.com/v3/tags/${tagId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_secret: process.env.KIT_API_SECRET,
        email: email
      })
    });

    if (!subscribeResponse.ok) {
      const errorText = await subscribeResponse.text();
      console.error(`Kit tag subscription failed: ${errorText}`);
      return res.status(502).json({ error: "Failed to add subscriber to tag in Kit." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Checkout initiated API error: ", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
