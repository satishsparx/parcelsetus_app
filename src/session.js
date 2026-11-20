export const SESSION_COOKIE_NAME = 'parcelsetus.sid';

const sessionCookieSameSite = () =>
  process.env.SESSION_COOKIE_SAME_SITE || (process.env.VERCEL === '1' ? 'none' : 'lax');

const sessionCookieSecure = () =>
  process.env.NODE_ENV === 'production' || sessionCookieSameSite() === 'none';

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: sessionCookieSecure(),
  sameSite: sessionCookieSameSite(),
  maxAge: 14 * 24 * 60 * 60 * 1000,
  path: '/',
});

export const clearSessionCookie = res =>
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: sessionCookieSameSite(),
    path: '/',
  });
