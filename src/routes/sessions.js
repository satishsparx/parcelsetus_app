import { Router } from 'express';
import { SessionHistory } from '../models/SessionHistory.js';
import { User } from '../models/User.js';
import { clearSessionCookie } from '../session.js';
import { closeSessionHistory } from '../services/sessionService.js';

const router = Router();

router.post('/logout', (req, res, next) => {
  if (!req.session) {
    clearSessionCookie(res);
    return res.status(204).end();
  }
  const closeHistory = closeSessionHistory(req, 'logout').then(
    () => null,
    historyError => historyError,
  );
  req.session.destroy(async error => {
    clearSessionCookie(res);
    try {
      const historyError = await closeHistory;
      if (historyError) return next(historyError);
    } catch (historyError) {
      return next(historyError);
    }
    if (error) return next(error);
    return res.status(204).end();
  });
});

router.post('/logout-all', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    await User.updateOne({ _id: req.session.userId }, { $inc: { sessionVersion: 1 } });
    await SessionHistory.updateMany(
      { userId: req.session.userId, active: true },
      { $set: { active: false, closedAt: new Date(), closeReason: 'logout-all' } },
    );
    const closeHistory = closeSessionHistory(req, 'logout-all').then(
      () => null,
      historyError => historyError,
    );
    req.session.destroy(async error => {
      clearSessionCookie(res);
      try {
        const historyError = await closeHistory;
        if (historyError) return next(historyError);
      } catch (historyError) {
        return next(historyError);
      }
      if (error) return next(error);
      res.json({ message: 'You have been signed out from all devices.' });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
