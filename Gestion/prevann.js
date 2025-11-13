// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (ANNULATIONS)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Récupérer les statistiques d'annulation en parallèle
    const [
      revenusPerdusMois,
      annulationsMois,
      terrainsAffectes,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee
    ] = await Promise.all([
      // Revenus perdus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Annulations du mois
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Terrains affectés par les annulations ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_affectes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation moyen du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui,
          ROUND(
            (COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END), 0)
            ), 2
          ) as taux_annulation_aujourdhui
        FROM reservation
      `),
      
      // Revenus perdus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      terrains_affectes: parseInt(terrainsAffectes.rows[0]?.terrains_affectes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel.rows[0]?.total_aujourdhui || 0),
      taux_annulation_aujourdhui: parseFloat(statsTempsReel.rows[0]?.taux_annulation_aujourdhui || 0),
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee.rows[0]?.revenus_perdus_annee || 0)
    };

    // Calcul des trends d'annulation
    const trends = await calculateAnnulationTrends(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Évolution des annulations sur 12 mois
router.get('/evolution-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      WITH mois_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '11 months',
          CURRENT_DATE,
          '1 month'::interval
        )::date as mois
      )
      SELECT 
        TO_CHAR(ms.mois, 'YYYY-MM') as periode,
        TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations,
        COUNT(r.numeroreservations) as total_reservations,
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(r.numeroreservations), 0)
          ), 2
        ) as taux_annulation_mensuel
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur évolution annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Analyse des terrains les plus affectés par les annulations
router.get('/terrains-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_total,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_total,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_terrain,
        -- Période avec le plus d'annulations
        (
          SELECT TO_CHAR(datereservation, 'YYYY-MM')
          FROM reservation r2 
          WHERE r2.numeroterrain = reservation.numeroterrain 
          AND r2.statut = 'annulée'
          GROUP BY TO_CHAR(datereservation, 'YYYY-MM')
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) as periode_max_annulations
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY numeroterrain, nomterrain, typeterrain
      HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      ORDER BY annulations_total DESC, taux_annulation_terrain DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse terrains annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📅 Analyse temporelle des annulations
router.get('/analyse-temporelle-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH stats_journalieres AS (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as num_jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(*) as total_reservations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY datereservation
      )
      SELECT 
        jour_semaine,
        num_jour_semaine,
        ROUND(AVG(annulations), 2) as annulations_moyennes,
        ROUND(AVG(confirmations), 2) as confirmations_moyennes,
        ROUND(AVG(total_reservations), 2) as reservations_moyennes,
        ROUND(AVG(revenus_perdus), 2) as revenus_perdus_moyens,
        ROUND(
          (SUM(annulations) * 100.0 / NULLIF(SUM(total_reservations), 0)
          ), 2
        ) as taux_annulation_jour,
        SUM(annulations) as annulations_total,
        SUM(confirmations) as confirmations_total
      FROM stats_journalieres
      GROUP BY jour_semaine, num_jour_semaine
      ORDER BY num_jour_semaine
    `);

    // Statistiques globales de la période
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as total_revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_global
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
    `);

    res.json({
      success: true,
      data: {
        analyse_journaliere: result.rows,
        statistiques_globales: statsGlobales.rows[0],
        periode_analyse: parseInt(periode)
      }
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

// 🔮 PRÉVISIONS AMÉLIORÉES - Analyse par semaine, jour et mois
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    // 1. Prévisions quotidiennes détaillées
    const previsionsQuotidiennes = await db.query(`
      WITH dates_futures AS (
        SELECT generate_series(
          CURRENT_DATE,
          CURRENT_DATE + INTERVAL '${periode} days',
          '1 day'::interval
        )::date as date_future
      )
      SELECT 
        df.date_future,
        TO_CHAR(df.date_future, 'YYYY-MM-DD') as date_iso,
        TO_CHAR(df.date_future, 'DD/MM') as date_courte,
        TO_CHAR(df.date_future, 'Day') as jour_semaine,
        EXTRACT(DOW FROM df.date_future) as num_jour_semaine,
        EXTRACT(WEEK FROM df.date_future) as semaine_annee,
        EXTRACT(MONTH FROM df.date_future) as mois,
        
        -- Réservations confirmées pour cette date
        COUNT(r.numeroreservations) as reservations_confirmees,
        COALESCE(SUM(r.tarif), 0) as revenu_attendu,
        
        -- Statistiques historiques pour ce jour de la semaine
        (
          SELECT COUNT(*) 
          FROM reservation rh 
          WHERE EXTRACT(DOW FROM rh.datereservation) = EXTRACT(DOW FROM df.date_future)
          AND rh.statut = 'annulée'
          AND rh.datereservation >= CURRENT_DATE - INTERVAL '90 days'
        ) as annulations_historiques_jour,
        
        -- Taux d'annulation historique pour ce jour
        (
          SELECT ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          )
          FROM reservation rh 
          WHERE EXTRACT(DOW FROM rh.datereservation) = EXTRACT(DOW FROM df.date_future)
          AND rh.datereservation >= CURRENT_DATE - INTERVAL '90 days'
        ) as taux_annulation_historique_jour,
        
        -- Nombre moyen d'annulations pour ce jour
        (
          SELECT ROUND(AVG(annulations_jour), 2)
          FROM (
            SELECT COUNT(*) as annulations_jour
            FROM reservation rh 
            WHERE EXTRACT(DOW FROM rh.datereservation) = EXTRACT(DOW FROM df.date_future)
            AND rh.statut = 'annulée'
            AND rh.datereservation >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY rh.datereservation
          ) stats
        ) as annulations_moyennes_jour
        
      FROM dates_futures df
      LEFT JOIN reservation r ON r.datereservation = df.date_future AND r.statut = 'confirmée'
      GROUP BY df.date_future
      ORDER BY df.date_future ASC
    `);

    // 2. Prévisions hebdomadaires
    const previsionsHebdomadaires = await db.query(`
      WITH semaines_futures AS (
        SELECT 
          EXTRACT(WEEK FROM generate_series) as semaine,
          EXTRACT(YEAR FROM generate_series) as annee,
          MIN(generate_series) as date_debut_semaine,
          MAX(generate_series) as date_fin_semaine
        FROM generate_series(
          CURRENT_DATE,
          CURRENT_DATE + INTERVAL '${periode} days',
          '1 day'::interval
        ) generate_series
        GROUP BY EXTRACT(WEEK FROM generate_series), EXTRACT(YEAR FROM generate_series)
      )
      SELECT 
        sf.semaine,
        sf.annee,
        TO_CHAR(sf.date_debut_semaine, 'DD/MM') || ' - ' || TO_CHAR(sf.date_fin_semaine, 'DD/MM') as periode_semaine,
        
        -- Réservations de la semaine
        COUNT(r.numeroreservations) as reservations_confirmees,
        COALESCE(SUM(r.tarif), 0) as revenu_attendu_semaine,
        
        -- Prévisions d'annulations basées sur l'historique
        (
          SELECT ROUND(AVG(annulations_semaine), 2)
          FROM (
            SELECT COUNT(*) as annulations_semaine
            FROM reservation rh 
            WHERE EXTRACT(WEEK FROM rh.datereservation) = sf.semaine
            AND EXTRACT(YEAR FROM rh.datereservation) = sf.annee - 1
            AND rh.statut = 'annulée'
            GROUP BY EXTRACT(WEEK FROM rh.datereservation), EXTRACT(YEAR FROM rh.datereservation)
          ) stats
        ) as annulations_prevues_semaine,
        
        -- Taux d'annulation historique pour cette semaine
        (
          SELECT ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          )
          FROM reservation rh 
          WHERE EXTRACT(WEEK FROM rh.datereservation) = sf.semaine
          AND EXTRACT(YEAR FROM rh.datereservation) = sf.annee - 1
        ) as taux_annulation_historique_semaine

      FROM semaines_futures sf
      LEFT JOIN reservation r ON r.datereservation BETWEEN sf.date_debut_semaine AND sf.date_fin_semaine 
        AND r.statut = 'confirmée'
      GROUP BY sf.semaine, sf.annee, sf.date_debut_semaine, sf.date_fin_semaine
      ORDER BY sf.annee, sf.semaine
    `);

    // 3. Prévisions mensuelles
    const previsionsMensuelles = await db.query(`
      WITH mois_futurs AS (
        SELECT 
          EXTRACT(MONTH FROM generate_series) as mois,
          EXTRACT(YEAR FROM generate_series) as annee,
          TO_CHAR(generate_series, 'Mon YYYY') as periode_mois
        FROM generate_series(
          CURRENT_DATE,
          CURRENT_DATE + INTERVAL '${periode} days',
          '1 month'::interval
        ) generate_series
        GROUP BY EXTRACT(MONTH FROM generate_series), EXTRACT(YEAR FROM generate_series), TO_CHAR(generate_series, 'Mon YYYY')
      )
      SELECT 
        mf.mois,
        mf.annee,
        mf.periode_mois,
        
        -- Réservations du mois
        COUNT(r.numeroreservations) as reservations_confirmees,
        COALESCE(SUM(r.tarif), 0) as revenu_attendu_mois,
        
        -- Prévisions d'annulations basées sur l'historique
        (
          SELECT COUNT(*)
          FROM reservation rh 
          WHERE EXTRACT(MONTH FROM rh.datereservation) = mf.mois
          AND EXTRACT(YEAR FROM rh.datereservation) = mf.annee - 1
          AND rh.statut = 'annulée'
        ) as annulations_prevues_mois,
        
        -- Taux d'annulation historique pour ce mois
        (
          SELECT ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          )
          FROM reservation rh 
          WHERE EXTRACT(MONTH FROM rh.datereservation) = mf.mois
          AND EXTRACT(YEAR FROM rh.datereservation) = mf.annee - 1
        ) as taux_annulation_historique_mois,
        
        -- Revenus à risque pour ce mois
        COALESCE(SUM(r.tarif), 0) * 
        COALESCE((
          SELECT ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) / 100
          FROM reservation rh 
          WHERE EXTRACT(MONTH FROM rh.datereservation) = mf.mois
          AND EXTRACT(YEAR FROM rh.datereservation) = mf.annee - 1
        ), 0.1) as revenus_risque_mois

      FROM mois_futurs mf
      LEFT JOIN reservation r ON 
        EXTRACT(MONTH FROM r.datereservation) = mf.mois 
        AND EXTRACT(YEAR FROM r.datereservation) = mf.annee
        AND r.statut = 'confirmée'
      GROUP BY mf.mois, mf.annee, mf.periode_mois
      ORDER BY mf.annee, mf.mois
    `);

    // 4. Statistiques globales de prévision
    const statsGlobalesPrevisions = await db.query(`
      WITH historique_recent AS (
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_90j,
          COUNT(*) as total_reservations_90j,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_90j,
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes_jour
        FROM (
          SELECT 
            datereservation,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_jour
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY datereservation
        ) stats_jour
      ),
      reservations_futures AS (
        SELECT 
          COUNT(*) as reservations_prevues_total,
          COALESCE(SUM(tarif), 0) as revenus_prevus_total
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      )
      SELECT 
        hr.taux_annulation_90j as taux_annulation_moyen,
        hr.annulations_moyennes_jour,
        rf.reservations_prevues_total,
        rf.revenus_prevus_total,
        
        -- Prévisions globales
        ROUND(hr.annulations_moyennes_jour * ${periode}) as annulations_prevues_total,
        ROUND(rf.revenus_prevus_total * (hr.taux_annulation_90j / 100)) as revenus_risque_total,
        
        -- Niveaux d'alerte
        CASE 
          WHEN hr.taux_annulation_90j > 20 THEN 'Élevé'
          WHEN hr.taux_annulation_90j > 10 THEN 'Modéré'
          ELSE 'Faible'
        END as niveau_risque_global,
        
        -- Jours à haut risque
        (
          SELECT COUNT(*)
          FROM (
            SELECT DISTINCT EXTRACT(DOW FROM datereservation) as jour_semaine
            FROM reservation 
            WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY EXTRACT(DOW FROM datereservation)
            HAVING COUNT(*) > (
              SELECT AVG(annulations_jour_semaine)
              FROM (
                SELECT COUNT(*) as annulations_jour_semaine
                FROM reservation 
                WHERE statut = 'annulée'
                AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
                GROUP BY EXTRACT(DOW FROM datereservation)
              ) stats_jours
            )
          ) jours_risque
        ) as jours_haut_risque_semaine

      FROM historique_recent hr, reservations_futures rf
    `);

    res.json({
      success: true,
      data: {
        // Données détaillées par période
        previsions_quotidiennes: previsionsQuotidiennes.rows,
        previsions_hebdomadaires: previsionsHebdomadaires.rows,
        previsions_mensuelles: previsionsMensuelles.rows,
        
        // Statistiques globales
        statistiques_globales: statsGlobalesPrevisions.rows[0],
        
        // Métriques résumées pour le dashboard
        resume_previsions: {
          periode_jours: parseInt(periode),
          reservations_prevues: statsGlobalesPrevisions.rows[0]?.reservations_prevues_total || 0,
          annulations_prevues: statsGlobalesPrevisions.rows[0]?.annulations_prevues_total || 0,
          revenus_prevus: statsGlobalesPrevisions.rows[0]?.revenus_prevus_total || 0,
          revenus_risque: statsGlobalesPrevisions.rows[0]?.revenus_risque_total || 0,
          taux_annulation_moyen: statsGlobalesPrevisions.rows[0]?.taux_annulation_moyen || 0,
          niveau_risque: statsGlobalesPrevisions.rows[0]?.niveau_risque_global || 'Faible',
          jours_analyse: previsionsQuotidiennes.rows.length,
          semaines_analyse: previsionsHebdomadaires.rows.length,
          mois_analyse: previsionsMensuelles.rows.length
        },
        
        // Dernière mise à jour
        derniere_maj: new Date().toISOString(),
        periode_analyse: parseInt(periode)
      }
    });
  } catch (error) {
    console.error('❌ Erreur prévisions annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Tableau de bord complet annulations
router.get('/synthese-annulations', async (req, res) => {
  try {
    const [
      statsMois,
      topTerrains,
      evolutionMensuelle,
      analyseRecent
    ] = await Promise.all([
      // Statistiques du mois actuel
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_mois,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_mois
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Top 5 terrains avec le plus d'annulations
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '3 months'
        GROUP BY numeroterrain, nomterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations DESC
        LIMIT 5
      `),
      
      // Évolution sur 6 mois
      db.query(`
        WITH mois_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '5 months',
            CURRENT_DATE,
            '1 month'::interval
          )::date as mois
        )
        SELECT 
          TO_CHAR(ms.mois, 'Mon YYYY') as periode,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `),
      
      // Analyse des 7 derniers jours
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'DD/MM') as date_jour,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    res.json({
      success: true,
      data: {
        stats_mois: statsMois.rows[0],
        top_terrains_annulations: topTerrains.rows,
        evolution_6_mois: evolutionMensuelle.rows,
        analyse_7_jours: analyseRecent.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur synthèse annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔍 NOUVELLE ROUTE: Prévisions détaillées pour l'occupation (pour le composant React)
router.get('/previsions/detaillees', async (req, res) => {
  try {
    const { jours = '14' } = req.query;
    const joursInt = parseInt(jours);

    console.log(`📊 Chargement des prévisions détaillées pour ${joursInt} jours...`);

    const result = await db.query(`
      WITH dates_futures AS (
        SELECT 
          generate_series(
            CURRENT_DATE + INTERVAL '1 day',
            CURRENT_DATE + INTERVAL '${joursInt} days',
            '1 day'::interval
          )::date as datereservation
      ),
      reservations_confirmees AS (
        SELECT 
          r.datereservation,
          COUNT(r.numeroreservations) as nb_reservations,
          COUNT(DISTINCT r.numeroterrain) as nb_terrains,
          COALESCE(SUM(r.tarif), 0) as revenu_attendu,
          STRING_AGG(DISTINCT r.typeterrain, ', ') as types_terrains
        FROM reservation r
        WHERE r.statut = 'confirmée'
          AND r.datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${joursInt} days'
        GROUP BY r.datereservation
      ),
      stats_terrains AS (
        SELECT COUNT(DISTINCT numeroterrain) as total_terrains
        FROM terrain
        WHERE statut = 'actif'
      )
      SELECT 
        df.datereservation,
        TO_CHAR(df.datereservation, 'YYYY-MM-DD') as date_iso,
        TO_CHAR(df.datereservation, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(df.datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM df.datereservation) as num_jour_semaine,
        
        COALESCE(rc.nb_reservations, 0) as nb_reservations,
        COALESCE(rc.nb_terrains, 0) as nb_terrains,
        COALESCE(rc.revenu_attendu, 0) as revenu_attendu,
        COALESCE(rc.types_terrains, 'Aucune réservation') as types_terrains,
        
        -- Calcul du pourcentage d'occupation RÉEL
        CASE 
          WHEN COALESCE(rc.nb_terrains, 0) > 0 THEN
            ROUND(
              (COALESCE(rc.nb_reservations, 0) * 100.0 / 
              (rc.nb_terrains * 8) -- 8 réservations max par terrain par jour
              ), 1
            )
          ELSE 0
        END as pourcentage_occupation,
        
        st.total_terrains as total_terrains_disponibles,
        
        -- Niveau d'occupation
        CASE 
          WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 80 THEN 'Élevée'
          WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 60 THEN 'Moyenne+'
          WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 40 THEN 'Moyenne'
          ELSE 'Faible'
        END as niveau_occupation,
        
        -- Prévisions d'annulations basées sur l'historique
        (
          SELECT ROUND(AVG(annulations_jour), 1)
          FROM (
            SELECT COUNT(*) as annulations_jour
            FROM reservation rh 
            WHERE EXTRACT(DOW FROM rh.datereservation) = EXTRACT(DOW FROM df.datereservation)
            AND rh.statut = 'annulée'
            AND rh.datereservation >= CURRENT_DATE - INTERVAL '60 days'
            GROUP BY rh.datereservation
          ) stats
        ) as annulations_prevues

      FROM dates_futures df
      LEFT JOIN reservations_confirmees rc ON rc.datereservation = df.datereservation
      CROSS JOIN stats_terrains st
      ORDER BY df.datereservation ASC
    `);

    // Statistiques globales pour la période
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(*) as total_jours_analyse,
        SUM(nb_reservations) as total_reservations_prevues,
        SUM(revenu_attendu) as total_revenu_prevue,
        ROUND(AVG(pourcentage_occupation), 1) as occupation_moyenne_prevue,
        COUNT(CASE WHEN niveau_occupation = 'Élevée' THEN 1 END) as jours_forte_occupation,
        COUNT(CASE WHEN niveau_occupation = 'Faible' THEN 1 END) as jours_faible_occupation
      FROM (
        SELECT 
          COALESCE(rc.nb_reservations, 0) as nb_reservations,
          COALESCE(rc.revenu_attendu, 0) as revenu_attendu,
          CASE 
            WHEN COALESCE(rc.nb_terrains, 0) > 0 THEN
              ROUND(
                (COALESCE(rc.nb_reservations, 0) * 100.0 / 
                (rc.nb_terrains * 8)
                ), 1
              )
            ELSE 0
          END as pourcentage_occupation,
          CASE 
            WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 80 THEN 'Élevée'
            WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 60 THEN 'Moyenne+'
            WHEN (COALESCE(rc.nb_reservations, 0) * 100.0 / NULLIF((rc.nb_terrains * 8), 0)) >= 40 THEN 'Moyenne'
            ELSE 'Faible'
          END as niveau_occupation
        FROM generate_series(
          CURRENT_DATE + INTERVAL '1 day',
          CURRENT_DATE + INTERVAL '${joursInt} days',
          '1 day'::interval
        )::date as date_futur
        LEFT JOIN reservation rc ON rc.datereservation = date_futur AND rc.statut = 'confirmée'
      ) previsions
    `);

    console.log(`✅ ${result.rows.length} jours de prévisions chargés`);

    res.json({
      success: true,
      data: result.rows,
      statistiques: statsGlobales.rows[0],
      metadata: {
        periode_jours: joursInt,
        date_debut: result.rows[0]?.date_formattee,
        date_fin: result.rows[result.rows.length - 1]?.date_formattee,
        derniere_maj: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions détaillées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement des prévisions',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends d'annulation
async function calculateAnnulationTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois_dernier,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois_dernier
      FROM reservation 
      WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier // Moins d'annulations = positif
      },
      revenus_perdus: {
        value: calculatePercentageChange(currentStats.revenus_perdus_mois, lastMonth.revenus_perdus_mois_dernier),
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier // Moins de revenus perdus = positif
      },
      taux_annulation: {
        value: calculatePercentageChange(currentStats.taux_annulation, 
          (lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui)) || 0),
        isPositive: currentStats.taux_annulation < ((lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui)) || 0)
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;