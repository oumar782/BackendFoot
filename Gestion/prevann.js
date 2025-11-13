// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Récupérer les statistiques d'annulation en parallèle
    const [
      annulationsMois,
      revenusPerdusMois,
      terrainsAffectes,
      tauxAnnulation,
      statsTempsReel,
      annulationsAnnee,
      motifsAnnulation
    ] = await Promise.all([
      // Annulations du mois actuel
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Revenus perdus du mois
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Terrains les plus affectés par les annulations
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_affectes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annulations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui
        FROM reservation
      `),
      
      // Annulations de l'année
      db.query(`
        SELECT COUNT(*) as annulations_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Motifs d'annulation les plus fréquents
      db.query(`
        SELECT 
          motif_annulation,
          COUNT(*) as nombre_annulations,
          ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée'), 0)), 2) as pourcentage
        FROM reservation 
        WHERE statut = 'annulée'
        AND motif_annulation IS NOT NULL
        GROUP BY motif_annulation
        ORDER BY nombre_annulations DESC
        LIMIT 5
      `)
    ]);

    const stats = {
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      terrains_affectes: parseInt(terrainsAffectes.rows[0]?.terrains_affectes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annulations_aujourdhui: parseInt(statsTempsReel.rows[0]?.annulations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel.rows[0]?.total_aujourdhui || 0),
      annulations_annee: parseInt(annulationsAnnee.rows[0]?.annulations_annee || 0),
      motifs_annulation: motifsAnnulation.rows
    };

    // Calcul des trends pour les annulations
    const trends = await calculateTrendsAnnulations(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations dashboard:', error);
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
        COUNT(r.numeroreservations) as annulations,
        COALESCE(SUM(r.tarif), 0) as revenus_perdus,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as reservations_confirmees,
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

// 🎯 Analyse détaillée des annulations par terrain
router.get('/analyse-annulations-terrains', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as total_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        COUNT(DISTINCT EXTRACT(MONTH FROM datereservation)) as mois_affectes,
        ROUND(
          (COUNT(*) * 100.0 / 
          (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '90 days')
          ), 2
        ) as part_annulations_total,
        -- Taux d'annulation spécifique au terrain
        ROUND(
          (COUNT(*) * 100.0 / NULLIF((
            SELECT COUNT(*) 
            FROM reservation r2 
            WHERE r2.numeroterrain = reservation.numeroterrain 
            AND r2.datereservation >= CURRENT_DATE - INTERVAL '90 days'
          ), 0)
          ), 2
        ) as taux_annulation_terrain
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY total_annulations DESC, revenus_perdus DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse annulations terrains:', error);
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
      WITH stats_jour_semaine AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          TO_CHAR(datereservation, 'Day') as nom_jour,
          COUNT(*) as annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus,
          ROUND(AVG(tarif), 2) as perte_moyenne
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
        ORDER BY jour_semaine
      ),
      stats_heure AS (
        SELECT 
          EXTRACT(HOUR FROM heuredebut) as heure_jour,
          COUNT(*) as annulations,
          ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée'), 0)), 2) as pourcentage
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
          AND heuredebut IS NOT NULL
        GROUP BY EXTRACT(HOUR FROM heuredebut)
        ORDER BY heure_jour
      ),
      stats_mois AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(*) as annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus
        FROM reservation 
        WHERE statut = 'annulée'
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month')
        ORDER BY mois
      )
      SELECT 
        (SELECT json_agg(row_to_json(stats_jour_semaine)) FROM stats_jour_semaine) as par_jour_semaine,
        (SELECT json_agg(row_to_json(stats_heure)) FROM stats_heure) as par_heure,
        (SELECT json_agg(row_to_json(stats_mois)) FROM stats_mois) as par_mois
    `);

    res.json({
      success: true,
      data: result.rows[0],
      periode_analyse: parseInt(periode)
    });
  } catch (error) {
    console.error('❌ Erreur analyse temporelle annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔍 Détails des motifs d'annulation
router.get('/motifs-annulation', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const result = await db.query(`
      SELECT 
        motif_annulation,
        COUNT(*) as nombre_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        MIN(datereservation) as premiere_annulation,
        MAX(datereservation) as derniere_annulation,
        COUNT(DISTINCT numeroterrain) as terrains_affectes,
        ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée'), 0)), 2) as pourcentage_total
      FROM reservation 
      WHERE statut = 'annulée'
      GROUP BY motif_annulation
      ORDER BY nombre_annulations DESC
      LIMIT $1
    `, [limit]);

    // Statistiques supplémentaires sur les motifs
    const statsMotifs = await db.query(`
      SELECT 
        COUNT(DISTINCT motif_annulation) as total_motifs_différents,
        COUNT(CASE WHEN motif_annulation IS NULL THEN 1 END) as annulations_sans_motif,
        ROUND(AVG(CASE WHEN motif_annulation IS NOT NULL THEN 1 ELSE 0 END * 100.0), 2) as taux_remplissage_motif
      FROM reservation 
      WHERE statut = 'annulée'
    `);

    res.json({
      success: true,
      data: {
        motifs: result.rows,
        statistiques: statsMotifs.rows[0]
      }
    });
  } catch (error) {
    console.error('❌ Erreur motifs annulation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Prévisions d'annulations
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH historique_annulations AS (
        SELECT 
          datereservation,
          COUNT(*) as annulations_jour,
          COALESCE(SUM(tarif), 0) as pertes_jour
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
        GROUP BY datereservation
      ),
      tendances AS (
        SELECT 
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes_par_jour,
          ROUND(AVG(pertes_jour), 2) as pertes_moyennes_par_jour,
          ROUND(STDDEV(annulations_jour), 2) as ecart_type_annulations,
          MAX(annulations_jour) as annulations_max_jour,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY annulations_jour) as annulations_seuil_alerte
        FROM historique_annulations
      ),
      predictions AS (
        SELECT 
          CURRENT_DATE + (n || ' days')::INTERVAL as date_prediction,
          (SELECT annulations_moyennes_par_jour FROM tendances) as annulations_prevues,
          (SELECT pertes_moyennes_par_jour FROM tendances) as pertes_prevues,
          (SELECT annulations_seuil_alerte FROM tendances) as seuil_alerte
        FROM generate_series(1, $1::int) n
      )
      SELECT 
        date_prediction::date as date,
        TO_CHAR(date_prediction, 'DD/MM') as date_formattee,
        TO_CHAR(date_prediction, 'Day') as jour_semaine,
        ROUND(annulations_prevues) as annulations_prevues,
        ROUND(pertes_prevues) as pertes_prevues,
        seuil_alerte,
        CASE 
          WHEN annulations_prevues > seuil_alerte THEN 'risque_eleve'
          WHEN annulations_prevues > (seuil_alerte * 0.7) THEN 'risque_modere'
          ELSE 'risque_faible'
        END as niveau_risque
      FROM predictions
      ORDER BY date_prediction ASC
    `, [periode]);

    // Calcul des statistiques de prévision
    const stats = {
      annulations_total_prevues: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.annulations_prevues), 0)),
      pertes_total_prevues: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.pertes_prevues), 0)),
      jours_risque_eleve: result.rows.filter(row => row.niveau_risque === 'risque_eleve').length,
      jours_risque_modere: result.rows.filter(row => row.niveau_risque === 'risque_modere').length,
      periode_prediction: parseInt(periode)
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      periode_analyse: parseInt(periode)
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

