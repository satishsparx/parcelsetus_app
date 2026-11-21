# Shipment notifications

Shipment notifications use a channel adapter registry and a MongoDB outbox. Booking code emits the `shipment.booked` event; adapters deliver it through WhatsApp now and can be extended with email or other channels later. Delivery jobs have a unique shipment-and-channel key, attempt history, a retry delay, and a lease so multiple workers can safely claim queued jobs.

## WhatsApp setup

Configure these backend environment variables locally and in Vercel:

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_API_VERSION=v27.0
WHATSAPP_SHIPMENT_BOOKED_TEMPLATE=shipment_booked
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_DEFAULT_COUNTRY_CODE=91
NOTIFICATION_CHANNELS=whatsapp
```

Create and get approval for a WhatsApp utility template named `shipment_booked` in WhatsApp Manager. Its body must contain four text placeholders, in this order:

1. Recipient name
2. Courier/provider
3. Tracking/AWB number
4. Current shipment status

For example: `Hi {{1}}, your parcel has been booked with {{2}}. Tracking number: {{3}}. Current status: {{4}}.` The WhatsApp adapter sends approved template messages through the Cloud API. The recipient must have agreed to receive WhatsApp updates; the booking form records the sender's confirmation and notifications are skipped unless it is checked.

The WhatsApp Cloud API token and phone number ID are server-only secrets. Never add them to frontend environment variables.

## Retry worker

Delivery is attempted immediately after the payment-confirmed shipment is created. Failed deliveries are stored in `notification_jobs` and retried with exponential backoff, up to eight attempts. The Vercel cron in `vercel.json` invokes `/api/internal/notifications/dispatch` every five minutes. Set a strong `CRON_SECRET` in Vercel so the endpoint only accepts authenticated cron requests.

## Adding another channel

Implement an adapter with `send({ to, payload })` and register it using `registerNotificationAdapter('email', adapter)` in `src/services/notificationService.js`. Add `email` to `NOTIFICATION_CHANNELS` to deliver the same `shipment.booked` event through it. The booking flow does not need to know which provider sends the notification.
