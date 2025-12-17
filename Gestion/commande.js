import express from 'express';
import db from '../db.js';

const router = express.Router();

// ==================== ROUTES DE BASE POUR COMMANDES ====================

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
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
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
        message: 'Champs requis manquants'
      });
    }

    // Générer un numéro de commande unique
    const timestamp = Date.now();
    const numero_commande = 'CMD-' + timestamp;

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

    const result = await db.query(sql, params);
    
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

    const result = await db.query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
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

    const result = await db.query(sql, [statut, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
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
    
    const result = await db.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée.'
      });
    }
    
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
    
    const result = await db.query(sql, params);
    
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
        COALESCE(SUM(total), 0) as chiffre_affaires,
        COALESCE(SUM(quantite), 0) as total_maillots,
        COALESCE(AVG(total), 0) as panier_moyen,
        COUNT(DISTINCT ville) as villes_distinctes
      FROM commandes
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0]
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
        COALESCE(SUM(total), 0) as chiffre_affaires,
        COALESCE(SUM(quantite), 0) as total_maillots
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY ville
      ORDER BY nombre_commandes DESC
    `;
    
    const result = await db.query(sql);
    
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

// ==================== ANALYSE AVANCÉE CLIENT-MAILLOT-VILLE ====================

// 📊 1. CLIENTS PAR MODÈLE DE MAILLOT
router.get('/analytique/clients-par-maillot', async (req, res) => {
  try {
    const sql = `
      -- Nombre de clients uniques par modèle de maillot
      SELECT 
        nom_produit as modele_maillot,
        COUNT(DISTINCT email) as nombre_clients_uniques,
        COUNT(*) as total_commandes,
        SUM(quantite) as total_maillots_vendus,
        SUM(sous_total) as chiffre_affaires,
        ROUND(AVG(prix_unitaire)::numeric, 2) as prix_moyen,
        ROUND(AVG(quantite)::numeric, 2) as quantite_moyenne_commande,
        
        -- Taille la plus populaire
        (SELECT taille 
         FROM commandes c2 
         WHERE c2.nom_produit = c1.nom_produit 
         GROUP BY taille 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as taille_plus_vendue,
        
        COUNT(DISTINCT taille) as nombre_tailles_differentes,
        MIN(date_creation) as premiere_vente,
        MAX(date_creation) as derniere_vente
        
      FROM commandes c1
      WHERE statut != 'annulee'
      GROUP BY nom_produit
      ORDER BY nombre_clients_uniques DESC
    `;
    
    const result = await db.query(sql);
    
    // Calculer les pourcentages côté Node.js
    const totalClients = result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0);
    const totalCA = result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0);
    
    const data = result.rows.map(row => ({
      ...row,
      pourcentage_clients_total: totalClients > 0 ? 
        ((row.nombre_clients_uniques / totalClients) * 100).toFixed(2) : 0,
      pourcentage_ca_total: totalCA > 0 ? 
        ((row.chiffre_affaires / totalCA) * 100).toFixed(2) : 0,
      valeur_moyenne_client: row.nombre_clients_uniques > 0 ? 
        (row.chiffre_affaires / row.nombre_clients_uniques).toFixed(2) : 0,
      taux_fidelite: row.nombre_clients_uniques > 0 ? 
        ((row.total_commandes / row.nombre_clients_uniques - 1) * 100).toFixed(2) : 0
    }));

    res.json({
      success: true,
      totaux: {
        total_modeles: result.rows.length,
        total_clients: totalClients,
        total_maillots: result.rows.reduce((sum, row) => sum + parseInt(row.total_maillots_vendus), 0),
        total_ca: totalCA
      },
      data: data
    });

  } catch (error) {
    console.error('❌ Erreur analyse clients par maillot:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🏙️ 2. CLIENTS PAR VILLE - SIMPLIFIÉ ET FONCTIONNEL
router.get('/analytique/clients-par-ville', async (req, res) => {
  try {
    const sql = `
      -- Statistiques clients par ville
      SELECT 
        ville,
        COUNT(DISTINCT email) as nombre_clients_uniques,
        COUNT(*) as total_commandes,
        SUM(total) as chiffre_affaires,
        SUM(quantite) as total_maillots_vendus,
        ROUND(AVG(total)::numeric, 2) as panier_moyen,
        ROUND(AVG(quantite)::numeric, 2) as quantite_moyenne_commande,
        
        -- Maillot le plus vendu dans la ville
        (SELECT nom_produit 
         FROM commandes c2 
         WHERE c2.ville = c1.ville 
         GROUP BY nom_produit 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as maillot_plus_vendu,
        
        -- Taille la plus vendue dans la ville
        (SELECT taille 
         FROM commandes c2 
         WHERE c2.ville = c1.ville 
         GROUP BY taille 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as taille_plus_vendue,
        
        COUNT(DISTINCT nom_produit) as nombre_modeles_differents,
        MIN(date_creation) as premiere_commande,
        MAX(date_creation) as derniere_commande,
        
        -- Clients fidèles (qui ont commandé plus d'une fois)
        COUNT(DISTINCT CASE WHEN email IN (
          SELECT email 
          FROM commandes c3 
          WHERE c3.ville = c1.ville 
          GROUP BY email 
          HAVING COUNT(*) > 1
        ) THEN email END) as clients_fideles
        
      FROM commandes c1
      WHERE statut != 'annulee' AND ville IS NOT NULL
      GROUP BY ville
      ORDER BY nombre_clients_uniques DESC
    `;
    
    const result = await db.query(sql);
    
    // Calculer les pourcentages côté Node.js
    const totalClients = result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0);
    const totalCA = result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0);
    
    const data = result.rows.map(row => ({
      ...row,
      pourcentage_clients_total: totalClients > 0 ? 
        ((row.nombre_clients_uniques / totalClients) * 100).toFixed(2) : 0,
      pourcentage_ca_total: totalCA > 0 ? 
        ((row.chiffre_affaires / totalCA) * 100).toFixed(2) : 0,
      taux_fidelite_ville: row.nombre_clients_uniques > 0 ? 
        ((row.clients_fideles / row.nombre_clients_uniques) * 100).toFixed(2) : 0,
      valeur_moyenne_client: row.nombre_clients_uniques > 0 ? 
        (row.chiffre_affaires / row.nombre_clients_uniques).toFixed(2) : 0,
      jours_depuis_derniere_commande: row.derniere_commande ? 
        Math.floor((new Date() - new Date(row.derniere_commande)) / (1000 * 60 * 60 * 24)) : null
    }));

    res.json({
      success: true,
      totaux: {
        total_villes: result.rows.length,
        total_clients: totalClients,
        total_commandes: result.rows.reduce((sum, row) => sum + parseInt(row.total_commandes), 0),
        total_ca: totalCA
      },
      data: data
    });

  } catch (error) {
    console.error('❌ Erreur analyse clients par ville:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📍 3. ANALYSE DES QUARTIERS
router.get('/analytique/quartiers', async (req, res) => {
  try {
    const { ville } = req.query;
    
    let whereClause = "WHERE statut != 'annulee' AND adresse_complete IS NOT NULL";
    const params = [];
    
    if (ville) {
      whereClause += ' AND ville = $1';
      params.push(ville);
    }

    const sql = `
      -- Analyse par zones géographiques basées sur l'adresse
      WITH zones AS (
        SELECT 
          ville,
          CASE 
            WHEN LOWER(adresse_complete) LIKE '%quartier%' THEN 
              SPLIT_PART(SPLIT_PART(LOWER(adresse_complete), 'quartier', 2), ',', 1)
            WHEN LOWER(adresse_complete) LIKE '%q.%' THEN 
              SPLIT_PART(SPLIT_PART(LOWER(adresse_complete), 'q.', 2), ',', 1)
            WHEN LOWER(adresse_complete) LIKE '%av.%' OR LOWER(adresse_complete) LIKE '%avenue%' THEN 'Centre-ville'
            WHEN LOWER(adresse_complete) LIKE '%rue%' THEN 'Centre-ville'
            WHEN LOWER(adresse_complete) LIKE '%bd%' OR LOWER(adresse_complete) LIKE '%boulevard%' THEN 'Grands axes'
            ELSE 'Autres secteurs'
          END as zone,
          email,
          total,
          quantite
        FROM commandes
        ${whereClause}
      )
      
      SELECT 
        ville,
        COALESCE(NULLIF(TRIM(zone), ''), 'Non spécifié') as quartier,
        COUNT(DISTINCT email) as clients,
        COUNT(*) as commandes,
        SUM(total) as chiffre_affaires,
        SUM(quantite) as maillots_vendus,
        ROUND(AVG(total)::numeric, 2) as panier_moyen
      FROM zones
      GROUP BY ville, COALESCE(NULLIF(TRIM(zone), ''), 'Non spécifié')
      HAVING COUNT(DISTINCT email) >= 1
      ORDER BY ville, clients DESC
    `;
    
    const result = await db.query(sql, params);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse quartiers:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📊 4. SYSTHÈSE COMPLÈTE CLIENT-MAILLOT-VILLE
router.get('/analytique/synthese', async (req, res) => {
  try {
    const sql = `
      -- Synthèse complète des 3 dimensions
      SELECT 
        ville,
        nom_produit,
        taille,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(*) as total_achats,
        SUM(quantite) as maillots_vendus,
        SUM(total) as chiffre_affaires,
        ROUND(AVG(total)::numeric, 2) as panier_moyen,
        ROUND(AVG(quantite)::numeric, 2) as quantite_moyenne,
        MIN(date_creation) as premiere_commande,
        MAX(date_creation) as derniere_commande
      FROM commandes
      WHERE statut != 'annulee' AND ville IS NOT NULL
      GROUP BY ville, nom_produit, taille
      HAVING COUNT(DISTINCT email) >= 1
      ORDER BY clients_uniques DESC, chiffre_affaires DESC
      LIMIT 100
    `;
    
    const result = await db.query(sql);
    
    // Catégoriser les hotspots
    const data = result.rows.map(row => {
      const clients = parseInt(row.clients_uniques);
      let niveau_hotspot = 'Activité faible';
      if (clients >= 5) niveau_hotspot = 'Hotspot majeur';
      else if (clients >= 3) niveau_hotspot = 'Hotspot moyen';
      else if (clients >= 2) niveau_hotspot = 'Hotspot mineur';
      
      return {
        ...row,
        niveau_hotspot,
        valeur_par_client: row.clients_uniques > 0 ? 
          (row.chiffre_affaires / row.clients_uniques).toFixed(2) : 0,
        maillots_par_client: row.clients_uniques > 0 ? 
          (row.maillots_vendus / row.clients_uniques).toFixed(2) : 0
      };
    });

    res.json({
      success: true,
      totaux: {
        total_combinaisons: result.rows.length,
        total_clients: result.rows.reduce((sum, row) => sum + parseInt(row.clients_uniques), 0),
        total_maillots: result.rows.reduce((sum, row) => sum + parseInt(row.maillots_vendus), 0),
        total_ca: result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0),
        hotspots_majeurs: data.filter(row => row.niveau_hotspot === 'Hotspot majeur').length,
        hotspots_moyens: data.filter(row => row.niveau_hotspot === 'Hotspot moyen').length
      },
      data: data
    });

  } catch (error) {
    console.error('❌ Erreur synthèse:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🔍 5. RECHERCHE AVANCÉE SIMPLIFIÉE
router.get('/analytique/recherche', async (req, res) => {
  try {
    const { ville, produit, taille, minClients = 1 } = req.query;
    
    let whereClause = "WHERE statut != 'annulee'";
    const params = [];
    let paramCount = 0;
    
    if (ville) {
      paramCount++;
      whereClause += ` AND ville ILIKE $${paramCount}`;
      params.push(`%${ville}%`);
    }
    
    if (produit) {
      paramCount++;
      whereClause += ` AND nom_produit ILIKE $${paramCount}`;
      params.push(`%${produit}%`);
    }
    
    if (taille) {
      paramCount++;
      whereClause += ` AND taille = $${paramCount}`;
      params.push(taille);
    }

    const sql = `
      SELECT 
        ville,
        nom_produit,
        taille,
        COUNT(DISTINCT email) as nombre_clients,
        COUNT(*) as nombre_commandes,
        SUM(quantite) as nombre_maillots,
        SUM(total) as chiffre_affaires,
        ROUND(AVG(total)::numeric, 2) as panier_moyen,
        MIN(date_creation) as premiere_commande,
        MAX(date_creation) as derniere_commande
      FROM commandes
      ${whereClause}
      GROUP BY ville, nom_produit, taille
      HAVING COUNT(DISTINCT email) >= $${paramCount + 1}
      ORDER BY nombre_clients DESC, chiffre_affaires DESC
    `;

    params.push(parseInt(minClients));
    
    const result = await db.query(sql, params);
    
    res.json({
      success: true,
      filtres: { ville, produit, taille, minClients },
      resultats: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur recherche avancée:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📈 6. ÉVOLUTION TEMPORELLE
router.get('/analytique/evolution', async (req, res) => {
  try {
    const { periode = 'mois', ville, produit } = req.query;
    
    let dateTrunc = 'month';
    switch(periode) {
      case 'jour': dateTrunc = 'day'; break;
      case 'semaine': dateTrunc = 'week'; break;
      case 'annee': dateTrunc = 'year'; break;
      default: dateTrunc = 'month';
    }
    
    let whereClause = "WHERE statut != 'annulee'";
    const params = [];
    
    if (ville) {
      whereClause += ' AND ville = $1';
      params.push(ville);
    }
    
    if (produit) {
      whereClause += params.length > 0 ? ' AND nom_produit = $2' : ' AND nom_produit = $1';
      params.push(produit);
    }

    const sql = `
      SELECT 
        DATE_TRUNC('${dateTrunc}', date_creation) as periode,
        COUNT(DISTINCT email) as nouveaux_clients,
        COUNT(*) as nouvelles_commandes,
        SUM(quantite) as nouveaux_maillots,
        SUM(total) as chiffre_affaires_periode,
        ROUND(AVG(total)::numeric, 2) as panier_moyen_periode
      FROM commandes
      ${whereClause}
      GROUP BY DATE_TRUNC('${dateTrunc}', date_creation)
      ORDER BY periode DESC
      LIMIT 12
    `;

    const result = await db.query(sql, params);
    
    res.json({
      success: true,
      periode: periode,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur évolution:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🎯 7. TOP PERFORMANCES ET RECOMMANDATIONS
router.get('/analytique/top-performances', async (req, res) => {
  try {
    const sql = `
      -- Top 10 des combinaisons les plus performantes
      SELECT 
        ville,
        nom_produit,
        taille,
        COUNT(DISTINCT email) as clients,
        SUM(quantite) as maillots_vendus,
        SUM(total) as chiffre_affaires,
        ROUND((SUM(total) / NULLIF(COUNT(DISTINCT email), 0))::numeric, 2) as valeur_par_client
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY ville, nom_produit, taille
      ORDER BY clients DESC, chiffre_affaires DESC
      LIMIT 10
    `;
    
    const result = await db.query(sql);
    
    // Générer des recommandations basées sur les données
    const recommandations = result.rows.map((row, index) => {
      const priorite = index < 3 ? 'Haute' : index < 7 ? 'Moyenne' : 'Basse';
      return {
        ville: row.ville,
        produit: row.nom_produit,
        taille: row.taille,
        type: 'Hotspot identifié',
        recommandation: `Renforcer la présence de ${row.nom_produit} taille ${row.taille} à ${row.ville}`,
        priorite: priorite,
        clients: row.clients,
        ca: row.chiffre_affaires
      };
    });

    res.json({
      success: true,
      top_performances: result.rows,
      recommandations: recommandations
    });

  } catch (error) {
    console.error('❌ Erreur top performances:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📊 8. ANALYSE DE SEGMENTATION DES CLIENTS
router.get('/analytique/segmentation-clients', async (req, res) => {
  try {
    const sql = `
      -- Segmentation RFM (Récence, Fréquence, Montant)
      WITH donnees_clients AS (
        SELECT 
          email,
          nom_complet,
          ville,
          COUNT(*) as nombre_commandes,
          SUM(total) as montant_total,
          MAX(date_creation) as derniere_commande,
          ROUND(AVG(total)::numeric, 2) as panier_moyen
        FROM commandes
        WHERE statut != 'annulee'
        GROUP BY email, nom_complet, ville
      )
      
      SELECT 
        CASE 
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 30 THEN 'Très récent (< 30j)'
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 90 THEN 'Récent (30-90j)'
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 180 THEN 'Ancien (90-180j)'
          ELSE 'Très ancien (> 180j)'
        END as segment_recence,
        
        CASE 
          WHEN nombre_commandes = 1 THEN 'Acheteur unique'
          WHEN nombre_commandes BETWEEN 2 AND 3 THEN 'Client occasionnel'
          WHEN nombre_commandes BETWEEN 4 AND 6 THEN 'Client régulier'
          ELSE 'Client fidèle'
        END as segment_frequence,
        
        CASE 
          WHEN montant_total <= 500 THEN 'Petit panier'
          WHEN montant_total <= 2000 THEN 'Panier moyen'
          ELSE 'Gros panier'
        END as segment_montant,
        
        COUNT(*) as nombre_clients,
        SUM(montant_total) as chiffre_affaires_segment,
        ROUND(AVG(montant_total)::numeric, 2) as moyenne_montant,
        ROUND(AVG(nombre_commandes)::numeric, 2) as moyenne_commandes
      FROM donnees_clients
      GROUP BY 
        CASE 
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 30 THEN 'Très récent (< 30j)'
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 90 THEN 'Récent (30-90j)'
          WHEN DATE_PART('day', CURRENT_DATE - derniere_commande) <= 180 THEN 'Ancien (90-180j)'
          ELSE 'Très ancien (> 180j)'
        END,
        CASE 
          WHEN nombre_commandes = 1 THEN 'Acheteur unique'
          WHEN nombre_commandes BETWEEN 2 AND 3 THEN 'Client occasionnel'
          WHEN nombre_commandes BETWEEN 4 AND 6 THEN 'Client régulier'
          ELSE 'Client fidèle'
        END,
        CASE 
          WHEN montant_total <= 500 THEN 'Petit panier'
          WHEN montant_total <= 2000 THEN 'Panier moyen'
          ELSE 'Gros panier'
        END
      ORDER BY chiffre_affaires_segment DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur segmentation clients:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📱 9. ANALYSE DES CANAUX DE VENTE
router.get('/analytique/canaux-vente', async (req, res) => {
  try {
    const sql = `
      -- Analyse par méthode de paiement (proxy pour canal de vente)
      SELECT 
        methode_paiement,
        COUNT(*) as nombre_commandes,
        COUNT(DISTINCT email) as clients_uniques,
        SUM(total) as chiffre_affaires,
        SUM(quantite) as maillots_vendus,
        ROUND(AVG(total)::numeric, 2) as panier_moyen,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER())::numeric, 2) as pourcentage_commandes
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY methode_paiement
      ORDER BY nombre_commandes DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse canaux:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📦 10. ANALYSE DES TAILLES PAR VILLE
router.get('/analytique/tailles-par-ville', async (req, res) => {
  try {
    const sql = `
      -- Popularité des tailles par ville
      SELECT 
        ville,
        taille,
        COUNT(DISTINCT email) as clients,
        COUNT(*) as commandes,
        SUM(quantite) as maillots_vendus,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(PARTITION BY ville))::numeric, 2) as pourcentage_ville
      FROM commandes
      WHERE statut != 'annulee' AND ville IS NOT NULL
      GROUP BY ville, taille
      ORDER BY ville, clients DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse tailles:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🔄 11. ANALYSE DE RÉCURRENCE D'ACHAT
router.get('/analytique/recurrence-achat', async (req, res) => {
  try {
    const sql = `
      -- Clients qui achètent plusieurs fois le même produit
      WITH achats_recurrents AS (
        SELECT 
          email,
          nom_produit,
          COUNT(*) as fois_achete,
          SUM(quantite) as total_quantite,
          SUM(sous_total) as total_depense,
          MIN(date_creation) as premier_achat,
          MAX(date_creation) as dernier_achat
        FROM commandes
        WHERE statut != 'annulee'
        GROUP BY email, nom_produit
        HAVING COUNT(*) > 1
      )
      
      SELECT 
        nom_produit,
        COUNT(DISTINCT email) as clients_fideles,
        SUM(fois_achete) as total_achats,
        SUM(total_quantite) as total_maillots,
        SUM(total_depense) as chiffre_affaires,
        ROUND(AVG(fois_achete)::numeric, 2) as moyenne_achats_par_client,
        ROUND(AVG(total_quantite)::numeric, 2) as moyenne_maillots_par_client
      FROM achats_recurrents
      GROUP BY nom_produit
      ORDER BY clients_fideles DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse récurrence:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🎁 12. ANALYSE DES PROMOTIONS
router.get('/analytique/promotions', async (req, res) => {
  try {
    const sql = `
      -- Impact des promotions
      SELECT 
        promotion_appliquee,
        COUNT(*) as nombre_commandes,
        COUNT(DISTINCT email) as clients_uniques,
        SUM(total) as chiffre_affaires,
        SUM(montant_promotion) as total_reductions,
        SUM(quantite) as maillots_vendus,
        ROUND(AVG(total)::numeric, 2) as panier_moyen,
        ROUND(AVG(montant_promotion)::numeric, 2) as reduction_moyenne,
        ROUND((SUM(total) / NULLIF(SUM(montant_promotion), 0))::numeric, 2) as ratio_ca_reduction
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY promotion_appliquee
      ORDER BY nombre_commandes DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse promotions:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📋 13. RAPPORT JOURNALIER DES ACTIVITÉS
router.get('/analytique/rapport-journalier', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const sql = `
      -- Rapport détaillé pour une date spécifique
      SELECT 
        -- Activités du jour
        (SELECT COUNT(*) FROM commandes WHERE DATE(date_creation) = $1) as commandes_du_jour,
        (SELECT COUNT(DISTINCT email) FROM commandes WHERE DATE(date_creation) = $1) as nouveaux_clients_jour,
        (SELECT COALESCE(SUM(total), 0) FROM commandes WHERE DATE(date_creation) = $1) as ca_du_jour,
        
        -- Top produits du jour
        (SELECT json_agg(row_to_json(t)) FROM (
          SELECT nom_produit, COUNT(*) as ventes, SUM(quantite) as quantite
          FROM commandes 
          WHERE DATE(date_creation) = $1
          GROUP BY nom_produit 
          ORDER BY COUNT(*) DESC 
          LIMIT 5
        ) t) as top_produits_jour,
        
        -- Top villes du jour
        (SELECT json_agg(row_to_json(t)) FROM (
          SELECT ville, COUNT(*) as commandes
          FROM commandes 
          WHERE DATE(date_creation) = $1 AND ville IS NOT NULL
          GROUP BY ville 
          ORDER BY COUNT(*) DESC 
          LIMIT 5
        ) t) as top_villes_jour,
        
        -- Comparaison avec la veille
        (SELECT COUNT(*) FROM commandes WHERE DATE(date_creation) = $1::date - INTERVAL '1 day') as commandes_veille,
        (SELECT COALESCE(SUM(total), 0) FROM commandes WHERE DATE(date_creation) = $1::date - INTERVAL '1 day') as ca_veille
    `;
    
    const result = await db.query(sql, [targetDate]);
    
    res.json({
      success: true,
      date: targetDate,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur rapport journalier:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🗺️ 14. CARTE DE CHALEUR GÉOGRAPHIQUE
router.get('/analytique/carte-chaleur', async (req, res) => {
  try {
    const sql = `
      -- Données pour carte de chaleur géographique
      SELECT 
        ville,
        COUNT(DISTINCT email) as densite_clients,
        COUNT(*) as intensite_commandes,
        SUM(total) as chaleur_ca,
        ROUND(AVG(total)::numeric, 2) as temperature_panier,
        
        -- Classification pour la carte
        CASE 
          WHEN COUNT(DISTINCT email) >= 10 THEN 'Zone très chaude'
          WHEN COUNT(DISTINCT email) >= 5 THEN 'Zone chaude'
          WHEN COUNT(DISTINCT email) >= 2 THEN 'Zone tiède'
          ELSE 'Zone froide'
        END as classification_zone
      FROM commandes
      WHERE statut != 'annulee' AND ville IS NOT NULL
      GROUP BY ville
      ORDER BY densite_clients DESC
    `;
    
    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur carte chaleur:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🏆 15. CLASSEMENT GLOBAL
router.get('/analytique/classement', async (req, res) => {
  try {
    const sql = `
      -- Classement multi-critères
      SELECT 
        'Villes' as categorie,
        ville as element,
        COUNT(DISTINCT email) as score_clients,
        COUNT(*) as score_commandes,
        SUM(total) as score_ca,
        RANK() OVER (ORDER BY COUNT(DISTINCT email) DESC) as classement_clients,
        RANK() OVER (ORDER BY SUM(total) DESC) as classement_ca
      FROM commandes
      WHERE statut != 'annulee' AND ville IS NOT NULL
      GROUP BY ville
      
      UNION ALL
      
      SELECT 
        'Produits' as categorie,
        nom_produit as element,
        COUNT(DISTINCT email) as score_clients,
        COUNT(*) as score_commandes,
        SUM(sous_total) as score_ca,
        RANK() OVER (ORDER BY COUNT(DISTINCT email) DESC) as classement_clients,
        RANK() OVER (ORDER BY SUM(sous_total) DESC) as classement_ca
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY nom_produit
      
      UNION ALL
      
      SELECT 
        'Tailles' as categorie,
        taille as element,
        COUNT(DISTINCT email) as score_clients,
        COUNT(*) as score_commandes,
        SUM(total) as score_ca,
        RANK() OVER (ORDER BY COUNT(DISTINCT email) DESC) as classement_clients,
        RANK() OVER (ORDER BY SUM(total) DESC) as classement_ca
      FROM commandes
      WHERE statut != 'annulee'
      GROUP BY taille
      
      ORDER BY categorie, classement_clients
    `;
    
    const result = await db.query(sql);
    
    // Organiser les résultats par catégorie
    const classement = {
      villes: result.rows.filter(row => row.categorie === 'Villes'),
      produits: result.rows.filter(row => row.categorie === 'Produits'),
      tailles: result.rows.filter(row => row.categorie === 'Tailles')
    };

    res.json({
      success: true,
      classement: classement
    });

  } catch (error) {
    console.error('❌ Erreur classement:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;