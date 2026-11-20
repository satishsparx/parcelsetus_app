import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Payment } from '../models/Payment.js';
import { Shipment } from '../models/Shipment.js';

export const razorpayConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

export function razorpaySignature(secret, value) {
  return createHmac('sha256', secret).update(value).digest();
}

export function signatureMatches(actual, expected) {
  if (typeof actual !== 'string' || !/^[a-f\d]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), expected);
}

export async function razorpayRequest(path, method = 'GET', payload) {
  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.description || 'Payment provider request failed.');
  return data;
}

export async function finalizeCapturedPayment(payment, gatewayPayment) {
  if (
    gatewayPayment.status !== 'captured' ||
    gatewayPayment.order_id !== payment.gatewayOrderId ||
    gatewayPayment.amount !== payment.amountPaise ||
    gatewayPayment.currency !== payment.currency
  )
    throw new Error('Payment details do not match the pending checkout.');

  if (payment.status === 'used' && payment.shipmentId)
    return Shipment.findById(payment.shipmentId).lean();

  payment.status = 'paid';
  payment.gatewayPaymentId = gatewayPayment.id;
  payment.method = gatewayPayment.method;
  payment.paidAt = new Date();
  await payment.save();

  let shipment = await Shipment.findOne({ paymentId: payment._id });
  if (!shipment) {
    const draft = payment.shipmentDraft;
    const providerCode = payment.carrier.slice(0, 2).toUpperCase();
    try {
      shipment = await Shipment.create({
        id: draft.idempotencyKey,
        sellerId: payment.sellerId,
        awb: `${providerCode}${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
        provider: payment.carrier,
        recipient: draft.recipient,
        destination: draft.destination,
        date: new Intl.DateTimeFormat('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        }).format(new Date()),
        amount: payment.amountPaise / 100,
        status: 'Pickup scheduled',
        paymentId: payment._id,
        idempotencyKey: draft.idempotencyKey,
        details: draft,
        demo: true,
        events: [],
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      shipment = await Shipment.findOne({ paymentId: payment._id });
      if (!shipment) throw error;
    }
  }

  payment.status = 'used';
  payment.shipmentId = shipment._id;
  await payment.save();
  return shipment.toObject();
}

export async function handleRazorpayWebhook(req, res, next) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Payment webhook is not configured.' });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid webhook body.' });
    const expected = razorpaySignature(secret, req.body);
    if (!signatureMatches(req.get('x-razorpay-signature'), expected))
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    const event = JSON.parse(req.body.toString('utf8'));
    const gatewayPayment = event.payload?.payment?.entity;
    if (event.event === 'payment.captured' && gatewayPayment?.order_id) {
      const payment = await Payment.findOne({ gatewayOrderId: gatewayPayment.order_id });
      if (payment) await finalizeCapturedPayment(payment, gatewayPayment);
    } else if (event.event === 'payment.failed' && gatewayPayment?.order_id) {
      await Payment.updateOne(
        { gatewayOrderId: gatewayPayment.order_id, status: 'created' },
        { $set: { status: 'failed', failureReason: gatewayPayment.error_description || '' } },
      );
    }
    return res.json({ received: true });
  } catch (error) {
    return next(error);
  }
}
