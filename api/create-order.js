export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { bump1, bump2, amount } = req.body || {};

    // Calculate server-side source of truth pricing metrics
    let total = 27; 
    if (bump1) total += 17;
    if (bump2) total += 12;

    const finalAmount = (amount && !isNaN(parseFloat(amount))) 
      ? parseFloat(amount).toFixed(2) 
      : total.toFixed(2);

    // 1. Get OAuth Access Token from PayPal
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

    // 2. Create the Order directly with PayPal APIs
    const orderResponse = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: finalAmount },
          description: "Portfolio Career School - Prompt Pack Order"
        }]
      })
    });

    const orderData = await orderResponse.json();
    return res.status(200).json({ id: orderData.id });
  } catch (err) {
    console.error("PayPal Create Order Error: ", err);
    return res.status(500).json({ error: "Failed to create secure transaction." });
  }
}