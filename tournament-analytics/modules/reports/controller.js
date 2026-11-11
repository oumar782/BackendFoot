import { ReportsService } from './service.js';
import { ok } from '../../shared/response.js';

export const ReportsController = {
  async getFinancialReport(req, res, next) {
    try {
      const report = await ReportsService.getFinancialReport(req.user.organizationId, req.query);
      return ok(res, report);
    } catch (err) {
      next(err);
    }
  },

  async getTournamentReport(req, res, next) {
    try {
      const { tournamentId } = req.params;
      const report = await ReportsService.getTournamentReport(req.user.organizationId, tournamentId);
      return ok(res, report);
    } catch (err) {
      next(err);
    }
  }
};

