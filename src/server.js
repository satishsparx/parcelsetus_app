import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { carriers } from './carriers/demo.js';
import authRouter from './auth.js';
import { User } from './models.js';

const app = express();
const port = Number(process.env.PORT || 4000);
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  name: 'parcelsetus.sid',
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'local-development-only-change-this-secret'),
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, collectionName: 'sessions', ttl: 14 * 24 * 60 * 60 }),
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 14 * 24 * 60 * 60 * 1000, path: '/' },
}));

app.use('/api/auth', authRouter);

// Shipment and address persistence remains a demo store; every query is scoped to the authenticated seller.
const shipments = new Map();
const addresses = new Map();
const quotes = new Map();
const idempotency = new Map();
const addressSchema = z.object({ label: z.string().min(1), contactName: z.string().min(1), phone: z.string().optional(), address: z.string().min(5), pin: z.string().regex(/^\d{6}$/), city: z.string().optional(), state: z.string().optional(), type: z.string().optional(), default: z.boolean().optional() });
const quoteSchema = z.object({ pickupPin: z.string().regex(/^\d{6}$/), destinationPin: z.string().regex(/^\d{6}$/), weightGrams: z.coerce.number().positive(), lengthCm: z.coerce.number().nonnegative().optional().default(0), widthCm: z.coerce.number().nonnegative().optional().default(0), heightCm: z.coerce.number().nonnegative().optional().default(0), paymentType: z.enum(['Prepaid', 'COD']).default('Prepaid') });
const bookingSchema = z.object({ quoteId: z.string(), provider: z.string(), pickup: z.object({ contactName: z.string().min(1), phone: z.string().min(8), address: z.string().min(5), pin: z.string().regex(/^\d{6}$/) }), delivery: z.object({ contactName: z.string().min(1), phone: z.string().min(8), address: z.string().min(5), pin: z.string().regex(/^\d{6}$/) }), parcel: z.object({ weightGrams: z.coerce.number().positive(), lengthCm: z.coerce.number().positive(), widthCm: z.coerce.number().positive(), heightCm: z.coerce.number().positive(), description: z.string().optional(), value: z.coerce.number().nonnegative().optional(), paymentType: z.enum(['Prepaid', 'COD']), codAmount: z.coerce.number().nonnegative().optional() }) });
const carrierByName = (name) => carriers.find(c => c.name.toLowerCase() === String(name).toLowerCase());
const validate = (schema, req, res) => { const parsed = schema.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() }); return null; } return parsed.data; };

async function requireVerifiedSeller(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    const user = await User.findById(req.session.userId).select('+sessionVersion');
    if (!user || user.status !== 'active' || !user.emailVerifiedAt || user.sessionVersion !== req.session.sessionVersion) {
      return req.session.destroy(() => { res.clearCookie('parcelsetus.sid'); res.status(401).json({ error: 'Your session has expired. Sign in again.' }); });
    }
    req.sellerId = user.id;
    next();
  } catch (error) { next(error); }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'parcelsetus-api' }));
app.get('/api/providers', (_req, res) => res.json(carriers.map(({ name, capabilities }) => ({ name, capabilities, mode: 'demo' }))));
app.use('/api', requireVerifiedSeller);
app.get('/api/shipments', (_req, res) => res.json([...shipments.values()].filter(s => s.sellerId === _req.sellerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.get('/api/shipments/:id', (req, res) => { const item = shipments.get(req.params.id); if (!item || item.sellerId !== req.sellerId) return res.status(404).json({ error: 'Shipment not found' }); res.json(item); });
app.post('/api/shipments', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (key && idempotency.has(key)) return res.status(200).json(idempotency.get(key));
  const data = bookingSchema.safeParse(req.body);
  // Allow the web demo's concise record payload while retaining strict booking validation.
  if (!data.success) {
    const demo = z.object({ id: z.string(), awb: z.string(), provider: z.string(), recipient: z.string(), destination: z.string().regex(/^\d{6}$/), date: z.string(), amount: z.number().nonnegative(), status: z.string() }).safeParse(req.body);
    if (!demo.success) return res.status(400).json({ error: 'Invalid booking details', details: data.error.flatten() });
    const record = { ...demo.data, sellerId: req.sellerId, createdAt: new Date().toISOString(), events: [] };
    shipments.set(record.id, record); if (key) idempotency.set(key, record); return res.status(201).json(record);
  }
  const booking = data.data; const quote = quotes.get(booking.quoteId); const carrier = carrierByName(booking.provider);
  if (!carrier) return res.status(400).json({ error: 'Provider is not available' });
  if (!quote || quote.expiresAt < new Date().toISOString() || quote.carrier !== carrier.name) return res.status(409).json({ error: 'Rate quote expired or invalid. Request a fresh quote.' });
  const result = await carrier.createBooking(booking);
  const id = `SHP-${new Date().getFullYear()}-${String(shipments.size + 1).padStart(6, '0')}`;
  const record = { id, awb: result.awb, provider: carrier.name, recipient: booking.delivery.contactName, destination: booking.delivery.pin, date: new Date().toLocaleDateString('en-IN'), amount: quote.amount, status: result.status, sellerId: req.sellerId, createdAt: new Date().toISOString(), labelUrl: result.labelUrl, demo: true, events: [] };
  shipments.set(id, record); if (key) idempotency.set(key, record); res.status(201).json(record);
});
app.post('/api/rates', async (req, res) => {
  const request = validate(quoteSchema, req, res); if (!request) return;
  const results = await Promise.all(carriers.map(async carrier => {
    try { const service = await carrier.checkServiceability(request); if (!service.eligible) return { provider: carrier.name, available: false, reason: service.reason }; const rate = await carrier.calculateRate(request); const quoteId = randomUUID(); quotes.set(quoteId, { ...rate, carrier: carrier.name }); return { provider: carrier.name, available: true, service: carrier.name === 'India Post' ? 'Speed Post' : carrier.name === 'Shadowfax' ? 'Next Day Air' : 'Surface Lite', ...rate, quoteId, capabilityNotice: 'Demo estimate; replace with live provider quote after onboarding.' }; }
    catch (error) { return { provider: carrier.name, available: false, reason: error.message }; }
  }));
  res.json(results);
});
app.post('/api/shipments/:id/track', async (req, res) => { const shipment = shipments.get(req.params.id); if (!shipment || shipment.sellerId !== req.sellerId) return res.status(404).json({ error: 'Shipment not found' }); const carrier = carrierByName(shipment.provider); if (!carrier) return res.status(404).json({ error: 'Provider unavailable' }); res.json(await carrier.getTracking(shipment.awb)); });
app.get('/api/addresses', (req, res) => res.json([...addresses.values()].filter(a => a.sellerId === req.sellerId)));
app.post('/api/addresses', (req, res) => { const body = validate(addressSchema, req, res); if (!body) return; const address = { ...body, id: randomUUID(), sellerId: req.sellerId, createdAt: new Date().toISOString() }; addresses.set(address.id, address); res.status(201).json(address); });
app.delete('/api/addresses/:id', (req, res) => { const address = addresses.get(req.params.id); if (!address || address.sellerId !== req.sellerId) return res.status(404).json({ error: 'Address not found' }); addresses.delete(address.id); res.status(204).end(); });
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error' }); });
async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to start the API.');
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production.');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, () => console.log(`ParcelSetus API listening on http://localhost:${port}`));
}
start().catch(error => { console.error(error); process.exit(1); });
