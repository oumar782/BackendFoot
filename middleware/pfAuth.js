import jwt from 'jsonwebtoken';

/**
 * Auth middleware for PlayForest (pf_users UUID + JWT).
 * Expects: Authorization: Bearer <token>
 * Sets: req.pfUser = { id, role, email }
 */
export function requirePfAuth(req, res, next) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ success: false, message: 'JWT_SECRET non configuré' });
  }

  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentification requise' });
  }

  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (!payload?.pfUserId) {
      return res.status(401).json({ success: false, message: 'Jeton PlayForest invalide' });
    }
    req.pfUser = {
      id: payload.pfUserId,
      role: payload.role || 'PLAYER',
      email: payload.email || null,
    };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Jeton invalide ou expiré' });
  }
}

export function signPfToken(user) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET non configuré');
  }
  return jwt.sign(
    {
      pfUserId: user.id,
      role: user.role,
      email: user.email,
      source: 'playforest',
    },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}
