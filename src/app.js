import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import authRouter from './auth.js';
import addressesRouter from './routes/addresses.js';
import paymentsRouter from './routes/payments.js';
import sessionsRouter from './routes/sessions.js';
import shipmentsRouter from './routes/shipments.js';
import usersRouter from './routes/users.js';
import notificationWorkerRouter from './routes/notificationWorker.js';
import requireVerifiedSeller from './middleware/requireVerifiedSeller.js';
import { handleRazorpayWebhook } from './services/razorpay.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session.js';
import { carriers } from './carriers/demo.js';
import { databaseConnectionMiddleware } from './config/database.js';

const app = express();

app.disable('x-powered-by');
app.set(
  'trust proxy',
  process.env.TRUST_PROXY === 'true' || process.env.VERCEL === '1' ? 1 : false,
);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(databaseConnectionMiddleware);
app.post(
  '/api/webhooks/razorpay',
  express.raw({ type: 'application/json' }),
  handleRazorpayWebhook,
);
app.use(express.json({ limit: '1mb' }));
app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false }),
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
app.use('/api/auth', sessionsRouter);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'parcelsetus-api' }));
app.get('/api/providers', (_req, res) =>
  res.json(carriers.map(({ name, capabilities }) => ({ name, capabilities, mode: 'demo' }))),
);
app.use('/api/internal/notifications', notificationWorkerRouter);
app.use('/api', requireVerifiedSeller);
app.use('/api', usersRouter);
app.use('/api', addressesRouter);
app.use('/api', shipmentsRouter);
app.use('/api', paymentsRouter);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

export default app;
