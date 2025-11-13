// routes/stats-annulations.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 STATISTIQUES PRÉDICTIVES D'ANNULATIONS - Tableau de bord complet
router.get('/previsions-annulations-complet', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    const periodeInt = parseInt(periode);

    console.log(`📊 Chargement des prévisions annulations pour ${periodeInt} jours...`);

    // Récupération en parallèle de toutes les données nécessaires
    const [
      previsionsQuotidiennes,
      previsionsMensuelles,
      risquesFinanciers,
      analyseHistorique,
      alertesRisques
    ] = await Promise.all([
      // 1. Prévisions quotidiennes détaillées avec risques
      db.query(`
        WITH dates_futures AS (
          SELECT generate_series(
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '${periodeInt} days',
            '1 day'::interval
          )::date as date_future
        ),
        reservations_confirmees AS (
          SELECT 
            datereservation,
            COUNT(*) as nb_reservations,
            COUNT(DISTINCT numeroterrain) as nb_terrains,
            COALESCE(SUM(tarif), 0) as revenu_attendu,
            STRING_AGG(DISTINCT numeroreservations::text, ', ') as ids_reservations,
            STRING_AGG(DISTINCT numeroterrain::text, ', ') as ids_terrains
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periodeInt} days'
          GROUP BY datereservation
        ),
        stats_historiques AS (
          SELECT 
            EXTRACT(DOW FROM datereservation) as jour_semaine,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historiques,
            COUNT(*) as total_reservations_historiques,
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation_historique,
            COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_historiques
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY EXTRACT(DOW FROM datereservation)
        )
        SELECT 
          df.date_future,
          TO_CHAR(df.date_future, 'YYYY-MM-DD') as date_iso,
          TO_CHAR(df.date_future, 'DD/MM/YYYY') as date_formattee,
          TO_CHAR(df.date_future, 'Day') as jour_semaine,
          EXTRACT(DOW FROM df.date_future) as num_jour_semaine,
          
          -- Réservations confirmées
          COALESCE(rc.nb_reservations, 0) as reservations_confirmees,
          COALESCE(rc.nb_terrains, 0) as terrains_reserves,
          COALESCE(rc.revenu_attendu, 0) as revenu_attendu,
          rc.ids_reservations,
          rc.ids_terrains,
          
          -- Analyse prédictive basée sur l'historique
          COALESCE(sh.annulations_historiques, 0) as annulations_historiques_jour,
          COALESCE(sh.taux_annulation_historique, 0) as taux_annulation_historique,
          COALESCE(sh.revenus_perdus_historiques, 0) as revenus_perdus_historiques,
          
          -- Prévisions d'annulations pour ce jour
          ROUND(
            COALESCE(rc.nb_reservations, 0) * 
            (COALESCE(sh.taux_annulation_historique, 0) / 100.0)
          ) as annulations_prevues_nombre,
          
          -- Revenus à risque pour ce jour
          ROUND(
            COALESCE(rc.revenu_attendu, 0) * 
            (COALESCE(sh.taux_annulation_historique, 0) / 100.0),
            2
          ) as revenus_risque_jour,
          
          -- Niveau de risque
          CASE 
            WHEN COALESCE(sh.taux_annulation_historique, 0) > 20 THEN 'Élevé'
            WHEN COALESCE(sh.taux_annulation_historique, 0) > 10 THEN 'Modéré'
            ELSE 'Faible'
          END as niveau_risque,
          
          -- Impact financier
          CASE 
            WHEN (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sh.taux_annulation_historique, 0) / 100.0)) > 500 THEN 'Critique'
            WHEN (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sh.taux_annulation_historique, 0) / 100.0)) > 200 THEN 'Important'
            WHEN (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sh.taux_annulation_historique, 0) / 100.0)) > 50 THEN 'Modéré'
            ELSE 'Négligeable'
          END as impact_financier

        FROM dates_futures df
        LEFT JOIN reservations_confirmees rc ON rc.datereservation = df.date_future
        LEFT JOIN stats_historiques sh ON sh.jour_semaine = EXTRACT(DOW FROM df.date_future)
        ORDER BY df.date_future ASC
      `),

      // 2. Prévisions mensuelles consolidées
      db.query(`
        WITH mois_futurs AS (
          SELECT 
            EXTRACT(MONTH FROM generate_series) as mois,
            EXTRACT(YEAR FROM generate_series) as annee,
            TO_CHAR(generate_series, 'Mon YYYY') as periode_mois,
            MIN(generate_series) as date_debut_mois,
            MAX(generate_series) as date_fin_mois
          FROM generate_series(
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '${periodeInt} days',
            '1 month'::interval
          ) generate_series
          GROUP BY EXTRACT(MONTH FROM generate_series), EXTRACT(YEAR FROM generate_series), TO_CHAR(generate_series, 'Mon YYYY')
        ),
        reservations_mensuelles AS (
          SELECT 
            EXTRACT(MONTH FROM datereservation) as mois,
            EXTRACT(YEAR FROM datereservation) as annee,
            COUNT(*) as reservations_confirmees,
            COALESCE(SUM(tarif), 0) as revenu_attendu_mois,
            COUNT(DISTINCT numeroterrain) as terrains_occupes
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periodeInt} days'
          GROUP BY EXTRACT(MONTH FROM datereservation), EXTRACT(YEAR FROM datereservation)
        ),
        historique_annulations_mensuelles AS (
          SELECT 
            EXTRACT(MONTH FROM datereservation) as mois,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historiques,
            COUNT(*) as total_reservations_historiques,
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation_mensuel,
            COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_moyens
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
          GROUP BY EXTRACT(MONTH FROM datereservation)
        )
        SELECT 
          mf.mois,
          mf.annee,
          mf.periode_mois,
          mf.date_debut_mois,
          mf.date_fin_mois,
          
          -- Réservations du mois
          COALESCE(rm.reservations_confirmees, 0) as reservations_confirmees,
          COALESCE(rm.revenu_attendu_mois, 0) as revenu_attendu_mois,
          COALESCE(rm.terrains_occupes, 0) as terrains_occupes,
          
          -- Analyse prédictive mensuelle
          COALESCE(ham.annulations_historiques, 0) as annulations_historiques_mois,
          COALESCE(ham.taux_annulation_mensuel, 0) as taux_annulation_historique_mois,
          COALESCE(ham.revenus_perdus_moyens, 0) as revenus_perdus_moyens_mois,
          
          -- Prévisions mensuelles
          ROUND(
            COALESCE(rm.reservations_confirmees, 0) * 
            (COALESCE(ham.taux_annulation_mensuel, 0) / 100.0)
          ) as annulations_prevues_mois,
          
          -- Revenus à risque mensuels
          ROUND(
            COALESCE(rm.revenu_attendu_mois, 0) * 
            (COALESCE(ham.taux_annulation_mensuel, 0) / 100.0),
            2
          ) as revenus_risque_mois,
          
          -- Impact financier mensuel
          CASE 
            WHEN (COALESCE(rm.revenu_attendu_mois, 0) * (COALESCE(ham.taux_annulation_mensuel, 0) / 100.0)) > 2000 THEN 'Très Élevé'
            WHEN (COALESCE(rm.revenu_attendu_mois, 0) * (COALESCE(ham.taux_annulation_mensuel, 0) / 100.0)) > 1000 THEN 'Élevé'
            WHEN (COALESCE(rm.revenu_attendu_mois, 0) * (COALESCE(ham.taux_annulation_mensuel, 0) / 100.0)) > 500 THEN 'Modéré'
            ELSE 'Faible'
          END as impact_financier_mois

        FROM mois_futurs mf
        LEFT JOIN reservations_mensuelles rm ON rm.mois = mf.mois AND rm.annee = mf.annee
        LEFT JOIN historique_annulations_mensuelles ham ON ham.mois = mf.mois
        ORDER BY mf.annee, mf.mois
      `),

      // 3. Analyse des risques financiers globaux
      db.query(`
        WITH reservations_futures AS (
          SELECT 
            COUNT(*) as total_reservations_prevues,
            COALESCE(SUM(tarif), 0) as total_revenu_attendu,
            COUNT(DISTINCT numeroterrain) as total_terrains_occupes,
            COUNT(DISTINCT idclient) as total_clients_concernes
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        ),
        historique_recent AS (
          SELECT 
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation_moyen_90j,
            COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_90j,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations_90j,
            
            -- Taux d'annulation par type de terrain
            ROUND(
              (COUNT(CASE WHEN typeterrain = 'football' AND statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(CASE WHEN typeterrain = 'football' THEN 1 END), 0)
              ), 2
            ) as taux_annulation_football,
            
            ROUND(
              (COUNT(CASE WHEN typeterrain = 'basketball' AND statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(CASE WHEN typeterrain = 'basketball' THEN 1 END), 0)
              ), 2
            ) as taux_annulation_basketball,
            
            ROUND(
              (COUNT(CASE WHEN typeterrain = 'tennis' AND statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(CASE WHEN typeterrain = 'tennis' THEN 1 END), 0)
              ), 2
            ) as taux_annulation_tennis
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
        ),
        jours_risque AS (
          SELECT 
            EXTRACT(DOW FROM datereservation) as jour_semaine,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_jour,
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation_jour
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY EXTRACT(DOW FROM datereservation)
        )
        SELECT 
          rf.total_reservations_prevues,
          rf.total_revenu_attendu,
          rf.total_terrains_occupes,
          rf.total_clients_concernes,
          
          hr.taux_annulation_moyen_90j,
          hr.revenus_perdus_90j,
          hr.total_annulations_90j,
          hr.taux_annulation_football,
          hr.taux_annulation_basketball,
          hr.taux_annulation_tennis,
          
          -- Prévisions globales
          ROUND(rf.total_reservations_prevues * (hr.taux_annulation_moyen_90j / 100.0)) as annulations_prevues_total,
          ROUND(rf.total_revenu_attendu * (hr.taux_annulation_moyen_90j / 100.0), 2) as revenus_risque_total,
          
          -- Jours à haut risque
          (SELECT COUNT(*) FROM jours_risque WHERE taux_annulation_jour > 15) as jours_haut_risque_semaine,
          
          -- Niveau de risque global
          CASE 
            WHEN hr.taux_annulation_moyen_90j > 20 THEN 'Très Élevé'
            WHEN hr.taux_annulation_moyen_90j > 15 THEN 'Élevé'
            WHEN hr.taux_annulation_moyen_90j > 10 THEN 'Modéré'
            ELSE 'Faible'
          END as niveau_risque_global,
          
          -- Recommandations
          CASE 
            WHEN hr.taux_annulation_moyen_90j > 20 THEN 'Mise en place urgente de mesures de rétention'
            WHEN hr.taux_annulation_moyen_90j > 15 THEN 'Renforcement des politiques d''annulation'
            WHEN hr.taux_annulation_moyen_90j > 10 THEN 'Surveillance accrue des réservations'
            ELSE 'Situation sous contrôle'
          END as recommandation

        FROM reservations_futures rf, historique_recent hr
      `),

      // 4. Analyse historique pour tendances
      db.query(`
        WITH historique_annulations AS (
          SELECT 
            DATE_TRUNC('day', datereservation) as date_jour,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
            COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
            COUNT(*) as total_reservations,
            COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY DATE_TRUNC('day', datereservation)
        )
        SELECT 
          date_jour,
          TO_CHAR(date_jour, 'DD/MM/YYYY') as date_formattee,
          annulations,
          confirmations,
          total_reservations,
          revenus_perdus,
          taux_annulation,
          
          -- Tendances sur 7 jours
          ROUND(AVG(taux_annulation) OVER (
            ORDER BY date_jour 
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ), 2) as taux_annulation_moyen_7j,
          
          ROUND(AVG(annulations) OVER (
            ORDER BY date_jour 
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ), 2) as annulations_moyennes_7j

        FROM historique_annulations
        ORDER BY date_jour DESC
      `),

      // 5. Alertes et points de vigilance
      db.query(`
        WITH reservations_risque AS (
          SELECT 
            r.datereservation,
            r.numeroreservations,
            r.numeroterrain,
            r.typeterrain,
            r.tarif,
            r.idclient,
            c.nom as client_nom,
            c.prenom as client_prenom,
            
            -- Historique d'annulation du client
            (SELECT COUNT(*) 
             FROM reservation r2 
             WHERE r2.idclient = r.idclient 
             AND r2.statut = 'annulée'
             AND r2.datereservation >= CURRENT_DATE - INTERVAL '180 days'
            ) as annulations_client_6mois,
            
            -- Taux d'annulation du terrain
            (SELECT ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
             )
             FROM reservation r3 
             WHERE r3.numeroterrain = r.numeroterrain
             AND r3.datereservation >= CURRENT_DATE - INTERVAL '90 days'
            ) as taux_annulation_terrain,
            
            -- Jours avant la réservation
            (r.datereservation - CURRENT_DATE) as jours_avant_reservation

          FROM reservation r
          JOIN clients c ON r.idclient = c.idclient
          WHERE r.statut = 'confirmée'
            AND r.datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periodeInt} days'
        )
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'DD/MM/YYYY') as date_formattee,
          numeroreservations,
          numeroterrain,
          typeterrain,
          tarif,
          client_nom,
          client_prenom,
          annulations_client_6mois,
          taux_annulation_terrain,
          jours_avant_reservation,
          
          -- Score de risque
          CASE 
            WHEN annulations_client_6mois >= 3 THEN 3
            WHEN annulations_client_6mois >= 1 THEN 2
            ELSE 1
          END + 
          CASE 
            WHEN taux_annulation_terrain > 20 THEN 3
            WHEN taux_annulation_terrain > 10 THEN 2
            ELSE 1
          END + 
          CASE 
            WHEN jours_avant_reservation <= 2 THEN 1
            WHEN jours_avant_reservation <= 7 THEN 2
            ELSE 3
          END as score_risque,
          
          -- Niveau d'alerte
          CASE 
            WHEN (
              CASE 
                WHEN annulations_client_6mois >= 3 THEN 3
                WHEN annulations_client_6mois >= 1 THEN 2
                ELSE 1
              END + 
              CASE 
                WHEN taux_annulation_terrain > 20 THEN 3
                WHEN taux_annulation_terrain > 10 THEN 2
                ELSE 1
              END + 
              CASE 
                WHEN jours_avant_reservation <= 2 THEN 1
                WHEN jours_avant_reservation <= 7 THEN 2
                ELSE 3
              END
            ) >= 7 THEN 'Élevé'
            WHEN (
              CASE 
                WHEN annulations_client_6mois >= 3 THEN 3
                WHEN annulations_client_6mois >= 1 THEN 2
                ELSE 1
              END + 
              CASE 
                WHEN taux_annulation_terrain > 20 THEN 3
                WHEN taux_annulation_terrain > 10 THEN 2
                ELSE 1
              END + 
              CASE 
                WHEN jours_avant_reservation <= 2 THEN 1
                WHEN jours_avant_reservation <= 7 THEN 2
                ELSE 3
              END
            ) >= 5 THEN 'Modéré'
            ELSE 'Faible'
          END as niveau_alerte

        FROM reservations_risque
        WHERE (
          annulations_client_6mois >= 1 
          OR taux_annulation_terrain > 10
          OR jours_avant_reservation <= 7
        )
        ORDER BY score_risque DESC, datereservation ASC
        LIMIT 20
      `)
    ]);

    // Calcul des métriques résumées pour le dashboard
    const resumePrevisions = {
      periode_jours: periodeInt,
      reservations_prevues_total: risquesFinanciers.rows[0]?.total_reservations_prevues || 0,
      annulations_prevues_total: risquesFinanciers.rows[0]?.annulations_prevues_total || 0,
      revenus_prevus_total: risquesFinanciers.rows[0]?.total_revenu_attendu || 0,
      revenus_risque_total: risquesFinanciers.rows[0]?.revenus_risque_total || 0,
      taux_annulation_moyen: risquesFinanciers.rows[0]?.taux_annulation_moyen_90j || 0,
      niveau_risque_global: risquesFinanciers.rows[0]?.niveau_risque_global || 'Faible',
      jours_analyse: previsionsQuotidiennes.rows.length,
      mois_analyse: previsionsMensuelles.rows.length,
      alertes_actives: alertesRisques.rows.length
    };

    console.log(`✅ Prévisions chargées: ${resumePrevisions.annulations_prevues_total} annulations prévues`);

    res.json({
      success: true,
      data: {
        // Données détaillées par période
        previsions_quotidiennes: previsionsQuotidiennes.rows,
        previsions_mensuelles: previsionsMensuelles.rows,
        
        // Analyses et risques
        risques_financiers: risquesFinanciers.rows[0],
        analyse_historique: analyseHistorique.rows,
        alertes_risques: alertesRisques.rows,
        
        // Métriques résumées
        resume_previsions: resumePrevisions,
        
        // Dernière mise à jour
        derniere_maj: new Date().toISOString(),
        periode_analyse: periodeInt
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions annulations complètes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des prévisions d\'annulations',
      error: error.message
    });
  }
});

