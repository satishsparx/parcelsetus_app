import { createHash } from 'node:crypto';
import { SessionHistory } from '../models/SessionHistory.js';

export const hashToken = value => createHash('sha256').update(value).digest('hex');

export function startSession(req, user) {
  // Rotate the session ID on every successful authentication to prevent session fixation.
  const previousSessionId = req.sessionID;
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = user.id;
      req.session.sessionVersion = user.sessionVersion || 0;
      req.session.save(async saveError => {
        if (saveError) return reject(saveError);
        try {
          const updates = [
            SessionHistory.create({
              userId: user.id,
              sessionIdHash: hashToken(req.sessionID),
              active: true,
            }),
          ];
          if (previousSessionId && previousSessionId !== req.sessionID) {
            updates.push(
              SessionHistory.updateOne(
                { sessionIdHash: hashToken(previousSessionId), active: true },
                { $set: { active: false, closedAt: new Date(), closeReason: 'rotated' } },
              ),
            );
          }
          await Promise.all(updates);
          resolve();
        } catch (historyError) {
          req.session.destroy(() => reject(historyError));
        }
      });
    });
  });
}

export async function closeSessionHistory(req, closeReason) {
  if (!req.sessionID || !req.session?.userId) return;
  const now = new Date();
  await SessionHistory.updateOne(
    { sessionIdHash: hashToken(req.sessionID) },
    {
      $set: { active: false, closedAt: now, closeReason },
      $setOnInsert: {
        userId: req.session.userId,
        sessionIdHash: hashToken(req.sessionID),
        createdAt: now,
      },
    },
    { upsert: true },
  );
}
