import { createHash } from 'node:crypto';
import { SessionHistory } from '../models/SessionHistory.js';
import { AUTH_COOKIE_NAME, authCookieOptions, issueAuthToken } from '../authToken.js';

export const hashToken = value => createHash('sha256').update(value).digest('hex');

export async function startSession(req, res, user) {
  const { jti, token } = issueAuthToken(user);
  const now = new Date();

  await SessionHistory.create({
    userId: user.id,
    sessionIdHash: hashToken(jti),
    active: true,
    createdAt: now,
  });

  if (req.authClaims?.jti) {
    await SessionHistory.updateOne(
      {
        userId: req.authClaims.sub,
        sessionIdHash: hashToken(req.authClaims.jti),
        active: true,
      },
      { $set: { active: false, closedAt: now, closeReason: 'rotated' } },
    );
  }

  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
}

export async function closeSessionHistory({ userId, jti }, closeReason) {
  if (!userId || !jti) return;
  await SessionHistory.updateOne(
    { userId, sessionIdHash: hashToken(jti), active: true },
    { $set: { active: false, closedAt: new Date(), closeReason } },
  );
}
