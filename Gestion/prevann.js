// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 🔮 PRÉVISIONS D'ANNULATIONS DÉTAILLÉES - Par jour et par mois
router.get('/previsions-annulations-detaillees', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    const periodeInt = parseInt(periode);

    console.log(`📊 Chargement des prévisions d'annulations pour ${periodeInt} jours...`);

    // 1. PRÉVISIONS QUOTIDIENNES DÉTAILLÉES
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
          COUNT(DISTINCT numeroterrain) as terrains_reserves,
          STRING_AGG(DISTINCT numeroreservations::text, ', ') as ids_reservations
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        GROUP BY datereservation
      ),
      historique_annulations AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as annulations_historiques,
          COUNT(DISTINCT numeroterrain) as terrains_affectes_historique,
          COALESCE(SUM(tarif), 0) as revenus_perdus_historique,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation rh2 
               WHERE EXTRACT(DOW FROM rh2.datereservation) = EXTRACT(DOW FROM reservation.datereservation)
               AND rh2.datereservation >= CURRENT_DATE - INTERVAL '90 days'
              ), 0
            )), 2
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
        COALESCE(rc.terrains_reserves, 0) as terrains_reserves,
        COALESCE(rc.ids_reservations, 'Aucune') as ids_reservations,
        
        -- Prévisions d'annulations basées sur l'historique
        COALESCE(ha.annulations_historiques, 0) as annulations_prevues_nombre,
        COALESCE(ha.taux_annulation_historique, 0) as taux_annulation_prevue,
        COALESCE(ha.terrains_affectes_historique, 0) as terrains_affectes_prevus,
        
        -- Estimation des pertes financières
        ROUND(
          COALESCE(rc.revenu_attendu, 0) * 
          COALESCE(ha.taux_annulation_historique, 0) / 100, 
          2
        ) as pertes_prevues_jour,
        
        -- Niveau de risque
        CASE 
          WHEN COALESCE(ha.taux_annulation_historique, 0) > 20 THEN 'Élevé'
          WHEN COALESCE(ha.taux_annulation_historique, 0) > 10 THEN 'Modéré'
          ELSE 'Faible'
        END as niveau_risque,
        
        -- Détail des pertes par terrain (estimation)
        CASE 
          WHEN COALESCE(rc.terrains_reserves, 0) > 0 THEN
            ROUND(
              (COALESCE(rc.revenu_attendu, 0) * COALESCE(ha.taux_annulation_historique, 0) / 100) / 
              NULLIF(rc.terrains_reserves, 0), 
              2
            )
          ELSE 0
        END as perte_moyenne_par_terrain

      FROM dates_futures df
      LEFT JOIN reservations_confirmees rc ON rc.datereservation = df.date_future
      LEFT JOIN historique_annulations ha ON ha.jour_semaine = EXTRACT(DOW FROM df.date_future)
      ORDER BY df.date_future ASC
    `);

    // 2. PRÉVISIONS MENSUELLES
    const previsionsMensuelles = await db.query(`
      WITH mois_futurs AS (
        SELECT 
          EXTRACT(MONTH FROM generate_series) as mois,
          EXTRACT(YEAR FROM generate_series) as annee,
          TO_CHAR(generate_series, 'Mon YYYY') as periode_mois,
          DATE_TRUNC('month', generate_series) as date_debut_mois,
          (DATE_TRUNC('month', generate_series) + INTERVAL '1 month - 1 day')::date as date_fin_mois
        FROM generate_series(
          CURRENT_DATE,
          CURRENT_DATE + INTERVAL '${periodeInt} days',
          '1 month'::interval
        ) generate_series
        GROUP BY EXTRACT(MONTH FROM generate_series), EXTRACT(YEAR FROM generate_series), 
                 TO_CHAR(generate_series, 'Mon YYYY'), DATE_TRUNC('month', generate_series)
      ),
      reservations_mensuelles AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          EXTRACT(YEAR FROM datereservation) as annee,
          COUNT(*) as reservations_confirmees,
          COALESCE(SUM(tarif), 0) as revenu_attendu_mois,
          COUNT(DISTINCT numeroterrain) as terrains_reserves_mois,
          COUNT(DISTINCT idclient) as clients_concernes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        GROUP BY EXTRACT(MONTH FROM datereservation), EXTRACT(YEAR FROM datereservation)
      ),
      historique_annulations_mensuel AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          COUNT(*) as annulations_historiques_mois,
          COALESCE(SUM(tarif), 0) as revenus_perdus_historique_mois,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation rh2 
               WHERE EXTRACT(MONTH FROM rh2.datereservation) = EXTRACT(MONTH FROM reservation.datereservation)
               AND EXTRACT(YEAR FROM rh2.datereservation) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
              ), 0
            )), 2
          ) as taux_annulation_historique_mois
        FROM reservation 
        WHERE statut = 'annulée'
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
        GROUP BY EXTRACT(MONTH FROM datereservation)
      )
      SELECT 
        mf.mois,
        mf.annee,
        mf.periode_mois,
        TO_CHAR(mf.date_debut_mois, 'DD/MM/YYYY') as date_debut_mois,
        TO_CHAR(mf.date_fin_mois, 'DD/MM/YYYY') as date_fin_mois,
        
        -- Réservations du mois
        COALESCE(rm.reservations_confirmees, 0) as reservations_confirmees,
        COALESCE(rm.revenu_attendu_mois, 0) as revenu_attendu_mois,
        COALESCE(rm.terrains_reserves_mois, 0) as terrains_reserves_mois,
        COALESCE(rm.clients_concernes, 0) as clients_concernes,
        
        -- Prévisions d'annulations mensuelles
        COALESCE(ham.annulations_historiques_mois, 0) as annulations_prevues_mois,
        COALESCE(ham.taux_annulation_historique_mois, 0) as taux_annulation_prevue_mois,
        
        -- Pertes financières mensuelles prévues
        ROUND(
          COALESCE(rm.revenu_attendu_mois, 0) * 
          COALESCE(ham.taux_annulation_historique_mois, 0) / 100, 
          2
        ) as pertes_prevues_mois,
        
        -- Estimation des pertes par terrain
        CASE 
          WHEN COALESCE(rm.terrains_reserves_mois, 0) > 0 THEN
            ROUND(
              (COALESCE(rm.revenu_attendu_mois, 0) * COALESCE(ham.taux_annulation_historique_mois, 0) / 100) / 
              NULLIF(rm.terrains_reserves_mois, 0), 
              2
            )
          ELSE 0
        END as perte_moyenne_par_terrain_mois,
        
        -- Niveau de risque mensuel
        CASE 
          WHEN COALESCE(ham.taux_annulation_historique_mois, 0) > 20 THEN 'Élevé'
          WHEN COALESCE(ham.taux_annulation_historique_mois, 0) > 10 THEN 'Modéré'
          ELSE 'Faible'
        END as niveau_risque_mois

      FROM mois_futurs mf
      LEFT JOIN reservations_mensuelles rm ON rm.mois = mf.mois AND rm.annee = mf.annee
      LEFT JOIN historique_annulations_mensuel ham ON ham.mois = mf.mois
      ORDER BY mf.annee, mf.mois
    `);

    // 3. STATISTIQUES GLOBALES DES PRÉVISIONS
    const statsGlobales = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          COUNT(*) as total_reservations_prevues,
          COALESCE(SUM(tarif), 0) as total_revenu_attendu,
          COUNT(DISTINCT numeroterrain) as total_terrains_concernes,
          COUNT(DISTINCT idclient) as total_clients_concernes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '${periodeInt} days'
      ),
      historique_annulations AS (
        SELECT 
          ROUND(AVG(taux_annulation), 2) as taux_annulation_moyen,
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes_jour,
          SUM(revenus_perdus) as revenus_perdus_90j
        FROM (
          SELECT 
            datereservation,
            COUNT(*) as annulations_jour,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            ROUND(
              (COUNT(*) * 100.0 / NULLIF(
                (SELECT COUNT(*) FROM reservation rh2 
                 WHERE rh2.datereservation = reservation.datereservation
                ), 0
              )), 2
            ) as taux_annulation
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY datereservation
        ) stats_jour
      )
      SELECT 
        rf.total_reservations_prevues,
        rf.total_revenu_attendu,
        rf.total_terrains_concernes,
        rf.total_clients_concernes,
        
        ha.taux_annulation_moyen,
        ha.annulations_moyennes_jour,
        ha.revenus_perdus_90j,
        
        -- Prévisions globales
        ROUND(rf.total_reservations_prevues * ha.taux_annulation_moyen / 100) as annulations_prevues_total,
        ROUND(rf.total_revenu_attendu * ha.taux_annulation_moyen / 100, 2) as pertes_prevues_total,
        
        -- Métriques par jour
        ROUND(rf.total_reservations_prevues / ${periodeInt}) as reservations_moyennes_par_jour,
        ROUND((rf.total_reservations_prevues * ha.taux_annulation_moyen / 100) / ${periodeInt}, 1) as annulations_moyennes_par_jour,
        
        -- Alertes
        CASE 
          WHEN ha.taux_annulation_moyen > 15 THEN '🔴 Risque Élevé'
          WHEN ha.taux_annulation_moyen > 8 THEN '🟡 Risque Modéré'
          ELSE '🟢 Risque Faible'
        END as alerte_globale,
        
        -- Jours à haut risque dans la période
        (
          SELECT COUNT(*)
          FROM (
            SELECT DISTINCT EXTRACT(DOW FROM df.date_future) as jour
            FROM generate_series(
              CURRENT_DATE + INTERVAL '1 day',
              CURRENT_DATE + INTERVAL '${periodeInt} days',
              '1 day'::interval
            )::date as date_future
          ) jours_futurs
          JOIN (
            SELECT EXTRACT(DOW FROM datereservation) as jour_risque
            FROM reservation 
            WHERE statut = 'annulée'
              AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY EXTRACT(DOW FROM datereservation)
            HAVING COUNT(*) > ha.annulations_moyennes_jour * 1.5
          ) jours_risque ON jours_risque.jour_risque = jours_futurs.jour
        ) as jours_haut_risque

      FROM reservations_futures rf, historique_annulations ha
    `);

    console.log(`✅ Prévisions chargées: ${previsionsQuotidiennes.rows.length} jours, ${previsionsMensuelles.rows.length} mois`);

    res.json({
      success: true,
      data: {
        // Données détaillées
        previsions_quotidiennes: previsionsQuotidiennes.rows,
        previsions_mensuelles: previsionsMensuelles.rows,
        
        // Résumé pour le dashboard
        resume_global: {
          periode_jours: periodeInt,
          total_reservations_prevues: statsGlobales.rows[0]?.total_reservations_prevues || 0,
          total_revenu_attendu: statsGlobales.rows[0]?.total_revenu_attendu || 0,
          annulations_prevues_total: statsGlobales.rows[0]?.annulations_prevues_total || 0,
          pertes_prevues_total: statsGlobales.rows[0]?.pertes_prevues_total || 0,
          taux_annulation_moyen: statsGlobales.rows[0]?.taux_annulation_moyen || 0,
          alerte_globale: statsGlobales.rows[0]?.alerte_globale || '🟢 Risque Faible',
          jours_haut_risque: statsGlobales.rows[0]?.jours_haut_risque || 0,
          terrains_concernes: statsGlobales.rows[0]?.total_terrains_concernes || 0,
          clients_concernes: statsGlobales.rows[0]?.total_clients_concernes || 0
        },
        
        // Statistiques détaillées
        statistiques_globales: statsGlobales.rows[0],
        
        // Métadonnées
        metadata: {
          periode_analyse: periodeInt,
          date_generation: new Date().toISOString(),
          jours_analyse: previsionsQuotidiennes.rows.length,
          mois_analyse: previsionsMensuelles.rows.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions annulations détaillées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des prévisions d\'annulations',
      error: error.message
    });
  }
});

