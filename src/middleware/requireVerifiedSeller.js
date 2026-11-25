import { User } from '../models/User.js';
import { SessionHistory } from '../models/SessionHistory.js';
import { clearAuthCookie } from '../authToken.js';
import { hashToken } from '../services/sessionService.js';

export async function requireAuthenticatedUser(req, res, next) {
  try {
    const claims = req.authClaims;
    if (!claims?.sub || !claims?.jti || !Number.isInteger(claims.ver)) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Sign in to continue.' });
    }

    const [user, activeSession] = await Promise.all([
      User.findById(claims.sub).select('+sessionVersion'),
      SessionHistory.exists({
        userId: claims.sub,
        sessionIdHash: hashToken(claims.jti),
        active: true,
      }),
    ]);

    if (
      !user ||
      !activeSession ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      user.sessionVersion !== claims.ver
    ) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    }

    req.auth = { user, userId: user.id, jti: claims.jti, sessionVersion: claims.ver };
    req.sellerId = user.id;
    return next();
  } catch (error) {
    return next(error);
  }
}

export default requireAuthenticatedUser;
