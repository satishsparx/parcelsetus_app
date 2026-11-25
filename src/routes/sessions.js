import { Router } from 'express';
import { SessionHistory } from '../models/SessionHistory.js';
import { User } from '../models/User.js';
import { clearAuthCookie } from '../authToken.js';
import { closeSessionHistory } from '../services/sessionService.js';
import { requireAuthenticatedUser } from '../middleware/requireVerifiedSeller.js';

const router = Router();

router.post('/logout', async (req, res, next) => {
  try {
    if (req.authClaims?.sub && req.authClaims?.jti) {
      await closeSessionHistory({ userId: req.authClaims.sub, jti: req.authClaims.jti }, 'logout');
    }
    clearAuthCookie(res);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post('/logout-all', requireAuthenticatedUser, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.auth.userId }, { $inc: { sessionVersion: 1 } });
    await SessionHistory.updateMany(
      { userId: req.auth.userId, active: true },
      { $set: { active: false, closedAt: new Date(), closeReason: 'logout-all' } },
    );
    clearAuthCookie(res);
    return res.json({ message: 'You have been signed out from all devices.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
