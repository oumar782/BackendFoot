import db from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';

export const RankingsService = {
  async getTournamentRankings(orgId, tournamentId) {
    // Verify tournament exists and belongs to org
    const tourneyRes = await db.query(
      'SELECT id, name FROM tournaments WHERE id = $1 AND organization_id = $2',
      [tournamentId, orgId]
    );
    if (tourneyRes.rowCount === 0) {
      throw new HttpError(404, 'Tournoi introuvable ou accès non autorisé');
    }
    const tournament = tourneyRes.rows[0];

    // Get registered teams for this tournament
    const teamsRes = await db.query(
      `SELECT DISTINCT t.id, t.name, t.logo_url
       FROM teams t
       JOIN registrations r ON r.team_id = t.id
       WHERE r.tournament_id = $1 AND r.organization_id = $2 AND r.status = 'approved'`,
      [tournamentId, orgId]
    );

    // Map to initialize team standings
    const standingsMap = new Map();
    for (const team of teamsRes.rows) {
      standingsMap.set(team.id, {
        team_id: team.id,
        team_name: team.name,
        logo_url: team.logo_url,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0
      });
    }

    // Get all VALIDATED matches for this tournament
    const matchesRes = await db.query(
      `SELECT home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE tournament_id = $1 AND organization_id = $2 AND is_validated = true AND status = 'completed'`,
      [tournamentId, orgId]
    );

    for (const match of matchesRes.rows) {
      const home = standingsMap.get(match.home_team_id) || {
        team_id: match.home_team_id,
        team_name: 'Équipe inconnue',
        played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0
      };
      const away = standingsMap.get(match.away_team_id) || {
        team_id: match.away_team_id,
        team_name: 'Équipe inconnue',
        played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0
      };

      home.played += 1;
      away.played += 1;
      home.goals_for += match.home_score;
      home.goals_against += match.away_score;
      away.goals_for += match.away_score;
      away.goals_against += match.home_score;

      if (match.home_score > match.away_score) {
        home.won += 1;
        home.points += 3;
        away.lost += 1;
      } else if (match.home_score < match.away_score) {
        away.won += 1;
        away.points += 3;
        home.lost += 1;
      } else {
        home.drawn += 1;
        home.points += 1;
        away.drawn += 1;
        away.points += 1;
      }

      home.goal_difference = home.goals_for - home.goals_against;
      away.goal_difference = away.goals_for - away.goals_against;

      standingsMap.set(match.home_team_id, home);
      standingsMap.set(match.away_team_id, away);
    }

    // Convert map to array and sort
    const standings = Array.from(standingsMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
      if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
      return a.team_name.localeCompare(b.team_name);
    });

    // Assign rank
    standings.forEach((item, index) => {
      item.rank = index + 1;
    });

    return {
      tournament,
      standings
    };
  }
};

