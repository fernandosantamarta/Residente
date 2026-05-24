require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Webhook needs raw body — must come before express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    console.log(`Payment succeeded: ${intent.id} — $${intent.amount / 100} from ${intent.metadata.resident_name} (Unit ${intent.metadata.unit})`);
    // TODO: update your database, send confirmation email, etc.
  }

  res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Create a payment intent for HOA dues
app.post('/create-payment-intent', async (req, res) => {
  const { amount, resident_name, unit, email } = req.body;

  if (!amount || !resident_name || !unit) {
    return res.status(400).json({ error: 'amount, resident_name, and unit are required' });
  }

  const amountInCents = Math.round(parseFloat(amount) * 100);
  if (isNaN(amountInCents) || amountInCents < 50) {
    return res.status(400).json({ error: 'Invalid payment amount' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      receipt_email: email || undefined,
      metadata: { resident_name, unit },
      description: `HOA Dues — ${resident_name}, Unit ${unit}`,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Payment setup failed. Please try again.' });
  }
});

// Fetch recent payments (for a simple admin view)
app.get('/payments', async (req, res) => {
  try {
    const intents = await stripe.paymentIntents.list({ limit: 20 });
    const payments = intents.data.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      status: p.status,
      resident: p.metadata.resident_name || 'Unknown',
      unit: p.metadata.unit || '—',
      date: new Date(p.created * 1000).toLocaleDateString(),
    }));
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch payments' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Residente server running at http://localhost:${PORT}`));
