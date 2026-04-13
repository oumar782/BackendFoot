import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 ANALYSES PROFONDES - AIDE À LA DÉCISION SANS PRÉDICTION

// 🔍 Route principale: Vue d'ensemble des analyses comportementales
router.get('/dashboard-complet', async (req, res) => {
  try {
    const { periode = '30jours' } = req.query;
    
    // 1. ANALYSE TEMPORELLE DES ACTIVITÉS
    const analyseTemporelle = await db.query(`
      WITH activites_quotidiennes AS (
        SELECT 
          datereservation,
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          EXTRACT(HOUR FROM heurereservation) as heure_resa,
          COUNT(*) as nb_reservations,
          COUNT(DISTINCT email) as nb_clients_uniques,
          COALESCE(SUM(tarif), 0) as revenu_total,
          COUNT(DISTINCT nomterrain) as nb_terrains_utilises
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY datereservation, EXTRACT(DOW FROM datereservation), EXTRACT(HOUR FROM heurereservation)
        ORDER BY datereservation
      )
      SELECT 
        AVG(nb_reservations) as reservations_moyennes_quotidiennes,
        MAX(nb_reservations) as pic_reservations_jour,
        MIN(nb_reservations) as creux_reservations_jour,
        ROUND(STDDEV(nb_reservations)::numeric, 2) as variabilite_reservations,
        AVG(nb_clients_uniques) as clients_moyens_quotidiens,
        MAX(nb_clients_uniques) as pic_clients_jour,
        AVG(revenu_total) as revenu_moyen_quotidien,
        MAX(revenu_total) as pic_revenu_jour,
        ROUND(STDDEV(revenu_total)::numeric, 2) as variabilite_revenus
      FROM activites_quotidiennes
    `);

    // 2. ANALYSE DES PATTERNS HEBDOMADAIRES
    const patternsHebdomadaires = await db.query(`
      SELECT 
        CASE 
          WHEN EXTRACT(DOW FROM datereservation) = 0 THEN 'Dimanche'
          WHEN EXTRACT(DOW FROM datereservation) = 1 THEN 'Lundi'
          WHEN EXTRACT(DOW FROM datereservation) = 2 THEN 'Mardi'
          WHEN EXTRACT(DOW FROM datereservation) = 3 THEN 'Mercredi'
          WHEN EXTRACT(DOW FROM datereservation) = 4 THEN 'Jeudi'
          WHEN EXTRACT(DOW FROM datereservation) = 5 THEN 'Vendredi'
          WHEN EXTRACT(DOW FROM datereservation) = 6 THEN 'Samedi'
        END as jour_semaine,
        COUNT(*) as total_reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COALESCE(SUM(tarif), 0) as revenu_total,
        ROUND(AVG(tarif)::numeric, 2) as tarif_moyen,
        COUNT(DISTINCT nomterrain) as terrains_utilises,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2)::numeric as pourcentage_total
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY EXTRACT(DOW FROM datereservation)
      ORDER BY COUNT(*) DESC
    `);

    // 3. ANALYSE DES CRÉNEAUX HORAIRES OPTIMAUX
    const creneauxOptimaux = await db.query(`
      WITH performance_horaires AS (
        SELECT 
          EXTRACT(HOUR FROM heurereservation) as heure,
          COUNT(*) as nb_reservations,
          COUNT(DISTINCT email) as nb_clients,
          COALESCE(SUM(tarif), 0) as revenu_total,
          COUNT(DISTINCT nomterrain) as terrains_utilises,
          ROUND(AVG(tarif)::numeric, 2) as tarif_moyen
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM heurereservation)
      ),
      stats_globales AS (
        SELECT 
          AVG(nb_reservations) as moy_reservations,
          STDDEV(nb_reservations) as ecart_reservations
        FROM performance_horaires
      )
      SELECT 
        ph.*,
        sg.moy_reservations,
        CASE 
          WHEN ph.nb_reservations > sg.moy_reservations + sg.ecart_reservations THEN 'PERFORMANT'
          WHEN ph.nb_reservations < sg.moy_reservations - sg.ecart_reservations THEN 'FAIBLE'
          ELSE 'MOYEN'
        END as performance_categorie,
        ROUND((ph.nb_reservations - sg.moy_reservations) * 100.0 / sg.moy_reservations)::numeric, 2 as ecart_performance_pct
      FROM performance_horaires ph, stats_globales sg
      ORDER BY ph.heure
    `);

    // 4. ANALYSE DE LA SATURATION DES TERRAINS
    const saturationTerrains = await db.query(`
      WITH usage_terrains AS (
        SELECT 
          nomterrain,
          typeTerrain,
          COUNT(*) as total_utilisations,
          COUNT(DISTINCT datereservation) as jours_utilises,
          COALESCE(SUM(tarif), 0) as revenu_genere,
          COUNT(DISTINCT email) as clients_uniques,
          ROUND(AVG(tarif)::numeric, 2) as tarif_moyen
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY nomterrain, typeTerrain
      ),
      capacite_theorique AS (
        SELECT 
          COUNT(*) * 3 as capacite_max_heures_jour
        FROM (
          SELECT DISTINCT datereservation 
          FROM reservation 
          WHERE statut = 'confirmée' 
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        ) dates
      )
      SELECT 
        ut.*,
        ct.capacite_max_heures_jour,
        ROUND(ut.total_utilisations * 100.0 / ct.capacite_max_heures_jour, 2)::numeric as taux_utilisation,
        ROUND(ut.revenu_genere * 100.0 / SUM(ut.revenu_genere) OVER(), 2)::numeric as part_revenu_total,
        CASE 
          WHEN ut.total_utilisations > ct.capacite_max_heures_jour * 0.8 THEN 'SATURÉ'
          WHEN ut.total_utilisations < ct.capacite_max_heures_jour * 0.3 THEN 'SOUS-UTILISÉ'
          ELSE 'ÉQUILIBRÉ'
        END as statut_utilisation
      FROM usage_terrains ut, capacite_theorique ct
      ORDER BY ut.total_utilisations DESC
    `);

    // 5. ANALYSE DES SEGMENTS DE CLIENTS
    const segmentsClients = await db.query(`
      WITH comportement_clients AS (
        SELECT 
          email,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as depense_totale,
          MIN(datereservation) as premiere_resa,
          MAX(datereservation) as derniere_resa,
          COUNT(DISTINCT nomterrain) as terrains_explores,
          ROUND(AVG(tarif)::numeric, 2) as tarif_moyen,
          MAX(datereservation) - MIN(datereservation) as duree_relation
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY email
      ),
      segmentation AS (
        SELECT 
          email,
          nb_reservations,
          depense_totale,
          duree_relation,
          terrains_explores,
          CASE 
            WHEN nb_reservations >= 10 AND depense_totale >= 500 THEN 'VIP'
            WHEN nb_reservations >= 5 AND depense_totale >= 200 THEN 'PRÉMIUM'
            WHEN nb_reservations >= 2 THEN 'RÉGULIER'
            WHEN nb_reservations = 1 THEN 'OCCASIONNEL'
            ELSE 'INACTIF'
          END as segment_comportemental
        FROM comportement_clients
      )
      SELECT 
        segment_comportemental,
        COUNT(*) as nb_clients,
        SUM(nb_reservations) as total_reservations_segment,
        SUM(depense_totale) as depense_totale_segment,
        ROUND(AVG(nb_reservations)::numeric, 2) as reservations_moyennes_client,
        ROUND(AVG(depense_totale)::numeric, 2) as depense_moyenne_client,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2)::numeric as pourcentage_clients
      FROM segmentation
      GROUP BY segment_comportemental
      ORDER BY depense_totale_segment DESC
    `);

    // 6. ANALYSE DES COHORTEMPS TEMPORELS
    const cohortesTemporelles = await db.query(`
      WITH cohortes AS (
        SELECT 
          DATE_TRUNC('week', datereservation) as semaine_cohorte,
          email,
          MIN(datereservation) as premiere_resa_semaine,
          COUNT(*) as nb_reservations_semaine
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', datereservation), email
      )
      SELECT 
        semaine_cohorte,
        COUNT(DISTINCT email) as nouveaux_clients_semaine,
        SUM(nb_reservations_semaine) as total_reservations_semaine,
        ROUND(AVG(nb_reservations_semaine)::numeric, 2) as reservations_moyennes_par_client,
        LAG(COUNT(DISTINCT email)) OVER (ORDER BY semaine_cohorte) as clients_semaine_precedente,
        ROUND(
          (COUNT(DISTINCT email) - LAG(COUNT(DISTINCT email)) OVER (ORDER BY semaine_cohorte)) * 100.0 / 
          LAG(COUNT(DISTINCT email)) OVER (ORDER BY semaine_cohorte), 2
        )::numeric as croissance_clients_pct
      FROM cohortes
      GROUP BY semaine_cohorte
      ORDER BY semaine_cohorte DESC
    `);

    res.json({
      success: true,
      periode_analyse: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        synthese_temporelle: analyseTemporelle.rows[0],
        patterns_hebdomadaires: patternsHebdomadaires.rows,
        creneaux_optimaux: creneauxOptimaux.rows,
        saturation_terrains: saturationTerrains.rows,
        segments_clients: segmentsClients.rows,
        cohortes_temporelles: cohortesTemporelles.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans analyse_profonde:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse approfondie',
      error: error.message
    });
  }
});

