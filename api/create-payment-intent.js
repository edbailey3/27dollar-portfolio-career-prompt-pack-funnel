import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      console.error('[Create Payment Intent Error]: Missing STRIPE_SECRET_KEY in environment variables.');
      return res.status(500).json({ error: 'Server payment configuration error.' });
    }

    const { bump1, bump2, email, externalId } = req.body || {};

    const cleanEmail = (typeof email === 'string') ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }

    // Calculate server-side total in cents ($27 base, +$17 bump 1, +$12 bump 2)
    const isBump1 = Boolean(bump1);
    const isBump2 = Boolean(bump2);
    let amountInCents = 2700;
    if (isBump1) amountInCents += 1700;
    if (isBump2) amountInCents += 1200;

    const stripe = new Stripe(secretKey);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      receipt_email: cleanEmail,
      metadata: {
        email: cleanEmail,
        externalId: externalId ? String(externalId) : '',
        bump1: String(isBump1),
        bump2: String(isBump2)
      }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[Create Payment Intent Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to create payment intent.' });
  }
}
