import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

export const AUTH_COOKIE_NAME = 'parcelsetus.auth';
export const AUTH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

const cookieSameSite = () =>
  process.env.SESSION_COOKIE_SAME_SITE || (process.env.VERCEL === '1' ? 'none' : 'lax');

const cookieSecure = () => process.env.NODE_ENV === 'production' || cookieSameSite() === 'none';

const signingSecret = () => {
  const secret =
    process.env.AUTH_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_TOKEN_SECRET must be configured in production.');
  }
  return secret || 'local-development-only-change-this-auth-token-secret';
};

export const assertAuthTokenConfig = () => signingSecret();

export const authCookieOptions = () => ({
  httpOnly: true,
  secure: cookieSecure(),
  sameSite: cookieSameSite(),
  maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
  path: '/',
});

const cookieValue = (req, name) => {
  const rawCookie = req.headers.cookie || '';
  const prefix = `${name}=`;
  const pair = rawCookie
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(prefix.length));
  } catch {
    return null;
  }
};

export function readAuthToken(req) {
  const token = cookieValue(req, AUTH_COOKIE_NAME);
  if (!token) return null;
  try {
    return jwt.verify(token, signingSecret(), {
      algorithms: ['HS256'],
      issuer: 'parcelsetus-api',
      audience: 'parcelsetus-web',
    });
  } catch {
    return null;
  }
}

export const authTokenMiddleware = (req, _res, next) => {
  req.authClaims = readAuthToken(req);
  next();
};

export function issueAuthToken(user) {
  const jti = randomBytes(32).toString('base64url');
  const token = jwt.sign({ ver: user.sessionVersion || 0 }, signingSecret(), {
    algorithm: 'HS256',
    subject: user.id,
    jwtid: jti,
    issuer: 'parcelsetus-api',
    audience: 'parcelsetus-web',
    expiresIn: AUTH_TOKEN_TTL_SECONDS,
  });
  return { jti, token };
}

export const clearAuthCookie = res =>
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/',
  });
