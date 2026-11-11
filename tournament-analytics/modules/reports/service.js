import db from '../../shared/db.js';
import { AnalyticsService } from '../analytics/service.js';
import { RankingsService } from '../rankings/service.js';
import { HttpError } from '../../shared/errors.js';

export const ReportsService = {
  async getFinancialReport(orgId, q = {}) {
    const financialData = await AnalyticsService.getFinancialAnalytics(orgId, q);
    return {
      title: 'Rapport Financier - Tournament Analytics Manager',
      generated_at: new Date().toISOString(),
      organization_id: orgId,
      filter: q,
      report_summary: financialData
    };
  },

  async getTournamentReport(orgId, tournamentId) {
    const tourneyRes = await db.query(
      'SELECT * FROM tournaments WHERE id = $1 AND organization_id = $2',
      [tournamentId, orgId]
    );
    if (tourneyRes.rowCount === 0) {
      throw new HttpError(404, 'Tournoi introuvable ou accès non autorisé');
    }
    const tournament = tourneyRes.rows[0];

    const [rankings, finances] = await Promise.all([
      RankingsService.getTournamentRankings(orgId, tournamentId),
      AnalyticsService.getFinancialAnalytics(orgId, { tournament_id: tournamentId })
    ]);

    return {
      title: `Rapport Général - ${tournament.name}`,
      generated_at: new Date().toISOString(),
      tournament,
      rankings: rankings.standings,
      finances: finances.overview
    };
  }
};

