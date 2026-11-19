import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, trim: true, default: '' },
    businessName: { type: String, trim: true, default: '' },
    accountType: { type: String, enum: ['Individual', 'Business'], required: true },
    passwordHash: { type: String, select: false },
    googleSubject: { type: String, unique: true, sparse: true, select: false },
    authProviders: { type: [{ type: String, enum: ['password', 'google'] }], default: [] },
    emailVerifiedAt: { type: Date, default: null },
    verificationTokenHash: { type: String, select: false },
    verificationExpiresAt: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    sessionVersion: { type: Number, default: 0, select: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);

const sessionHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionIdHash: { type: String, required: true, unique: true, select: false },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, enum: ['logout', 'logout-all', 'rotated'], default: null },
  },
  { versionKey: false, collection: 'session_history' },
);

sessionHistorySchema.index({ userId: 1, createdAt: -1 });

export const SessionHistory = mongoose.model('SessionHistory', sessionHistorySchema);
