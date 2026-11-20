import mongoose from 'mongoose';

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
