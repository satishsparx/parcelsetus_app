import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, trim: true, default: '' },
    businessName: { type: String, trim: true, default: '' },
    businessAddress: { type: String, trim: true, default: '', maxlength: 300 },
    gstin: { type: String, trim: true, uppercase: true, default: '', maxlength: 15 },
    pendingEmail: { type: String, lowercase: true, trim: true, select: false },
    emailChangeTokenHash: { type: String, select: false },
    emailChangeExpiresAt: { type: Date, select: false },
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

const addressSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    contactName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    pin: { type: String, required: true, match: /^\d{6}$/ },
    city: { type: String, trim: true, default: '', maxlength: 100 },
    state: { type: String, trim: true, default: '', maxlength: 100 },
    type: { type: String, default: 'Pickup' },
    default: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Address = mongoose.model('Address', addressSchema);

const shipmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    awb: { type: String, required: true, index: true },
    provider: { type: String, required: true },
    recipient: { type: String, required: true },
    destination: { type: String, required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, required: true },
    labelUrl: { type: String, default: null },
    demo: { type: Boolean, default: true },
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    idempotencyKey: { type: String, default: undefined },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    lastTrackedAt: { type: Date, default: null },
  },
  { timestamps: true, id: false, collection: 'shipments' },
);

shipmentSchema.index(
  { sellerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
shipmentSchema.index({ sellerId: 1, id: 1 }, { unique: true });
shipmentSchema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { paymentId: { $type: 'objectId' } },
  },
);
shipmentSchema.index({ sellerId: 1, createdAt: -1 });

export const Shipment = mongoose.model('Shipment', shipmentSchema);

const paymentSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gateway: { type: String, enum: ['razorpay'], default: 'razorpay' },
    gatewayOrderId: { type: String, required: true, unique: true },
    gatewayPaymentId: { type: String, default: null, index: true },
    idempotencyKey: { type: String, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    method: { type: String, default: 'upi' },
    status: {
      type: String,
      enum: ['created', 'paid', 'used', 'failed'],
      default: 'created',
      index: true,
    },
    carrier: { type: String, required: true },
    quoteId: { type: String, required: true },
    shipmentDraft: { type: mongoose.Schema.Types.Mixed, required: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true, collection: 'payments' },
);

paymentSchema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true });

export const Payment = mongoose.model('Payment', paymentSchema);

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
