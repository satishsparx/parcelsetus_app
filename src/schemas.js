import { z } from 'zod';
export const addressSchema = z.object({
  label: z.string().trim().min(1).max(80),
  contactName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(20).optional().default(''),
  address: z.string().trim().min(5).max(300),
  pin: z.string().regex(/^\d{6}$/),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default(''),
  type: z.string().optional().default('Pickup'),
  default: z.boolean().optional().default(false),
});
export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  businessName: z.string().trim().max(120).optional().default(''),
  mobile: z.string().trim().max(20).optional().default(''),
  businessAddress: z.string().trim().max(300).optional().default(''),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional()
    .default(''),
});
export const quoteSchema = z.object({
  pickupPin: z.string().regex(/^\d{6}$/),
  destinationPin: z.string().regex(/^\d{6}$/),
  weightGrams: z.coerce.number().positive(),
  lengthCm: z.coerce.number().nonnegative().optional().default(0),
  widthCm: z.coerce.number().nonnegative().optional().default(0),
  heightCm: z.coerce.number().nonnegative().optional().default(0),
  paymentType: z.enum(['Prepaid', 'COD']).default('Prepaid'),
});
export const paymentOrderSchema = z.object({
  quoteId: z.string().min(1),
  provider: z.string().min(1).max(80),
  idempotencyKey: z.string().min(8).max(80),
  shipment: z.object({
    recipient: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(8).max(20),
    address: z.string().trim().min(5).max(300),
    destination: z.string().regex(/^\d{6}$/),
    city: z.string().trim().max(100).optional().default(''),
    state: z.string().trim().max(100).optional().default(''),
    pickupName: z.string().trim().min(1).max(100),
    pickupPhone: z.string().trim().min(8).max(20),
    pickupAddress: z.string().trim().min(5).max(300),
    pickupPin: z.string().regex(/^\d{6}$/),
    pickupCity: z.string().trim().max(100).optional().default(''),
    pickupState: z.string().trim().max(100).optional().default(''),
    weight: z.coerce.number().positive(),
    length: z.coerce.number().positive(),
    width: z.coerce.number().positive(),
    height: z.coerce.number().positive(),
    description: z.string().trim().max(200).optional().default(''),
    value: z.coerce.number().nonnegative(),
    paymentType: z.enum(['Prepaid', 'COD']),
    codAmount: z.coerce.number().nonnegative().optional().default(0),
    whatsappOptIn: z.boolean().optional().default(false),
  }),
});
