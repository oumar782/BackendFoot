import jwt from 'jsonwebtoken';

const normaliseRole = (role) => String(role || '').trim().toLowerCase();
export const isAdmin = (user) => ['administrateur', 'admin'].includes(normaliseRole(user?.role));
export const isManager = (user) => ['gestionnaire', 'manager'].includes(normaliseRole(user?.role));

export function requireAuth(req, res, next) {
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
    req.user = { userId: payload.userId, role: payload.role || payload.typeuser, managerId: payload.managerId ?? null };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Jeton invalide ou expiré' });
  }
}

export function requireManagerOrAdmin(req, res, next) {
  if (isAdmin(req.user)) return next();
  if (isManager(req.user) && req.user.managerId != null) return next();
  return res.status(403).json({ success: false, message: 'Accès gestionnaire requis' });
}

// Use only around legacy aggregate routes until their SQL has an explicit
// terrain join. It prevents a manager from receiving a global aggregate.
export function requireAdminForGlobalAnalytics(req, res, next) {
  if (isAdmin(req.user)) return next();
  return res.status(403).json({ success: false, message: 'Analyse non encore disponible pour ce gestionnaire' });
}
