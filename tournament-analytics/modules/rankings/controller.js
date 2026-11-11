import { RankingsService } from './service.js';
import { ok } from '../../shared/response.js';

export const RankingsController = {
  async getRankings(req, res, next) {
    try {
      const { tournamentId } = req.params;
      const result = await RankingsService.getTournamentRankings(req.user.organizationId, tournamentId);
      return ok(res, result.standings, { tournament: result.tournament });
    } catch (err) {
      next(err);
    }
  }
};

