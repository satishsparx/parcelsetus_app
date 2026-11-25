const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export default function requireSameOrigin(req, res, next) {
  if (safeMethods.has(req.method)) return next();

  const configuredOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  if (req.get('origin') !== configuredOrigin) {
    return res.status(403).json({ error: 'This request origin is not allowed.' });
  }

  return next();
}
