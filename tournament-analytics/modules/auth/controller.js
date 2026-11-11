import { AuthService } from './service.js';
import { ok } from '../../shared/response.js';

export const AuthController = {
  async register(req, res, next) {
    try {
      const result = await AuthService.register(req.body);
      res.cookie('token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 3600 * 1000
      });
      return ok(res, result, {}, 201);
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const result = await AuthService.login(req.body);
      res.cookie('token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 3600 * 1000
      });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },

  async me(req, res, next) {
    try {
      const user = await AuthService.getMe(req.user.sub, req.user.organizationId);
      return ok(res, user);
    } catch (err) {
      next(err);
    }
  },

  async logout(_req, res) {
    res.clearCookie('token');
    return ok(res, { message: 'Déconnexion réussie' });
  }
};

