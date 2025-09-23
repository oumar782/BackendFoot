import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route pour récupérer tous les contacts
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT 
        id,
        nom,
        email,
        message,
        motif,
        sujet
      FROM contact 
      ORDER BY id DESC
    `;
    
    console.log('📋 Requête SQL:', sql);
    
    const result = await db.query(sql);
    
    console.log('📊 Contacts trouvés:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('📝 Premier contact:', result.rows[0]);
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contact trouvé.'
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

// 📌 Route pour récupérer un contact spécifique par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `
      SELECT 
        id,
        nom,
        email,
        message,
        motif,
        sujet
      FROM contact 
      WHERE id = $1
    `;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contact non trouvé.'
      });
    }

    console.log('✅ Contact trouvé:', result.rows[0]);
    
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

// 📌 Route pour créer un nouveau contact
router.post('/', async (req, res) => {
  try {
    const {
      nom,
      email,
      message,
      motif,
      sujet
    } = req.body;

    // Validation des champs requis
    if (!nom || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: nom, email et message sont obligatoires.'
      });
    }

    const sql = `
      INSERT INTO contact (
        nom, email, message, motif, sujet
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const params = [nom, email, message, motif, sujet];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    console.log('✅ Contact créé:', result.rows[0]);
    
    res.status(201).json({
      success: true,
      message: 'Contact créé avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur création contact:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour un contact
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nom,
      email,
      message,
      motif,
      sujet
    } = req.body;

    const sql = `
      UPDATE contact 
      SET 
        nom = $1,
        email = $2,
        message = $3,
        motif = $4,
        sujet = $5
      WHERE id = $6
      RETURNING *
    `;

    const params = [nom, email, message, motif, sujet, id];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contact non trouvé.'
      });
    }
    
    console.log('✅ Contact mis à jour:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Contact mis à jour avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour contact:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour supprimer un contact
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = 'DELETE FROM contact WHERE id = $1 RETURNING *';
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contact non trouvé.'
      });
    }
    
    console.log('✅ Contact supprimé:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Contact supprimé avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur suppression contact:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour filtrer les contacts
router.get('/filtre/recherche', async (req, res) => {
  try {
    const { nom, email, motif, sujet } = req.query;
    
    let sql = `
      SELECT 
        id,
        nom,
        email,
        message,
        motif,
        sujet
      FROM contact 
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (nom) {
      paramCount++;
      sql += ` AND nom ILIKE $${paramCount}`;
      params.push(`%${nom}%`);
    }
    
    if (email) {
      paramCount++;
      sql += ` AND email ILIKE $${paramCount}`;
      params.push(`%${email}%`);
    }
    
    if (motif) {
      paramCount++;
      sql += ` AND motif ILIKE $${paramCount}`;
      params.push(`%${motif}%`);
    }
    
    if (sujet) {
      paramCount++;
      sql += ` AND sujet ILIKE $${paramCount}`;
      params.push(`%${sujet}%`);
    }
    
    sql += ` ORDER BY id DESC`;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);
    
    const result = await db.query(sql, params);
    
    console.log('📊 Contacts trouvés:', result.rows.length);
    
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