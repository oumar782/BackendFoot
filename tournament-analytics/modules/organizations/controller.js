import { OrganizationService } from './service.js';
import { ok } from '../../shared/response.js';

export const OrganizationController = {
  async getMyOrganization(req, res, next) {
    try {
      const org = await OrganizationService.getMyOrganization(req.user.organizationId);
      return ok(res, org);
    } catch (err) {
      next(err);
    }
  },

  async updateMyOrganization(req, res, next) {
    try {
      const updated = await OrganizationService.updateMyOrganization(req.user, req.body);
      return ok(res, updated);
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req, res, next) {
    try {
      const result = await OrganizationService.listUsers(req.user.organizationId, req.query);
      return ok(res, result.data, result.meta);
    } catch (err) {
      next(err);
    }
  },

  async addUser(req, res, next) {
    try {
      const user = await OrganizationService.addUser(req.user, req.body);
      return ok(res, user, {}, 201);
    } catch (err) {
      next(err);
    }
  }
};

