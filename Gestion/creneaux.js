import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route pour récupérer les créneaux disponibles
router.get('/creneaux', async (req, res) => {
  try {
    const { date, terrainType, surface } = req.query;

    if (!date || !terrainType) {
      return res.status(400).json({ 
        success: false,
        message: 'Date et type de terrain requis.' 
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ 
        success: false,
        message: 'Format de date invalide. Utilisez YYYY-MM-DD.' 
      });
    }

    let sql = `
      SELECT 
        idcreneaux,
        TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
        heure,
        statut,
        numeroterrain,
        typeTerrain,
        heurefin,
        nomterrain,
        SurfaceTerrains
      FROM creneaux 
      WHERE typeTerrain = $1 
      AND TO_CHAR(datecreneaux, 'YYYY-MM-DD') = $2
    `;
    
    let params = [terrainType, date];

    if (surface) {
      sql += ` AND SurfaceTerrains = $3`;
      params.push(surface);
    }

    sql += ` ORDER BY heure`;

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucun créneau disponible pour ces critères.',
        date_recherchee: date,
        type_terrain: terrainType,
        surface: surface || 'non spécifiée'
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

export default router;