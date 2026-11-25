import mongoose from 'mongoose';

const sessionHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionIdHash: { type: String, required: true, unique: true, select: false },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    closeReason: {
      type: String,
      enum: ['logout', 'logout-all', 'rotated', 'password-reset'],
      default: null,
    },
  },
  { versionKey: false, collection: 'session_history' },
);

sessionHistorySchema.index({ userId: 1, createdAt: -1 });

export const SessionHistory = mongoose.model('SessionHistory', sessionHistorySchema);
