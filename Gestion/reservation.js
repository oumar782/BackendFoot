import express from 'express';
import db from '../db.js';

const router = express.Router();

// Middleware pour logger les requêtes
router.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`, req.body || '');
  next();
});

// 📌 Route pour récupérer toutes les réservations avec filtres
router.get('/', async (req, res) => {
  try {
    const { search, statut } = req.query;
    
    let sql = `
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
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    // Filtre par recherche
    if (search) {
      paramCount++;
      sql += ` AND (
        nomclient ILIKE $${paramCount} OR 
        email ILIKE $${paramCount} OR 
        nomterrain ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    // Filtre par statut
    if (statut) {
      paramCount++;
      sql += ` AND statut = $${paramCount}`;
      params.push(statut);
    }

    sql += ` ORDER BY datereservation DESC, heurereservation DESC`;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);
    
    const result = await db.query(sql, params);
    
    console.log('📊 Réservations trouvées:', result.rows.length);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📌 Route pour récupérer une réservation spécifique par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
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
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    console.log('✅ Réservation trouvée:', result.rows[0]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📌 Route pour créer une nouvelle réservation
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
      typeTerrain,
      tarif,
      surface,
      heurefin,
      nomterrain
    } = req.body;

    // Validation des champs requis
    const requiredFields = ['datereservation', 'heurereservation', 'idclient', 'numeroterrain'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Champs requis manquants: ${missingFields.join(', ')}`
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut, idclient, numeroterrain,
        nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain
    ];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    console.log('✅ Réservation créée:', result.rows[0]);
    
    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur création réservation:', error);
    
    // Gestion des erreurs de contrainte unique
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Une réservation existe déjà pour ce créneau horaire'
      });
    }
    
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

    // Vérifier que la réservation existe
    const checkSql = 'SELECT id FROM reservation WHERE id = $1';
    const checkResult = await db.query(checkSql, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const sql = `
      UPDATE reservation 
      SET 
        datereservation = COALESCE($1, datereservation),
        heurereservation = COALESCE($2, heurereservation),
        statut = COALESCE($3, statut),
        idclient = COALESCE($4, idclient),
        numeroterrain = COALESCE($5, numeroterrain),
        nomclient = COALESCE($6, nomclient),
        prenom = COALESCE($7, prenom),
        email = COALESCE($8, email),
        telephone = COALESCE($9, telephone),
        typeTerrain = COALESCE($10, typeTerrain),
        tarif = COALESCE($11, tarif),
        surface = COALESCE($12, surface),
        heurefin = COALESCE($13, heurefin),
        nomterrain = COALESCE($14, nomterrain)
      WHERE id = $15
      RETURNING *
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain, id
    ];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    console.log('✅ Réservation mise à jour:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour réservation:', error);
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
    
    // Vérifier que la réservation existe
    const checkSql = 'SELECT id FROM reservation WHERE id = $1';
    const checkResult = await db.query(checkSql, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    
    const sql = 'DELETE FROM reservation WHERE id = $1 RETURNING *';
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    console.log('✅ Réservation supprimée:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Réservation supprimée avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur suppression réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour le statut d'une réservation
router.put('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    
    if (!statut || !['confirmée', 'annulée', 'en attente', 'terminée'].includes(statut)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide. Utilisez: confirmée, annulée, en attente, ou terminée.'
      });
    }
    
    // Vérifier que la réservation existe
    const checkSql = 'SELECT id FROM reservation WHERE id = $1';
    const checkResult = await db.query(checkSql, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    
    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE id = $2
      RETURNING *
    `;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', [statut, id]);
    
    const result = await db.query(sql, [statut, id]);
    
    console.log('✅ Statut réservation mis à jour:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Statut de la réservation mis à jour avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;