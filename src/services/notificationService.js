import { NotificationJob } from '../models/NotificationJob.js';
import { WhatsAppCloudAdapter } from './notifications/adapters/whatsappCloudAdapter.js';

const adapters = new Map([['whatsapp', new WhatsAppCloudAdapter()]]);
const maxAttempts = 8;
const retryDelay = attempts => Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);

export function registerNotificationAdapter(channel, adapter) {
  if (!channel || typeof adapter?.send !== 'function')
    throw new TypeError('Notification adapters must have a channel name and send method.');
  adapters.set(channel, adapter);
}

export async function enqueueNotification({ eventKey, eventType, channel, recipient, payload }) {
  const adapter = adapters.get(channel);
  if (!adapter) throw new Error(`No notification adapter registered for channel: ${channel}`);
  const job = await NotificationJob.findOneAndUpdate(
    { eventKey, channel },
    {
      $setOnInsert: {
        eventKey,
        eventType,
        channel,
        recipient,
        payload,
        status: 'queued',
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (job.status !== 'sent') await deliverNotificationJob(job._id, channel, adapter);
  return job;
}

export async function queueShipmentBookedNotifications(shipment) {
  const details = shipment.details || {};
  if (!details.whatsappOptIn || !details.phone) return;

  const enabledChannels = (process.env.NOTIFICATION_CHANNELS || 'whatsapp')
    .split(',')
    .map(channel => channel.trim().toLowerCase())
    .filter(Boolean);

  for (const channel of enabledChannels) {
    const adapter = adapters.get(channel);
    if (!adapter) {
      console.warn(`No notification adapter registered for channel: ${channel}`);
      continue;
    }

    await enqueueNotification({
      eventKey: `shipment-booked:${shipment._id}`,
      eventType: 'shipment.booked',
      channel,
      recipient: details.phone,
      payload: {
        recipientName: shipment.recipient,
        carrier: shipment.provider,
        trackingNumber: shipment.awb,
        status: shipment.status,
      },
    });
  }
}

async function deliverNotificationJob(jobId, channel, adapter = adapters.get(channel)) {
  if (!adapter || adapter.isConfigured === false) return false;
  const now = new Date();
  const job = await NotificationJob.findOneAndUpdate(
    {
      _id: jobId,
      $or: [
        { status: 'queued', nextAttemptAt: { $lte: now } },
        { status: 'failed', nextAttemptAt: { $lte: now }, attempts: { $lt: maxAttempts } },
        { status: 'sending', lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'sending', lockedUntil: new Date(now.getTime() + 30_000) },
      $inc: { attempts: 1 },
    },
    { new: true },
  );
  if (!job) return false;

  try {
    const result = await adapter.send({ to: job.recipient, payload: job.payload });
    await NotificationJob.updateOne(
      { _id: job._id, status: 'sending' },
      {
        $set: {
          status: 'sent',
          providerMessageId: result?.messageId || '',
          sentAt: new Date(),
          lastError: '',
          lockedUntil: null,
        },
      },
    );
    return true;
  } catch (error) {
    const terminal = job.attempts >= maxAttempts;
    await NotificationJob.updateOne(
      { _id: job._id, status: 'sending' },
      {
        $set: {
          status: 'failed',
          lastError: error.message || 'Notification delivery failed.',
          nextAttemptAt: terminal
            ? new Date('9999-12-31T23:59:59.999Z')
            : new Date(Date.now() + retryDelay(job.attempts)),
          lockedUntil: null,
        },
      },
    );
    console.error(`Notification delivery failed (${channel}):`, error.message);
    return false;
  }
}

export async function processPendingNotifications({ limit = 25 } = {}) {
  const now = new Date();
  const jobs = await NotificationJob.find({
    $or: [
      { status: 'queued', nextAttemptAt: { $lte: now } },
      { status: 'failed', nextAttemptAt: { $lte: now }, attempts: { $lt: maxAttempts } },
      { status: 'sending', lockedUntil: { $lte: now } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || 25, 100)))
    .select('_id channel')
    .lean();

  const results = await Promise.all(jobs.map(job => deliverNotificationJob(job._id, job.channel)));
  return { processed: jobs.length, sent: results.filter(Boolean).length };
}