// 📈 Analyse comparative annulations vs confirmations
router.get('/comparatif-annulations-confirmations', async (req, res) => {
  try {
    const result = await db.query(`
      WITH stats_comparatives AS (
        SELECT 
          datereservation,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
          COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenus_gagnes,
          COUNT(*) as total_reservations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY datereservation
      )
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'DD/MM/YYYY') as date_formattee,
        annulations,
        confirmations,
        revenus_perdus,
        revenus_gagnes,
        total_reservations,
        ROUND((annulations * 100.0 / NULLIF(total_reservations, 0)), 2) as taux_annulation_jour,
        ROUND((confirmations * 100.0 / NULLIF(total_reservations, 0)), 2) as taux_confirmation_jour,
        CASE 
          WHEN (annulations * 100.0 / NULLIF(total_reservations, 0)) > 20 THEN 'taux_eleve'
          WHEN (annulations * 100.0 / NULLIF(total_reservations, 0)) > 10 THEN 'taux_modere'
          ELSE 'taux_faible'
        END as severite_annulation
      FROM stats_comparatives
      ORDER BY datereservation DESC
    `);

    // Statistiques globales
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(*) as total_reservations_30j,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations_30j,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations_30j,
        ROUND((COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_annulation_global,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_30j,
        COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenus_gagnes_30j
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
    `);

    res.json({
      success: true,
      data: {
        quotidien: result.rows,
        global: statsGlobales.rows[0]
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse comparative:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends des annulations
async function calculateTrendsAnnulations(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COUNT(*) as annulations_mois_dernier,
        COALESCE(SUM(tarif), 0) as revenus_perdus_mois_dernier
      FROM reservation 
      WHERE statut = 'annulée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
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
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier // Moins de pertes = positif
      },
      taux_annulation: {
        value: calculatePercentageChange(currentStats.taux_annulation, 
          lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + 50)), // Estimation
        isPositive: currentStats.taux_annulation < (lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + 50))
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;