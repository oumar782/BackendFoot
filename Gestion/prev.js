// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 🔮 PRÉVISIONS D'ANNULATIONS - Version corrigée et simplifiée
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    const periodeInt = parseInt(periode);

    console.log(`📊 Chargement des prévisions d'annulations pour ${periodeInt} jours...`);

    // 1. Prévisions quotidiennes détaillées avec pertes estimées
    const previsionsQuotidiennes = await db.query(`
      WITH dates_futures AS (
        SELECT generate_series(
          CURRENT_DATE + INTERVAL '1 day',
          CURRENT_DATE + INTERVAL '${periodeInt} days',
          '1 day'::interval
        )::date as date_future
      ),
      reservations_confirmees AS (
        SELECT 
          datereservation,
          COUNT(*) as reservations_confirmees,
          COALESCE(SUM(tarif), 0) as revenu_attendu,
          STRING_AGG(DISTINCT numeroterrain::text, ', ') as terrains_reserves
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        GROUP BY datereservation
      ),
      stats_annulations_historiques AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as annulations_total,
          COUNT(DISTINCT datereservation) as jours_avec_annulations,
          ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT datereservation), 2) as annulations_moyennes_par_jour,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation r2 
               WHERE EXTRACT(DOW FROM r2.datereservation) = EXTRACT(DOW FROM reservation.datereservation)
               AND r2.datereservation >= CURRENT_DATE - INTERVAL '90 days'), 0)
            ), 2
          ) as taux_annulation_historique
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      )
      SELECT 
        df.date_future,
        TO_CHAR(df.date_future, 'YYYY-MM-DD') as date_iso,
        TO_CHAR(df.date_future, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(df.date_future, 'Day') as jour_semaine,
        EXTRACT(DOW FROM df.date_future) as num_jour_semaine,
        
        -- Réservations confirmées pour cette date
        COALESCE(rc.reservations_confirmees, 0) as reservations_confirmees,
        COALESCE(rc.revenu_attendu, 0) as revenu_attendu,
        COALESCE(rc.terrains_reserves, 'Aucun') as terrains_reserves,
        
        -- Prévisions d'annulations basées sur l'historique du même jour de semaine
        COALESCE(sah.annulations_moyennes_par_jour, 0) as annulations_prevues,
        COALESCE(sah.taux_annulation_historique, 0) as taux_annulation_prevue,
        
        -- Pertes financières estimées
        ROUND(
          COALESCE(rc.revenu_attendu, 0) * 
          COALESCE(sah.taux_annulation_historique, 0) / 100, 
          2
        ) as pertes_estimees,
        
        -- Niveau de risque
        CASE 
          WHEN COALESCE(sah.taux_annulation_historique, 0) > 20 THEN 'Élevé'
          WHEN COALESCE(sah.taux_annulation_historique, 0) > 10 THEN 'Moyen'
          ELSE 'Faible'
        END as niveau_risque,
        
        -- Impact sur l'occupation
        CASE 
          WHEN COALESCE(rc.reservations_confirmees, 0) > 0 THEN
            ROUND(
              (COALESCE(sah.annulations_moyennes_par_jour, 0) * 100.0 / 
              COALESCE(rc.reservations_confirmees, 1)
            ), 1)
          ELSE 0
        END as impact_occupation_percent

      FROM dates_futures df
      LEFT JOIN reservations_confirmees rc ON rc.datereservation = df.date_future
      LEFT JOIN stats_annulations_historiques sah ON sah.jour_semaine = EXTRACT(DOW FROM df.date_future)
      ORDER BY df.date_future ASC
    `);

    // 2. Prévisions mensuelles agrégées
    const previsionsMensuelles = await db.query(`
      WITH mois_futurs AS (
        SELECT 
          EXTRACT(MONTH FROM generate_series) as mois,
          EXTRACT(YEAR FROM generate_series) as annee,
          TO_CHAR(generate_series, 'Mon YYYY') as periode_mois,
          MIN(generate_series) as date_debut_mois,
          MAX(generate_series) as date_fin_mois
        FROM generate_series(
          CURRENT_DATE + INTERVAL '1 day',
          CURRENT_DATE + INTERVAL '${periodeInt} days',
          '1 month'::interval
        ) generate_series
        GROUP BY EXTRACT(MONTH FROM generate_series), EXTRACT(YEAR FROM generate_series), TO_CHAR(generate_series, 'Mon YYYY')
      ),
      reservations_par_mois AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          EXTRACT(YEAR FROM datereservation) as annee,
          COUNT(*) as reservations_confirmees,
          COALESCE(SUM(tarif), 0) as revenu_attendu_mois
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        GROUP BY EXTRACT(MONTH FROM datereservation), EXTRACT(YEAR FROM datereservation)
      ),
      stats_annulations_mensuelles AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          COUNT(*) as annulations_mois_historique,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation r2 
               WHERE EXTRACT(MONTH FROM r2.datereservation) = EXTRACT(MONTH FROM reservation.datereservation)
               AND r2.datereservation >= CURRENT_DATE - INTERVAL '12 months'), 0)
            ), 2
          ) as taux_annulation_mensuel_historique
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY EXTRACT(MONTH FROM datereservation)
      )
      SELECT 
        mf.mois,
        mf.annee,
        mf.periode_mois,
        mf.date_debut_mois,
        mf.date_fin_mois,
        
        -- Réservations du mois
        COALESCE(rpm.reservations_confirmees, 0) as reservations_confirmees,
        COALESCE(rpm.revenu_attendu_mois, 0) as revenu_attendu_mois,
        
        -- Prévisions d'annulations basées sur l'historique mensuel
        COALESCE(sam.annulations_mois_historique, 0) as annulations_prevues_mois,
        COALESCE(sam.taux_annulation_mensuel_historique, 0) as taux_annulation_prevue_mois,
        
        -- Pertes financières estimées pour le mois
        ROUND(
          COALESCE(rpm.revenu_attendu_mois, 0) * 
          COALESCE(sam.taux_annulation_mensuel_historique, 0) / 100, 
          2
        ) as pertes_estimees_mois,
        
        -- Réservations à risque (celles qui pourraient être annulées)
        ROUND(
          COALESCE(rpm.reservations_confirmees, 0) * 
          COALESCE(sam.taux_annulation_mensuel_historique, 0) / 100
        ) as reservations_a_risque,
        
        -- Niveau de risque mensuel
        CASE 
          WHEN COALESCE(sam.taux_annulation_mensuel_historique, 0) > 20 THEN 'Élevé'
          WHEN COALESCE(sam.taux_annulation_mensuel_historique, 0) > 10 THEN 'Moyen'
          ELSE 'Faible'
        END as niveau_risque_mois

      FROM mois_futurs mf
      LEFT JOIN reservations_par_mois rpm ON rpm.mois = mf.mois AND rpm.annee = mf.annee
      LEFT JOIN stats_annulations_mensuelles sam ON sam.mois = mf.mois
      ORDER BY mf.annee, mf.mois
    `);

    // 3. Statistiques globales des prévisions
    const statsGlobales = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          COUNT(*) as total_reservations_prevues,
          COALESCE(SUM(tarif), 0) as total_revenu_attendu,
          COUNT(DISTINCT datereservation) as jours_avec_reservations
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${periodeInt} days'
      ),
      historique_annulations AS (
        SELECT 
          ROUND(AVG(annulations_par_jour), 2) as annulations_moyennes_par_jour,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation 
               WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'), 0)
            ), 2
          ) as taux_annulation_moyen,
          COUNT(DISTINCT datereservation) as jours_avec_annulations,
          COUNT(*) as total_annulations_90j
        FROM (
          SELECT 
            datereservation,
            COUNT(*) as annulations_par_jour
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY datereservation
        ) stats_jour
      )
      SELECT 
        rf.total_reservations_prevues,
        rf.total_revenu_attendu,
        rf.jours_avec_reservations,
        ha.annulations_moyennes_par_jour,
        ha.taux_annulation_moyen,
        ha.total_annulations_90j,
        
        -- Prévisions globales
        ROUND(ha.annulations_moyennes_par_jour * ${periodeInt}) as annulations_prevues_total,
        ROUND(rf.total_revenu_attendu * (ha.taux_annulation_moyen / 100)) as pertes_totales_estimees,
        
        -- Métriques de risque
        CASE 
          WHEN ha.taux_annulation_moyen > 20 THEN 'Élevé'
          WHEN ha.taux_annulation_moyen > 10 THEN 'Moyen'
          ELSE 'Faible'
        END as niveau_risque_global,
        
        -- Jours à haut risque dans la période
        (
          SELECT COUNT(*)
          FROM (
            SELECT DISTINCT EXTRACT(DOW FROM df.date_future) as jour_semaine
            FROM generate_series(
              CURRENT_DATE + INTERVAL '1 day',
              CURRENT_DATE + INTERVAL '${periodeInt} days',
              '1 day'::interval
            )::date as date_future
            WHERE EXTRACT(DOW FROM df.date_future) IN (
              SELECT jour_semaine
              FROM (
                SELECT 
                  EXTRACT(DOW FROM datereservation) as jour_semaine,
                  COUNT(*) as annulations
                FROM reservation 
                WHERE statut = 'annulée'
                  AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
                GROUP BY EXTRACT(DOW FROM datereservation)
                HAVING COUNT(*) > (
                  SELECT AVG(annulations_par_jour_semaine)
                  FROM (
                    SELECT COUNT(*) as annulations_par_jour_semaine
                    FROM reservation 
                    WHERE statut = 'annulée'
                      AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
                    GROUP BY EXTRACT(DOW FROM datereservation)
                  ) stats
                )
              ) jours_risque
            )
          ) jours_risque_periode
        ) as jours_haut_risque

      FROM reservations_futures rf, historique_annulations ha
    `);

    // 4. Résumé pour le dashboard
    const resumePrevisions = {
      periode_jours: periodeInt,
      total_reservations_prevues: statsGlobales.rows[0]?.total_reservations_prevues || 0,
      total_revenu_attendu: statsGlobales.rows[0]?.total_revenu_attendu || 0,
      annulations_prevues_total: statsGlobales.rows[0]?.annulations_prevues_total || 0,
      pertes_totales_estimees: statsGlobales.rows[0]?.pertes_totales_estimees || 0,
      taux_annulation_moyen: statsGlobales.rows[0]?.taux_annulation_moyen || 0,
      niveau_risque_global: statsGlobales.rows[0]?.niveau_risque_global || 'Faible',
      jours_analyse: previsionsQuotidiennes.rows.length,
      mois_analyse: previsionsMensuelles.rows.length,
      jours_haut_risque: statsGlobales.rows[0]?.jours_haut_risque || 0
    };

    res.json({
      success: true,
      data: {
        // Données détaillées
        previsions_quotidiennes: previsionsQuotidiennes.rows,
        previsions_mensuelles: previsionsMensuelles.rows,
        
        // Statistiques globales
        statistiques_globales: statsGlobales.rows[0],
        
        // Résumé pour affichage dashboard
        resume_previsions: resumePrevisions,
        
        // Métadonnées
        derniere_maj: new Date().toISOString(),
        periode_analyse: periodeInt
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des prévisions d\'annulations',
      error: error.message
    });
  }
});

// 📊 PRÉVISIONS SIMPLIFIÉES POUR LE DASHBOARD
router.get('/previsions-annulations-simplifiees', async (req, res) => {
  try {
    const { jours = '7' } = req.query;
    
    const result = await db.query(`
      WITH dates_prochaines AS (
        SELECT generate_series(
          CURRENT_DATE + INTERVAL '1 day',
          CURRENT_DATE + INTERVAL '${jours} days',
          '1 day'::interval
        )::date as date_future
      ),
      reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as revenu_attendu,
          STRING_AGG(DISTINCT numeroterrain::text, ', ') as terrains
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${jours} days'
        GROUP BY datereservation
      ),
      historique_annulations AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          ROUND(AVG(nb_annulations), 2) as annulations_moyennes,
          ROUND(AVG(pertes_jour), 2) as pertes_moyennes
        FROM (
          SELECT 
            datereservation,
            EXTRACT(DOW FROM datereservation) as jour_semaine,
            COUNT(*) as nb_annulations,
            COALESCE(SUM(tarif), 0) as pertes_jour
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY datereservation
        ) stats
        GROUP BY EXTRACT(DOW FROM datereservation)
      )
      SELECT 
        df.date_future as date,
        TO_CHAR(df.date_future, 'DD/MM') as date_courte,
        TO_CHAR(df.date_future, 'Day') as jour,
        
        COALESCE(rf.nb_reservations, 0) as reservations_prevues,
        COALESCE(rf.revenu_attendu, 0) as revenu_attendu,
        COALESCE(rf.terrains, 'Aucun') as terrains_concernes,
        
        COALESCE(ha.annulations_moyennes, 0) as annulations_prevues,
        COALESCE(ha.pertes_moyennes, 0) as pertes_prevues,
        
        CASE 
          WHEN COALESCE(ha.annulations_moyennes, 0) > 3 THEN 'Élevé'
          WHEN COALESCE(ha.annulations_moyennes, 0) > 1 THEN 'Moyen'
          ELSE 'Faible'
        END as risque_annulations

      FROM dates_prochaines df
      LEFT JOIN reservations_futures rf ON rf.datereservation = df.date_future
      LEFT JOIN historique_annulations ha ON ha.jour_semaine = EXTRACT(DOW FROM df.date_future)
      ORDER BY df.date_future ASC
    `);

    // Calcul des totaux
    const totaux = {
      total_reservations: result.rows.reduce((sum, row) => sum + row.reservations_prevues, 0),
      total_revenu: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_attendu), 0),
      total_annulations_prevues: result.rows.reduce((sum, row) => sum + parseFloat(row.annulations_prevues), 0),
      total_pertes_prevues: result.rows.reduce((sum, row) => sum + parseFloat(row.pertes_prevues), 0),
      jours_risque_eleve: result.rows.filter(row => row.risque_annulations === 'Élevé').length
    };

    res.json({
      success: true,
      data: result.rows,
      totaux: totaux,
      periode: parseInt(jours)
    });

  } catch (error) {
    console.error('❌ Erreur prévisions simplifiées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des prévisions',
      error: error.message
    });
  }
});

export default router;