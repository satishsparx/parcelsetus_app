import mongoose from 'mongoose';

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
