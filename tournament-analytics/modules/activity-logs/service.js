import db from '../../shared/db.js';

export const ActivityLogsService = {
  async listLogs(orgId, q = {}) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const clauses = ['al.organization_id = $1'];
    const values = [orgId];
    let n = 2;

    if (q.entity) {
      clauses.push(`al.entity = $${n++}`);
      values.push(q.entity);
    }

    if (q.action) {
      clauses.push(`al.action = $${n++}`);
      values.push(q.action);
    }

    if (q.user_id) {
      clauses.push(`al.user_id = $${n++}`);
      values.push(q.user_id);
    }

    const where = clauses.join(' AND ');

    const countRes = await db.query(
      `SELECT COUNT(*)::int as total FROM activity_logs al WHERE ${where}`,
      values
    );
    const total = countRes.rows[0]?.total || 0;

    const rowsRes = await db.query(
      `SELECT al.*, u.email as user_email, u.first_name, u.last_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE ${where}
       ORDER BY al.created_at DESC
       LIMIT $${n} OFFSET $${n + 1}`,
      [...values, limit, offset]
    );

    return {
      data: rowsRes.rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
};

