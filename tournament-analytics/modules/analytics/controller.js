import { AnalyticsService } from './service.js';
import { ok } from '../../shared/response.js';

export const AnalyticsController = {
  async getFinance(req, res, next) {
    try {
      const data = await AnalyticsService.getFinancialAnalytics(req.user.organizationId, req.query);
      return ok(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getDashboard(req, res, next) {
    try {
      const data = await AnalyticsService.getDashboardAnalytics(req.user.organizationId);
      return ok(res, data);
    } catch (err) {
      next(err);
    }
  }
};

