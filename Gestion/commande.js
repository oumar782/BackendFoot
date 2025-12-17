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

// ==================== ANALYSE AVANCÉE CLIENT-MAILLOT-VILLE ====================

// 📊 1. CLIENTS PAR MODÈLE DE MAILLOT
router.get('/analytique/clients-par-maillot', async (req, res) => {
  try {
    const { startDate, endDate, minClients = 1 } = req.query;
    
    let dateFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (startDate && endDate) {
      dateFilter = 'WHERE date_creation BETWEEN $1 AND $2';
      params.push(startDate, endDate);
      paramIndex = 3;
    }

    const sql = `
      WITH stats_maillot AS (
        SELECT 
          nom_produit as modele_maillot,
          COUNT(DISTINCT email) as nombre_clients_uniques,
          COUNT(*) as total_commandes,
          SUM(quantite) as total_maillots_vendus,
          SUM(sous_total) as chiffre_affaires,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne_commande,
          
          -- Taille la plus populaire
          MODE() WITHIN GROUP (ORDER BY taille) as taille_plus_vendue,
          COUNT(DISTINCT taille) as nombre_tailles_differentes,
          
          -- Période d'activité
          MIN(date_creation) as premiere_vente,
          MAX(date_creation) as derniere_vente,
          DATE_PART('day', MAX(date_creation) - MIN(date_creation)) as duree_vente_jours
          
        FROM commandes
        ${dateFilter}
        GROUP BY nom_produit
      ),
      
      stats_detaillees AS (
        SELECT 
          nom_produit,
          taille,
          COUNT(DISTINCT email) as clients_par_taille,
          SUM(quantite) as quantite_vendue_taille,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen_taille
        FROM commandes
        ${dateFilter}
        GROUP BY nom_produit, taille
      )
      
      SELECT 
        sm.*,
        -- Pourcentage de clients par rapport au total
        ROUND(100.0 * sm.nombre_clients_uniques / NULLIF(
          (SELECT SUM(nombre_clients_uniques) FROM stats_maillot), 0
        ), 2) as pourcentage_clients_total,
        
        -- Taux de fidélité (clients qui achètent plusieurs fois le même modèle)
        ROUND(100.0 * sm.total_commandes / NULLIF(sm.nombre_clients_uniques, 0) - 100, 2) as taux_fidelite_maillot,
        
        -- Valeur par client
        ROUND(sm.chiffre_affaires / NULLIF(sm.nombre_clients_uniques, 0), 2) as valeur_moyenne_client,
        
        -- Rotation
        ROUND(sm.total_maillots_vendus / NULLIF(sm.duree_vente_jours, 0), 2) as rotation_quotidienne,
        
        -- Détails par taille
        (SELECT json_agg(row_to_json(sd)) 
         FROM stats_detaillees sd 
         WHERE sd.nom_produit = sm.modele_maillot 
         ORDER BY sd.clients_par_taille DESC) as details_tailles
         
      FROM stats_maillot sm
      WHERE sm.nombre_clients_uniques >= $${paramIndex}
      ORDER BY sm.nombre_clients_uniques DESC
    `;

    params.push(parseInt(minClients));
    
    console.log('📋 Analyse clients par maillot');

    const result = await db.query(sql, params);
    
    // Calcul des totaux
    const totaux = {
      total_modeles: result.rows.length,
      total_clients: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0),
      total_maillots: result.rows.reduce((sum, row) => sum + parseInt(row.total_maillots_vendus), 0),
      total_ca: result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0),
      moyenne_clients_par_modele: result.rows.length > 0 ? 
        result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0) / result.rows.length : 0
    };

    res.json({
      success: true,
      totaux,
      data: result.rows
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

// 🏙️ 2. CLIENTS PAR VILLE
router.get('/analytique/clients-par-ville', async (req, res) => {
  try {
    const { startDate, endDate, minClients = 1 } = req.query;
    
    let dateFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (startDate && endDate) {
      dateFilter = 'WHERE date_creation BETWEEN $1 AND $2';
      params.push(startDate, endDate);
      paramIndex = 3;
    }

    const sql = `
      WITH stats_ville AS (
        SELECT 
          ville,
          COUNT(DISTINCT email) as nombre_clients_uniques,
          COUNT(*) as total_commandes,
          SUM(total) as chiffre_affaires,
          SUM(quantite) as total_maillots_vendus,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne_commande,
          
          -- Maillots les plus populaires par ville
          MODE() WITHIN GROUP (ORDER BY nom_produit) as maillot_plus_vendu,
          COUNT(DISTINCT nom_produit) as nombre_modeles_differents,
          
          -- Taille la plus populaire par ville
          MODE() WITHIN GROUP (ORDER BY taille) as taille_plus_vendue,
          
          -- Période d'activité
          MIN(date_creation) as premiere_commande,
          MAX(date_creation) as derniere_commande,
          DATE_PART('day', CURRENT_DATE - MAX(date_creation)) as jours_depuis_derniere_commande,
          
          -- Taux de fidélité ville
          COUNT(DISTINCT CASE WHEN email IN (
            SELECT email FROM commandes c2 
            WHERE c2.ville = commandes.ville 
            GROUP BY email 
            HAVING COUNT(*) > 1
          ) THEN email END) as clients_fideles
          
        FROM commandes
        ${dateFilter ? dateFilter + ' AND' : 'WHERE'} ville IS NOT NULL
        GROUP BY ville
      ),
      
      top_maillots_ville AS (
        SELECT 
          ville,
          nom_produit,
          COUNT(DISTINCT email) as clients_maillot,
          SUM(quantite) as quantite_vendue,
          ROUND(100.0 * COUNT(DISTINCT email) / NULLIF(
            (SELECT COUNT(DISTINCT email) FROM commandes c2 
             WHERE c2.ville = c1.ville 
             ${dateFilter ? 'AND ' + dateFilter.substring(6) : ''}), 0
          ), 2) as penetration_maillot_ville
        FROM commandes c1
        ${dateFilter}
        GROUP BY ville, nom_produit
      )
      
      SELECT 
        sv.*,
        -- Pourcentage de clients par rapport au total
        ROUND(100.0 * sv.nombre_clients_uniques / NULLIF(
          (SELECT SUM(nombre_clients_uniques) FROM stats_ville), 0
        ), 2) as pourcentage_clients_total,
        
        -- Pourcentage de CA par rapport au total
        ROUND(100.0 * sv.chiffre_affaires / NULLIF(
          (SELECT SUM(chiffre_affaires) FROM stats_ville), 0
        ), 2) as pourcentage_ca_total,
        
        -- Taux de fidélité
        ROUND(100.0 * sv.clients_fideles / NULLIF(sv.nombre_clients_uniques, 0), 2) as taux_fidelite_ville,
        
        -- Valeur par client
        ROUND(sv.chiffre_affaires / NULLIF(sv.nombre_clients_uniques, 0), 2) as valeur_moyenne_client,
        
        -- Détails des maillots
        (SELECT json_agg(row_to_json(tmv)) 
         FROM top_maillots_ville tmv 
         WHERE tmv.ville = sv.ville 
         ORDER BY tmv.clients_maillot DESC 
         LIMIT 5) as top_maillots
         
      FROM stats_ville sv
      WHERE sv.nombre_clients_uniques >= $${paramIndex}
      ORDER BY sv.nombre_clients_uniques DESC
    `;

    params.push(parseInt(minClients));
    
    console.log('📋 Analyse clients par ville');

    const result = await db.query(sql, params);
    
    // Calcul des totaux
    const totaux = {
      total_villes: result.rows.length,
      total_clients: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0),
      total_commandes: result.rows.reduce((sum, row) => sum + parseInt(row.total_commandes), 0),
      total_ca: result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0),
      moyenne_clients_par_ville: result.rows.length > 0 ? 
        result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients_uniques), 0) / result.rows.length : 0
    };

    res.json({
      success: true,
      totaux,
      data: result.rows
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

// 📍 3. CLIENTS PAR QUARTIER (EXTRACTION DE L'ADRESSE)
router.get('/analytique/clients-par-quartier', async (req, res) => {
  try {
    const { ville, minClients = 2 } = req.query;
    
    let whereClause = "WHERE statut != 'annulee' AND ville IS NOT NULL AND adresse_complete IS NOT NULL";
    const params = [];
    
    if (ville) {
      whereClause += ' AND ville ILIKE $1';
      params.push(`%${ville}%`);
    }

    const sql = `
      WITH extraction_quartier AS (
        SELECT 
          ville,
          -- Extraction du quartier depuis l'adresse complète
          CASE 
            WHEN adresse_complete ILIKE '%quartier%' THEN 
              SUBSTRING(adresse_complete FROM 'quartier[[:space:]]+([^,]+)')
            WHEN adresse_complete ILIKE '%q.%' THEN 
              SUBSTRING(adresse_complete FROM 'q\.[[:space:]]*([^,]+)')
            WHEN adresse_complete ILIKE '%av.%' OR adresse_complete ILIKE '%avenue%' THEN 
              'Centre-ville'
            WHEN adresse_complete ILIKE '%rue%' OR adresse_complete ILIKE '%boulevard%' THEN 
              'Centre-ville'
            ELSE 'Autre secteur'
          END as quartier,
          email,
          nom_complet,
          telephone
        FROM commandes
        ${whereClause}
      ),
      
      stats_quartier AS (
        SELECT 
          ville,
          quartier,
          COUNT(DISTINCT email) as clients_quartier,
          COUNT(*) as commandes_quartier,
          COUNT(DISTINCT nom_complet) as clients_identifies,
          STRING_AGG(DISTINCT telephone, ', ') as telephones_quartier
        FROM extraction_quartier
        GROUP BY ville, quartier
      ),
      
      top_maillots_quartier AS (
        SELECT 
          eq.ville,
          eq.quartier,
          c.nom_produit,
          COUNT(DISTINCT c.email) as clients_maillot
        FROM extraction_quartier eq
        JOIN commandes c ON eq.email = c.email
        GROUP BY eq.ville, eq.quartier, c.nom_produit
      )
      
      SELECT 
        sq.*,
        -- Pourcentage de clients par rapport à la ville
        ROUND(100.0 * sq.clients_quartier / NULLIF(
          (SELECT COUNT(DISTINCT email) FROM commandes c2 WHERE c2.ville = sq.ville), 0
        ), 2) as pourcentage_ville,
        
        -- Intensité d'activité
        CASE 
          WHEN sq.clients_quartier >= 10 THEN 'Zone très active'
          WHEN sq.clients_quartier >= 5 THEN 'Zone active'
          WHEN sq.clients_quartier >= 3 THEN 'Zone modérée'
          ELSE 'Zone émergente'
        END as intensite_activite,
        
        -- Top maillots du quartier
        (SELECT json_agg(row_to_json(tmq)) 
         FROM top_maillots_quartier tmq 
         WHERE tmq.ville = sq.ville AND tmq.quartier = sq.quartier 
         ORDER BY tmq.clients_maillot DESC 
         LIMIT 3) as top_maillots
         
      FROM stats_quartier sq
      WHERE sq.clients_quartier >= $${params.length + 1}
      ORDER BY sq.ville, sq.clients_quartier DESC
    `;

    params.push(parseInt(minClients));
    
    console.log('📋 Analyse clients par quartier');

    const result = await db.query(sql, params);
    
    // Calcul des totaux
    const totaux = {
      total_quartiers: result.rows.length,
      total_clients: result.rows.reduce((sum, row) => sum + parseInt(row.clients_quartier), 0),
      total_commandes: result.rows.reduce((sum, row) => sum + parseInt(row.commandes_quartier), 0),
      zones_tres_actives: result.rows.filter(row => row.intensite_activite === 'Zone très active').length,
      zones_actives: result.rows.filter(row => row.intensite_activite === 'Zone active').length
    };

    res.json({
      success: true,
      totaux,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse clients par quartier:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📊 4. SYSTHÈSE COMPLÈTE CLIENT-MAILLOT-VILLE
router.get('/analytique/synthese-complete', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = 'WHERE date_creation BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    const sql = `
      WITH donnees_croisees AS (
        SELECT 
          ville,
          nom_produit,
          taille,
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(*) as total_achats,
          SUM(quantite) as maillots_vendus,
          SUM(total) as chiffre_affaires,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne,
          MIN(date_creation) as premiere_commande,
          MAX(date_creation) as derniere_commande
        FROM commandes
        ${dateFilter ? dateFilter + ' AND' : 'WHERE'} statut != 'annulee' AND ville IS NOT NULL
        GROUP BY ville, nom_produit, taille
      ),
      
      hotspots AS (
        SELECT 
          ville,
          nom_produit,
          taille,
          clients_uniques,
          total_achats,
          maillots_vendus,
          chiffre_affaires,
          panier_moyen,
          quantite_moyenne,
          premiere_commande,
          derniere_commande,
          ROUND(chiffre_affaires / NULLIF(clients_uniques, 0), 2) as valeur_par_client,
          ROUND(maillots_vendus / NULLIF(clients_uniques, 0), 2) as maillots_par_client,
          DATE_PART('day', derniere_commande - premiere_commande) as periode_activite_jours,
          
          -- Classification hotspots
          CASE 
            WHEN clients_uniques >= 5 THEN 'Hotspot majeur'
            WHEN clients_uniques >= 3 THEN 'Hotspot moyen'
            WHEN clients_uniques >= 2 THEN 'Hotspot mineur'
            ELSE 'Activité faible'
          END as niveau_hotspot,
          
          -- Potentiel de croissance
          CASE 
            WHEN ROUND(maillots_vendus / NULLIF(clients_uniques, 0), 2) >= 2 THEN 'Fort potentiel'
            WHEN ROUND(maillots_vendus / NULLIF(clients_uniques, 0), 2) >= 1.5 THEN 'Potentiel moyen'
            ELSE 'Potentiel limité'
          END as potentiel_croissance
          
        FROM donnees_croisees
      ),
      
      stats_ville AS (
        SELECT 
          ville,
          COUNT(DISTINCT CONCAT(nom_produit, taille)) as combinaisons_uniques,
          SUM(clients_uniques) as total_clients_ville,
          SUM(maillots_vendus) as total_maillots_ville,
          SUM(chiffre_affaires) as total_ca_ville,
          COUNT(*) FILTER (WHERE niveau_hotspot = 'Hotspot majeur') as hotspots_majeurs,
          COUNT(*) FILTER (WHERE niveau_hotspot = 'Hotspot moyen') as hotspots_moyens,
          COUNT(*) FILTER (WHERE niveau_hotspot = 'Hotspot mineur') as hotspots_mineurs
        FROM hotspots
        GROUP BY ville
      ),
      
      stats_maillot AS (
        SELECT 
          nom_produit,
          COUNT(DISTINCT CONCAT(ville, taille)) as combinaisons_uniques,
          SUM(clients_uniques) as total_clients_maillot,
          SUM(maillots_vendus) as total_maillots_model,
          SUM(chiffre_affaires) as total_ca_maillot,
          COUNT(DISTINCT ville) as villes_distribuees
        FROM hotspots
        GROUP BY nom_produit
      ),
      
      opportunites AS (
        SELECT 
          h1.ville,
          h1.nom_produit as produit_actuel,
          h1.taille as taille_actuelle,
          h2.nom_produit as produit_potentiel,
          h2.taille as taille_potentielle,
          COUNT(DISTINCT h1.clients_uniques) as clients_communs
        FROM hotspots h1
        JOIN hotspots h2 ON h1.ville = h2.ville 
          AND h1.nom_produit != h2.nom_produit
          AND h1.clients_uniques > 0 AND h2.clients_uniques > 0
        GROUP BY h1.ville, h1.nom_produit, h1.taille, h2.nom_produit, h2.taille
        HAVING COUNT(DISTINCT h1.clients_uniques) >= 2
      )

      SELECT 
        -- Hotspots d'activité
        (SELECT json_agg(row_to_json(hotspots) ORDER BY clients_uniques DESC, chiffre_affaires DESC LIMIT 30) 
         FROM hotspots) as hotspots_activite,
        
        -- Statistiques par ville
        (SELECT json_agg(row_to_json(stats_ville) ORDER BY total_clients_ville DESC) 
         FROM stats_ville) as statistiques_villes,
        
        -- Statistiques par maillot
        (SELECT json_agg(row_to_json(stats_maillot) ORDER BY total_clients_maillot DESC) 
         FROM stats_maillot) as statistiques_maillots,
        
        -- Opportunités de cross-selling
        (SELECT json_agg(row_to_json(opportunites) ORDER BY clients_communs DESC LIMIT 15) 
         FROM opportunites) as opportunites_cross_selling,
        
        -- Métriques globales
        (SELECT COUNT(*) FROM hotspots) as total_combinaisons,
        (SELECT SUM(total_clients_ville) FROM stats_ville) as total_clients_analyses,
        (SELECT SUM(total_maillots_ville) FROM stats_ville) as total_maillots_vendus,
        (SELECT SUM(total_ca_ville) FROM stats_ville) as total_chiffre_affaires,
        (SELECT ROUND(AVG(total_clients_ville), 2) FROM stats_ville) as moyenne_clients_par_ville,
        (SELECT COUNT(*) FROM hotspots WHERE niveau_hotspot = 'Hotspot majeur') as total_hotspots_majeurs
    `;

    console.log('📋 Synthèse complète client-maillot-ville');

    const result = await db.query(sql, params.length > 0 ? params : undefined);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur synthèse complète:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🔍 5. RECHERCHE AVANCÉE PAR FILTRES
router.get('/analytique/recherche-avancee', async (req, res) => {
  try {
    const { ville, produit, taille, minClients = 1, dateDebut, dateFin } = req.query;
    
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
    
    if (dateDebut && dateFin) {
      paramCount++;
      whereClause += ` AND date_creation BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(dateDebut, dateFin);
      paramCount++;
    }

    const sql = `
      WITH donnees_filtrees AS (
        SELECT 
          ville,
          nom_produit,
          taille,
          COUNT(DISTINCT email) as nombre_clients,
          COUNT(*) as nombre_commandes,
          SUM(quantite) as nombre_maillots,
          SUM(total) as chiffre_affaires,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne,
          MIN(date_creation) as premiere_commande,
          MAX(date_creation) as derniere_commande
        FROM commandes
        ${whereClause}
        GROUP BY ville, nom_produit, taille
      ),
      
      clients_detaille AS (
        SELECT 
          c.ville,
          c.nom_produit,
          c.taille,
          c.email,
          c.nom_complet,
          c.telephone,
          COUNT(*) as achats_client,
          SUM(c.quantite) as maillots_client,
          SUM(c.total) as depense_client
        FROM commandes c
        ${whereClause}
        GROUP BY c.ville, c.nom_produit, c.taille, c.email, c.nom_complet, c.telephone
      )
      
      SELECT 
        df.*,
        DATE_PART('day', df.derniere_commande - df.premiere_commande) as periode_activite_jours,
        ROUND(df.chiffre_affaires / NULLIF(df.nombre_clients, 0), 2) as valeur_par_client,
        ROUND(df.nombre_maillots / NULLIF(df.nombre_clients, 0), 2) as maillots_par_client,
        
        -- Clients détaillés
        (SELECT json_agg(json_build_object(
          'nom', cd.nom_complet,
          'email', cd.email,
          'telephone', cd.telephone,
          'achats', cd.achats_client,
          'maillots', cd.maillots_client,
          'depense', cd.depense_client
        )) 
        FROM clients_detaille cd 
        WHERE cd.ville = df.ville 
          AND cd.nom_produit = df.nom_produit 
          AND cd.taille = df.taille 
        LIMIT 10) as liste_clients
        
      FROM donnees_filtrees df
      WHERE df.nombre_clients >= $${paramCount + 1}
      ORDER BY df.nombre_clients DESC, df.chiffre_affaires DESC
    `;

    params.push(parseInt(minClients));
    
    console.log('📋 Recherche avancée avec filtres:', { ville, produit, taille, minClients, dateDebut, dateFin });

    const result = await db.query(sql, params);
    
    // Calcul des totaux
    const totaux = {
      total_combinaisons: result.rows.length,
      total_clients: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients), 0),
      total_commandes: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_commandes), 0),
      total_maillots: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_maillots), 0),
      total_ca: result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0),
      moyenne_clients_par_combinaison: result.rows.length > 0 ? 
        result.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients), 0) / result.rows.length : 0
    };

    res.json({
      success: true,
      filtres_appliques: { ville, produit, taille, minClients, dateDebut, dateFin },
      totaux,
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

// 📈 6. ÉVOLUTION TEMPORELLE CLIENT-MAILLOT-VILLE
router.get('/analytique/evolution-temporelle', async (req, res) => {
  try {
    const { ville, produit, taille, periode = 'mois' } = req.query;
    
    let dateTrunc = 'month';
    switch(periode) {
      case 'jour': dateTrunc = 'day'; break;
      case 'semaine': dateTrunc = 'week'; break;
      case 'mois': dateTrunc = 'month'; break;
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
    
    if (taille) {
      whereClause += params.length > 0 ? ' AND taille = $3' : ' AND taille = $1';
      params.push(taille);
    }

    const sql = `
      SELECT 
        DATE_TRUNC('${dateTrunc}', date_creation) as periode,
        ville,
        nom_produit,
        taille,
        COUNT(DISTINCT email) as nouveaux_clients,
        COUNT(*) as nouvelles_commandes,
        SUM(quantite) as nouveaux_maillots,
        SUM(total) as chiffre_affaires_periode,
        ROUND(AVG(total), 2) as panier_moyen_periode,
        
        -- Croissance clients
        LAG(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)) as clients_periode_precedente,
        ROUND(
          (COUNT(DISTINCT email) - LAG(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation))) * 100.0 / 
          NULLIF(LAG(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)), 0), 2
        ) as croissance_clients,
        
        -- Clients cumulés
        SUM(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)) as clients_cumules
        
      FROM commandes
      ${whereClause}
      GROUP BY DATE_TRUNC('${dateTrunc}', date_creation), ville, nom_produit, taille
      ORDER BY periode DESC
      LIMIT 24
    `;

    console.log(`📋 Évolution temporelle (${periode})`);

    const result = await db.query(sql, params);
    
    // Calcul des tendances
    const tendances = {
      periode_analysee: periode,
      total_periodes: result.rows.length,
      croissance_moyenne: result.rows.length > 1 ? 
        result.rows.reduce((sum, row) => sum + (row.croissance_clients || 0), 0) / (result.rows.length - 1) : 0,
      clients_totaux: result.rows.length > 0 ? result.rows[0].clients_cumules : 0,
      periode_max_croissance: result.rows.length > 1 ? 
        result.rows.reduce((max, row) => row.croissance_clients > max.croissance_clients ? row : max, result.rows[1]) : null
    };

    res.json({
      success: true,
      filtres: { ville, produit, taille, periode },
      tendances,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur évolution temporelle:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🎯 7. RECOMMANDATIONS STRATÉGIQUES
router.get('/analytique/recommandations', async (req, res) => {
  try {
    const sql = `
      WITH hotspots AS (
        SELECT 
          ville,
          nom_produit,
          taille,
          COUNT(DISTINCT email) as clients,
          SUM(quantite) as maillots_vendus,
          SUM(total) as ca
        FROM commandes
        WHERE statut != 'annulee'
        GROUP BY ville, nom_produit, taille
      ),
      
      zones_sous_exploitees AS (
        SELECT 
          ville,
          COUNT(DISTINCT nom_produit) as modeles_presents,
          COUNT(DISTINCT taille) as tailles_presentes,
          ROUND(100.0 * COUNT(DISTINCT nom_produit) / NULLIF(
            (SELECT COUNT(DISTINCT nom_produit) FROM commandes), 0
          ), 2) as couverture_modeles,
          ROUND(100.0 * COUNT(DISTINCT taille) / 5, 2) as couverture_tailles
        FROM commandes
        WHERE statut != 'annulee'
        GROUP BY ville
      ),
      
      opportunites_produits AS (
        SELECT 
          h1.ville,
          h1.nom_produit as produit_actuel,
          p.nom_produit as produit_suggestion,
          COUNT(*) as similarites
        FROM hotspots h1
        CROSS JOIN (SELECT DISTINCT nom_produit FROM commandes) p
        WHERE p.nom_produit NOT IN (
          SELECT nom_produit FROM hotspots h2 
          WHERE h2.ville = h1.ville
        )
        AND h1.clients >= 2
        GROUP BY h1.ville, h1.nom_produit, p.nom_produit
        HAVING COUNT(*) >= 1
      )
      
      SELECT 
        -- Recommandations par ville
        (SELECT json_agg(json_build_object(
          'ville', zse.ville,
          'type', 'Extension gamme',
          'recommandation', 'Ajouter ' || (5 - zse.tailles_presentes) || ' tailles manquantes',
          'priorite', CASE 
            WHEN zse.couverture_tailles < 50 THEN 'Haute'
            WHEN zse.couverture_tailles < 80 THEN 'Moyenne'
            ELSE 'Basse'
          END
        )) 
        FROM zones_sous_exploitees zse 
        WHERE zse.couverture_tailles < 100) as recommandations_tailles,
        
        -- Recommandations produits
        (SELECT json_agg(json_build_object(
          'ville', op.ville,
          'produit_actuel', op.produit_actuel,
          'produit_suggestion', op.produit_suggestion,
          'type', 'Cross-selling',
          'recommandation', 'Promouvoir ' || op.produit_suggestion || ' aux clients de ' || op.produit_actuel,
          'priorite', CASE 
            WHEN op.similarites >= 3 THEN 'Haute'
            WHEN op.similarites >= 2 THEN 'Moyenne'
            ELSE 'Basse'
          END
        )) 
        FROM opportunites_produits op 
        ORDER BY op.similarites DESC 
        LIMIT 10) as recommandations_produits,
        
        -- Hotspots à renforcer
        (SELECT json_agg(json_build_object(
          'ville', h.ville,
          'produit', h.nom_produit,
          'taille', h.taille,
          'clients', h.clients,
          'type', 'Renforcement',
          'recommandation', 'Augmenter le stock de ' || h.nom_produit || ' taille ' || h.taille || ' à ' || h.ville,
          'priorite', CASE 
            WHEN h.clients >= 5 THEN 'Haute'
            WHEN h.clients >= 3 THEN 'Moyenne'
            ELSE 'Basse'
          END
        )) 
        FROM hotspots h 
        WHERE h.clients >= 2 
        ORDER BY h.ca DESC 
        LIMIT 10) as recommandations_stocks
    `;

    console.log('📋 Génération de recommandations stratégiques');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur génération recommandations:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;