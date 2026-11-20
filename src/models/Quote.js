import mongoose from 'mongoose';

const quoteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    carrier: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'INR' },
    expiresAt: { type: Date, required: true, expires: 0 },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'quotes' },
);

export const Quote = mongoose.model('Quote', quoteSchema);
