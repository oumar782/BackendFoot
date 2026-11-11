import { queryWithRetry } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import { logActivity } from '../../shared/activity.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (str) => typeof str === 'string' && UUID_REGEX.test(str);

const uuidFields = [
  'id', 'organization_id', 'tournament_id', 'team_id', 
  'home_team_id', 'away_team_id', 'sponsor_id', 'user_id', 'entity_id'
];

export const createResourceService = (def) => ({
  async list(orgId, q = {}) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const clauses = ['organization_id = $1'];
    const values = [orgId];
    let n = 2;

    if (q.search && def.search && def.search.length > 0) {
      const searchClauses = def.search.map(field => `${field}::text ILIKE $${n}`);
      clauses.push(`(${searchClauses.join(' OR ')})`);
      values.push(`%${q.search}%`);
      n++;
    }

    if (def.fields) {
      for (const field of def.fields) {
        if (q[field] !== undefined && !['search', 'page', 'limit', 'sort', 'order'].includes(field)) {
          // If field is a UUID column, validate UUID format
          if (uuidFields.includes(field) && !isValidUuid(q[field])) {
            throw new HttpError(400, `Paramètre '${field}' invalide. Un identifiant UUID est attendu.`);
          }
          clauses.push(`${field} = $${n++}`);
          values.push(q[field]);
        }
      }
    }

    const where = clauses.join(' AND ');
    const sortField = (def.allowedSorts || def.fields || []).includes(q.sort) ? q.sort : 'created_at';
    const order = String(q.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRes = await queryWithRetry(`SELECT COUNT(*)::int as total FROM ${def.table} WHERE ${where}`, values);
    const total = countRes.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const rowsRes = await queryWithRetry(
      `SELECT * FROM ${def.table} WHERE ${where} ORDER BY ${sortField} ${order} LIMIT $${n} OFFSET $${n + 1}`,
      [...values, limit, offset]
    );

    return {
      data: rowsRes.rows,
      meta: {
        page,
        limit,
        total,
        totalPages
      }
    };
  },

  async get(orgId, id) {
    if (!isValidUuid(id)) {
      throw new HttpError(400, `Identifiant invalide '${id}'. Un format UUID est attendu (ex: 123e4567-e89b-12d3-a456-426614174000)`);
    }
    const res = await queryWithRetry(
      `SELECT * FROM ${def.table} WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );
    if (res.rowCount === 0) {
      throw new HttpError(404, `Élément (${def.table}) introuvable ou accès non autorisé`);
    }
    return res.rows[0];
  },

  async create(user, input) {
    let normalizedInput = input;

    if (['registrations', 'players'].includes(def.table) && input.team_id !== undefined && input.team_id !== null && !isValidUuid(input.team_id)) {
      const teamReference = input.team_name?.trim() || (typeof input.team_id === 'string' ? input.team_id.trim() : '');
      if (!teamReference) {
        throw new HttpError(400, "Une équipe est requise. Utilisez l'UUID retourné par la création de l'équipe ou envoyez team_name.");
      }

      const existingTeam = await queryWithRetry(
        'SELECT id FROM teams WHERE organization_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
        [user.organizationId, teamReference]
      );
      const team = existingTeam.rows[0] || (await queryWithRetry(
        'INSERT INTO teams (organization_id, name) VALUES ($1, $2) RETURNING id',
        [user.organizationId, teamReference]
      )).rows[0];
      normalizedInput = { ...input, team_id: team.id };
    }

    const allowedFields = def.fields.filter(f => normalizedInput[f] !== undefined);
    if (allowedFields.length === 0 && def.fields.length > 0) {
      throw new HttpError(422, 'Champs invalides pour la création');
    }

    if (def.table === 'registrations') {
      if (def.table === 'registrations' && !isValidUuid(normalizedInput.tournament_id)) {
        throw new HttpError(400, "Valeur invalide pour le champ 'tournament_id'. Utilisez l'identifiant UUID retourné par la création du tournoi.");
      }
      if (!isValidUuid(normalizedInput.team_id)) {
        throw new HttpError(400, "Valeur invalide pour le champ 'team_id'. Utilisez l'identifiant UUID retourné par la création de l'équipe.");
      }
    }

    // Validate UUID for foreign key fields in input
    for (const f of allowedFields) {
      if (uuidFields.includes(f) && normalizedInput[f] !== null && !isValidUuid(normalizedInput[f])) {
        throw new HttpError(400, `Valeur invalide pour le champ '${f}'. Un UUID est attendu.`);
      }
    }

    const keys = allowedFields;
    const vals = keys.map(k => normalizedInput[k]);

    const placeholders = keys.map((_, i) => `$${i + 2}`).join(', ');
    const queryStr = `
      INSERT INTO ${def.table} (organization_id, ${keys.join(', ')})
      VALUES ($1${keys.length ? ', ' + placeholders : ''})
      RETURNING *
    `;

    const res = await queryWithRetry(queryStr, [user.organizationId, ...vals]);
    const createdItem = res.rows[0];

    await logActivity(user, 'create', def.table, createdItem.id, { input: normalizedInput });
    return createdItem;
  },

  async update(user, id, input) {
    await this.get(user.organizationId, id);

    const allowedFields = def.fields.filter(f => input[f] !== undefined);
    if (allowedFields.length === 0) {
      throw new HttpError(422, 'Aucun champ valide fourni pour la modification');
    }

    // Validate UUID for foreign key fields in input
    for (const f of allowedFields) {
      if (uuidFields.includes(f) && input[f] !== null && !isValidUuid(input[f])) {
        throw new HttpError(400, `Valeur invalide pour le champ '${f}'. Un UUID est attendu.`);
      }
    }

    const setClauses = allowedFields.map((f, i) => `${f} = $${i + 1}`);
    const vals = allowedFields.map(f => input[f]);

    const queryStr = `
      UPDATE ${def.table}
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${vals.length + 1} AND organization_id = $${vals.length + 2}
      RETURNING *
    `;

    const res = await queryWithRetry(queryStr, [...vals, id, user.organizationId]);
    const updatedItem = res.rows[0];

    await logActivity(user, 'update', def.table, id, { input });
    return updatedItem;
  },

  async remove(user, id) {
    await this.get(user.organizationId, id);

    await queryWithRetry(
      `DELETE FROM ${def.table} WHERE id = $1 AND organization_id = $2`,
      [id, user.organizationId]
    );

    await logActivity(user, 'delete', def.table, id);
    return { id, deleted: true };
  }
});
