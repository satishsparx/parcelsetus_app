import { Router } from 'express';
import { processPendingNotifications } from '../services/notificationService.js';

const router = Router();

router.get('/dispatch', async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const result = await processPendingNotifications();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
