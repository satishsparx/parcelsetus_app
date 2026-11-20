import { Router } from 'express';
import { z } from 'zod';
import { Payment } from '../models/Payment.js';
import { Shipment } from '../models/Shipment.js';
import { paymentOrderSchema } from '../schemas.js';
import {
  finalizeCapturedPayment,
  razorpayConfigured,
  razorpayRequest,
  razorpaySignature,
  signatureMatches,
} from '../services/razorpay.js';
import quoteStore from '../services/quotes.js';

const router = Router();

router.post('/payments/razorpay/order', async (req, res, next) => {
  try {
    if (!razorpayConfigured())
      return res.status(503).json({ error: 'UPI checkout is not configured on the server yet.' });
    const parsed = paymentOrderSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: 'Check shipment details before paying.' });
    const { quoteId, provider, idempotencyKey } = parsed.data;
    const quote = quoteStore.get(quoteId);
    if (!quote || quote.expiresAt < new Date().toISOString() || quote.carrier !== provider)
      return res.status(409).json({ error: 'This courier quote expired. Choose a courier again.' });
    if (parsed.data.shipment.paymentType === 'COD' && parsed.data.shipment.codAmount <= 0)
      return res.status(400).json({ error: 'Enter a valid cash-on-delivery amount.' });

    let payment = await Payment.findOne({ sellerId: req.sellerId, idempotencyKey });
    if (payment && (payment.quoteId !== quoteId || payment.carrier !== provider))
      return res
        .status(409)
        .json({ error: 'The selected courier changed. Restart this payment attempt.' });
    if (payment?.status === 'used' && payment.shipmentId) {
      const shipment = await Shipment.findById(payment.shipmentId).lean();
      return res.json({ shipment });
    }
    if (payment) {
      let gatewayPayment = payment.gatewayPaymentId
        ? await razorpayRequest(`/payments/${encodeURIComponent(payment.gatewayPaymentId)}`)
        : null;
      if (!gatewayPayment) {
        const orderPayments = await razorpayRequest(
          `/orders/${encodeURIComponent(payment.gatewayOrderId)}/payments`,
        );
        gatewayPayment = orderPayments.items?.find(item => item.status === 'captured');
      }
      if (gatewayPayment?.status === 'captured') {
        const shipment = await finalizeCapturedPayment(payment, gatewayPayment);
        return res.json({ shipment });
      }
    }

    if (!payment) {
      const amountPaise = Math.round(quote.amount * 100);
      const order = await razorpayRequest('/orders', 'POST', {
        amount: amountPaise,
        currency: 'INR',
        receipt: idempotencyKey.slice(0, 40),
        payment_capture: 1,
        notes: { shipment_id: idempotencyKey, carrier: provider },
      });
      try {
        payment = await Payment.create({
          sellerId: req.sellerId,
          gatewayOrderId: order.id,
          idempotencyKey,
          amountPaise,
          currency: order.currency || 'INR',
          carrier: provider,
          quoteId,
          shipmentDraft: { ...parsed.data.shipment, idempotencyKey },
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        payment = await Payment.findOne({ sellerId: req.sellerId, idempotencyKey });
        if (!payment) throw error;
      }
    }
    if (payment.status === 'failed') {
      payment.status = 'created';
      payment.failureReason = '';
      await payment.save();
    }
    return res.json({
      paymentId: payment.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: payment.gatewayOrderId,
      amount: payment.amountPaise,
      currency: payment.currency,
      name: 'ParcelSetus',
      description: `Shipping with ${payment.carrier}`,
    });
  } catch (error) {
    next(error);
  }
});
router.post('/payments/razorpay/verify', async (req, res, next) => {
  try {
    if (!razorpayConfigured())
      return res.status(503).json({ error: 'UPI checkout is not configured on the server yet.' });
    const parsed = z
      .object({
        razorpay_order_id: z.string().min(1),
        razorpay_payment_id: z.string().min(1),
        razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Payment response is incomplete.' });
    const payment = await Payment.findOne({
      sellerId: req.sellerId,
      gatewayOrderId: parsed.data.razorpay_order_id,
    });
    if (!payment) return res.status(404).json({ error: 'Payment order was not found.' });
    const expected = razorpaySignature(
      process.env.RAZORPAY_KEY_SECRET,
      `${payment.gatewayOrderId}|${parsed.data.razorpay_payment_id}`,
    );
    if (!signatureMatches(parsed.data.razorpay_signature, expected))
      return res.status(400).json({ error: 'Payment signature could not be verified.' });
    const gatewayPayment = await razorpayRequest(
      `/payments/${encodeURIComponent(parsed.data.razorpay_payment_id)}`,
    );
    if (gatewayPayment.status !== 'captured')
      return res.status(409).json({ error: 'Payment is not captured yet. Please retry shortly.' });
    const shipment = await finalizeCapturedPayment(payment, gatewayPayment);
    return res.json({ shipment });
  } catch (error) {
    next(error);
  }
});
router.get('/payments', async (req, res, next) => {
  try {
    const payments = await Payment.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean();
    return res.json(
      payments.map(payment => ({
        id: payment._id,
        shipmentId: payment.shipmentDraft?.idempotencyKey || '',
        carrier: payment.carrier,
        amount: payment.amountPaise / 100,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        createdAt: payment.createdAt,
        gatewayPaymentId: payment.gatewayPaymentId,
      })),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
