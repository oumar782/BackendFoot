import { HttpError } from './errors.js';

export const ROLES = ['owner', 'admin', 'manager', 'editor', 'analyst', 'viewer'];

export const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: ['*'],
  manager: ['read', 'create', 'update', 'delete'],
  editor: ['read', 'create', 'update'],
  analyst: ['read'],
  viewer: ['read']
};

export const requireRoles = (...allowedRoles) => {
  return (req, _res, next) => {
    if (!req.user || !req.user.role) {
      return next(new HttpError(401, 'Utilisateur non authentifié'));
    }
    if (allowedRoles.includes('*') || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return next(new HttpError(403, `Accès refusé. Rôle requis: ${allowedRoles.join(', ')}`));
  };
};

export const requirePermission = (permission) => {
  return (req, _res, next) => {
    if (!req.user || !req.user.role) {
      return next(new HttpError(401, 'Utilisateur non authentifié'));
    }
    const userPermissions = ROLE_PERMISSIONS[req.user.role] || [];
    if (userPermissions.includes('*') || userPermissions.includes(permission)) {
      return next();
    }
    return next(new HttpError(403, `Accès refusé. Permission '${permission}' requise`));
  };
};
