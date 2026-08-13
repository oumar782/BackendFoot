import express from 'express';
import pool from '../db.js';
import { requireAuth, requireManagerOrAdmin } from '../middleware/auth.js';
import { ownedCreneau, ownedTerrain, tenantFilter } from '../middleware/tenant.js';

const router = express.Router();
router.use(requireAuth, requireManagerOrAdmin);

const fields = `idcreneaux, TO_CHAR(datecreneaux, 'YYYY-MM-DD') AS datecreneaux, heure, heurefin,
  statut, numeroterrain, typeterrain, nomterrain, surfaceterrains, tarif, ville, quartier`;
const missing = (res) => res.status(404).json({ success: false, message: 'Créneau non trouvé' });

router.get('/', async (req, res) => {
  try {
    const scope = tenantFilter(req, 't.manager_id');
    const result = await pool.query(`SELECT ${fields} FROM creneaux c JOIN terrains t ON t.numeroterrain = c.numeroterrain WHERE 1=1${scope.sql} ORDER BY datecreneaux, heure`, scope.params);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des créneaux', error: err.message }); }
});

router.get('/filtre/recherche', async (req, res) => {
  try {
    const { date, statut, terrain, ville, quartier } = req.query;
    const params = [];
    let where = ' WHERE 1=1';
    for (const [column, value] of [['c.datecreneaux', date], ['c.statut', statut], ['c.numeroterrain', terrain], ['c.ville', ville], ['c.quartier', quartier]]) {
      if (value) { params.push(value); where += ` AND ${column} = $${params.length}`; }
    }
    const scope = tenantFilter(req, 't.manager_id', params);
    const result = await pool.query(`SELECT ${fields} FROM creneaux c JOIN terrains t ON t.numeroterrain = c.numeroterrain${where}${scope.sql} ORDER BY datecreneaux, heure`, scope.params);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message }); }
});

router.get('/statistiques/overview', async (req, res) => {
  try {
    const scope = tenantFilter(req, 't.manager_id');
    const result = await pool.query(`SELECT COUNT(*) AS total_creneaux, COUNT(*) FILTER (WHERE c.statut = 'disponible') AS disponibles, COUNT(*) FILTER (WHERE c.statut = 'réservé') AS reserves, COUNT(*) FILTER (WHERE c.statut = 'maintenance') AS maintenance, COUNT(DISTINCT c.numeroterrain) AS terrains_actifs, AVG(c.tarif) AS tarif_moyen, COUNT(DISTINCT c.ville) AS villes_disponibles FROM creneaux c JOIN terrains t ON t.numeroterrain = c.numeroterrain WHERE 1=1${scope.sql}`, scope.params);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try { const slot = await ownedCreneau(pool, req, req.params.id); return slot ? res.json({ success: true, data: slot }) : missing(res); }
  catch (err) { return res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message }); }
});

router.post('/', async (req, res) => {
  const { datecreneaux, heure, heurefin, statut, numeroterrain, tarif } = req.body;
  if (!datecreneaux || !heure || !statut || !numeroterrain || tarif == null) return res.status(400).json({ success: false, message: 'Champs requis manquants' });
  try {
    const terrain = await ownedTerrain(pool, req, numeroterrain);
    if (!terrain) return res.status(403).json({ success: false, message: 'Terrain non autorisé' });
    const result = await pool.query(`INSERT INTO creneaux (datecreneaux, heure, heurefin, statut, numeroterrain, typeterrain, nomterrain, surfaceterrains, tarif, ville, quartier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${fields}`,
      [datecreneaux, heure, heurefin || null, statut, numeroterrain, terrain.typeterrain, terrain.nomterrain, terrain.surface, tarif, terrain.ville || null, terrain.quartier || null]);
    res.status(201).json({ success: true, message: 'Créneau ajouté avec succès', data: result.rows[0] });
  } catch (err) { res.status(err.code === '23505' ? 409 : 500).json({ success: false, message: err.code === '23505' ? 'Un créneau existe déjà pour ce terrain à cette date et heure' : 'Erreur serveur', error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { datecreneaux, heure, heurefin, statut, numeroterrain, tarif } = req.body;
  if (!datecreneaux || !heure || !statut || !numeroterrain || tarif == null) return res.status(400).json({ success: false, message: 'Champs requis manquants' });
  try {
    if (!await ownedCreneau(pool, req, req.params.id)) return missing(res);
    const terrain = await ownedTerrain(pool, req, numeroterrain);
    if (!terrain) return res.status(403).json({ success: false, message: 'Terrain non autorisé' });
    const result = await pool.query(`UPDATE creneaux SET datecreneaux=$1, heure=$2, heurefin=$3, statut=$4, numeroterrain=$5, typeterrain=$6, nomterrain=$7, surfaceterrains=$8, tarif=$9, ville=$10, quartier=$11 WHERE idcreneaux=$12 RETURNING ${fields}`,
      [datecreneaux, heure, heurefin || null, statut, numeroterrain, terrain.typeterrain, terrain.nomterrain, terrain.surface, tarif, terrain.ville || null, terrain.quartier || null, req.params.id]);
    res.json({ success: true, message: 'Créneau modifié avec succès', data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!await ownedCreneau(pool, req, req.params.id)) return missing(res);
    const result = await pool.query(`DELETE FROM creneaux WHERE idcreneaux=$1 RETURNING ${fields}`, [req.params.id]);
    res.json({ success: true, message: 'Créneau supprimé avec succès', data: result.rows[0] });
  } catch (err) { res.status(err.code === '23503' ? 409 : 500).json({ success: false, message: err.code === '23503' ? 'Impossible de supprimer ce créneau car il est lié à des réservations' : 'Erreur serveur', error: err.message }); }
});

export default router;
