import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';
import { HttpError } from '../shared/errors.js';

export const authenticate = (req, _res, next) => {
  let token = null;

  // 1. Bearer token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Cookie fallback (req.cookies or raw Cookie header parsing)
  if (!token) {
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.cookie) {
      const parsedCookies = Object.fromEntries(
        req.headers.cookie.split(';').map(c => {
          const [k, ...v] = c.trim().split('=');
          return [k, v.join('=')];
        })
      );
      token = parsedCookies.token || parsedCookies.jwt;
    }
  }

  if (!token) {
    return next(new HttpError(401, 'Jeton d\'authentification manquant'));
  }

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET);
    if (!decoded.organizationId) {
      return next(new HttpError(401, 'Jeton invalide: absence d\'organisation'));
    }
    req.user = decoded;
    return next();
  } catch (err) {
    return next(new HttpError(401, 'Jeton invalide ou expiré'));
  }
};
