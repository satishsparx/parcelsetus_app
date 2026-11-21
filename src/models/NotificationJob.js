import mongoose from 'mongoose';

const notificationJobSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true },
    eventType: { type: String, required: true },
    channel: { type: String, required: true },
    recipient: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'failed'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    providerMessageId: { type: String, default: '' },
    lastError: { type: String, default: '' },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'notification_jobs' },
);

notificationJobSchema.index({ eventKey: 1, channel: 1 }, { unique: true });
notificationJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export const NotificationJob = mongoose.model('NotificationJob', notificationJobSchema);
