import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { carriers } from './carriers/demo.js';
import authRouter from './auth.js';
import { Address, Payment, Shipment, User } from './models.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session.js';

const app = express();
const port = Number(process.env.PORT || 4000);
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.post(
  '/api/webhooks/razorpay',
  express.raw({ type: 'application/json' }),
  handleRazorpayWebhook,
);
app.use(express.json({ limit: '1mb' }));
app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }),
);
app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret:
      process.env.SESSION_SECRET ||
      (process.env.NODE_ENV === 'production'
        ? undefined
        : 'local-development-only-change-this-secret'),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60,
    }),
    cookie: sessionCookieOptions(),
  }),
);

app.use('/api/auth', authRouter);

// Quote data remains a short-lived demo store; shipments and addresses persist in MongoDB.
const quotes = new Map();
const addressSchema = z.object({
  label: z.string().trim().min(1).max(80),
  contactName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(20).optional().default(''),
  address: z.string().trim().min(5).max(300),
  pin: z.string().regex(/^\d{6}$/),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default(''),
  type: z.string().optional().default('Pickup'),
  default: z.boolean().optional().default(false),
});
const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  businessName: z.string().trim().max(120).optional().default(''),
  mobile: z.string().trim().max(20).optional().default(''),
  businessAddress: z.string().trim().max(300).optional().default(''),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional()
    .default(''),
});
const quoteSchema = z.object({
  pickupPin: z.string().regex(/^\d{6}$/),
  destinationPin: z.string().regex(/^\d{6}$/),
  weightGrams: z.coerce.number().positive(),
  lengthCm: z.coerce.number().nonnegative().optional().default(0),
  widthCm: z.coerce.number().nonnegative().optional().default(0),
  heightCm: z.coerce.number().nonnegative().optional().default(0),
  paymentType: z.enum(['Prepaid', 'COD']).default('Prepaid'),
});
const paymentOrderSchema = z.object({
  quoteId: z.string().min(1),
  provider: z.string().min(1).max(80),
  idempotencyKey: z.string().min(8).max(80),
  shipment: z.object({
    recipient: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(8).max(20),
    address: z.string().trim().min(5).max(300),
    destination: z.string().regex(/^\d{6}$/),
    city: z.string().trim().max(100).optional().default(''),
    state: z.string().trim().max(100).optional().default(''),
    pickupName: z.string().trim().min(1).max(100),
    pickupPhone: z.string().trim().min(8).max(20),
    pickupAddress: z.string().trim().min(5).max(300),
    pickupPin: z.string().regex(/^\d{6}$/),
    pickupCity: z.string().trim().max(100).optional().default(''),
    pickupState: z.string().trim().max(100).optional().default(''),
    weight: z.coerce.number().positive(),
    length: z.coerce.number().positive(),
    width: z.coerce.number().positive(),
    height: z.coerce.number().positive(),
    description: z.string().trim().max(200).optional().default(''),
    value: z.coerce.number().nonnegative(),
    paymentType: z.enum(['Prepaid', 'COD']),
    codAmount: z.coerce.number().nonnegative().optional().default(0),
  }),
});
const carrierByName = name =>
  carriers.find(c => c.name.toLowerCase() === String(name).toLowerCase());

const razorpayConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

function razorpaySignature(secret, value) {
  return createHmac('sha256', secret).update(value).digest();
}

function signatureMatches(actual, expected) {
  if (typeof actual !== 'string' || !/^[a-f\d]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), expected);
}

async function razorpayRequest(path, method = 'GET', payload) {
  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.description || 'Payment provider request failed.');
  return data;
}

