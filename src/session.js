export const SESSION_COOKIE_NAME = 'parcelsetus.sid';

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 14 * 24 * 60 * 60 * 1000,
  path: '/',
});

export const clearSessionCookie = res =>
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
