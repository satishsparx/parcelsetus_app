import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Address } from '../models/Address.js';
import { addressSchema } from '../schemas.js';
import { validate } from '../lib/validate.js';

const router = Router();

router.get('/addresses', async (req, res, next) => {
  try {
    res.json(await Address.find({ sellerId: req.sellerId }).sort({ createdAt: -1 }).lean());
  } catch (error) {
    next(error);
  }
});
router.post('/addresses', async (req, res, next) => {
  try {
    const body = validate(addressSchema, req, res);
    if (!body) return;
    if (body.default)
      await Address.updateMany({ sellerId: req.sellerId }, { $set: { default: false } });
    const count = await Address.countDocuments({ sellerId: req.sellerId });
    const address = await Address.create({
      ...body,
      id: randomUUID(),
      sellerId: req.sellerId,
      default: body.default || count === 0,
    });
    return res.status(201).json(address);
  } catch (error) {
    next(error);
  }
});
router.put('/addresses/:id', async (req, res, next) => {
  try {
    const body = validate(addressSchema, req, res);
    if (!body) return;
    if (body.default)
      await Address.updateMany(
        { sellerId: req.sellerId, id: { $ne: req.params.id } },
        { $set: { default: false } },
      );
    const address = await Address.findOneAndUpdate(
      { id: req.params.id, sellerId: req.sellerId },
      { $set: body },
      { new: true, runValidators: true },
    );
    if (!address) return res.status(404).json({ error: 'Address not found.' });
    return res.json(address);
  } catch (error) {
    next(error);
  }
});
router.delete('/addresses/:id', async (req, res, next) => {
  try {
    const address = await Address.findOneAndDelete({ id: req.params.id, sellerId: req.sellerId });
    if (!address) return res.status(404).json({ error: 'Address not found.' });
    if (address.default) {
      const nextDefault = await Address.findOne({ sellerId: req.sellerId }).sort({ createdAt: 1 });
      if (nextDefault) {
        nextDefault.default = true;
        await nextDefault.save();
      }
    }
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
