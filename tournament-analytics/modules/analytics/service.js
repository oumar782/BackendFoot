import { queryWithRetry } from '../../shared/db.js';

export const AnalyticsService = {
  async getFinancialAnalytics(orgId, q = {}) {
    const { tournament_id, start_date, end_date } = q;

    let txWhere = 'organization_id = $1';
    let expWhere = 'organization_id = $1';
    let spWhere = 'organization_id = $1';
    let regWhere = 'organization_id = $1';
    const params = [orgId];
    let n = 2;

    if (tournament_id) {
      txWhere += ` AND tournament_id = $${n}`;
      expWhere += ` AND tournament_id = $${n}`;
      spWhere += ` AND tournament_id = $${n}`;
      regWhere += ` AND tournament_id = $${n}`;
      params.push(tournament_id);
      n++;
    }

    if (start_date) {
      txWhere += ` AND transaction_date >= $${n}`;
      expWhere += ` AND expense_date >= $${n}`;
      spWhere += ` AND start_date >= $${n}`;
      regWhere += ` AND registration_date >= $${n}`;
      params.push(start_date);
      n++;
    }

    if (end_date) {
      txWhere += ` AND transaction_date <= $${n}`;
      expWhere += ` AND expense_date <= $${n}`;
      spWhere += ` AND end_date <= $${n}`;
      regWhere += ` AND registration_date <= $${n}`;
      params.push(end_date);
      n++;
    }

    const [txIncomeRes, txExpenseRes, expensesRes, sponsorsRes, registrationsRes] = await Promise.all([
      queryWithRetry(`SELECT COALESCE(SUM(amount), 0)::numeric as total FROM financial_transactions WHERE ${txWhere} AND type = 'income'`, params),
      queryWithRetry(`SELECT COALESCE(SUM(amount), 0)::numeric as total FROM financial_transactions WHERE ${txWhere} AND type = 'expense'`, params),
      queryWithRetry(`SELECT COALESCE(SUM(amount), 0)::numeric as total FROM expenses WHERE ${expWhere}`, params),
      queryWithRetry(`SELECT COALESCE(SUM(amount), 0)::numeric as total FROM sponsorship_contracts WHERE ${spWhere} AND status = 'active'`, params),
      queryWithRetry(`SELECT COALESCE(SUM(fee), 0)::numeric as total FROM registrations WHERE ${regWhere} AND status = 'approved'`, params)
    ]);

    const transactionIncome = parseFloat(txIncomeRes.rows[0]?.total || 0);
    const transactionExpense = parseFloat(txExpenseRes.rows[0]?.total || 0);
    const directExpenses = parseFloat(expensesRes.rows[0]?.total || 0);
    const sponsorshipRevenues = parseFloat(sponsorsRes.rows[0]?.total || 0);
    const registrationRevenues = parseFloat(registrationsRes.rows[0]?.total || 0);

    const totalIncome = transactionIncome + sponsorshipRevenues + registrationRevenues;
    const totalExpense = transactionExpense + directExpenses;
    const netProfit = totalIncome - totalExpense;

    const profitMarginPercent = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(2) : 0;
    const roiPercent = totalExpense > 0 ? ((netProfit / totalExpense) * 100).toFixed(2) : 0;

    return {
      overview: {
        total_income: totalIncome,
        total_expense: totalExpense,
        net_profit: netProfit,
        profit_margin_percent: parseFloat(profitMarginPercent),
        roi_percent: parseFloat(roiPercent)
      },
      breakdown: {
        income: {
          transactions: transactionIncome,
          sponsorships: sponsorshipRevenues,
          registrations: registrationRevenues
        },
        expense: {
          transactions: transactionExpense,
          direct_expenses: directExpenses
        }
      }
    };
  },

  async getDashboardAnalytics(orgId) {
    const [tourneysRes, teamsRes, playersRes, matchesRes] = await Promise.all([
      queryWithRetry('SELECT status, COUNT(*)::int as count FROM tournaments WHERE organization_id = $1 GROUP BY status', [orgId]),
      queryWithRetry('SELECT COUNT(*)::int as count FROM teams WHERE organization_id = $1', [orgId]),
      queryWithRetry('SELECT COUNT(*)::int as count FROM players WHERE organization_id = $1', [orgId]),
      queryWithRetry('SELECT status, is_validated, COUNT(*)::int as count FROM matches WHERE organization_id = $1 GROUP BY status, is_validated', [orgId])
    ]);

    return {
      tournaments: tourneysRes.rows,
      total_teams: teamsRes.rows[0]?.count || 0,
      total_players: playersRes.rows[0]?.count || 0,
      matches_summary: matchesRes.rows
    };
  }
};