async function finalizeCapturedPayment(payment, gatewayPayment) {
  if (
    gatewayPayment.status !== 'captured' ||
    gatewayPayment.order_id !== payment.gatewayOrderId ||
    gatewayPayment.amount !== payment.amountPaise ||
    gatewayPayment.currency !== payment.currency
  )
    throw new Error('Payment details do not match the pending checkout.');

  if (payment.status === 'used' && payment.shipmentId)
    return Shipment.findById(payment.shipmentId).lean();

  payment.status = 'paid';
  payment.gatewayPaymentId = gatewayPayment.id;
  payment.method = gatewayPayment.method;
  payment.paidAt = new Date();
  await payment.save();

  let shipment = await Shipment.findOne({ paymentId: payment._id });
  if (!shipment) {
    const draft = payment.shipmentDraft;
    const providerCode = payment.carrier.slice(0, 2).toUpperCase();
    try {
      shipment = await Shipment.create({
        id: draft.idempotencyKey,
        sellerId: payment.sellerId,
        awb: `${providerCode}${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
        provider: payment.carrier,
        recipient: draft.recipient,
        destination: draft.destination,
        date: new Intl.DateTimeFormat('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        }).format(new Date()),
        amount: payment.amountPaise / 100,
        status: 'Pickup scheduled',
        paymentId: payment._id,
        idempotencyKey: draft.idempotencyKey,
        details: draft,
        demo: true,
        events: [],
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      shipment = await Shipment.findOne({ paymentId: payment._id });
      if (!shipment) throw error;
    }
  }

  payment.status = 'used';
  payment.shipmentId = shipment._id;
  await payment.save();
  return shipment.toObject();
}

async function handleRazorpayWebhook(req, res, next) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Payment webhook is not configured.' });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid webhook body.' });
    const expected = razorpaySignature(secret, req.body);
    if (!signatureMatches(req.get('x-razorpay-signature'), expected))
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    const event = JSON.parse(req.body.toString('utf8'));
    const gatewayPayment = event.payload?.payment?.entity;
    if (event.event === 'payment.captured' && gatewayPayment?.order_id) {
      const payment = await Payment.findOne({ gatewayOrderId: gatewayPayment.order_id });
      if (payment) await finalizeCapturedPayment(payment, gatewayPayment);
    } else if (event.event === 'payment.failed' && gatewayPayment?.order_id) {
      await Payment.updateOne(
        { gatewayOrderId: gatewayPayment.order_id, status: 'created' },
        { $set: { status: 'failed', failureReason: gatewayPayment.error_description || '' } },
      );
    }
    return res.json({ received: true });
  } catch (error) {
    return next(error);
  }
}

const validate = (schema, req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
};

async function requireVerifiedSeller(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    const user = await User.findById(req.session.userId).select('+sessionVersion');
    if (
      !user ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      user.sessionVersion !== req.session.sessionVersion
    ) {
      return req.session.destroy(() => {
        res.clearCookie('parcelsetus.sid');
        res.status(401).json({ error: 'Your session has expired. Sign in again.' });
      });
    }
    req.sellerId = user.id;
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'parcelsetus-api' }));
app.get('/api/providers', (_req, res) =>
  res.json(carriers.map(({ name, capabilities }) => ({ name, capabilities, mode: 'demo' }))),
);
app.use('/api', requireVerifiedSeller);
app.post('/api/payments/razorpay/order', async (req, res, next) => {
  try {
    if (!razorpayConfigured())
      return res.status(503).json({ error: 'UPI checkout is not configured on the server yet.' });
    const parsed = paymentOrderSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: 'Check shipment details before paying.' });
    const { quoteId, provider, idempotencyKey } = parsed.data;
    const quote = quotes.get(quoteId);
    if (!quote || quote.expiresAt < new Date().toISOString() || quote.carrier !== provider)
      return res.status(409).json({ error: 'This courier quote expired. Choose a courier again.' });
    if (parsed.data.shipment.paymentType === 'COD' && parsed.data.shipment.codAmount <= 0)
      return res.status(400).json({ error: 'Enter a valid cash-on-delivery amount.' });

    let payment = await Payment.findOne({ sellerId: req.sellerId, idempotencyKey });
    if (payment && (payment.quoteId !== quoteId || payment.carrier !== provider))
      return res
        .status(409)
        .json({ error: 'The selected courier changed. Restart this payment attempt.' });
    if (payment?.status === 'used' && payment.shipmentId) {
      const shipment = await Shipment.findById(payment.shipmentId).lean();
      return res.json({ shipment });
    }
    if (payment) {
      let gatewayPayment = payment.gatewayPaymentId
        ? await razorpayRequest(`/payments/${encodeURIComponent(payment.gatewayPaymentId)}`)
        : null;
      if (!gatewayPayment) {
        const orderPayments = await razorpayRequest(
          `/orders/${encodeURIComponent(payment.gatewayOrderId)}/payments`,
        );
        gatewayPayment = orderPayments.items?.find(item => item.status === 'captured');
      }
      if (gatewayPayment?.status === 'captured') {
        const shipment = await finalizeCapturedPayment(payment, gatewayPayment);
        return res.json({ shipment });
      }
    }

    if (!payment) {
      const amountPaise = Math.round(quote.amount * 100);
      const order = await razorpayRequest('/orders', 'POST', {
        amount: amountPaise,
        currency: 'INR',
        receipt: idempotencyKey.slice(0, 40),
        payment_capture: 1,
        notes: { shipment_id: idempotencyKey, carrier: provider },
      });
      try {
        payment = await Payment.create({
          sellerId: req.sellerId,
          gatewayOrderId: order.id,
          idempotencyKey,
          amountPaise,
          currency: order.currency || 'INR',
          carrier: provider,
          quoteId,
          shipmentDraft: { ...parsed.data.shipment, idempotencyKey },
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        payment = await Payment.findOne({ sellerId: req.sellerId, idempotencyKey });
        if (!payment) throw error;
      }
    }
    if (payment.status === 'failed') {
      payment.status = 'created';
      payment.failureReason = '';
      await payment.save();
    }
    return res.json({
      paymentId: payment.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: payment.gatewayOrderId,
      amount: payment.amountPaise,
      currency: payment.currency,
      name: 'ParcelSetus',
      description: `Shipping with ${payment.carrier}`,
    });
  } catch (error) {
    next(error);
  }
});
app.post('/api/payments/razorpay/verify', async (req, res, next) => {
  try {
    if (!razorpayConfigured())
      return res.status(503).json({ error: 'UPI checkout is not configured on the server yet.' });
    const parsed = z
      .object({
        razorpay_order_id: z.string().min(1),
        razorpay_payment_id: z.string().min(1),
        razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Payment response is incomplete.' });
    const payment = await Payment.findOne({
      sellerId: req.sellerId,
      gatewayOrderId: parsed.data.razorpay_order_id,
    });
    if (!payment) return res.status(404).json({ error: 'Payment order was not found.' });
    const expected = razorpaySignature(
      process.env.RAZORPAY_KEY_SECRET,
      `${payment.gatewayOrderId}|${parsed.data.razorpay_payment_id}`,
    );
    if (!signatureMatches(parsed.data.razorpay_signature, expected))
      return res.status(400).json({ error: 'Payment signature could not be verified.' });
    const gatewayPayment = await razorpayRequest(
      `/payments/${encodeURIComponent(parsed.data.razorpay_payment_id)}`,
    );
    if (gatewayPayment.status !== 'captured')
      return res.status(409).json({ error: 'Payment is not captured yet. Please retry shortly.' });
    const shipment = await finalizeCapturedPayment(payment, gatewayPayment);
    return res.json({ shipment });
  } catch (error) {
    next(error);
  }
});
app.get('/api/payments', async (req, res, next) => {
  try {
    const payments = await Payment.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean();
    return res.json(
      payments.map(payment => ({
        id: payment._id,
        shipmentId: payment.shipmentDraft?.idempotencyKey || '',
        carrier: payment.carrier,
        amount: payment.amountPaise / 100,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        createdAt: payment.createdAt,
        gatewayPaymentId: payment.gatewayPaymentId,
      })),
    );
  } catch (error) {
    next(error);
  }
});
app.patch('/api/profile', async (req, res, next) => {
  try {
    const input = validate(profileSchema, req, res);
    if (!input) return;
    const user = await User.findByIdAndUpdate(req.sellerId, { $set: input }, { new: true });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        businessName: user.businessName,
        businessAddress: user.businessAddress,
        gstin: user.gstin,
        accountType: user.accountType,
        emailVerified: Boolean(user.emailVerifiedAt),
        authProviders: user.authProviders || [],
      },
    });
  } catch (error) {
    next(error);
  }
});
app.get('/api/shipments', async (req, res, next) => {
  try {
    const items = await Shipment.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (error) {
    next(error);
  }
});
app.get('/api/shipments/:id', async (req, res, next) => {
  try {
    const item = await Shipment.findOne({ id: req.params.id, sellerId: req.sellerId }).lean();
    if (!item) return res.status(404).json({ error: 'Shipment not found' });
    return res.json(item);
  } catch (error) {
    next(error);
  }
});
app.post('/api/shipments', (_req, res) =>
  res.status(403).json({ error: 'A shipment is created only after verified payment.' }),
);
app.post('/api/rates', async (req, res) => {
  const request = validate(quoteSchema, req, res);
  if (!request) return;
  const results = await Promise.all(
    carriers.map(async carrier => {
      try {
        const service = await carrier.checkServiceability(request);
        if (!service.eligible)
          return { provider: carrier.name, available: false, reason: service.reason };
        const rate = await carrier.calculateRate(request);
        const quoteId = randomUUID();
        quotes.set(quoteId, { ...rate, carrier: carrier.name });
        return {
          provider: carrier.name,
          available: true,
          service:
            carrier.name === 'India Post'
              ? 'Speed Post'
              : carrier.name === 'Shadowfax'
                ? 'Next Day Air'
                : 'Surface Lite',
          ...rate,
          quoteId,
          capabilityNotice: 'Demo estimate; replace with live provider quote after onboarding.',
        };
      } catch (error) {
        return { provider: carrier.name, available: false, reason: error.message };
      }
    }),
  );
  res.json(results);
});
app.post('/api/shipments/:id/track', async (req, res, next) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id, sellerId: req.sellerId });
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    const carrier = carrierByName(shipment.provider);
    if (!carrier) return res.status(404).json({ error: 'Provider unavailable' });
    const tracking = await carrier.getTracking(shipment.awb);
    shipment.status = tracking.status || shipment.status;
    shipment.events = tracking.events || shipment.events;
    shipment.lastTrackedAt = new Date();
    await shipment.save();
    return res.json(tracking);
  } catch (error) {
    next(error);
  }
});
app.get('/api/addresses', async (req, res, next) => {
  try {
    res.json(await Address.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean());
  } catch (error) {
    next(error);
  }
});
app.post('/api/addresses', async (req, res, next) => {
  try {
    const body = validate(addressSchema, req, res);
    if (!body) return;
    if (body.default)
      await Address.updateMany({ sellerId: req.sellerId }, { $set: { default: false } });
    const count = await Address.countDocuments({ sellerId: req.sellerId });
    const address = await Address.create({
      ...body,
      id: randomUUID(),
      sellerId: req.sellerId,
      default: body.default || count === 0,
    });
    return res.status(201).json(address);
  } catch (error) {
    next(error);
  }
});
app.put('/api/addresses/:id', async (req, res, next) => {
  try {
    const body = validate(addressSchema, req, res);
    if (!body) return;
    if (body.default)
      await Address.updateMany(
        { sellerId: req.sellerId, id: { $ne: req.params.id } },
        { $set: { default: false } },
      );
    const address = await Address.findOneAndUpdate(
      { id: req.params.id, sellerId: req.sellerId },
      { $set: body },
      { new: true, runValidators: true },
    );
    if (!address) return res.status(404).json({ error: 'Address not found.' });
    return res.json(address);
  } catch (error) {
    next(error);
  }
});
app.delete('/api/addresses/:id', async (req, res, next) => {
  try {
    const address = await Address.findOneAndDelete({ id: req.params.id, sellerId: req.sellerId });
    if (!address) return res.status(404).json({ error: 'Address not found.' });
    if (address.default) {
      const nextDefault = await Address.findOne({ sellerId: req.sellerId }).sort({ createdAt: 1 });
      if (nextDefault) {
        nextDefault.default = true;
        await nextDefault.save();
      }
    }
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});
async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to start the API.');
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET)
    throw new Error('SESSION_SECRET is required in production.');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, () => console.log(`ParcelSetus API listening on http://localhost:${port}`));
}
start().catch(error => {
  console.error(error);
  process.exit(1);
});