// 📊 TABLEAU DE BORD SYNTHÈSE ANNULATIONS
router.get('/synthese-previsions-annulations', async (req, res) => {
  try {
    const [
      statsMoisCourant,
      previsionsSemaine,
      topTerrainsRisque,
      alertesImmediates
    ] = await Promise.all([
      // Statistiques du mois courant
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois_courant,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_mois_courant,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes_mois_courant,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_mois_courant
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Prévisions pour les 7 prochains jours
      db.query(`
        WITH jours_futurs AS (
          SELECT generate_series(
            CURRENT_DATE + INTERVAL '1 day',
            CURRENT_DATE + INTERVAL '7 days',
            '1 day'::interval
          )::date as date_future
        )
        SELECT 
          jf.date_future,
          TO_CHAR(jf.date_future, 'DD/MM') as date_courte,
          TO_CHAR(jf.date_future, 'Day') as jour_semaine,
          COUNT(r.numeroreservations) as reservations_confirmees,
          COALESCE(SUM(r.tarif), 0) as revenu_attendu,
          ROUND(
            COALESCE(SUM(r.tarif), 0) * 
            (
              SELECT COALESCE(taux_annulation_historique, 0) / 100
              FROM (
                SELECT 
                  EXTRACT(DOW FROM datereservation) as jour_semaine,
                  ROUND(
                    (COUNT(*) * 100.0 / NULLIF(
                      (SELECT COUNT(*) FROM reservation rh2 
                       WHERE EXTRACT(DOW FROM rh2.datereservation) = EXTRACT(DOW FROM reservation.datereservation)
                       AND rh2.datereservation >= CURRENT_DATE - INTERVAL '60 days'
                      ), 0
                    )), 2
                  ) as taux_annulation_historique
                FROM reservation 
                WHERE statut = 'annulée'
                  AND datereservation >= CURRENT_DATE - INTERVAL '60 days'
                GROUP BY EXTRACT(DOW FROM datereservation)
              ) ha WHERE ha.jour_semaine = EXTRACT(DOW FROM jf.date_future)
            ), 2
          ) as pertes_prevues
        FROM jours_futurs jf
        LEFT JOIN reservation r ON r.datereservation = jf.date_future AND r.statut = 'confirmée'
        GROUP BY jf.date_future
        ORDER BY jf.date_future ASC
      `),
      
      // Terrains à haut risque d'annulation
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_passees,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as reservations_futures,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_historique,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes_passees
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          OR (datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' AND statut = 'confirmée')
        GROUP BY numeroterrain, nomterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
           AND COUNT(CASE WHEN statut = 'confirmée' AND datereservation >= CURRENT_DATE THEN 1 END) > 0
        ORDER BY taux_annulation_historique DESC
        LIMIT 5
      `),
      
      // Alertes immédiates (aujourd'hui et demain)
      db.query(`
        SELECT 
          datereservation,
          COUNT(*) as reservations_risque,
          COALESCE(SUM(tarif), 0) as revenu_risque,
          STRING_AGG(DISTINCT numeroterrain::text, ', ') as terrains_concernes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
          AND EXTRACT(DOW FROM datereservation) IN (
            SELECT EXTRACT(DOW FROM datereservation) as jour_risque
            FROM reservation 
            WHERE statut = 'annulée'
              AND datereservation >= CURRENT_DATE - INTERVAL '60 days'
            GROUP BY EXTRACT(DOW FROM datereservation)
            HAVING COUNT(*) > (
              SELECT AVG(annulations_jour) 
              FROM (
                SELECT COUNT(*) as annulations_jour
                FROM reservation 
                WHERE statut = 'annulée'
                  AND datereservation >= CURRENT_DATE - INTERVAL '60 days'
                GROUP BY datereservation
              ) stats
            )
          )
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    res.json({
      success: true,
      data: {
        stats_mois_courant: statsMoisCourant.rows[0],
        previsions_semaine: previsionsSemaine.rows,
        terrains_risque: topTerrainsRisque.rows,
        alertes_immediates: alertesImmediates.rows,
        derniere_maj: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Erreur synthèse prévisions annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;