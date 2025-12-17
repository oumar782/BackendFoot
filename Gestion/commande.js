import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 ANALYSE GLOBALE - Tableau de bord principal
router.get('/analytique/dashboard', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = `WHERE date_creation BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    }

    const sql = `
      -- Métriques principales
      WITH stats AS (
        SELECT 
          COUNT(*) as total_commandes,
          SUM(total) as chiffre_affaires_total,
          SUM(CASE WHEN statut = 'livree' THEN total ELSE 0 END) as ca_confirme,
          SUM(quantite) as total_maillots_vendus,
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(DISTINCT ville) as villes_couvertes,
          AVG(total) as panier_moyen,
          AVG(quantite) as quantite_moyenne,
          
          -- Analyse temporelle
          DATE_TRUNC('day', date_creation) as jour,
          DATE_TRUNC('week', date_creation) as semaine,
          DATE_TRUNC('month', date_creation) as mois,
          
          -- Taux de conversion (si vous avez des données d'abandon)
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as commandes_annulees,
          SUM(CASE WHEN statut IN ('livree', 'expediee', 'confirmee') THEN 1 ELSE 0 END) as commandes_validees,
          
          -- Analyse financière
          SUM(frais_livraison) as total_frais_livraison,
          SUM(montant_promotion) as total_promotions,
          SUM(prix_original) as chiffre_affaires_hors_promo,
          
          -- Analyse produit
          SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) as commandes_promotionnelles
        FROM commandes
        ${dateFilter}
        GROUP BY jour, semaine, mois
      ),
      
      -- Tendance par statut
      tendances_statut AS (
        SELECT 
          statut,
          COUNT(*) as nombre,
          SUM(total) as valeur_totale,
          ROUND(AVG(total), 2) as valeur_moyenne,
          ROUND(AVG(quantite), 2) as quantite_moyenne,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage
        FROM commandes
        ${dateFilter ? dateFilter + ' AND' : 'WHERE'} date_creation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY statut
        ORDER BY nombre DESC
      ),
      
      -- Top produits
      top_produits AS (
        SELECT 
          nom_produit,
          COUNT(*) as nombre_commandes,
          SUM(quantite) as quantite_vendue,
          SUM(sous_total) as chiffre_affaires_produit,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen,
          ROUND(SUM(quantite) * 100.0 / SUM(SUM(quantite)) OVER (), 2) as part_marche
        FROM commandes
        ${dateFilter}
        GROUP BY nom_produit
        ORDER BY quantite_vendue DESC
        LIMIT 10
      ),
      
      -- Analyse géographique
      geo_analyse AS (
        SELECT 
          ville,
          COUNT(*) as commandes,
          SUM(total) as ca_ville,
          SUM(quantite) as maillots_vendus,
          ROUND(AVG(total), 2) as panier_moyen_ville,
          COUNT(DISTINCT email) as clients_uniques_ville,
          RANK() OVER (ORDER BY SUM(total) DESC) as classement_ca
        FROM commandes
        ${dateFilter}
        GROUP BY ville
        HAVING COUNT(*) >= 1
        ORDER BY ca_ville DESC
      ),
      
      -- Analyse temporelle détaillée
      analyse_temporelle AS (
        SELECT 
          EXTRACT(HOUR FROM date_creation) as heure,
          EXTRACT(DOW FROM date_creation) as jour_semaine,
          TO_CHAR(date_creation, 'Day') as nom_jour,
          COUNT(*) as commandes_par_heure,
          SUM(total) as ca_par_heure,
          ROUND(AVG(total), 2) as panier_moyen_heure
        FROM commandes
        ${dateFilter}
        GROUP BY heure, jour_semaine, nom_jour
        ORDER BY jour_semaine, heure
      ),
      
      -- Analyse client
      analyse_clients AS (
        SELECT 
          CASE 
            WHEN COUNT(*) > 5 THEN 'Client fidèle'
            WHEN COUNT(*) BETWEEN 2 AND 5 THEN 'Client récurrent'
            ELSE 'Nouveau client'
          END as segment_client,
          COUNT(DISTINCT email) as nombre_clients,
          SUM(total) as ca_segment,
          ROUND(AVG(total), 2) as panier_moyen_segment,
          COUNT(*) as total_commandes_segment
        FROM commandes
        ${dateFilter}
        GROUP BY segment_client
      ),
      
      -- Analyse des tailles
      analyse_taille AS (
        SELECT 
          taille,
          COUNT(*) as nombre_commandes,
          SUM(quantite) as quantite_vendue,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_taille
        FROM commandes
        ${dateFilter}
        GROUP BY taille
        ORDER BY quantite_vendue DESC
      ),
      
      -- Tendance temporelle (7 derniers jours)
      tendance_7jours AS (
        SELECT 
          DATE(date_creation) as date,
          COUNT(*) as commandes,
          SUM(total) as chiffre_affaires,
          SUM(quantite) as maillots_vendus,
          ROUND(AVG(total), 2) as panier_moyen,
          LAG(COUNT(*)) OVER (ORDER BY DATE(date_creation)) as commandes_veille,
          LAG(SUM(total)) OVER (ORDER BY DATE(date_creation)) as ca_veille
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(date_creation)
        ORDER BY date
      ),
      
      -- Méthodes de paiement
      methodes_paiement AS (
        SELECT 
          methode_paiement,
          COUNT(*) as nombre_commandes,
          SUM(total) as total_ca,
          ROUND(AVG(total), 2) as panier_moyen_methode,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_utilisation
        FROM commandes
        ${dateFilter}
        GROUP BY methode_paiement
        ORDER BY nombre_commandes DESC
      )

      SELECT 
        -- Récupérer toutes les données
        (SELECT json_agg(row_to_json(stats)) FROM stats) as metrics_globales,
        (SELECT json_agg(row_to_json(tendances_statut)) FROM tendances_statut) as tendances_statut,
        (SELECT json_agg(row_to_json(top_produits)) FROM top_produits) as top_produits,
        (SELECT json_agg(row_to_json(geo_analyse)) FROM geo_analyse) as analyse_geographique,
        (SELECT json_agg(row_to_json(analyse_temporelle)) FROM analyse_temporelle) as analyse_temporelle,
        (SELECT json_agg(row_to_json(analyse_clients)) FROM analyse_clients) as analyse_clients,
        (SELECT json_agg(row_to_json(analyse_taille)) FROM analyse_taille) as analyse_taille,
        (SELECT json_agg(row_to_json(tendance_7jours)) FROM tendance_7jours) as tendance_7jours,
        (SELECT json_agg(row_to_json(methodes_paiement)) FROM methodes_paiement) as methodes_paiement
    `;

    console.log('📋 Requête dashboard analytique');

    const result = await db.query(sql, params.length > 0 ? params : undefined);
    
    const data = result.rows[0] || {};
    
    // Calcul des indicateurs de performance clés (KPI)
    const kpis = {
      taux_conversion: data.commandes_validees && data.total_commandes ? 
        (data.commandes_validees / data.total_commandes * 100).toFixed(2) : 0,
      taux_annulation: data.commandes_annulees && data.total_commandes ? 
        (data.commandes_annulees / data.total_commandes * 100).toFixed(2) : 0,
      valeur_vie_client: data.ca_confirme && data.clients_uniques ? 
        (data.ca_confirme / data.clients_uniques).toFixed(2) : 0,
      marge_livraison: data.total_frais_livraison && data.chiffre_affaires_total ? 
        (data.total_frais_livraison / data.chiffre_affaires_total * 100).toFixed(2) : 0
    };

    res.json({
      success: true,
      data: {
        kpis,
        ...data
      }
    });

  } catch (error) {
    console.error('❌ Erreur dashboard analytique:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📈 ANALYSE TEMPORELLE AVANCÉE
router.get('/analytique/temporelle', async (req, res) => {
  try {
    const { periode = 'jour', startDate, endDate } = req.query;
    
    let dateTrunc;
    switch(periode) {
      case 'heure': dateTrunc = 'hour'; break;
      case 'jour': dateTrunc = 'day'; break;
      case 'semaine': dateTrunc = 'week'; break;
      case 'mois': dateTrunc = 'month'; break;
      default: dateTrunc = 'day';
    }

    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = `WHERE date_creation BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    }

    const sql = `
      WITH donnees_temporelles AS (
        SELECT 
          DATE_TRUNC('${dateTrunc}', date_creation) as periode,
          COUNT(*) as commandes,
          SUM(total) as chiffre_affaires,
          SUM(quantite) as quantite_vendue,
          SUM(CASE WHEN statut = 'livree' THEN total ELSE 0 END) as ca_confirme,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations,
          COUNT(DISTINCT email) as nouveaux_clients,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne,
          
          -- Calcul des tendances
          LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)) as commandes_periode_precedente,
          LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)) as ca_periode_precedente,
          
          -- Analyse de croissance
          ROUND(
            ((COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation))) * 100.0 / 
            NULLIF(LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)), 0)), 2
          ) as croissance_commandes,
          
          ROUND(
            ((SUM(total) - LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation))) * 100.0 / 
            NULLIF(LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('${dateTrunc}', date_creation)), 0)), 2
          ) as croissance_ca
          
        FROM commandes
        ${dateFilter}
        GROUP BY periode
        ORDER BY periode DESC
      )
      
      SELECT 
        periode,
        commandes,
        chiffre_affaires,
        quantite_vendue,
        ca_confirme,
        annulations,
        nouveaux_clients,
        panier_moyen,
        quantite_moyenne,
        commandes_periode_precedente,
        ca_periode_precedente,
        croissance_commandes,
        croissance_ca,
        
        -- Indicateurs supplémentaires
        ROUND(chiffre_affaires / NULLIF(commandes, 0), 2) as valeur_par_commande,
        ROUND(quantite_vendue / NULLIF(commandes, 0), 2) as items_par_commande,
        ROUND(100.0 * annulations / NULLIF(commandes, 0), 2) as taux_annulation
        
      FROM donnees_temporelles
      ORDER BY periode DESC
      LIMIT 50
    `;

    console.log(`📋 Analyse temporelle (${periode})`);

    const result = await db.query(sql, params.length > 0 ? params : undefined);
    
    // Calcul des totaux
    const totaux = {
      total_commandes: result.rows.reduce((sum, row) => sum + parseInt(row.commandes), 0),
      total_ca: result.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0),
      total_quantite: result.rows.reduce((sum, row) => sum + parseInt(row.quantite_vendue), 0),
      moyenne_croissance: result.rows.length > 0 ? 
        result.rows.reduce((sum, row) => sum + (row.croissance_ca || 0), 0) / result.rows.length : 0
    };

    res.json({
      success: true,
      periode: dateTrunc,
      totaux,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur analyse temporelle:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📊 ANALYSE CLIENT AVANCÉE
router.get('/analytique/clients', async (req, res) => {
  try {
    const sql = `
      WITH donnees_clients AS (
        SELECT 
          email,
          nom_complet,
          ville,
          COUNT(*) as nombre_commandes,
          SUM(total) as chiffre_affaires_total,
          MIN(date_creation) as premiere_commande,
          MAX(date_creation) as derniere_commande,
          SUM(quantite) as total_maillots,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(quantite), 2) as quantite_moyenne,
          STRING_AGG(DISTINCT statut, ', ') as statuts_commandes,
          
          -- Segmentation RFM
          DATE_PART('day', CURRENT_TIMESTAMP - MAX(date_creation)) as recence_jours,
          COUNT(*) as frequence,
          SUM(total) as monetisation,
          
          -- Produits achetés
          STRING_AGG(DISTINCT nom_produit, ', ') as produits_achetes,
          STRING_AGG(DISTINCT taille, ', ') as tailles_achetees
          
        FROM commandes
        GROUP BY email, nom_complet, ville
        HAVING COUNT(*) >= 1
      ),
      
      segmentation_rfm AS (
        SELECT 
          *,
          CASE 
            WHEN recence_jours <= 30 THEN 'Très récent'
            WHEN recence_jours <= 90 THEN 'Récent'
            WHEN recence_jours <= 180 THEN 'Ancien'
            ELSE 'Très ancien'
          END as segment_recence,
          
          CASE 
            WHEN frequence = 1 THEN 'Achat unique'
            WHEN frequence BETWEEN 2 AND 5 THEN 'Client occasionnel'
            WHEN frequence BETWEEN 6 AND 10 THEN 'Client régulier'
            ELSE 'Client fidèle'
          END as segment_frequence,
          
          CASE 
            WHEN monetisation <= 500 THEN 'Petit panier'
            WHEN monetisation <= 2000 THEN 'Panier moyen'
            ELSE 'Gros panier'
          END as segment_monetisation,
          
          -- Score RFM
          (CASE WHEN recence_jours <= 30 THEN 4
                WHEN recence_jours <= 90 THEN 3
                WHEN recence_jours <= 180 THEN 2
                ELSE 1 END) +
          (CASE WHEN frequence = 1 THEN 1
                WHEN frequence BETWEEN 2 AND 5 THEN 2
                WHEN frequence BETWEEN 6 AND 10 THEN 3
                ELSE 4 END) +
          (CASE WHEN monetisation <= 500 THEN 1
                WHEN monetisation <= 2000 THEN 2
                ELSE 3 END) as score_rfm,
          
          -- Valeur vie client prédite
          ROUND(monetisation / NULLIF(frequence, 0) * 
                (CASE WHEN recence_jours <= 30 THEN 12
                      WHEN recence_jours <= 90 THEN 6
                      WHEN recence_jours <= 180 THEN 3
                      ELSE 1 END), 2) as valeur_vie_client_estimee
          
        FROM donnees_clients
      ),
      
      statistiques_segments AS (
        SELECT 
          segment_frequence,
          COUNT(*) as nombre_clients,
          SUM(chiffre_affaires_total) as ca_segment,
          ROUND(AVG(chiffre_affaires_total), 2) as ca_moyen_par_client,
          ROUND(AVG(recence_jours), 2) as recence_moyenne,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_clients
        FROM segmentation_rfm
        GROUP BY segment_frequence
        ORDER BY ca_segment DESC
      ),
      
      top_clients AS (
        SELECT 
          nom_complet,
          email,
          ville,
          nombre_commandes,
          chiffre_affaires_total,
          recence_jours,
          segment_frequence,
          score_rfm,
          valeur_vie_client_estimee,
          RANK() OVER (ORDER BY chiffre_affaires_total DESC) as classement_ca
        FROM segmentation_rfm
        ORDER BY chiffre_affaires_total DESC
        LIMIT 20
      ),
      
      analyse_geo_clients AS (
        SELECT 
          ville,
          COUNT(DISTINCT email) as clients_uniques,
          SUM(nombre_commandes) as total_commandes,
          ROUND(AVG(chiffre_affaires_total), 2) as ca_moyen_par_client,
          ROUND(SUM(chiffre_affaires_total) / COUNT(DISTINCT email), 2) as valeur_moyenne_client
        FROM segmentation_rfm
        GROUP BY ville
        HAVING COUNT(DISTINCT email) >= 1
        ORDER BY clients_uniques DESC
      )

      SELECT 
        (SELECT COUNT(*) FROM donnees_clients) as total_clients,
        (SELECT SUM(chiffre_affaires_total) FROM donnees_clients) as ca_total_clients,
        (SELECT ROUND(AVG(chiffre_affaires_total), 2) FROM donnees_clients) as ca_moyen_client,
        (SELECT ROUND(AVG(nombre_commandes), 2) FROM donnees_clients) as commandes_moyennes_par_client,
        
        (SELECT json_agg(row_to_json(top_clients)) FROM top_clients) as top_clients,
        (SELECT json_agg(row_to_json(statistiques_segments)) FROM statistiques_segments) as segments_clients,
        (SELECT json_agg(row_to_json(analyse_geo_clients)) FROM analyse_geo_clients) as geo_clients,
        
        -- Distribution RFM
        (SELECT json_agg(row_to_json(
          SELECT segment_recence, COUNT(*) FROM segmentation_rfm GROUP BY segment_recence
        ))) as distribution_recence,
        
        (SELECT json_agg(row_to_json(
          SELECT segment_frequence, COUNT(*) FROM segmentation_rfm GROUP BY segment_frequence
        ))) as distribution_frequence
    `;

    console.log('📋 Analyse clients avancée');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur analyse clients:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📦 ANALYSE PRODUIT AVANCÉE
router.get('/analytique/produits', async (req, res) => {
  try {
    const sql = `
      WITH stats_produits AS (
        SELECT 
          nom_produit,
          COUNT(*) as nombre_commandes,
          SUM(quantite) as quantite_vendue,
          SUM(sous_total) as chiffre_affaires_produit,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen,
          MIN(prix_unitaire) as prix_min,
          MAX(prix_unitaire) as prix_max,
          ROUND(AVG(quantite), 2) as quantite_moyenne_par_commande,
          
          -- Analyse temporelle produit
          MIN(date_creation) as premiere_vente,
          MAX(date_creation) as derniere_vente,
          DATE_PART('day', MAX(date_creation) - MIN(date_creation)) as duree_vente_jours,
          
          -- Analyse des tailles
          MODE() WITHIN GROUP (ORDER BY taille) as taille_plus_vendue,
          COUNT(DISTINCT taille) as nombre_tailles_vendues,
          
          -- Analyse des promotions
          SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) as ventes_en_promotion,
          SUM(CASE WHEN promotion_appliquee = true THEN montant_promotion ELSE 0 END) as total_promotions_appliquees,
          
          -- Taux de rotation
          ROUND(SUM(quantite) / NULLIF(COUNT(DISTINCT DATE(date_creation)), 0), 2) as rotation_quotidienne
          
        FROM commandes
        WHERE statut != 'annulee'
        GROUP BY nom_produit
      ),
      
      performance_produits AS (
        SELECT 
          *,
          ROUND(chiffre_affaires_produit * 100.0 / SUM(chiffre_affaires_produit) OVER (), 2) as part_marche_ca,
          ROUND(quantite_vendue * 100.0 / SUM(quantite_vendue) OVER (), 2) as part_marche_quantite,
          ROUND(nombre_commandes * 100.0 / SUM(nombre_commandes) OVER (), 2) as part_marche_commandes,
          
          -- Indice de performance
          ROUND(
            (part_marche_ca * 0.4 + part_marche_quantite * 0.3 + part_marche_commandes * 0.3) / 
            (quantite_vendue / NULLIF(duree_vente_jours, 0)), 2
          ) as indice_performance,
          
          -- Classification ABC
          CASE 
            WHEN ROUND(chiffre_affaires_produit * 100.0 / SUM(chiffre_affaires_produit) OVER (), 2) >= 70 THEN 'A - Produit clé'
            WHEN ROUND(chiffre_affaires_produit * 100.0 / SUM(chiffre_affaires_produit) OVER (), 2) >= 90 THEN 'B - Produit important'
            ELSE 'C - Produit secondaire'
          END as classification_abc
          
        FROM stats_produits
      ),
      
      tendance_ventes AS (
        SELECT 
          nom_produit,
          DATE_TRUNC('week', date_creation) as semaine,
          SUM(quantite) as quantite_vendue_semaine,
          SUM(sous_total) as ca_semaine,
          COUNT(*) as commandes_semaine
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '12 weeks'
        GROUP BY nom_produit, DATE_TRUNC('week', date_creation)
      ),
      
      correlation_taille_prix AS (
        SELECT 
          taille,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen_taille,
          SUM(quantite) as quantite_vendue_taille,
          COUNT(*) as nombre_commandes_taille,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as popularite_taille
        FROM commandes
        GROUP BY taille
        ORDER BY quantite_vendue_taille DESC
      ),
      
      analyse_croix_produits AS (
        SELECT 
          a.nom_produit as produit_a,
          b.nom_produit as produit_b,
          COUNT(*) as achat_conjoint
        FROM commandes a
        JOIN commandes b ON a.email = b.email 
          AND a.date_creation = b.date_creation
          AND a.nom_produit != b.nom_produit
        GROUP BY a.nom_produit, b.nom_produit
        HAVING COUNT(*) >= 2
        ORDER BY achat_conjoint DESC
        LIMIT 10
      )

      SELECT 
        (SELECT json_agg(row_to_json(performance_produits)) FROM performance_produits ORDER BY chiffre_affaires_produit DESC) as produits_performance,
        (SELECT json_agg(row_to_json(correlation_taille_prix)) FROM correlation_taille_prix) as analyse_taille,
        (SELECT json_agg(row_to_json(analyse_croix_produits)) FROM analyse_croix_produits) as produits_associes,
        
        -- Métriques globales produits
        (SELECT COUNT(DISTINCT nom_produit) FROM commandes) as nombre_produits_distincts,
        (SELECT SUM(quantite_vendue) FROM stats_produits) as total_maillots_vendus,
        (SELECT ROUND(AVG(quantite_vendue), 2) FROM stats_produits) as moyenne_vente_par_produit,
        (SELECT ROUND(STDDEV(quantite_vendue), 2) FROM stats_produits) as ecart_type_ventes
    `;

    console.log('📋 Analyse produits avancée');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur analyse produits:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 🎯 ANALYSE PROMOTIONNELLE
router.get('/analytique/promotions', async (req, res) => {
  try {
    const sql = `
      WITH analyse_promotions AS (
        SELECT 
          promotion_appliquee,
          COUNT(*) as nombre_commandes,
          SUM(total) as chiffre_affaires,
          SUM(montant_promotion) as total_reduction,
          SUM(quantite) as quantite_vendue,
          ROUND(AVG(total), 2) as panier_moyen,
          ROUND(AVG(montant_promotion), 2) as reduction_moyenne,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_commandes,
          
          -- Analyse par statut
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations,
          SUM(CASE WHEN statut = 'livree' THEN 1 ELSE 0 END) as livraisons_confirmees,
          
          -- Efficacité promotionnelle
          ROUND(SUM(total) / NULLIF(SUM(montant_promotion), 0), 2) as ratio_ca_reduction,
          ROUND(SUM(quantite) / NULLIF(COUNT(*), 0), 2) as quantite_moyenne_panier
          
        FROM commandes
        GROUP BY promotion_appliquee
      ),
      
      impact_promotion_produit AS (
        SELECT 
          nom_produit,
          promotion_appliquee,
          COUNT(*) as commandes,
          SUM(quantite) as quantite_vendue,
          SUM(total) as ca,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen,
          ROUND(AVG(montant_promotion), 2) as reduction_moyenne,
          ROUND(100.0 * SUM(montant_promotion) / SUM(prix_original), 2) as taux_reduction_moyen
        FROM commandes
        WHERE promotion_appliquee = true
        GROUP BY nom_produit, promotion_appliquee
        ORDER BY quantite_vendue DESC
        LIMIT 15
      ),
      
      evolution_promotions AS (
        SELECT 
          DATE_TRUNC('week', date_creation) as semaine,
          SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) as commandes_promo,
          SUM(CASE WHEN promotion_appliquee = false THEN 1 ELSE 0 END) as commandes_sans_promo,
          SUM(CASE WHEN promotion_appliquee = true THEN total ELSE 0 END) as ca_promo,
          SUM(CASE WHEN promotion_appliquee = false THEN total ELSE 0 END) as ca_sans_promo,
          ROUND(100.0 * SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_promotion_semaine
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '12 weeks'
        GROUP BY DATE_TRUNC('week', date_creation)
        ORDER BY semaine DESC
      ),
      
      client_promotion AS (
        SELECT 
          email,
          COUNT(*) as total_commandes,
          SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) as commandes_promo,
          SUM(CASE WHEN promotion_appliquee = false THEN 1 ELSE 0 END) as commandes_sans_promo,
          ROUND(100.0 * SUM(CASE WHEN promotion_appliquee = true THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_promotion_client,
          SUM(CASE WHEN promotion_appliquee = true THEN montant_promotion ELSE 0 END) as total_economise
        FROM commandes
        GROUP BY email
        HAVING COUNT(*) >= 2
      )

      SELECT 
        (SELECT json_agg(row_to_json(analyse_promotions)) FROM analyse_promotions) as analyse_globale,
        (SELECT json_agg(row_to_json(impact_promotion_produit)) FROM impact_promotion_produit) as impact_produits,
        (SELECT json_agg(row_to_json(evolution_promotions)) FROM evolution_promotions) as evolution_temporelle,
        (SELECT json_agg(row_to_json(client_promotion)) FROM client_promotion LIMIT 20) as clients_promotion,
        
        -- KPI Promotions
        (SELECT ROUND(AVG(taux_promotion_client), 2) FROM client_promotion) as taux_promotion_client_moyen,
        (SELECT SUM(total_economise) FROM client_promotion) as total_economies_clients,
        (SELECT COUNT(*) FROM client_promotion WHERE taux_promotion_client >= 50) as clients_sensibles_promotions
    `;

    console.log('📋 Analyse promotions');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
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

// 📍 ANALYSE GÉOGRAPHIQUE AVANCÉE
router.get('/analytique/geographique', async (req, res) => {
  try {
    const sql = `
      WITH stats_ville AS (
        SELECT 
          ville,
          COUNT(*) as nombre_commandes,
          COUNT(DISTINCT email) as clients_uniques,
          SUM(total) as chiffre_affaires_ville,
          SUM(quantite) as maillots_vendus,
          ROUND(AVG(total), 2) as panier_moyen_ville,
          ROUND(AVG(quantite), 2) as quantite_moyenne_ville,
          
          -- Analyse temporelle par ville
          MIN(date_creation) as premiere_commande_ville,
          MAX(date_creation) as derniere_commande_ville,
          
          -- Analyse des statuts par ville
          SUM(CASE WHEN statut = 'livree' THEN 1 ELSE 0 END) as commandes_livrees,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as commandes_annulees,
          
          -- Produits populaires par ville
          MODE() WITHIN GROUP (ORDER BY nom_produit) as produit_plus_vendu,
          MODE() WITHIN GROUP (ORDER BY taille) as taille_plus_vendue
          
        FROM commandes
        GROUP BY ville
        HAVING COUNT(*) >= 1
      ),
      
      performance_ville AS (
        SELECT 
          *,
          ROUND(chiffre_affaires_ville * 100.0 / SUM(chiffre_affaires_ville) OVER (), 2) as part_marche_ca,
          ROUND(nombre_commandes * 100.0 / SUM(nombre_commandes) OVER (), 2) as part_marche_commandes,
          ROUND(maillots_vendus * 100.0 / SUM(maillots_vendus) OVER (), 2) as part_marche_quantite,
          
          -- Indice de performance ville
          ROUND(
            (part_marche_ca * 0.5 + part_marche_commandes * 0.3 + part_marche_quantite * 0.2) * 
            (clients_uniques / NULLIF(nombre_commandes, 0)), 2
          ) as indice_performance_ville,
          
          -- Taux de rétention ville
          ROUND(100.0 * clients_uniques / NULLIF(nombre_commandes, 0), 2) as taux_fidelite_ville,
          
          -- Taux de succès livraison
          ROUND(100.0 * commandes_livrees / NULLIF(nombre_commandes, 0), 2) as taux_succes_livraison
          
        FROM stats_ville
      ),
      
      tendance_geo_temporelle AS (
        SELECT 
          ville,
          DATE_TRUNC('month', date_creation) as mois,
          COUNT(*) as commandes_mois,
          SUM(total) as ca_mois,
          SUM(quantite) as quantite_mois,
          ROUND(AVG(total), 2) as panier_moyen_mois
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY ville, DATE_TRUNC('month', date_creation)
      ),
      
      analyse_distance AS (
        SELECT 
          ville,
          ROUND(AVG(frais_livraison), 2) as frais_livraison_moyen,
          COUNT(*) as commandes_avec_livraison,
          SUM(frais_livraison) as total_frais_livraison_ville
        FROM commandes
        WHERE frais_livraison > 0
        GROUP BY ville
      ),
      
      clusters_geographiques AS (
        SELECT 
          CASE 
            WHEN nombre_commandes >= 100 THEN 'Ville majeure'
            WHEN nombre_commandes >= 50 THEN 'Ville moyenne'
            WHEN nombre_commandes >= 20 THEN 'Petite ville'
            ELSE 'Ville émergente'
          END as cluster_ville,
          COUNT(*) as nombre_villes,
          SUM(nombre_commandes) as total_commandes_cluster,
          SUM(chiffre_affaires_ville) as total_ca_cluster,
          ROUND(AVG(panier_moyen_ville), 2) as panier_moyen_cluster
        FROM performance_ville
        GROUP BY cluster_ville
        ORDER BY total_ca_cluster DESC
      )

      SELECT 
        (SELECT json_agg(row_to_json(performance_ville ORDER BY chiffre_affaires_ville DESC)) FROM performance_ville) as villes_performance,
        (SELECT json_agg(row_to_json(tendance_geo_temporelle)) FROM tendance_geo_temporelle) as tendance_temporelle_geo,
        (SELECT json_agg(row_to_json(analyse_distance)) FROM analyse_distance) as analyse_livraison,
        (SELECT json_agg(row_to_json(clusters_geographiques)) FROM clusters_geographiques) as clusters_geographiques,
        
        -- Métriques globales géographiques
        (SELECT COUNT(DISTINCT ville) FROM commandes) as total_villes,
        (SELECT SUM(chiffre_affaires_ville) FROM performance_ville) as ca_total_geo,
        (SELECT ROUND(AVG(panier_moyen_ville), 2) FROM performance_ville) as panier_moyen_global,
        (SELECT ROUND(STDDEV(panier_moyen_ville), 2) FROM performance_ville) as ecart_type_panier_ville
    `;

    console.log('📋 Analyse géographique avancée');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur analyse géographique:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📉 ANALYSE DES RISQUES ET PERFORMANCE
router.get('/analytique/performance', async (req, res) => {
  try {
    const sql = `
      WITH indicateurs_performance AS (
        SELECT 
          -- Indicateurs de volume
          COUNT(*) as total_commandes,
          SUM(total) as chiffre_affaires_total,
          SUM(quantite) as total_maillots_vendus,
          
          -- Indicateurs de qualité
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as commandes_annulees,
          SUM(CASE WHEN statut = 'livree' THEN 1 ELSE 0 END) as commandes_livrees,
          SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as commandes_en_attente,
          
          -- Indicateurs financiers
          SUM(frais_livraison) as total_frais_livraison,
          SUM(montant_promotion) as total_promotions,
          ROUND(SUM(frais_livraison) * 100.0 / SUM(total), 2) as pourcentage_frais_livraison,
          ROUND(SUM(montant_promotion) * 100.0 / SUM(prix_original), 2) as pourcentage_promotions,
          
          -- Indicateurs clients
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(DISTINCT ville) as villes_couvertes,
          
          -- Indicateurs temporels
          DATE_PART('day', MAX(date_creation) - MIN(date_creation)) as periode_analyse_jours,
          ROUND(COUNT(*) / DATE_PART('day', MAX(date_creation) - MIN(date_creation)), 2) as commandes_par_jour,
          ROUND(SUM(total) / DATE_PART('day', MAX(date_creation) - MIN(date_creation)), 2) as ca_par_jour
          
        FROM commandes
      ),
      
      analyse_risques AS (
        SELECT 
          -- Risque d'annulation
          ville,
          COUNT(*) as commandes_ville,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations_ville,
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_annulation_ville,
          
          -- Risque financier
          SUM(CASE WHEN statut = 'annulee' THEN total ELSE 0 END) as ca_perdu_annulation,
          ROUND(AVG(CASE WHEN statut = 'annulee' THEN total ELSE NULL END), 2) as valeur_moyenne_annulation
          
        FROM commandes
        GROUP BY ville
        HAVING COUNT(*) >= 5
      ),
      
      performance_produit_risque AS (
        SELECT 
          nom_produit,
          COUNT(*) as ventes_total,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations_produit,
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_annulation_produit,
          ROUND(AVG(prix_unitaire), 2) as prix_moyen,
          SUM(CASE WHEN statut = 'annulee' THEN sous_total ELSE 0 END) as ca_perdu_produit
        FROM commandes
        GROUP BY nom_produit
        HAVING COUNT(*) >= 3
      ),
      
      analyse_tendances_negatives AS (
        SELECT 
          DATE_TRUNC('week', date_creation) as semaine,
          COUNT(*) as commandes_semaine,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations_semaine,
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_annulation_semaine,
          SUM(total) as ca_semaine,
          SUM(CASE WHEN statut = 'annulee' THEN total ELSE 0 END) as ca_perdu_semaine
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', date_creation)
        ORDER BY semaine
      ),
      
      alertes_performance AS (
        SELECT 
          'Taux annulation élevé' as type_alerte,
          ville as cible,
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as valeur,
          'Considérer une vérification supplémentaire pour cette ville' as recommandation
        FROM commandes
        GROUP BY ville
        HAVING COUNT(*) >= 10 AND 100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*) > 20
        
        UNION ALL
        
        SELECT 
          'Produit à fort taux d annulation' as type_alerte,
          nom_produit as cible,
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as valeur,
          'Réévaluer la disponibilité ou la description du produit' as recommandation
        FROM commandes
        GROUP BY nom_produit
        HAVING COUNT(*) >= 5 AND 100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*) > 15
        
        UNION ALL
        
        SELECT 
          'Baisse de commandes hebdomadaire' as type_alerte,
          'Global' as cible,
          ROUND((LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('week', date_creation)) - COUNT(*)) * 100.0 / 
                LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('week', date_creation)), 2) as valeur,
          'Analyser les causes de la baisse d activité' as recommandation
        FROM commandes
        WHERE date_creation >= CURRENT_DATE - INTERVAL '4 weeks'
        GROUP BY DATE_TRUNC('week', date_creation)
        HAVING COUNT(*) < LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('week', date_creation)) * 0.8
      )

      SELECT 
        (SELECT row_to_json(indicateurs_performance) FROM indicateurs_performance) as kpis_globaux,
        (SELECT json_agg(row_to_json(analyse_risques)) FROM analyse_risques ORDER BY taux_annulation_ville DESC) as analyse_risques,
        (SELECT json_agg(row_to_json(performance_produit_risque)) FROM performance_produit_risque ORDER BY taux_annulation_produit DESC) as risques_produits,
        (SELECT json_agg(row_to_json(analyse_tendances_negatives)) FROM analyse_tendances_negatives) as tendances_negatives,
        (SELECT json_agg(row_to_json(alertes_performance)) FROM alertes_performance) as alertes,
        
        -- Score de performance global
        (
          SELECT ROUND(
            (100 - COALESCE(AVG(taux_annulation_ville), 0)) * 0.3 +
            (commandes_par_jour / 10) * 0.3 +
            (clients_uniques / 100) * 0.2 +
            (villes_couvertes / 10) * 0.2, 2
          )
          FROM indicateurs_performance, 
          (SELECT COALESCE(AVG(taux_annulation_ville), 0) as taux_annulation_ville FROM analyse_risques) as taux
        ) as score_performance_global
    `;

    console.log('📋 Analyse performance et risques');

    const result = await db.query(sql);
    
    res.json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur analyse performance:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

// 📊 RAPPORT SYNTHÈSE MENSUEL
router.get('/analytique/rapport-mensuel', async (req, res) => {
  try {
    const { mois, annee } = req.query;
    
    const moisCible = mois || EXTRACT(MONTH FROM CURRENT_DATE);
    const anneeCible = annee || EXTRACT(YEAR FROM CURRENT_DATE);

    const sql = `
      WITH donnees_mois AS (
        SELECT 
          -- Données du mois en cours
          COUNT(*) as commandes_mois,
          SUM(total) as ca_mois,
          SUM(quantite) as maillots_vendus_mois,
          COUNT(DISTINCT email) as nouveaux_clients_mois,
          COUNT(DISTINCT ville) as nouvelles_villes_mois,
          ROUND(AVG(total), 2) as panier_moyen_mois,
          SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulations_mois,
          SUM(montant_promotion) as promotions_appliquees_mois,
          
          -- Données du mois précédent
          LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', date_creation)) as commandes_mois_precedent,
          LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('month', date_creation)) as ca_mois_precedent,
          LAG(SUM(quantite)) OVER (ORDER BY DATE_TRUNC('month', date_creation)) as maillots_mois_precedent,
          
          -- Croissance
          ROUND(
            (COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', date_creation))) * 100.0 / 
            NULLIF(LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', date_creation)), 0), 2
          ) as croissance_commandes,
          
          ROUND(
            (SUM(total) - LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('month', date_creation))) * 100.0 / 
            NULLIF(LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC('month', date_creation)), 0), 2
          ) as croissance_ca
          
        FROM commandes
        WHERE EXTRACT(MONTH FROM date_creation) IN (${moisCible}, ${moisCible} - 1)
          AND EXTRACT(YEAR FROM date_creation) = ${anneeCible}
        GROUP BY DATE_TRUNC('month', date_creation)
        ORDER BY DATE_TRUNC('month', date_creation) DESC
        LIMIT 2
      ),
      
      top_elements_mois AS (
        SELECT 
          'top_produits' as categorie,
          json_agg(json_build_object(
            'nom', nom_produit,
            'quantite', SUM(quantite),
            'ca', SUM(sous_total),
            'commandes', COUNT(*)
          ) ORDER BY SUM(quantite) DESC LIMIT 5) as donnees
        FROM commandes
        WHERE EXTRACT(MONTH FROM date_creation) = ${moisCible}
          AND EXTRACT(YEAR FROM date_creation) = ${anneeCible}
        GROUP BY nom_produit
        
        UNION ALL
        
        SELECT 
          'top_villes' as categorie,
          json_agg(json_build_object(
            'ville', ville,
            'commandes', COUNT(*),
            'ca', SUM(total),
            'clients', COUNT(DISTINCT email)
          ) ORDER BY COUNT(*) DESC LIMIT 5) as donnees
        FROM commandes
        WHERE EXTRACT(MONTH FROM date_creation) = ${moisCible}
          AND EXTRACT(YEAR FROM date_creation) = ${anneeCible}
        GROUP BY ville
        
        UNION ALL
        
        SELECT 
          'top_clients' as categorie,
          json_agg(json_build_object(
            'client', nom_complet,
            'email', email,
            'commandes', COUNT(*),
            'ca', SUM(total),
            'ville', ville
          ) ORDER BY SUM(total) DESC LIMIT 5) as donnees
        FROM commandes
        WHERE EXTRACT(MONTH FROM date_creation) = ${moisCible}
          AND EXTRACT(YEAR FROM date_creation) = ${anneeCible}
        GROUP BY nom_complet, email, ville
      ),
      
      indicateurs_cles AS (
        SELECT 
          ROUND(100.0 * SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_annulation_mois,
          ROUND(SUM(total) / COUNT(DISTINCT email), 2) as valeur_vie_client_mois,
          ROUND(SUM(frais_livraison) * 100.0 / SUM(total), 2) as pourcentage_frais_livraison,
          ROUND(SUM(montant_promotion) * 100.0 / SUM(prix_original), 2) as pourcentage_promotions,
          COUNT(DISTINCT taille) as nombre_tailles_vendues,
          MODE() WITHIN GROUP (ORDER BY taille) as taille_plus_vendue
        FROM commandes
        WHERE EXTRACT(MONTH FROM date_creation) = ${moisCible}
          AND EXTRACT(YEAR FROM date_creation) = ${anneeCible}
      )

      SELECT 
        (SELECT row_to_json(d) FROM donnees_mois d LIMIT 1) as comparaison_mensuelle,
        (SELECT json_object_agg(categorie, donnees) FROM top_elements_mois) as tops_mois,
        (SELECT row_to_json(indicateurs_cles) FROM indicateurs_cles) as indicateurs_cles,
        
        -- Recommandations basées sur les données
        ARRAY[
          CASE 
            WHEN (SELECT taux_annulation_mois FROM indicateurs_cles) > 15 
            THEN 'Taux d annulation élevé - Investiguer les causes'
            ELSE 'Taux d annulation acceptable'
          END,
          CASE 
            WHEN (SELECT croissance_ca FROM donnees_mois LIMIT 1) < 0 
            THEN 'Baisse du CA - Analyser les tendances négatives'
            WHEN (SELECT croissance_ca FROM donnees_mois LIMIT 1) < 5 
            THEN 'Croissance faible - Considérer des promotions'
            ELSE 'Bonne croissance - Maintenir la stratégie'
          END,
          CASE 
            WHEN (SELECT COUNT(*) FROM commandes WHERE promotion_appliquee = true 
                  AND EXTRACT(MONTH FROM date_creation) = ${moisCible}) < 5 
            THEN 'Peu de promotions utilisées - Évaluer leur efficacité'
            ELSE 'Promotions bien utilisées'
          END
        ] as recommandations
    `;

    console.log(`📋 Rapport mensuel ${moisCible}/${anneeCible}`);

    const result = await db.query(sql);
    
    res.json({
      success: true,
      mois: moisCible,
      annee: anneeCible,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur rapport mensuel:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});

export default router;