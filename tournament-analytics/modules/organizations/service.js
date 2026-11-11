import { queryWithRetry } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import { hashPassword } from '../../shared/crypto.js';
import { logActivity } from '../../shared/activity.js';

export const OrganizationService = {
  async getMyOrganization(orgId) {
    const res = await queryWithRetry('SELECT * FROM organizations WHERE id = $1', [orgId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Organisation introuvable');
    return res.rows[0];
  },

  async updateMyOrganization(user, input) {
    const { name } = input;
    if (!name || !name.trim()) throw new HttpError(422, 'Le nom de l\'organisation est requis');

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const res = await queryWithRetry(
      `UPDATE organizations SET name = $1, slug = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [name.trim(), `${slug}-${Date.now()}`, user.organizationId]
    );

    await logActivity(user, 'update', 'organizations', user.organizationId, { name });
    return res.rows[0];
  },

  async listUsers(orgId, q = {}) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const countRes = await queryWithRetry(
      'SELECT COUNT(*)::int as total FROM users WHERE organization_id = $1',
      [orgId]
    );
    const total = countRes.rows[0]?.total || 0;

    const rowsRes = await queryWithRetry(
      `SELECT id, organization_id, email, role, first_name, last_name, created_at
       FROM users WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
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
  },

  async addUser(currentUser, input) {
    const { email, password, role, first_name, last_name } = input;
    if (!email || !password || !role) {
      throw new HttpError(422, 'Les champs email, password et role sont requis');
    }

    const validRoles = ['owner', 'admin', 'manager', 'editor', 'analyst', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new HttpError(422, `Rôle invalide. Rôles autorisés: ${validRoles.join(', ')}`);
    }

    const existing = await queryWithRetry('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rowCount > 0) {
      throw new HttpError(400, 'Cet email existe déjà');
    }

    const password_hash = await hashPassword(password);
    const res = await queryWithRetry(
      `INSERT INTO users (organization_id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, email, role, first_name, last_name, created_at`,
      [currentUser.organizationId, email.toLowerCase().trim(), password_hash, role, first_name || null, last_name || null]
    );

    const newUser = res.rows[0];
    await logActivity(currentUser, 'create_user', 'users', newUser.id, { email, role });
    return newUser;
  }
};

