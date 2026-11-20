# ParcelSetus API

Node.js + Express API for ParcelSetus, including seller authentication and the existing preview shipment modules.

## Run locally

1. Use Node.js 20 or newer and install/start MongoDB locally, or create a MongoDB database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a long random `SESSION_SECRET`.
3. Configure SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`) to send verification and reset links. In local development without SMTP, the API returns a one-time development link in the response.
4. Optional Google sign-in: configure a Google OAuth web client, set its client ID as `GOOGLE_CLIENT_ID` here and `VITE_GOOGLE_CLIENT_ID` in the frontend.
5. UPI checkout: set Razorpay test credentials in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Configure a Razorpay webhook to `POST /api/webhooks/razorpay`, subscribe to `payment.captured` and `payment.failed`, and set its signing secret in `RAZORPAY_WEBHOOK_SECRET`.
6. Run `npm install` and `npm run dev`.

API listens on `http://localhost:4000` by default. Configure `CLIENT_ORIGIN` for the frontend origin.

## Deploy to Vercel

Import this backend repository as its own Vercel project and set the project root to this folder. Vercel detects the root `index.js`, which exports the Express app; `src/server.js` remains the local listener. Configure the environment variables from `.env.example` in the Vercel project settings. Use a hosted MongoDB connection string reachable from Vercel, set `CLIENT_ORIGIN` and `APP_ORIGIN` to the deployed frontend URL, and use production credentials for email, Google, and Razorpay. Do not deploy the local `.env` file. The app caches its Mongoose connection between warm function invocations, and short-lived rate quotes are stored in MongoDB so checkout works across serverless instances.

## Code quality

Run `npm run lint` for backend ESLint checks, `npm run format` to apply Prettier, or `npm run format:check` to check style without editing files. Use Node 20 or newer for these commands.

## Local MongoDB Compass

The local MongoDB Community 8.0 service uses `127.0.0.1:27017`. In Compass, create a connection with:

```text
mongodb://127.0.0.1:27017
```

The `parcelsetus` database, `users` collection, and `sessions` collection are created when the first account/session is written. The backend `.env` is configured to use `mongodb://127.0.0.1:27017/parcelsetus`.

On this Mac, Node 22 is installed keg-only to leave the existing global Node version untouched. Start the API with:

```sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run dev
```

## Authentication routes

- `POST /api/auth/register` — validates fields, normalizes and uniquely indexes email, hashes passwords with bcrypt, and sends an expiring verification link
- `POST /api/auth/verify-email` and `POST /api/auth/resend-verification`
- `POST /api/auth/login` — verified accounts only
- `POST /api/auth/google` — verifies the Google ID token server-side and creates or links a verified account
- `POST /api/auth/link-password` — lets a signed-in Google seller add password sign-in to the same account
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` — one-time expiring reset token; password changes invalidate existing sessions
- `GET /api/auth/me`, `POST /api/auth/logout`, and `POST /api/auth/logout-all`
- `POST /api/auth/change-email` and `POST /api/auth/verify-email-change` — verifies a new email before replacing the sign-in address

Sessions use HttpOnly, SameSite cookies stored in MongoDB. All application API routes after `/api/auth` require a valid session for an active, email-verified account. Session-version checks revoke sessions across devices. Verification and reset tokens are stored only as SHA-256 hashes. Development links are returned only when `NODE_ENV` is not `production` and SMTP is not configured.

## Routes

- `GET /api/health`
- `GET /api/providers`
- `GET /api/shipments` and `GET /api/shipments/:id`
- `POST /api/rates` — validates both PIN codes and package details, checks provider capability and returns expiring demo quotes
- `POST /api/payments/razorpay/order` and `POST /api/payments/razorpay/verify` — creates checkout orders and verifies captured payments before creating a shipment
- `POST /api/webhooks/razorpay` — validates gateway signatures and reconciles captured/failed payments
- `GET /api/payments` — seller-scoped payment history
- `POST /api/shipments/:id/track`
- `GET|POST /api/addresses`, `PUT|DELETE /api/addresses/:id`

Seller profiles, addresses, payments, session history, shipments, and expiring quotes are stored in MongoDB. `src/carriers/interface.js` defines the provider contract and normalized lifecycle values. `src/carriers/demo.js` is a local preview adapter: its rates, tracking, and AWBs are not live carrier data. Use Razorpay test keys while working with these demo carrier bookings.

## Remaining production work

Quote data and carrier adapters remain demo implementations. Connect credential-backed carrier services and reconcile shipment creation with carrier booking, then add monitoring and backups. Do not expose carrier or payment secrets to the frontend. In production, use HTTPS, set a unique `SESSION_SECRET`, configure trusted proxy settings if applicable, and use an SMTP provider with verified sender identity.
