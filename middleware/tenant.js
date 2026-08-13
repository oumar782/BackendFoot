import { isAdmin } from './auth.js';

export function tenantFilter(req, column, params = []) {
  if (isAdmin(req.user)) return { sql: '', params };
  params.push(req.user.managerId);
  return { sql: ` AND ${column} = $${params.length}`, params };
}

export async function ownedTerrain(pool, req, terrainId) {
  const params = [terrainId];
  const scope = tenantFilter(req, 't.manager_id', params);
  const result = await pool.query(`SELECT t.* FROM terrains t WHERE t.numeroterrain = $1${scope.sql}`, scope.params);
  return result.rows[0] || null;
}

export async function ownedCreneau(pool, req, creneauId) {
  const params = [creneauId];
  const scope = tenantFilter(req, 't.manager_id', params);
  const result = await pool.query(`SELECT c.*, t.manager_id FROM creneaux c JOIN terrains t ON t.numeroterrain = c.numeroterrain WHERE c.idcreneaux = $1${scope.sql}`, scope.params);
  return result.rows[0] || null;
}

export async function ownedReservation(pool, req, reservationId) {
  const params = [reservationId];
  const scope = tenantFilter(req, 't.manager_id', params);
  const result = await pool.query(`SELECT r.*, t.manager_id FROM reservation r JOIN terrains t ON t.numeroterrain = r.numeroterrain WHERE r.numeroreservations = $1${scope.sql}`, scope.params);
  return result.rows[0] || null;
}
