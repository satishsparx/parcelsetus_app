import mongoose from 'mongoose';

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