// 📈 Analyse des corrélations comportementales
router.get('/correlations-comportementales', async (req, res) => {
  try {
    // 1. Corrélation jour/heure/réservations
    const correlationJourHeure = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_semaine,
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as nb_reservations,
        COUNT(DISTINCT email) as nb_clients,
        COALESCE(SUM(tarif), 0) as revenu_total
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY EXTRACT(DOW FROM datereservation), EXTRACT(HOUR FROM heurereservation)
      HAVING COUNT(*) >= 3
      ORDER BY nb_reservations DESC
      LIMIT 20
    `);

    // 2. Corrélation terrain/type/réservations
    const correlationTerrainType = await db.query(`
      SELECT 
        nomterrain,
        typeTerrain,
        SurfaceTerrains,
        COUNT(*) as nb_reservations,
        COUNT(DISTINCT email) as nb_clients,
        COALESCE(SUM(tarif), 0) as revenu_total,
        ROUND(AVG(tarif)::numeric, 2) as tarif_moyen
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY nomterrain, typeTerrain, SurfaceTerrains
      ORDER BY revenu_total DESC
    `);

    // 3. Analyse des patterns de réservation par client
    const patternsReservationClients = await db.query(`
      WITH patterns_client AS (
        SELECT 
          email,
          COUNT(*) as total_reservations,
          COUNT(DISTINCT EXTRACT(DOW FROM datereservation)) as jours_differents_utilises,
          COUNT(DISTINCT EXTRACT(HOUR FROM heurereservation)) as heures_differentes_utilisees,
          COUNT(DISTINCT nomterrain) as terrains_differents_utilises,
          COALESCE(SUM(tarif), 0) as depense_totale,
          ROUND(AVG(tarif)::numeric, 2) as tarif_moyen,
          MAX(datereservation) - MIN(datereservation) as etendue_temporelle
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY email
        HAVING COUNT(*) >= 2
      )
      SELECT 
        COUNT(*) as nb_clients_actifs,
        ROUND(AVG(total_reservations)::numeric, 2) as reservations_moyennes_client,
        ROUND(AVG(jours_differents_utilises)::numeric, 2) as diversite_jours_moyenne,
        ROUND(AVG(heures_differentes_utilisees)::numeric, 2) as diversite_horaires_moyenne,
        ROUND(AVG(terrains_differents_utilises)::numeric, 2) as diversite_terrains_moyenne,
        ROUND(AVG(depense_totale)::numeric, 2) as depense_moyenne_client
      FROM patterns_client
    `);

    res.json({
      success: true,
      correlations: {
        jour_heure: correlationJourHeure.rows,
        terrain_type: correlationTerrainType.rows,
        patterns_clients: patternsReservationClients.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans correlations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des corrélations',
      error: error.message
    });
  }
});

// 🔍 Analyse des anomalies et outliers
router.get('/detection-anomalies', async (req, res) => {
  try {
    // 1. Jours avec activité anormalement élevée ou faible
    const anomaliesJournalieres = await db.query(`
      WITH stats_journalieres AS (
        SELECT 
          datereservation,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as revenu_total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY datereservation
      ),
      stats_globales AS (
        SELECT 
          AVG(nb_reservations) as moy_reservations,
          STDDEV(nb_reservations) as ecart_reservations,
          AVG(revenu_total) as moy_revenus,
          STDDEV(revenu_total) as ecart_revenus
        FROM stats_journalieres
      )
      SELECT 
        sj.datereservation,
        sj.nb_reservations,
        sg.moy_reservations,
        CASE 
          WHEN sj.nb_reservations > sg.moy_reservations + 2 * sg.ecart_reservations THEN 'PIC ACTIVITÉ'
          WHEN sj.nb_reservations < sg.moy_reservations - 2 * sg.ecart_reservations THEN 'CREUX ACTIVITÉ'
          ELSE 'NORMAL'
        END as anomalie_reservations,
        sj.revenu_total,
        sg.moy_revenus,
        CASE 
          WHEN sj.revenu_total > sg.moy_revenus + 2 * sg.ecart_revenus THEN 'PIC REVENUS'
          WHEN sj.revenu_total < sg.moy_revenus - 2 * sg.ecart_revenus THEN 'CREUX REVENUS'
          ELSE 'NORMAL'
        END as anomalie_revenus
      FROM stats_journalieres sj, stats_globales sg
      WHERE sj.nb_reservations > sg.moy_reservations + 2 * sg.ecart_reservations
         OR sj.nb_reservations < sg.moy_reservations - 2 * sg.ecart_reservations
         OR sj.revenu_total > sg.moy_revenus + 2 * sg.ecart_revenus
         OR sj.revenu_total < sg.moy_revenus - 2 * sg.ecart_revenus
      ORDER BY sj.datereservation DESC
    `);

    // 2. Clients avec comportement anormal
    const anomaliesClients = await db.query(`
      WITH comportement_client AS (
        SELECT 
          email,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as depense_totale,
          ROUND(AVG(tarif)::numeric, 2) as tarif_moyen
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY email
      ),
      stats_clients AS (
        SELECT 
          AVG(nb_reservations) as moy_reservations,
          STDDEV(nb_reservations) as ecart_reservations,
          AVG(depense_totale) as moy_depense,
          STDDEV(depense_totale) as ecart_depense
        FROM comportement_client
      )
      SELECT 
        cc.email,
        cc.nb_reservations,
        sc.moy_reservations,
        CASE 
          WHEN cc.nb_reservations > sc.moy_reservations + 2 * sc.ecart_reservations THEN 'SUPER-UTILISATEUR'
          WHEN cc.nb_reservations < sc.moy_reservations - 2 * sc.ecart_reservations THEN 'UTILISATEUR MINIMAL'
          ELSE 'NORMAL'
        END as anomalie_frequence,
        cc.depense_totale,
        sc.moy_depense,
        CASE 
          WHEN cc.depense_totale > sc.moy_depense + 2 * sc.ecart_depense THEN 'GROS DÉPENSIER'
          WHEN cc.depense_totale < sc.moy_depense - 2 * sc.ecart_depense THEN 'FAIBLE DÉPENSIER'
          ELSE 'NORMAL'
        END as anomalie_depense
      FROM comportement_client cc, stats_clients sc
      WHERE cc.nb_reservations > sc.moy_reservations + 2 * sc.ecart_reservations
         OR cc.nb_reservations < sc.moy_reservations - 2 * sc.ecart_reservations
         OR cc.depense_totale > sc.moy_depense + 2 * sc.ecart_depense
         OR cc.depense_totale < sc.moy_depense - 2 * sc.ecart_depense
      ORDER BY cc.depense_totale DESC
      LIMIT 15
    `);

    res.json({
      success: true,
      anomalies: {
        journalieres: anomaliesJournalieres.rows,
        clients: anomaliesClients.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans detection_anomalies:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la détection d\'anomalies',
      error: error.message
    });
  }
});

export default router;