// 📈 ROUTE SPÉCIFIQUE: Prévisions financières détaillées (pour composants React)
router.get('/previsions-financieres', async (req, res) => {
  try {
    const { jours = '14' } = req.query;
    const joursInt = parseInt(jours);

    console.log(`💰 Calcul des prévisions financières pour ${joursInt} jours...`);

    const result = await db.query(`
      WITH dates_futures AS (
        SELECT 
          generate_series(
            CURRENT_DATE,
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
          STRING_AGG(DISTINCT r.typeterrain, ', ') as types_terrains,
          STRING_AGG(r.numeroreservations::text, ', ') as ids_reservations
        FROM reservation r
        WHERE r.statut = 'confirmée'
          AND r.datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${joursInt} days'
        GROUP BY r.datereservation
      ),
      stats_annulations_historiques AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_jour,
          ROUND(AVG(
            CASE WHEN statut = 'annulée' THEN tarif ELSE NULL END
          ), 2) as montant_moyen_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      )
      SELECT 
        df.datereservation,
        TO_CHAR(df.datereservation, 'YYYY-MM-DD') as date_iso,
        TO_CHAR(df.datereservation, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(df.datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM df.datereservation) as num_jour_semaine,
        
        -- Données confirmées
        COALESCE(rc.nb_reservations, 0) as reservations_confirmees,
        COALESCE(rc.nb_terrains, 0) as terrains_occupes,
        COALESCE(rc.revenu_attendu, 0) as revenu_attendu,
        COALESCE(rc.types_terrains, 'Aucune') as types_terrains,
        rc.ids_reservations,
        
        -- Analyse prédictive
        COALESCE(sah.taux_annulation_jour, 8.5) as taux_annulation_prevue, -- 8.5% par défaut si pas de données
        COALESCE(sah.montant_moyen_annulation, 45.0) as montant_moyen_annulation,
        
        -- Calcul des pertes prévues
        ROUND(
          COALESCE(rc.nb_reservations, 0) * 
          (COALESCE(sah.taux_annulation_jour, 8.5) / 100.0)
        ) as annulations_prevues_nombre,
        
        ROUND(
          COALESCE(rc.revenu_attendu, 0) * 
          (COALESCE(sah.taux_annulation_jour, 8.5) / 100.0),
          2
        ) as pertes_financieres_prevues,
        
        -- Revenu net prévu (après déduction des annulations)
        ROUND(
          COALESCE(rc.revenu_attendu, 0) - 
          (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sah.taux_annulation_jour, 8.5) / 100.0)),
          2
        ) as revenu_net_prevue,
        
        -- Indicateurs de performance
        CASE 
          WHEN COALESCE(rc.nb_terrains, 0) > 0 THEN
            ROUND(
              (COALESCE(rc.nb_reservations, 0) * 100.0 / 
              (rc.nb_terrains * 8) -- 8 créneaux max par terrain
              ), 1
            )
          ELSE 0
        END as taux_occupation_prevue,
        
        -- Niveau d'alerte financier
        CASE 
          WHEN (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sah.taux_annulation_jour, 8.5) / 100.0)) > 300 THEN '🔴 Risque Élevé'
          WHEN (COALESCE(rc.revenu_attendu, 0) * (COALESCE(sah.taux_annulation_jour, 8.5) / 100.0)) > 150 THEN '🟡 Risque Modéré'
          ELSE '🟢 Risque Faible'
        END as alerte_financiere

      FROM dates_futures df
      LEFT JOIN reservations_confirmees rc ON rc.datereservation = df.datereservation
      LEFT JOIN stats_annulations_historiques sah ON sah.jour_semaine = EXTRACT(DOW FROM df.datereservation)
      ORDER BY df.datereservation ASC
    `);

    // Calcul des totaux pour la période
    const statsTotaux = result.rows.reduce((acc, jour) => {
      return {
        revenu_total_attendu: acc.revenu_total_attendu + parseFloat(jour.revenu_attendu),
        pertes_total_prevues: acc.pertes_total_prevues + parseFloat(jour.pertes_financieres_prevues),
        revenu_net_total: acc.revenu_net_total + parseFloat(jour.revenu_net_prevue),
        reservations_total: acc.reservations_total + parseInt(jour.reservations_confirmees),
        annulations_total_prevues: acc.annulations_total_prevues + parseInt(jour.annulations_prevues_nombre)
      };
    }, {
      revenu_total_attendu: 0,
      pertes_total_prevues: 0,
      revenu_net_total: 0,
      reservations_total: 0,
      annulations_total_prevues: 0
    });

    // Calcul du taux d'annulation moyen prévu
    const tauxAnnulationMoyen = result.rows.length > 0 
      ? result.rows.reduce((sum, jour) => sum + parseFloat(jour.taux_annulation_prevue), 0) / result.rows.length
      : 0;

    console.log(`✅ Prévisions financières calculées: ${statsTotaux.perte_total_prevues}€ de pertes prévues`);

    res.json({
      success: true,
      data: {
        previsions_jour_par_jour: result.rows,
        resume_financier: {
          periode_jours: joursInt,
          ...statsTotaux,
          taux_annulation_moyen_prevue: Math.round(tauxAnnulationMoyen * 100) / 100,
          jours_avec_risque_eleve: result.rows.filter(j => j.alerte_financiere.includes('Élevé')).length,
          jours_avec_risque_modere: result.rows.filter(j => j.alerte_financiere.includes('Modéré')).length
        },
        metadata: {
          date_debut: result.rows[0]?.date_formattee,
          date_fin: result.rows[result.rows.length - 1]?.date_formattee,
          derniere_maj: new Date().toISOString(),
          methode_calcul: "Analyse historique sur 90 jours + tendances saisonnières"
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions financières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des prévisions financières',
      error: error.message
    });
  }
});

export default router;