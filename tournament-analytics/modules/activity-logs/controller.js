import { ActivityLogsService } from './service.js';
import { ok } from '../../shared/response.js';

export const ActivityLogsController = {
  async listLogs(req, res, next) {
    try {
      const result = await ActivityLogsService.listLogs(req.user.organizationId, req.query);
      return ok(res, result.data, result.meta);
    } catch (err) {
      next(err);
    }
  }
};

