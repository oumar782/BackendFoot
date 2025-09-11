import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 UTILITAIRE POUR FORMATER LES DATES
const formatDateForClient = (date) => {
  if (!date) return null;
  return new Date(date).toISOString().split('T')[0]; // Format YYYY-MM-DD
};

// 📌 Route pour récupérer toutes les réservations (avec ou sans filtres)
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut, date, clientId } = req.query;
    
    let sql = `
      SELECT 
        id, -- ✅ OBLIGATOIRE POUR REACT KEYS
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeTerrain,
        tarif,
        surface,
        heurefin,
        nomterrain
      FROM reservation 
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    // Filtres
    if (clientId) {
      paramCount++;
      sql += ` AND idclient = $${paramCount}`;
      params.push(clientId);
    } else {
      if (nom) {
        paramCount++;
        sql += ` AND nomclient ILIKE $${paramCount}`;
        params.push(`%${nom}%`);
      }
      if (email) {
        paramCount++;
        sql += ` AND email ILIKE $${paramCount}`;
        params.push(`%${email}%`);
      }
    }
    
    if (statut) {
      paramCount++;
      sql += ` AND statut = $${paramCount}`;
      params.push(statut);
    }
    
    if (date) {
      paramCount++;
      sql += ` AND datereservation = $${paramCount}`;
      params.push(date);
    }
    
    sql += ` ORDER BY datereservation DESC, heurereservation DESC`;
    
    console.log('📋 [GET /] Requête SQL:', sql);
    console.log('📦 [GET /] Paramètres:', params);
    
    const result = await db.query(sql, params);
    
    console.log('📊 [GET /] Réservations trouvées:', result.rows.length);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(row => ({
        ...row,
        datereservation: formatDateForClient(row.datereservation) // Format cohérent
      }))
    });

  } catch (error) {
    console.error('❌ [GET /] Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📌 Route pour récupérer UNE réservation par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID invalide.'
      });
    }

    const sql = `
      SELECT 
        id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeTerrain,
        tarif,
        surface,
        heurefin,
        nomterrain
      FROM reservation 
      WHERE id = $1
    `;
    
    console.log('📋 [GET /:id] Requête SQL:', sql);
    console.log('📦 [GET /:id] Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const reservation = {
      ...result.rows[0],
      datereservation: formatDateForClient(result.rows[0].datereservation)
    };
    
    console.log('✅ [GET /:id] Réservation trouvée:', reservation);
    
    res.json({
      success: true,
      data: reservation
    });

  } catch (error) {
    console.error('❌ [GET /:id] Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📌 Route pour créer une réservation
router.post('/', async (req, res) => {
  try {
    const {
      datereservation,
      heurereservation,
      statut = 'en attente',
      idclient,
      numeroterrain,
      nomclient,
      prenom,
      email,
      telephone,
      typeTerrain = '',
      tarif = 0,
      surface = '',
      heurefin,
      nomterrain = ''
    } = req.body;

    // Validation
    if (!datereservation || !heurereservation || !idclient || !numeroterrain || !heurefin) {
      return res.status(400).json({
        success: false,
        message: 'Champs obligatoires manquants: date, heure début, heure fin, idclient, numeroterrain.'
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut, idclient, numeroterrain,
        nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING 
        id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeTerrain,
        tarif,
        surface,
        heurefin,
        nomterrain
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain
    ];

    console.log('📋 [POST /] Requête SQL:', sql);
    console.log('📦 [POST /] Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      throw new Error('Échec de la création');
    }
    
    const newReservation = {
      ...result.rows[0],
      datereservation: formatDateForClient(result.rows[0].datereservation)
    };
    
    console.log('✅ [POST /] Réservation créée:', newReservation);
    
    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès.',
      data: newReservation
    });

  } catch (error) {
    console.error('❌ [POST /] Erreur création:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour une réservation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      datereservation,
      heurereservation,
      statut,
      idclient,
      numeroterrain,
      nomclient,
      prenom,
      email,
      telephone,
      typeTerrain,
      tarif,
      surface,
      heurefin,
      nomterrain
    } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de réservation invalide.'
      });
    }

    const sql = `
      UPDATE reservation 
      SET 
        datereservation = $1,
        heurereservation = $2,
        statut = $3,
        idclient = $4,
        numeroterrain = $5,
        nomclient = $6,
        prenom = $7,
        email = $8,
        telephone = $9,
        typeTerrain = $10,
        tarif = $11,
        surface = $12,
        heurefin = $13,
        nomterrain = $14
      WHERE id = $15
      RETURNING 
        id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeTerrain,
        tarif,
        surface,
        heurefin,
        nomterrain
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain, id
    ];

    console.log('📋 [PUT /:id] Requête SQL:', sql);
    console.log('📦 [PUT /:id] Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée ou non mise à jour.'
      });
    }
    
    const updatedReservation = {
      ...result.rows[0],
      datereservation: formatDateForClient(result.rows[0].datereservation)
    };
    
    console.log('✅ [PUT /:id] Réservation mise à jour:', updatedReservation);
    
    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès.',
      data: updatedReservation
    });

  } catch (error) {
    console.error('❌ [PUT /:id] Erreur mise à jour:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour supprimer une réservation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de réservation invalide.'
      });
    }
    
    const sql = 'DELETE FROM reservation WHERE id = $1 RETURNING id';
    
    console.log('📋 [DELETE /:id] Requête SQL:', sql);
    console.log('📦 [DELETE /:id] Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    
    console.log('✅ [DELETE /:id] Réservation supprimée. ID:', result.rows[0].id);
    
    res.json({
      success: true,
      message: 'Réservation supprimée avec succès.',
      data: { id: result.rows[0].id }
    });

  } catch (error) {
    console.error('❌ [DELETE /:id] Erreur suppression:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour UNIQUEMENT le statut
router.put('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de réservation invalide.'
      });
    }
    
    if (!statut || !['confirmée', 'annulée', 'en attente', 'terminée'].includes(statut)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide. Valeurs autorisées: confirmée, annulée, en attente, terminée.'
      });
    }
    
    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE id = $2
      RETURNING 
        id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeTerrain,
        tarif,
        surface,
        heurefin,
        nomterrain
    `;
    
    console.log('📋 [PUT /:id/statut] Requête SQL:', sql);
    console.log('📦 [PUT /:id/statut] Paramètres:', [statut, id]);
    
    const result = await db.query(sql, [statut, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const updatedReservation = {
      ...result.rows[0],
      datereservation: formatDateForClient(result.rows[0].datereservation)
    };
    
    console.log('✅ [PUT /:id/statut] Statut mis à jour:', updatedReservation);
    
    res.json({
      success: true,
      message: 'Statut de la réservation mis à jour avec succès.',
      data: updatedReservation
    });

  } catch (error) {
    console.error('❌ [PUT /:id/statut] Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;