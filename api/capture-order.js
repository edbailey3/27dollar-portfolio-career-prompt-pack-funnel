export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderID, email } = req.body;

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

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}