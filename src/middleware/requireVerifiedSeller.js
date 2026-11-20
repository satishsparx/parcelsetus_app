import { User } from '../models/User.js';

export default async function requireVerifiedSeller(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    const user = await User.findById(req.session.userId).select('+sessionVersion');
    if (
      !user ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      user.sessionVersion !== req.session.sessionVersion
    ) {
      return req.session.destroy(() => {
        res.clearCookie('parcelsetus.sid');
        res.status(401).json({ error: 'Your session has expired. Sign in again.' });
      });
    }
    req.sellerId = user.id;
    next();
  } catch (error) {
    next(error);
  }
}
