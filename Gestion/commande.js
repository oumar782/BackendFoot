import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route pour récupérer toutes les commandes
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT 
        id,
        nom_complet,
        telephone,
        email,
        ville,
        adresse_complete,
        produit_id,
        nom_produit,
        prix_unitaire,
        quantite,
        taille,
        sous_total,
        frais_livraison,
        total,
        statut,
        methode_paiement,
        promotion_appliquee,
        montant_promotion,
        prix_original,
        notes,
        numero_commande,
        date_creation,
        date_modification
      FROM commandes 
      ORDER BY date_creation DESC
    `;
    
    console.log('📋 Requête SQL:', sql);
    
    const result = await db.query(sql);
    
    console.log('📊 Commandes trouvées:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('📝 Première commande:', {
        id: result.rows[0].id,
        nom_complet: result.rows[0].nom_complet,
        total: result.rows[0].total,
        statut: result.rows[0].statut
      });
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucune commande trouvée.'
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

// 📌 Route pour récupérer une commande spécifique par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `
      SELECT 
        id,
        nom_complet,
        telephone,
        email,
        ville,
        adresse_complete,
        produit_id,
        nom_produit,
        prix_unitaire,
        quantite,
        taille,
        sous_total,
        frais_livraison,
        total,
        statut,
        methode_paiement,
        promotion_appliquee,
        montant_promotion,
        prix_original,
        notes,
        numero_commande,
        date_creation,
        date_modification
      FROM commandes 
      WHERE id = $1
    `;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }

    console.log('✅ Commande trouvée:', result.rows[0]);
    
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

// 📌 Route pour créer une nouvelle commande
router.post('/', async (req, res) => {
  try {
    const {
      nom_complet,
      telephone,
      email,
      ville,
      adresse_complete,
      produit_id,
      nom_produit,
      prix_unitaire,
      quantite = 1,
      taille,
      sous_total,
      frais_livraison = 29.00,
      total,
      statut = 'en_attente',
      methode_paiement = 'livraison',
      promotion_appliquee = false,
      montant_promotion = 0.00,
      prix_original,
      notes = ''
    } = req.body;

    // Validation des champs requis
    if (!nom_complet || !telephone || !ville || !adresse_complete || 
        !produit_id || !nom_produit || !prix_unitaire || !taille || 
        !sous_total || !total) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: nom_complet, telephone, ville, adresse_complete, produit_id, nom_produit, prix_unitaire, taille, sous_total, total sont obligatoires.'
      });
    }

    // Générer un numéro de commande unique
    const timestamp = Date.now();
    const numero_commande = `CMD-${timestamp}`;

    const sql = `
      INSERT INTO commandes (
        nom_complet, telephone, email, ville, adresse_complete,
        produit_id, nom_produit, prix_unitaire, quantite, taille,
        sous_total, frais_livraison, total, statut, methode_paiement,
        promotion_appliquee, montant_promotion, prix_original, notes,
        numero_commande
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `;

    const params = [
      nom_complet, telephone, email, ville, adresse_complete,
      produit_id, nom_produit, prix_unitaire, quantite, taille,
      sous_total, frais_livraison, total, statut, methode_paiement,
      promotion_appliquee, montant_promotion, prix_original, notes,
      numero_commande
    ];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    console.log('✅ Commande créée:', result.rows[0]);
    
    res.status(201).json({
      success: true,
      message: 'Commande créée avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur création commande:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour une commande
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nom_complet,
      telephone,
      email,
      ville,
      adresse_complete,
      statut,
      methode_paiement,
      notes
    } = req.body;

    const sql = `
      UPDATE commandes 
      SET 
        nom_complet = $1,
        telephone = $2,
        email = $3,
        ville = $4,
        adresse_complete = $5,
        statut = $6,
        methode_paiement = $7,
        notes = $8,
        date_modification = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `;

    const params = [
      nom_complet, telephone, email, ville, adresse_complete,
      statut, methode_paiement, notes, id
    ];

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
    console.log('✅ Commande mise à jour:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Commande mise à jour avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour commande:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour uniquement le statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;

    if (!statut) {
      return res.status(400).json({
        success: false,
        message: 'Le champ statut est obligatoire.'
      });
    }

    const sql = `
      UPDATE commandes 
      SET 
        statut = $1,
        date_modification = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', [statut, id]);

    const result = await db.query(sql, [statut, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
    console.log('✅ Statut commande mis à jour:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Statut commande mis à jour avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour supprimer une commande
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = 'DELETE FROM commandes WHERE id = $1 RETURNING *';
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
    console.log('✅ Commande supprimée:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Commande supprimée avec succès.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur suppression commande:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour filtrer les commandes
router.get('/filtre/recherche', async (req, res) => {
  try {
    const { nom_complet, telephone, ville, statut, numero_commande } = req.query;
    
    let sql = `
      SELECT 
        id,
        nom_complet,
        telephone,
        email,
        ville,
        adresse_complete,
        produit_id,
        nom_produit,
        prix_unitaire,
        quantite,
        taille,
        sous_total,
        frais_livraison,
        total,
        statut,
        methode_paiement,
        promotion_appliquee,
        montant_promotion,
        prix_original,
        notes,
        numero_commande,
        date_creation,
        date_modification
      FROM commandes 
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (nom_complet) {
      paramCount++;
      sql += ` AND nom_complet ILIKE $${paramCount}`;
      params.push(`%${nom_complet}%`);
    }
    
    if (telephone) {
      paramCount++;
      sql += ` AND telephone ILIKE $${paramCount}`;
      params.push(`%${telephone}%`);
    }
    
    if (ville) {
      paramCount++;
      sql += ` AND ville ILIKE $${paramCount}`;
      params.push(`%${ville}%`);
    }
    
    if (statut) {
      paramCount++;
      sql += ` AND statut = $${paramCount}`;
      params.push(statut);
    }
    
    if (numero_commande) {
      paramCount++;
      sql += ` AND numero_commande ILIKE $${paramCount}`;
      params.push(`%${numero_commande}%`);
    }
    
    sql += ` ORDER BY date_creation DESC`;
    
    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);
    
    const result = await db.query(sql, params);
    
    console.log('📊 Commandes trouvées:', result.rows.length);
    
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

// 📌 Route pour récupérer les statistiques
router.get('/statistiques/resume', async (req, res) => {
  try {
    const sql = `
      SELECT 
        COUNT(*) as total_commandes,
        SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as en_attente,
        SUM(CASE WHEN statut = 'confirmee' THEN 1 ELSE 0 END) as confirmees,
        SUM(CASE WHEN statut = 'expediee' THEN 1 ELSE 0 END) as expediees,
        SUM(CASE WHEN statut = 'livree' THEN 1 ELSE 0 END) as livrees,
        SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulees,
        SUM(total) as chiffre_affaires,
        SUM(quantite) as total_maillots,
        AVG(total) as panier_moyen,
        COUNT(DISTINCT ville) as villes_distinctes
      FROM commandes
    `;
    
    console.log('📋 Requête SQL:', sql);
    
    const result = await db.query(sql);
    
    console.log('📊 Statistiques calculées');
    
    res.json({
      success: true,
      data: result.rows[0] || {
        total_commandes: 0,
        en_attente: 0,
        confirmees: 0,
        expediees: 0,
        livrees: 0,
        annulees: 0,
        chiffre_affaires: 0,
        total_maillots: 0,
        panier_moyen: 0,
        villes_distinctes: 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur statistiques:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📌 Route pour récupérer les commandes par ville
router.get('/statistiques/par-ville', async (req, res) => {
  try {
    const sql = `
      SELECT 
        ville,
        COUNT(*) as nombre_commandes,
        SUM(total) as chiffre_affaires,
        SUM(quantite) as total_maillots
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY ville
      ORDER BY nombre_commandes DESC
    `;
    
    console.log('📋 Requête SQL:', sql);
    
    const result = await db.query(sql);
    
    console.log('📊 Statistiques par ville:', result.rows.length);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur statistiques par ville:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;