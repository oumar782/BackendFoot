import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route pour récupérer toutes les réservations
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT 
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
      ORDER BY datereservation, heurereservation
    `;
    
    console.log('📋 Requête SQL:', sql);
    
    const result = await db.query(sql);
    
    console.log('📊 Réservations trouvées:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('📝 Première réservation:', result.rows[0]);
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucune réservation trouvée.'
      });
    }

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

    // Validation des champs requis
    if (!datereservation || !heurereservation || !statut || !idclient || !numeroterrain) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: date, heure, statut, idclient et numeroterrain sont obligatoires.'
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
      RETURNING *
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeTerrain, tarif, surface, heurefin, nomterrain, id
    ];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    
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
    
    const sql = 'DELETE FROM reservation WHERE id = $1 RETURNING *';
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    
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
    
    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE id = $2
      RETURNING *
    `;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', [statut, id]);
    
    const result = await db.query(sql, [statut, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

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
// Dans votre route API (/api/reservation/)
router.get('/', async (req, res) => {
    try {
      const { nom, email, statut, date, clientId } = req.query;
      
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
      
      // Sécurité: si clientId est fourni, on filtre uniquement par ce client
      if (clientId) {
        paramCount++;
        sql += ` AND idclient = $${paramCount}`;
        params.push(clientId);
      } else {
        // Pour l'admin, on peut permettre d'autres filtres
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

export default router;