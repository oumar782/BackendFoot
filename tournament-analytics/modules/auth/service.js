import db, { queryWithRetry } from '../../shared/db.js';
import jwt from 'jsonwebtoken';
import { ENV } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../shared/crypto.js';
import { HttpError } from '../../shared/errors.js';
import { logActivity } from '../../shared/activity.js';

export const AuthService = {
  async register(input) {
    const { organization_name, email, password, first_name, last_name } = input;

    // 1. Check existing email
    const existing = await queryWithRetry('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rowCount > 0) {
      throw new HttpError(400, 'Cet email est déjà utilisé');
    }

    // 2. Resilient checkout with timeout fallback for Supabase PgBouncer (Port 6543)
    let client = null;
    let isDedicatedClient = false;

    try {
      client = await Promise.race([
        db.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), 3000))
      ]);
      isDedicatedClient = true;
      await client.query('BEGIN');
    } catch (e) {
      // Fallback: query pool directly if pooler rejects manual checkout
      client = db;
      isDedicatedClient = false;
    }

    try {
      const slug = organization_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const orgResult = await client.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *',
        [organization_name.trim(), `${slug}-${Date.now()}`]
      );
      const organization = orgResult.rows[0];

      const password_hash = await hashPassword(password);
      const userResult = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, role, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, organization_id, email, role, first_name, last_name, created_at`,
        [organization.id, email.toLowerCase().trim(), password_hash, 'owner', first_name || null, last_name || null]
      );
      const user = userResult.rows[0];

      if (isDedicatedClient) {
        await client.query('COMMIT');
      }

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id
      };
      const token = jwt.sign(tokenPayload, ENV.JWT_SECRET, { expiresIn: ENV.JWT_EXPIRES_IN });

      await logActivity(tokenPayload, 'register', 'users', user.id, { organization_name });

      return { user, organization, token };
    } catch (err) {
      if (isDedicatedClient && client) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw err;
    } finally {
      if (isDedicatedClient && client && typeof client.release === 'function') {
        client.release();
      }
    }
  },

  async login(input) {
    const { email, password } = input;
    const userRes = await queryWithRetry(
      `SELECT u.id, u.organization_id, u.email, u.password_hash, u.role, u.first_name, u.last_name, o.name as organization_name
       FROM users u
       JOIN organizations o ON u.organization_id = o.id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rowCount === 0) {
      throw new HttpError(401, 'Identifiants invalides');
    }

    const user = userRes.rows[0];
    const match = await verifyPassword(password, user.password_hash);
    if (!match) {
      throw new HttpError(401, 'Identifiants invalides');
    }

    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id
    };
    const token = jwt.sign(tokenPayload, ENV.JWT_SECRET, { expiresIn: ENV.JWT_EXPIRES_IN });

    delete user.password_hash;
    await logActivity(tokenPayload, 'login', 'users', user.id);

    return { user, token };
  },

  async getMe(userId, orgId) {
    const userRes = await queryWithRetry(
      `SELECT u.id, u.organization_id, u.email, u.role, u.first_name, u.last_name, u.created_at,
              o.name as organization_name, o.slug as organization_slug
       FROM users u
       JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = $1 AND u.organization_id = $2`,
      [userId, orgId]
    );

    if (userRes.rowCount === 0) {
      throw new HttpError(404, 'Utilisateur introuvable');
    }

    return userRes.rows[0];
  }
};
