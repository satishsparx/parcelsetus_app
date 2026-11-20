import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Shipment } from '../models/Shipment.js';
import { carriers } from '../carriers/demo.js';
import { quoteSchema } from '../schemas.js';
import { validate } from '../lib/validate.js';
import quoteStore from '../services/quotes.js';

const router = Router();
const carrierByName = name =>
  carriers.find(c => c.name.toLowerCase() === String(name).toLowerCase());

router.get('/shipments', async (req, res, next) => {
  try {
    const items = await Shipment.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (error) {
    next(error);
  }
});
router.get('/shipments/:id', async (req, res, next) => {
  try {
    const item = await Shipment.findOne({ id: req.params.id, sellerId: req.sellerId }).lean();
    if (!item) return res.status(404).json({ error: 'Shipment not found' });
    return res.json(item);
  } catch (error) {
    next(error);
  }
});
router.post('/shipments', (_req, res) =>
  res.status(403).json({ error: 'A shipment is created only after verified payment.' }),
);
router.post('/rates', async (req, res) => {
  const request = validate(quoteSchema, req, res);
  if (!request) return;
  const results = await Promise.all(
    carriers.map(async carrier => {
      try {
        const service = await carrier.checkServiceability(request);
        if (!service.eligible)
          return { provider: carrier.name, available: false, reason: service.reason };
        const rate = await carrier.calculateRate(request);
        const quoteId = randomUUID();
        quoteStore.set(quoteId, { ...rate, carrier: carrier.name });
        return {
          provider: carrier.name,
          available: true,
          service:
            carrier.name === 'India Post'
              ? 'Speed Post'
              : carrier.name === 'Shadowfax'
                ? 'Next Day Air'
                : 'Surface Lite',
          ...rate,
          quoteId,
          capabilityNotice: 'Demo estimate; replace with live provider quote after onboarding.',
        };
      } catch (error) {
        return { provider: carrier.name, available: false, reason: error.message };
      }
    }),
  );
  res.json(results);
});
router.post('/shipments/:id/track', async (req, res, next) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id, sellerId: req.sellerId });
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    const carrier = carrierByName(shipment.provider);
    if (!carrier) return res.status(404).json({ error: 'Provider unavailable' });
    const tracking = await carrier.getTracking(shipment.awb);
    shipment.status = tracking.status || shipment.status;
    shipment.events = tracking.events || shipment.events;
    shipment.lastTrackedAt = new Date();
    await shipment.save();
    return res.json(tracking);
  } catch (error) {
    next(error);
  }
});

export default router;
