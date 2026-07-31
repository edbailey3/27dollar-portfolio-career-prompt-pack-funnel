export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

  if (!publishableKey) {
    console.warn('[Stripe Config Warning]: STRIPE_PUBLISHABLE_KEY is not set in environment variables.');
  }

  return res.status(200).json({ publishableKey });
}
